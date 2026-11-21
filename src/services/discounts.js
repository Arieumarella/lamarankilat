import crypto from 'node:crypto';
import { getDb, audit } from '../db.js';
import { config } from '../config.js';
import { nowIso, formatRupiah } from '../util.js';
import { logger } from '../logger.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizePromoCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
}

export function makeCode(prefix = 'LK', len = 6) {
  const body = Array.from(crypto.randomBytes(len)).map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${prefix}${body}`;
}

/** Kode referral unik & stabil per customer. */
export function ensureReferralCode(customerId) {
  const db = getDb();
  const row = db.prepare('SELECT id, referral_code FROM customers WHERE id = ?').get(customerId);
  if (!row) return null;
  if (row.referral_code) return row.referral_code;
  for (let i = 0; i < 20; i += 1) {
    const code = makeCode('LK', 5);
    const exists = db.prepare('SELECT 1 FROM customers WHERE referral_code = ?').get(code);
    if (exists) continue;
    db.prepare('UPDATE customers SET referral_code = ? WHERE id = ?').run(code, customerId);
    return code;
  }
  return null;
}

/**
 * Buat diskon referral milik satu customer (kredit Rp5.000 untuk order berikutnya).
 * Idempoten per owner: satu kredit aktif per customer.
 */
export function grantReferralCredit(customerId, amount = config.referral.credit) {
  const db = getDb();
  const code = ensureReferralCode(customerId);
  if (!code) return null;
  const existing = db.prepare(
    "SELECT * FROM discounts WHERE owner_customer_id = ? AND source = 'referral' AND active = 1 AND (expires_at IS NULL OR expires_at > ?)",
  ).get(customerId, nowIso());
  if (existing) return existing;
  const info = db.prepare(`
    INSERT INTO discounts (code, kind, value, max_uses, per_customer, min_price, owner_customer_id, source, expires_at, active, created_at)
    VALUES (?, 'fixed', ?, 1, 1, 0, ?, 'referral', ?, 1, ?)
  `).run(`REF${code}`, amount, customerId, new Date(Date.now() + 30 * 86400000).toISOString(), nowIso());
  audit('system', 'referral_credit_granted', 'customer', customerId, { code: `REF${code}`, amount });
  return db.prepare('SELECT * FROM discounts WHERE id = ?').get(info.lastInsertRowid);
}

/** Cari diskon yang bisa dipakai customer untuk harga tertentu. */
export function findUsable(discountCode, customerId, price) {
  const code = normalizePromoCode(discountCode);
  if (!code) return { discount: null, reason: 'Kode kosong' };
  const db = getDb();
  const discount = db.prepare('SELECT * FROM discounts WHERE code = ? AND active = 1').get(code);
  if (!discount) return { discount: null, reason: 'Kode tidak dikenal' };
  if (discount.expires_at && discount.expires_at <= nowIso()) return { discount: null, reason: 'Kode sudah kedaluwarsa' };
  if (discount.max_uses > 0 && discount.used_count >= discount.max_uses) return { discount: null, reason: 'Kuota kode habis' };
  if (discount.min_price > 0 && price < discount.min_price) {
    return { discount: null, reason: `Minimal belanja ${formatRupiah(discount.min_price)}` };
  }
  if (discount.owner_customer_id && discount.owner_customer_id !== customerId) {
    return { discount: null, reason: 'Kode ini milik pengguna lain' };
  }
  const used = db.prepare('SELECT 1 FROM discount_uses WHERE discount_id = ? AND customer_id = ?').get(discount.id, customerId);
  if (used && discount.per_customer > 0) return { discount: null, reason: 'Kode sudah kamu pakai' };
  const amount = computeAmount(discount, price);
  if (amount <= 0) return { discount: null, reason: 'Kode tidak mengurangi biaya' };
  return { discount, amount };
}

export function computeAmount(discount, price) {
  const maxShare = Math.floor((price * config.referral.maxSharePct) / 100);
  let amount = discount.kind === 'percent'
    ? Math.floor((price * Math.min(100, Math.max(0, discount.value))) / 100)
    : Math.min(price, Math.max(0, discount.value));
  if (maxShare > 0) amount = Math.min(amount, maxShare);
  return Math.max(0, amount);
}

/** Pakai diskon untuk order (dipanggil setelah order dibuat). */
export function applyDiscount({ discountCode, customerId, orderId, price }) {
  const { discount, amount, reason } = findUsable(discountCode, customerId, price);
  if (!discount) return { applied: false, reason, amount: 0 };
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO discount_uses (discount_id, customer_id, order_id, amount, created_at)
      VALUES (?,?,?,?,?)`).run(discount.id, customerId, orderId, amount, nowIso());
    db.prepare('UPDATE discounts SET used_count = used_count + 1 WHERE id = ?').run(discount.id);
    db.prepare('UPDATE orders SET price = ?, discount_amount = ?, discount_code = ? WHERE id = ?')
      .run(Math.max(0, price - amount), amount, discount.code, orderId);
  });
  tx();
  audit('system', 'discount_applied', 'order', orderId, { code: discount.code, amount });
  logger.info('discount_applied', { order: orderId, code: discount.code, amount });
  return { applied: true, amount, code: discount.code };
}

