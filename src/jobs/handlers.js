import { getDb } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { nowIso, truncate, minuteDiff } from '../util.js';
import { registerHandler, enqueue } from '../services/jobs.js';
import { generateOrderDocuments, scoreMessage } from '../services/documents.js';
import { getOrder, transition, orderDocuments } from '../services/orders.js';
import { sendText, sendDocument } from '../services/wa/sender.js';
import { bumpMetric, recordAtsScore, recordDeliveryMinutes } from '../services/metrics.js';
import { sendTelegram } from '../services/alerts.js';
import { cleanupExpiredArtefacts, expireStaleOrders } from '../services/retention.js';
import { getOrCreateCustomer } from '../services/customers.js';
import { atsBand } from '../services/ats.js';

function customerOf(order) {
  return getDb().prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
}

registerHandler('generate_documents', async ({ order_id: orderId, revision_note: revisionNote = null, version = 1 }) => {
  let order = getOrder(orderId);
  if (!order) throw new Error(`order ${orderId} hilang`);
  if (order.status === 'revision_requested') {
    order = transition(order.id, 'generating', { reason: 'revision' }, 'system');
  }
  const result = await generateOrderDocuments(orderId, { revisionNote, version });
  enqueue('deliver_order', { order_id: orderId, version, score: result.score.total });
});

registerHandler('deliver_order', async ({ order_id: orderId, version = 1 }) => {
  const order = getOrder(orderId);
  if (!order) throw new Error(`order ${orderId} hilang`);
  const customer = customerOf(order);
  if (!customer) throw new Error('customer hilang');

  const docs = orderDocuments(orderId).filter((d) => d.version === version);
  const wanted = order.product === 'bundle'
    ? ['cv_pdf', 'letter_pdf', 'cv_docx', 'linkedin_txt', 'score_pdf']
    : ['cv_pdf', 'cv_docx', 'score_pdf'];
  const ready = wanted.map((kind) => docs.find((d) => d.kind === kind)).filter(Boolean);
  if (!ready.length) throw new Error('dokumen belum dirender');

  const score = getDb().prepare('SELECT ats_score, ats_breakdown FROM orders WHERE id = ?').get(orderId);
  let breakdown = null;
  try { breakdown = JSON.parse(score.ats_breakdown || 'null'); } catch { breakdown = null; }

  const intro = [
    `Dokumen untuk ${order.code} sudah siap 🎉`,
    breakdown ? scoreMessage(breakdown, { label: labelFor(breakdown.total) }) : '',
    '',
    'File dikirim menyusul di chat ini. Simpan sebelum 30 hari (auto-hapus demi privasi).',
  ].filter(Boolean).join('\n');
  await sendText(customer.wa_number, intro, { quickReplies: ['REVISI', 'REFERRAL'] });

  for (const doc of ready) {
    const mime = doc.path.endsWith('.docx')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : doc.path.endsWith('.txt')
        ? 'text/plain'
        : 'application/pdf';
    await sendDocument(customer.wa_number, doc.path, docName(doc.path, order.code), mime);
  }

  const rel = (() => { try { return JSON.parse(order.notes || 'null'); } catch { return null; } })();
  if (rel?.parent_order_id) {
    getDb().prepare('UPDATE orders SET status = ? WHERE id = ?').run('closed', rel.parent_order_id);
  }

  transition(orderId, 'delivered', { documents: ready.length }, 'system');
  bumpMetric('orders_delivered');
  bumpMetric('revenue', order.price);
  recordAtsScore(score.ats_score || 0);
  if (order.paid_at) recordDeliveryMinutes(Math.max(0, minuteDiff(order.paid_at, nowIso())));

  const conv = getDb().prepare('SELECT * FROM conversations WHERE customer_id = ?').get(customer.id);
  if (conv) {
    let ctx = {};
    try { ctx = JSON.parse(conv.context_json || '{}'); } catch { ctx = {}; }
    ctx.order_id = orderId;
    getDb().prepare("UPDATE conversations SET state = 'FOLLOWUP', context_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(ctx), nowIso(), conv.id);
  }

  enqueue('followup', { order_id: orderId }, { delayMs: 24 * 3600 * 1000 });
  enqueue('cleanup_artefacts', {}, { delayMs: config.artefactTtlDays * 86400 * 1000 });
  enqueue('notify_admin', { text: `✅ ${order.code} terkirim ke ${customer.wa_number} (skor ${score.ats_score || '-'})` });
});

function labelFor(total) {
  return atsBand(total).label;
}

function docName(filePath, code) {
  const base = filePath.split('/').pop() || `dokumen-${code}`;
  return base;
}

registerHandler('followup', async ({ order_id: orderId }) => {
  const order = getOrder(orderId);
  if (!order || order.status !== 'delivered') return;
  const customer = customerOf(order);
  if (!customer) return;
  await sendText(customer.wa_number, [
    'Sudah sempat baca CV-nya?',
    'Kalau ada bagian yang mau dirapikan, balas REVISI — revisi pertama gratis.',
    `Ajak teman pakai kode ${customer.referral_code}, kalian masing-masing dapat potongan Rp5.000.`,
  ].join('\n'), { quickReplies: ['REVISI', 'REFERRAL'] });
  await sendText(customer.wa_number, 'Kalau butuh bantuan lain, balas ADMIN ya. Kalau sudah tidak mau dihubungi, balas BERHENTI.', { quickReplies: ['BERHENTI'] });
});

registerHandler('notify_admin', async ({ text, severity = 'info' }) => {
  await sendTelegram(`[LamaranKilat/${severity}] ${truncate(text, 900)}`);
  logger.info('admin_notified', { severity, text: truncate(text, 120) });
});

registerHandler('notify_customer', async ({ wa_number: waNumber, text }) => {
  if (!waNumber || !text) throw new Error('payload notify_customer tidak lengkap');
  await sendText(waNumber, text);
});

registerHandler('expire_orders', async () => {
  const n = expireStaleOrders();
  if (n) logger.info('orders_expired', { count: n });
});

registerHandler('cleanup_artefacts', async () => {
  const removed = cleanupExpiredArtefacts();
  logger.info('cleanup_done', { removed });
});

registerHandler('broadcast', async ({ numbers = [], text }) => {
  let sent = 0;
  for (const n of numbers.slice(0, 200)) {
    const customer = getOrCreateCustomer(n);
    if (customer.blocked) continue;
    // eslint-disable-next-line no-await-in-loop
    await sendText(customer.wa_number, text);
    sent += 1;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 2500));
  }
  logger.info('broadcast_done', { sent });
});
