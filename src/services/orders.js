import crypto from 'node:crypto';
import { getDb, audit } from '../db.js';
import { config, paymentConfigured } from '../config.js';
import { nowIso, addDaysIso, formatRupiah } from '../util.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const ORDER_TRANSITIONS = {
  draft: ['awaiting_payment', 'cancelled'],
  awaiting_payment: ['paid', 'expired', 'cancelled'],
  paid: ['generating', 'cancelled'],
  generating: ['delivered', 'needs_human'],
  needs_human: ['generating', 'cancelled'],
  delivered: ['revision_requested', 'closed', 'refunded'],
  revision_requested: ['generating'],
  closed: ['refunded'],
  expired: [],
  cancelled: [],
  refunded: [],
};

export class PaymentNotConfiguredError extends Error {
  constructor() {
    super('pembayaran belum dikonfigurasi');
    this.code = 'PAYMENT_NOT_CONFIGURED';
  }
}

export function orderCode() {
  const db = getDb();
  const d = new Date();
  const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  for (let i = 0; i < 30; i += 1) {
    const rand = Array.from(crypto.randomBytes(4)).map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    const code = `LK-${stamp}-${rand}`;
    if (!db.prepare('SELECT 1 FROM orders WHERE code = ?').get(code)) return code;
  }
  throw new Error('gagal membuat kode order unik');
}

export function priceFor(product) {
  if (product === 'bundle') return config.price.bundle;
  if (product === 'revision') return config.price.revision;
  return config.price.cv;
}

export function createOrder({ customerId, product, input, source = 'wa', campaign = null, parentOrderId = null }) {
  if (!['cv', 'bundle', 'revision'].includes(product)) throw new Error('produk tidak dikenal');
  if (!paymentConfigured()) throw new PaymentNotConfiguredError();
  const db = getDb();
  const price = priceFor(product);
  const code = orderCode();
  const info = db.prepare(`
    INSERT INTO orders (code, customer_id, product, price, status, payment_status, source, campaign,
      input_json, created_at, expires_at, notes, revision_count)
    VALUES (?,?,?,?, 'draft', 'pending', ?, ?, ?, ?, ?, ?, ?)
  `).run(code, customerId, product, price, source, campaign, JSON.stringify(input || {}),
    nowIso(), addDaysIso(config.artefactTtlDays), parentOrderId ? JSON.stringify({ parent_order_id: parentOrderId }) : null,
    parentOrderId ? 1 : 0);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
  audit('system', 'order_created', 'order', order.id, { code, product, price });
  return order;
}

export function getOrder(id) {
  return getDb().prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

export function getOrderByCode(code) {
  return getDb().prepare('SELECT * FROM orders WHERE code = ?').get(code);
}

export function orderInput(order) {
  try { return JSON.parse(order.input_json || '{}'); } catch { return {}; }
}

export function transition(orderId, next, meta = {}, actor = 'system') {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('order tidak ditemukan');
  if (order.status === next) return order; // idempoten
  const allowed = ORDER_TRANSITIONS[order.status] || [];
  if (!allowed.includes(next)) {
    throw new Error(`transisi terlarang: ${order.status} → ${next}`);
  }
  const patch = { status: next };
  const now = nowIso();
  if (next === 'paid') patch.paid_at = now;
  if (next === 'generating') patch.generated_at = null;
  if (next === 'delivered') patch.delivered_at = now;
  const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE orders SET ${sets}, payment_status = CASE WHEN ? = 'paid' THEN 'paid' ELSE payment_status END WHERE id = ?`)
    .run(...Object.values(patch), next, orderId);
  audit(actor, 'order_transition', 'order', orderId, { from: order.status, to: next, ...meta });
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

export function setAts(orderId, score, breakdown) {
  getDb().prepare('UPDATE orders SET ats_score = ?, ats_breakdown = ? WHERE id = ?')
    .run(score, JSON.stringify(breakdown), orderId);
}

export function markNeedsHuman(orderId, reason) {
  return transition(orderId, 'needs_human', { reason }, 'system');
}

export function listOrders({ status = '', q = '', limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (status) { where.push('o.status = ?'); params.push(status); }
  if (q) { where.push('(o.code LIKE ? OR c.wa_number LIKE ? OR c.display_name LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT o.*, c.wa_number, c.display_name, p.status AS payment_review_status
    FROM orders o JOIN customers c ON c.id = o.customer_id
    LEFT JOIN payments p ON p.order_id = o.id
    ${clause}
    GROUP BY o.id
    ORDER BY o.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM orders o JOIN customers c ON c.id = o.customer_id ${clause}`).get(...params).c;
  return { rows, total };
}

export function orderDocuments(orderId) {
  return getDb().prepare('SELECT * FROM documents WHERE order_id = ? AND deleted_at IS NULL ORDER BY id DESC').all(orderId);
}

export function statusLabel(status) {
  return {
    draft: 'Draft', awaiting_payment: 'Menunggu bayar', paid: 'Sudah bayar', generating: 'Diproses',
    delivered: 'Terkirim', needs_human: 'Butuh admin', revision_requested: 'Revisi', closed: 'Selesai',
    expired: 'Kedaluwarsa', cancelled: 'Dibatalkan', refunded: 'Refund',
  }[status] || status;
}

export function revenueSummary() {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) AS paid_orders, COALESCE(SUM(price),0) AS revenue
    FROM orders WHERE payment_status = 'paid' AND status IN ('paid','generating','delivered','closed','revision_requested')
  `).get();
  const today = db.prepare(`
    SELECT COUNT(*) AS c, COALESCE(SUM(price),0) AS revenue FROM orders
    WHERE payment_status = 'paid' AND date(paid_at) = date('now')
  `).get();
  return { ...row, today, avg: row.paid_orders ? Math.round(row.revenue / row.paid_orders) : 0 };
}

export function describeOrder(order) {
  return `${order.code} · ${order.product === 'bundle' ? 'Paket lengkap' : 'CV'} · ${formatRupiah(order.price)}`;
}
