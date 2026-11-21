import { Router } from 'express';
import fs from 'node:fs';
import { config } from '../config.js';
import { getDb, audit } from '../db.js';
import { logger } from '../logger.js';
import { verifyPassword, hashPassword } from '../migrate.js';
import { requireAdmin, sameOrigin, issueSession, setSessionCookie, clearSessionCookie, clientIp, loginLockRemaining, recordLoginAttempt } from './auth.js';
import { loginPage, dashboardPage, ordersPage, orderPage, paymentsPage, jobsPage, settingsPage, promoPage } from '../views/admin.js';
import { listOrders, getOrder, orderInput, orderDocuments, transition, statusLabel, revenueSummary } from '../services/orders.js';
import { pendingPayments, refundPayment } from '../services/payments.js';
import { startFulfillment } from '../services/fulfillment.js';
import { recentJobs, queueStats, retryJob, enqueue } from '../services/jobs.js';
import { metricsRange, funnel } from '../services/metrics.js';
import { diskUsage, cleanupExpiredArtefacts, expireStaleOrders } from '../services/retention.js';
import { listDiscounts, createPromo, deactivateDiscount } from '../services/discounts.js';
import { waState } from '../services/wa/baileys.js';
import { checkRouter9 } from '../services/ai/router9.js';
import { formatWIB } from '../util.js';

function flash(res, kind, message) {
  res.redirect(`/admin?${kind}=${encodeURIComponent(message)}`);
}

