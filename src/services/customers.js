import crypto from 'node:crypto';
import { getDb, audit } from '../db.js';
import { nowIso, normalizePhone } from '../util.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeReferralCode(prefix = 'LK') {
  const db = getDb();
  for (let i = 0; i < 20; i += 1) {
    const body = Array.from(crypto.randomBytes(4)).map((b) => ALPHABET[b % ALPHABET.length]).join('');
    const code = `${prefix}${body}`;
    const exists = db.prepare('SELECT 1 FROM customers WHERE referral_code = ?').get(code);
    if (!exists) return code;
  }
  return `${prefix}${Date.now().toString(36).toUpperCase()}`;
}

export function getOrCreateCustomer(rawNumber, displayName = null) {
  const db = getDb();
  const wa = normalizePhone(rawNumber);
  if (!wa) throw new Error('nomor WA tidak valid');
  const found = db.prepare('SELECT * FROM customers WHERE wa_number = ?').get(wa);
  if (found) {
    db.prepare('UPDATE customers SET last_seen_at = ? WHERE id = ?').run(nowIso(), found.id);
    return found;
  }
  const info = db.prepare(
    'INSERT INTO customers (wa_number, display_name, referral_code, created_at, last_seen_at) VALUES (?,?,?,?,?)',
  ).run(wa, displayName, makeReferralCode(), nowIso(), nowIso());
  audit('system', 'customer_created', 'customer', info.lastInsertRowid);
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
}

export function updateCustomer(id, patch) {
  const db = getDb();
  const allowed = ['display_name', 'email', 'city', 'blocked', 'referred_by'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => (typeof patch[k] === 'boolean' ? (patch[k] ? 1 : 0) : patch[k]));
  db.prepare(`UPDATE customers SET ${sets}, last_seen_at = ? WHERE id = ?`).run(...values, nowIso(), id);
}

export function findByNumber(number) {
  return getDb().prepare('SELECT * FROM customers WHERE wa_number = ?').get(normalizePhone(number));
}

export function applyReferral(newCustomerId, code) {
  const db = getDb();
  if (!code) return null;
  const referrer = db.prepare('SELECT * FROM customers WHERE referral_code = ?').get(String(code).toUpperCase().trim());
  if (!referrer || referrer.id === newCustomerId) return null;
  db.prepare('UPDATE customers SET referred_by = ? WHERE id = ?').run(referrer.id, newCustomerId);
  audit(`wa:${newCustomerId}`, 'referral_applied', 'customer', newCustomerId, { referrer: referrer.id, code });
  return referrer;
}

export function referralStats() {
  return getDb().prepare(`
    SELECT referrer.id, referrer.wa_number, referrer.display_name, referrer.referral_code,
           COUNT(referred.id) AS invited
    FROM customers referrer
    JOIN customers referred ON referred.referred_by = referrer.id
    GROUP BY referrer.id
    ORDER BY invited DESC LIMIT 50
  `).all();
}