/** Tandai kredit referral teman saat order pertama teman dibayar. */
export function creditReferrer(customerId) {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer?.referred_by) return null;
  const paidCount = db.prepare("SELECT COUNT(*) c FROM orders WHERE customer_id = ? AND payment_status = 'paid'").get(customerId).c;
  if (paidCount !== 1) return null; // hanya order pertama
  const discount = grantReferralCredit(customer.referred_by, config.referral.credit);
  if (discount) {
    audit('system', 'referral_reward', 'customer', customer.referred_by, { from: customerId, code: discount.code });
  }
  return discount;
}

/** Simpan kode referral saat onboarding (maks 1x, tidak boleh diri sendiri). */
export function attachReferrer(customerId, rawCode) {
  const code = normalizePromoCode(rawCode);
  if (!code) return { ok: false, reason: 'Kode kosong' };
  const db = getDb();
  const me = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!me) return { ok: false, reason: 'Customer tidak ada' };
  if (me.referred_by) return { ok: false, reason: 'Kode referral sudah pernah dipakai' };
  const referrer = db.prepare('SELECT * FROM customers WHERE referral_code = ?').get(code);
  if (!referrer) return { ok: false, reason: 'Kode referral tidak dikenal' };
  if (referrer.id === customerId) return { ok: false, reason: 'Tidak bisa pakai kode sendiri' };
  const paid = db.prepare("SELECT COUNT(*) c FROM orders WHERE customer_id = ? AND payment_status = 'paid'").get(customerId).c;
  if (paid > 0) return { ok: false, reason: 'Kode hanya untuk pesanan pertama' };
  db.prepare('UPDATE customers SET referred_by = ? WHERE id = ?').run(referrer.id, customerId);
  // kredit langsung untuk teman baru: potongan Rp5.000 di order pertamanya
  const discount = grantReferralCredit(customerId, config.referral.credit);
  audit(`wa:${me.wa_number}`, 'referral_attached', 'customer', customerId, { referrer: referrer.id, code: discount?.code || null });
  return { ok: true, discount };
}

export function listDiscounts({ active = null, limit = 100 } = {}) {
  const db = getDb();
  if (active === true) return db.prepare('SELECT * FROM discounts WHERE active = 1 ORDER BY id DESC LIMIT ?').all(limit);
  return db.prepare('SELECT * FROM discounts ORDER BY id DESC LIMIT ?').all(limit);
}

export function createPromo({ code, kind = 'fixed', value, maxUses = 0, perCustomer = 1, minPrice = 0, expiresAt = null, source = 'promo' }) {
  const db = getDb();
  const normalized = normalizePromoCode(code) || makeCode('LK', 6);
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('nilai diskon tidak valid');
  if (!['fixed', 'percent'].includes(kind)) throw new Error('jenis diskon tidak valid');
  if (kind === 'percent' && amount > 100) throw new Error('persen maksimal 100');
  const info = db.prepare(`
    INSERT INTO discounts (code, kind, value, max_uses, per_customer, min_price, source, expires_at, active, created_at)
    VALUES (?,?,?,?,?,?,?,?,1,?)
  `).run(normalized, kind, amount, Number(maxUses || 0), Number(perCustomer || 1), Number(minPrice || 0), source, expiresAt, nowIso());
  audit('admin', 'promo_created', 'discount', info.lastInsertRowid, { code: normalized, kind, value: amount });
  return db.prepare('SELECT * FROM discounts WHERE id = ?').get(info.lastInsertRowid);
}

export function deactivateDiscount(id) {
  getDb().prepare('UPDATE discounts SET active = 0 WHERE id = ?').run(id);
  audit('admin', 'promo_deactivated', 'discount', id);
}
