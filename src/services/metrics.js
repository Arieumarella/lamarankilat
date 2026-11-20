import { getDb } from '../db.js';
import { wibDay } from '../util.js';

export function bumpMetric(field, delta = 1, day = wibDay()) {
  const allowed = ['chats_started', 'previews_sent', 'orders_created', 'orders_paid', 'orders_delivered',
    'revenue', 'refunds', 'revisions'];
  if (!allowed.includes(field)) throw new Error(`metrik tidak dikenal: ${field}`);
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO metrics_daily (day) VALUES (?)').run(day);
  db.prepare(`UPDATE metrics_daily SET ${field} = COALESCE(${field},0) + ? WHERE day = ?`).run(delta, day);
}

export function recordAtsScore(score, day = wibDay()) {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO metrics_daily (day) VALUES (?)').run(day);
  const row = db.prepare('SELECT avg_ats_score, orders_delivered FROM metrics_daily WHERE day = ?').get(day);
  const delivered = Math.max(1, row.orders_delivered || 1);
  const avg = row.avg_ats_score ? ((row.avg_ats_score * (delivered - 1)) + score) / delivered : score;
  db.prepare('UPDATE metrics_daily SET avg_ats_score = ? WHERE day = ?').run(Number(avg.toFixed(1)), day);
}

export function recordDeliveryMinutes(minutes, day = wibDay()) {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO metrics_daily (day) VALUES (?)').run(day);
  const row = db.prepare('SELECT avg_minutes_to_deliver, orders_delivered FROM metrics_daily WHERE day = ?').get(day);
  const delivered = Math.max(1, row.orders_delivered || 1);
  const avg = row.avg_minutes_to_deliver
    ? ((row.avg_minutes_to_deliver * (delivered - 1)) + minutes) / delivered
    : minutes;
  db.prepare('UPDATE metrics_daily SET avg_minutes_to_deliver = ? WHERE day = ?').run(Number(avg.toFixed(1)), day);
}

export function metricsRange(days = 14) {
  return getDb().prepare('SELECT * FROM metrics_daily ORDER BY day DESC LIMIT ?').all(days);
}

export function funnel() {
  const db = getDb();
  const orders = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  const paid = db.prepare("SELECT COUNT(*) c FROM orders WHERE payment_status = 'paid'").get().c;
  const delivered = db.prepare("SELECT COUNT(*) c FROM orders WHERE status IN ('delivered','closed')").get().c;
  const revisions = db.prepare('SELECT COALESCE(SUM(revision_count),0) c FROM orders').get().c;
  const chats = db.prepare('SELECT COUNT(DISTINCT chat_id) c FROM wa_messages WHERE direction = ?').get('in').c;
  return { chats, orders, paid, delivered, revisions, conversion: chats ? Math.round((paid / chats) * 1000) / 10 : 0 };
}
