import crypto from 'node:crypto';
import { getDb, audit } from '../db.js';
import { config, paymentConfigured } from '../config.js';
import { nowIso, formatRupiah } from '../util.js';

/** Nominal unik = harga + 3 digit (001–999) yang belum dipakai 24 jam terakhir. */
export function reserveUniqueAmount(price) {
  const db = getDb();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const used = new Set(
    db.prepare("SELECT amount FROM payments WHERE created_at >= ? AND status != 'expired'").all(since).map((r) => r.amount),
  );
  const candidates = [];
  for (let i = 1; i <= 999; i += 1) candidates.push(i);
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (const suffix of candidates) {
    const amount = price + suffix;
    if (!used.has(amount)) return amount;
  }
  throw new Error('nominal unik habis untuk 24 jam terakhir');
}

export function createPaymentForOrder(order) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(order.id);
  if (existing) return existing;
  const amount = order.unique_amount || reserveUniqueAmount(order.price);
  const info = db.prepare(`
    INSERT INTO payments (order_id, provider, provider_ref, amount, status, created_at)
    VALUES (?,?,?,?, 'pending', ?)
  `).run(order.id, config.payment.mode === 'qris_static' ? 'qris_static' : 'transfer_manual',
    `order:${order.code}`, amount, nowIso());
  db.prepare('UPDATE orders SET unique_amount = ? WHERE id = ?').run(amount, order.id);
  audit('system', 'payment_created', 'payment', info.lastInsertRowid, { amount });
  return db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid);
}

export function paymentInstructions(order) {
  const amount = order.unique_amount ?? order.price;
  if (!paymentConfigured()) {
    return {
      ok: false,
      text: 'Pembayaran belum dikonfigurasi. Admin perlu mengisi BANK_ACCOUNT & BANK_HOLDER di .env lebih dulu.',
    };
  }
  const p = config.payment;
  if (p.mode === 'manual_confirm') {
    return {
      ok: true,
      amount,
      mode: 'manual_confirm',
      text: [
        'Instruksi pembayaran',
        `Nominal tagihan: ${formatRupiah(amount)} (harus tepat sampai 3 digit terakhir).`,
        'Admin akan mengirim detail rekening/QRIS melalui chat ini.',
        'Setelah transfer, kirim screenshot bukti ke chat ini. Admin verifikasi maksimal 30 menit.',
      ].join('\n'),
    };
  }
  if (p.mode === 'qris_static' && p.qrisImagePath) {
    return {
      ok: true,
      amount,
      mode: 'qris_static',
      text: [
        'Instruksi pembayaran (QRIS)',
        `Nominal: ${formatRupiah(amount)} (harus tepat sampai 3 digit terakhir)`,
        'Scan QRIS yang dikirim setelah pesan ini, lalu kirim screenshot bukti transfer ke chat ini.',
      ].join('\n'),
    };
  }
  return {
    ok: true,
    amount,
    mode: 'transfer_manual',
    text: [
      'Instruksi pembayaran',
      `Transfer ke ${p.bankName || 'rekening'} ${p.bankAccount}`,
      `a.n. ${p.bankHolder}`,
      `Nominal: ${formatRupiah(amount)} (harus tepat sampai 3 digit terakhir)`,
      'Setelah transfer, kirim screenshot bukti ke chat ini. Admin verifikasi maksimal 30 menit.',
    ].join('\n'),
  };
}

export function attachProof(orderId, filePath) {
  const db = getDb();
  const payment = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(orderId);
  if (!payment) return null;
  db.prepare("UPDATE payments SET proof_path = ?, status = 'review' WHERE id = ?").run(filePath, payment.id);
  db.prepare("UPDATE orders SET payment_status = 'review' WHERE id = ?").run(orderId);
  audit('wa:customer', 'payment_proof_received', 'payment', payment.id, { order_id: orderId });
  return db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id);
}

export function approvePayment(paymentId, actor = 'admin') {
  const db = getDb();
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!payment) throw new Error('payment tidak ditemukan');
  if (payment.status === 'paid') return payment;
  db.prepare("UPDATE payments SET status = 'paid', paid_at = ?, matched_by = ? WHERE id = ?")
    .run(nowIso(), actor, paymentId);
  db.prepare("UPDATE orders SET payment_status = 'paid', paid_at = ? WHERE id = ?")
    .run(nowIso(), payment.order_id);
  audit(actor, 'payment_approved', 'payment', paymentId, { order_id: payment.order_id, amount: payment.amount });
  return db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
}

export function refundPayment(paymentId, actor = 'admin', note = '') {
  const db = getDb();
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!payment) throw new Error('payment tidak ditemukan');
  db.prepare("UPDATE payments SET status = 'refunded' WHERE id = ?").run(paymentId);
  audit(actor, 'payment_refunded', 'payment', paymentId, { note });
  return db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
}

export function pendingPayments() {
  return getDb().prepare(`
    SELECT p.*, o.code AS order_code, o.product, o.status AS order_status, c.wa_number, c.display_name
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    JOIN customers c ON c.id = o.customer_id
    WHERE p.status IN ('pending','review')
    ORDER BY CASE p.status WHEN 'review' THEN 0 ELSE 1 END, p.created_at DESC
  `).all();
}
