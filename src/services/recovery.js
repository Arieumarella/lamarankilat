import { getDb, audit } from '../db.js';
import { logger } from '../logger.js';
import { enqueue } from './jobs.js';
import { sendTelegram } from './alerts.js';

const STUCK_MINUTES = 12;

/**
 * Selamatkan order berbayar yang tertahan di `paid`/`generating` tanpa job aktif
 * (mis. job mati karena restart atau handler error). Order seperti ini tidak boleh
 * menggantung tanpa dokumen: pelanggan sudah membayar.
 */
export function recoverStuckOrders({ dryRun = false } = {}) {
  const db = getDb();
  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60000).toISOString();
  const rows = db.prepare(`
    SELECT o.id, o.code, o.status, COALESCE(o.generated_at, o.paid_at, o.created_at) AS since, o.revision_count
    FROM orders o
    WHERE o.payment_status = 'paid'
      AND o.status NOT IN ('delivered', 'closed', 'cancelled', 'expired', 'refunded')
      AND COALESCE(o.generated_at, o.paid_at, o.created_at) < ?
      AND NOT EXISTS (
        SELECT 1 FROM jobs j
        WHERE j.status IN ('queued', 'running')
          AND j.type = 'generate_documents'
          AND j.payload LIKE '%"order_id":' || o.id || '%'
      )
    ORDER BY o.id ASC
    LIMIT 20
  `).all(cutoff);

  if (!rows.length) return { requeued: 0, orders: [] };

  if (!dryRun) {
    for (const row of rows) {
      enqueue('generate_documents', { order_id: row.id, version: (row.revision_count || 0) + 1 }, { delayMs: 500 });
      audit('system', 'order_recovered', 'order', row.id, { code: row.code, status: row.status, stuck_since: row.since });
    }
    logger.warn('orders_recovered', { count: rows.length, codes: rows.map((r) => r.code) });
    sendTelegram(
      `♻️ ${rows.length} order berbayar tertahan dan dijadwalkan ulang otomatis: ${rows.map((r) => r.code).join(', ')}`,
    ).catch(() => {});
  }
  return { requeued: rows.length, orders: rows.map((r) => r.code) };
}

/** Dipanggil berkala dari index.js (tiap 5 menit). */
export function startRecoveryLoop(intervalMs = 5 * 60 * 1000) {
  const timer = setInterval(() => {
    try { recoverStuckOrders(); } catch (err) { logger.error('recovery_failed', { error: String(err.message) }); }
  }, intervalMs);
  timer.unref();
  return timer;
}