export function adminRoutes() {
  const r = Router();
  r.use(sameOrigin);

  r.get('/admin', async (req, res, next) => {
    try {
      if (!req.admin) {
        // requireAdmin redirects; lakukan manual agar tidak loop
        const { readSession } = await import('./auth.js');
        if (!readSession(req)) return res.type('html').send(loginPage());
      }
      const db = getDb();
      const today = db.prepare(`
        SELECT COUNT(*) AS c, COALESCE(SUM(CASE WHEN payment_status='paid' THEN price ELSE 0 END),0) AS revenue
        FROM orders WHERE date(created_at) = date('now')
      `).get();
      const total = db.prepare('SELECT COUNT(*) AS c FROM orders').get();
      const rev = revenueSummary();
      const unverified = db.prepare("SELECT id FROM payments WHERE status = 'review'").all();
      const deadJobs = db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE status = 'dead'").get().c;
      const queue = queueStats();
      const router = await checkRouter9();
      const recent = listOrders({ limit: 8 }).rows;
      const wa = waState();
      let aiHealth = null;
      try {
        const row = db.prepare("SELECT value, updated_at FROM app_settings WHERE key = 'ai_health'").get();
        if (row) aiHealth = { ...JSON.parse(row.value), updated_at: row.updated_at };
      } catch { aiHealth = null; }
      const { backupStatus } = await import('../services/backup.js');
      res.type('html').send(dashboardPage({
        kpis: { ordersToday: today.c, ordersTotal: total.c, revenueToday: today.revenue, revenueTotal: rev.revenue },
        metrics: metricsRange(14),
        recent,
        unverified,
        deadJobs,
        wa,
        queue,
        router,
        aiHealth,
        backup: backupStatus(),
        disk: diskUsage(),
        funnel: funnel(),
      }));
    } catch (err) { next(err); }
  });

  r.post('/admin/login', (req, res) => {
    const ip = clientIp(req);
    const locked = loginLockRemaining(ip);
    if (locked > 0) {
      const mins = Math.ceil(locked / 60000);
      audit('anonymous', 'admin_login_locked', 'admin', { ip, mins });
      return res.status(429).type('html').send(loginPage(`Terlalu banyak percobaan gagal. Coba lagi dalam ${mins} menit.`));
    }
    const { username, password } = req.body || {};
    const admin = getDb().prepare('SELECT * FROM admins WHERE username = ?').get(String(username || '').trim());
    if (!admin || !verifyPassword(String(password || ''), admin.password_hash)) {
      recordLoginAttempt(ip, username, false);
      audit('anonymous', 'admin_login_failed', 'admin', username || null, { ip });
      return res.status(401).type('html').send(loginPage('Username atau password salah.'));
    }
    recordLoginAttempt(ip, username, true);
    setSessionCookie(res, issueSession(admin.username));
    audit(`admin:${admin.username}`, 'admin_login', 'admin', admin.id, { ip });
    res.redirect('/admin');
  });

  r.get('/admin/logout', (req, res) => {
    clearSessionCookie(res);
    res.redirect('/admin');
  });

  // --- semua route di bawah wajib login ---
  r.use('/admin', requireAdmin);

  r.get('/admin/orders', (req, res, next) => {
    try {
      const { rows, total } = listOrders({
        status: String(req.query.status || ''),
        q: String(req.query.q || '').slice(0, 60),
        limit: 200,
      });
      res.type('html').send(ordersPage({ rows, total, status: String(req.query.status || ''), q: String(req.query.q || '') }));
    } catch (err) { next(err); }
  });

  r.get('/admin/orders/:id', (req, res, next) => {
    try {
      const order = getOrder(Number(req.params.id));
      if (!order) return res.status(404).send('Order tidak ditemukan');
      const db = getDb();
      const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
      const docs = orderDocuments(order.id);
      const payments = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC').all(order.id);
      const jobs = db.prepare("SELECT * FROM jobs WHERE json_extract(payload, '$.order_id') = ? ORDER BY id DESC LIMIT 20").all(order.id);
      const audits = db.prepare("SELECT * FROM audit_log WHERE entity = 'order' AND entity_id = ? ORDER BY id DESC LIMIT 20").all(String(order.id));
      res.type('html').send(orderPage({ order, customer, input: orderInput(order), docs, payments, jobs, audits }));
    } catch (err) { next(err); }
  });

  r.post('/admin/orders/:id/regenerate', (req, res, next) => {
    try {
      const order = getOrder(Number(req.params.id));
      if (!order) return res.status(404).send('Order tidak ditemukan');
      if (!['paid', 'generating', 'needs_human'].includes(order.status)) {
        return flash(res, 'err', `Order berstatus ${order.status}, tidak bisa regenerate.`);
      }
      if (order.status === 'needs_human') transition(order.id, 'generating', { via: 'admin' }, 'admin');
      if (order.status === 'paid') transition(order.id, 'paid', {}, 'admin');
      enqueue('generate_documents', { order_id: order.id, version: (order.revision_count || 0) + 1, manual: true });
      audit('admin', 'order_regenerate', 'order', order.id);
      flash(res, 'ok', `Regenerate dijadwalkan untuk ${order.code}.`);
    } catch (err) { next(err); }
  });

  r.post('/admin/orders/:id/redeliver', (req, res, next) => {
    try {
      const order = getOrder(Number(req.params.id));
      if (!order) return res.status(404).send('Order tidak ditemukan');
      const docs = orderDocuments(order.id);
      if (!docs.length) return flash(res, 'err', 'Belum ada dokumen untuk dikirim.');
      const version = Math.max(...docs.map((d) => d.version));
      enqueue('deliver_order', { order_id: order.id, version });
      audit('admin', 'order_redeliver', 'order', order.id, { version });
      flash(res, 'ok', `Pengiriman ulang ${order.code} dijadwalkan.`);
    } catch (err) { next(err); }
  });

  r.post('/admin/orders/:id/close', (req, res, next) => {
    try {
      const order = getOrder(Number(req.params.id));
      if (!order) return res.status(404).send('Order tidak ditemukan');
      transition(order.id, 'closed', { via: 'admin' }, 'admin');
      flash(res, 'ok', `${order.code} ditandai selesai.`);
    } catch (err) { flash(res, 'err', String(err.message)); }
  });

  r.post('/admin/orders/:id/cancel', (req, res, next) => {
    try {
      const order = getOrder(Number(req.params.id));
      if (!order) return res.status(404).send('Order tidak ditemukan');
      transition(order.id, 'cancelled', { via: 'admin' }, 'admin');
      getDb().prepare("UPDATE payments SET status = 'cancelled' WHERE order_id = ? AND status IN ('pending','review')").run(order.id);
      flash(res, 'ok', `${order.code} dibatalkan.`);
    } catch (err) { flash(res, 'err', String(err.message)); }
  });

  r.get('/admin/payments', (req, res, next) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT p.*, o.code AS order_code, o.product, o.status AS order_status, c.wa_number, c.display_name
        FROM payments p JOIN orders o ON o.id = p.order_id JOIN customers c ON c.id = o.customer_id
        ORDER BY CASE p.status WHEN 'review' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, p.created_at DESC LIMIT 200
      `).all();
      const totals = {
        pending: rows.filter((x) => x.status === 'pending').length,
        review: rows.filter((x) => x.status === 'review').length,
        paidAmount: rows.filter((x) => x.status === 'paid').reduce((a, x) => a + x.amount, 0),
      };
      res.type('html').send(paymentsPage({ rows, totals }));
    } catch (err) { next(err); }
  });

  r.post('/admin/payments/:id/approve', async (req, res, next) => {
    try {
      const db = getDb();
      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(req.params.id));
      if (!payment) return res.status(404).send('Pembayaran tidak ditemukan');
      await startFulfillment(payment.order_id, { actor: 'admin', paymentId: payment.id });
      const order = getOrder(payment.order_id);
      flash(res, 'ok', `Pembayaran ${order.code} disetujui. Dokumen sedang dibuat.`);
    } catch (err) { flash(res, 'err', String(err.message)); }
  });

  r.post('/admin/payments/:id/refund', (req, res, next) => {
    try {
      const db = getDb();
      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(req.params.id));
      if (!payment) return res.status(404).send('Pembayaran tidak ditemukan');
      refundPayment(payment.id, 'admin', 'manual refund');
      const order = getOrder(payment.order_id);
      if (order && ['awaiting_payment', 'paid', 'generating', 'delivered', 'closed'].includes(order.status)) {
        getDb().prepare("UPDATE orders SET status = 'refunded' WHERE id = ?").run(order.id);
      }
      audit('admin', 'order_refunded', 'order', payment.order_id);
      flash(res, 'ok', `Refund dicatat untuk ${order?.code || payment.order_id}.`);
    } catch (err) { flash(res, 'err', String(err.message)); }
  });

  r.get('/admin/payments/:id/proof', (req, res, next) => {
    try {
      const payment = getDb().prepare('SELECT * FROM payments WHERE id = ?').get(Number(req.params.id));
      if (!payment?.proof_path) return res.status(404).send('Tidak ada bukti');
      if (!fs.existsSync(payment.proof_path)) return res.status(404).send('File bukti tidak ditemukan');
      res.sendFile(payment.proof_path);
    } catch (err) { next(err); }
  });

  r.get('/admin/docs/:id', (req, res, next) => {
    try {
      const doc = getDb().prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
      if (!doc || doc.deleted_at) return res.status(404).send('Dokumen tidak tersedia');
      if (!fs.existsSync(doc.path)) return res.status(404).send('File hilang');
      res.download(doc.path);
    } catch (err) { next(err); }
  });

  r.get('/admin/jobs', (req, res, next) => {
    try {
      res.type('html').send(jobsPage({ jobs: recentJobs(80), queue: queueStats() }));
    } catch (err) { next(err); }
  });

  r.post('/admin/jobs/:id/retry', (req, res) => {
    retryJob(Number(req.params.id));
    flash(res, 'ok', `Job #${req.params.id} dikembalikan ke queue.`);
  });

  r.post('/admin/jobs/expire', (req, res) => {
    const expired = expireStaleOrders();
    const cleaned = cleanupExpiredArtefacts();
    flash(res, 'ok', `Maintenance: ${expired} order kedaluwarsa, ${cleaned} artefak dibersihkan.`);
  });

  r.get('/admin/settings', async (req, res, next) => {
    try {
      const db = getDb();
      const counts = {
        customers: db.prepare('SELECT COUNT(*) c FROM customers').get().c,
        orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
        documents: db.prepare('SELECT COUNT(*) c FROM documents WHERE deleted_at IS NULL').get().c,
        messages: db.prepare('SELECT COUNT(*) c FROM wa_messages').get().c,
      };
      const envInfo = [
        ['NODE_ENV', config.env],
        ['PORT', config.port],
        ['PAYMENT_MODE', config.payment.mode],
        ['BANK', config.payment.bankName ? `${config.payment.bankName} ${config.payment.bankAccount}` : 'belum diset'],
        ['PRICE', `CV ${config.price.cv} / bundle ${config.price.bundle} / revisi ${config.price.revision}`],
        ['TTL DATA', `${config.artefactTtlDays} hari`],
        ['WA_ENABLED', String(config.wa.enabled)],
        ['ROUTER9', config.router9.baseUrl],
        ['SESSION', `${config.sessionHours} jam`],
        ['SERVER TIME', formatWIB(new Date().toISOString())],
      ];
      res.type('html').send(settingsPage({
        wa: waState(), router: await checkRouter9(), disk: diskUsage(), counts, envInfo,
        backup: (await import('../services/backup.js')).backupStatus(),
      }));
    } catch (err) { next(err); }
  });

  r.post('/admin/settings/cleanup', (req, res) => {
    const cleaned = cleanupExpiredArtefacts();
    flash(res, 'ok', `${cleaned} artefak kedaluwarsa dibersihkan.`);
  });

  r.post('/admin/settings/backup', async (req, res) => {
    try {
      const { runBackup } = await import('../services/backup.js');
      const result = runBackup({ force: true });
      if (result.ok) flash(res, 'ok', `Backup selesai: ${result.file.split('/').pop()} (${Math.round(result.bytes / 1024)} KB).`);
      else flash(res, 'ok', result.reason === 'exists' ? 'Backup hari ini sudah ada.' : 'Backup dilewati.');
    } catch (err) {
      logger.error('backup_manual_failed', { error: String(err.message) });
      flash(res, 'err', `Backup gagal: ${err.message}`);
    }
  });

  r.get('/admin/promo', (req, res, next) => {
    try {
      res.type('html').send(promoPage({ rows: listDiscounts({ limit: 200 }), flash: req.query }));
    } catch (err) { next(err); }
  });

  r.post('/admin/promo', (req, res) => {
    try {
      const { code, kind, value, maxUses, perCustomer, minPrice, days } = req.body || {};
      const expiresAt = Number(days) > 0 ? new Date(Date.now() + Number(days) * 86400000).toISOString() : null;
      const created = createPromo({
        code, kind, value: Number(value), maxUses: Number(maxUses || 0),
        perCustomer: Number(perCustomer || 1), minPrice: Number(minPrice || 0), expiresAt,
      });
      audit(`admin:${req.admin.u}`, 'promo_created', 'discount', created.id, { code: created.code });
      flash(res, 'ok', `Kode ${created.code} dibuat.`);
    } catch (err) { flash(res, 'err', err.message); }
  });

  r.post('/admin/promo/:id/off', (req, res) => {
    deactivateDiscount(Number(req.params.id));
    audit(`admin:${req.admin.u}`, 'promo_deactivated', 'discount', Number(req.params.id));
    flash(res, 'ok', 'Kode promo dinonaktifkan.');
  });

  r.post('/admin/settings/password', (req, res) => {
    try {
      const { current, next: nextPass } = req.body || {};
      const username = req.admin.u;
      const admin = getDb().prepare('SELECT * FROM admins WHERE username = ?').get(username);
      if (!admin || !verifyPassword(String(current || ''), admin.password_hash)) {
        return flash(res, 'err', 'Password lama salah.');
      }
      if (String(nextPass || '').length < 10) return flash(res, 'err', 'Password baru minimal 10 karakter.');
      getDb().prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(String(nextPass)), admin.id);
      audit(`admin:${username}`, 'admin_password_changed', 'admin', admin.id);
      flash(res, 'ok', 'Password admin diperbarui.');
    } catch (err) { flash(res, 'err', String(err.message)); }
  });

  r.get('/admin/export/orders.csv', (req, res) => {
    const rows = getDb().prepare(`
      SELECT o.code, o.product, o.price, o.unique_amount, o.status, o.payment_status, o.ats_score,
             o.created_at, o.paid_at, o.delivered_at, c.wa_number, c.display_name
      FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id DESC
    `).all();
    const header = 'code,product,price,unique_amount,status,payment_status,ats_score,created_at,paid_at,delivered_at,wa_number,display_name\n';
    const body = rows.map((r) => [r.code, r.product, r.price, r.unique_amount, r.status, r.payment_status, r.ats_score,
      r.created_at, r.paid_at, r.delivered_at, r.wa_number, `"${String(r.display_name || '').replaceAll('"', "'")}"`].join(',')).join('\n');
    res.type('text/csv').attachment('lamarankilat-orders.csv').send(header + body);
  });

  r.get('/admin/status.json', (req, res) => {
    res.json({ queue: queueStats(), wa: waState(), revenue: revenueSummary(), funnel: funnel(), statuses: Object.keys(statusLabel('')) });
  });

  return r;
}
