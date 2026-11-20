import fs from 'node:fs';
import path from 'node:path';
import { getDb, audit } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { nowIso } from '../util.js';

function unlinkQuiet(file) {
  try { fs.unlinkSync(file); } catch { /* ignore */ }
}

/**
 * Hapus data pribadi customer (permintaan "HAPUS DATA SAYA").
 * Order tetap tersimpan untuk rekap keuangan, tapi isi input & dokumen dihapus.
 */
export function hardDeleteCustomerData(customerId) {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) return { documents: 0, files: 0 };

  const orders = db.prepare('SELECT * FROM orders WHERE customer_id = ?').all(customerId);
  let docs = 0;
  let files = 0;
  for (const order of orders) {
    for (const doc of db.prepare('SELECT * FROM documents WHERE order_id = ?').all(order.id)) {
      unlinkQuiet(doc.path);
      files += 1;
    }
    db.prepare("UPDATE documents SET deleted_at = ? WHERE order_id = ?").run(nowIso(), order.id);
    docs += 1;
    const dir = path.join(config.artefactDir, order.code);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    db.prepare('UPDATE orders SET input_json = ?, notes = NULL, ats_breakdown = NULL WHERE id = ?')
      .run(JSON.stringify({ deleted: true }), order.id);
    db.prepare('DELETE FROM job_descriptions WHERE order_id = ?').run(order.id);
    for (const pay of db.prepare('SELECT * FROM payments WHERE order_id = ?').all(order.id)) {
      if (pay.proof_path && pay.proof_path.startsWith(config.mediaDir)) unlinkQuiet(pay.proof_path);
    }
  }
  db.prepare('UPDATE payments SET proof_path = NULL WHERE order_id IN (SELECT id FROM orders WHERE customer_id = ?)').run(customerId);
  db.prepare('DELETE FROM conversations WHERE customer_id = ?').run(customerId);
  db.prepare('DELETE FROM wa_messages WHERE chat_id = ?').run(customer.wa_number);
  db.prepare('UPDATE customers SET display_name = NULL, email = NULL, city = NULL, blocked = 1 WHERE id = ?').run(customerId);
  audit(`wa:${customer.wa_number}`, 'customer_data_deleted', 'customer', customerId, { orders: orders.length });
  return { documents: docs, files };
}

/** Hapus artefak lebih tua dari TTL; tandai dokumen terhapus. */
export function cleanupExpiredArtefacts() {
  const db = getDb();
  const cutoff = new Date(Date.now() - config.artefactTtlDays * 86400000).toISOString();
  const stale = db.prepare('SELECT * FROM documents WHERE deleted_at IS NULL AND created_at < ?').all(cutoff);
  let removed = 0;
  for (const doc of stale) {
    unlinkQuiet(doc.path);
    db.prepare('UPDATE documents SET deleted_at = ? WHERE id = ?').run(nowIso(), doc.id);
    removed += 1;
  }
  const mediaCutoff = new Date(Date.now() - config.dataRetentionDays * 86400000).toISOString();
  const proofs = db.prepare('SELECT id, proof_path FROM payments WHERE proof_path IS NOT NULL AND created_at < ?').all(mediaCutoff);
  for (const p of proofs) {
    unlinkQuiet(p.proof_path);
    db.prepare('UPDATE payments SET proof_path = NULL WHERE id = ?').run(p.id);
  }
  if (removed) logger.info('artefacts_cleaned', { removed });
  return removed;
}

/** Order menunggu bayar > 24 jam → expired; payment pending → expired. */
export function expireStaleOrders() {
  const db = getDb();
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const rows = db.prepare("SELECT id FROM orders WHERE status = 'awaiting_payment' AND created_at < ?").all(cutoff);
  for (const row of rows) {
    db.prepare("UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'awaiting_payment'").run(row.id);
    db.prepare("UPDATE payments SET status = 'expired' WHERE order_id = ? AND status = 'pending'").run(row.id);
    audit('system', 'order_expired', 'order', row.id);
  }
  return rows.length;
}

/** Ringkasan penggunaan disk untuk halaman admin. */
export function diskUsage() {
  const root = path.dirname(config.artefactDir);
  let bytes = 0;
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else { try { bytes += fs.statSync(full).size; } catch { /* ignore */ } }
    }
  };
  walk(root);
  return { bytes, mb: Math.round((bytes / 1048576) * 10) / 10 };
}
