import crypto from 'node:crypto';
import { getDb, audit } from '../db.js';
import { config } from '../config.js';
import { nowIso, addDaysIso, sha256File } from '../util.js';
import fs from 'node:fs';

const TOKEN_BYTES = 24;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Terbitkan token portal pesanan. Hanya hash yang disimpan (bocor DB ≠ bocor akses).
 * @returns {{token:string, expiresAt:string}}
 */
export function issuePortalToken(orderId, { days = 30, purpose = 'portal' } = {}) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = addDaysIso(days);
  const db = getDb();
  db.prepare('INSERT INTO access_tokens (order_id, token_hash, purpose, expires_at, created_at) VALUES (?,?,?,?,?)')
    .run(orderId, hashToken(token), purpose, expiresAt, nowIso());
  db.prepare('UPDATE orders SET download_token = ?, download_expires_at = ? WHERE id = ?')
    .run(hashToken(token), expiresAt, orderId);
  audit('system', 'portal_token_issued', 'order', orderId, { purpose, expiresAt });
  return { token, expiresAt };
}

/** Verifikasi token portal → order atau null. */
export function orderForToken(token) {
  if (!token || String(token).length < 16) return null;
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM access_tokens WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1",
  ).get(hashToken(String(token)), nowIso());
  if (!row) return null;
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(row.order_id) || null;
}

export function portalUrl(code, token) {
  const base = config.baseUrl.replace(/\/$/, '');
  return `${base}/pesanan/${encodeURIComponent(code)}?t=${encodeURIComponent(token)}`;
}

/** Dokumen terbaru untuk order (yang tidak dihapus), dikelompokkan per kind. */
export function latestDocuments(orderId) {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM documents WHERE order_id = ? AND deleted_at IS NULL ORDER BY kind, version DESC, id DESC',
  ).all(orderId);
  const byKind = new Map();
  for (const row of rows) {
    if (!byKind.has(row.kind)) byKind.set(row.kind, row);
  }
  return [...byKind.values()].filter((doc) => {
    try { return fs.existsSync(doc.path); } catch { return false; }
  });
}

export function docFingerprint(doc) {
  try { return sha256File(doc.path).slice(0, 12); } catch { return null; }
}
