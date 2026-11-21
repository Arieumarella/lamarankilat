import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { nowIso } from '../util.js';

const handlers = new Map();

export function registerHandler(type, fn) {
  handlers.set(type, fn);
}

export function enqueue(type, payload = {}, { runAfter = null, delayMs = 0 } = {}) {
  const db = getDb();
  const when = runAfter || new Date(Date.now() + delayMs).toISOString();
  const info = db.prepare(`
    INSERT INTO jobs (type, payload, status, run_after, created_at, updated_at)
    VALUES (?,?, 'queued', ?, ?, ?)
  `).run(type, JSON.stringify(payload || {}), when, nowIso(), nowIso());
  return info.lastInsertRowid;
}

function backoffMs(attempts) {
  return Math.min(10 * 60 * 1000, 15000 * 2 ** Math.max(0, attempts - 1));
}

export function claimJob() {
  const db = getDb();
  const job = db.prepare(`
    SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY id ASC LIMIT 1
  `).get(nowIso());
  if (!job) return null;
  const changed = db.prepare("UPDATE jobs SET status = 'running', locked_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
    .run(nowIso(), nowIso(), job.id).changes;
  return changed ? { ...job, status: 'running' } : null;
}

export async function runJob(job) {
  const db = getDb();
  const fn = handlers.get(job.type);
  if (!fn) {
    // Handler bisa belum terdaftar saat boot (registerAll async). Jangan buang job
    // berbayar: tunda dan coba lagi, baru matikan setelah 5 percobaan.
    const attempts = job.attempts + 1;
    const dead = attempts >= 5;
    db.prepare(`
      UPDATE jobs SET status = ?, attempts = ?, last_error = ?, run_after = ?, updated_at = ?, locked_at = NULL
      WHERE id = ?
    `).run(dead ? 'dead' : 'queued', attempts, `no handler for ${job.type}`,
      new Date(Date.now() + 2000).toISOString(), nowIso(), job.id);
    logger.error('job_no_handler', { id: job.id, type: job.type, attempts, dead });
    return false;
  }
  try {
    await fn(JSON.parse(job.payload || '{}'), job);
    db.prepare("UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ?").run(nowIso(), job.id);
    return true;
  } catch (err) {
    const attempts = job.attempts + 1;
    const dead = attempts >= 5;
    const nextRun = new Date(Date.now() + backoffMs(attempts)).toISOString();
    db.prepare(`
      UPDATE jobs SET status = ?, attempts = ?, last_error = ?, run_after = ?, updated_at = ?, locked_at = NULL
      WHERE id = ?
    `).run(dead ? 'dead' : 'queued', attempts, String(err.message).slice(0, 500), nextRun, nowIso(), job.id);
    logger.error('job_failed', { id: job.id, type: job.type, attempts, dead, error: String(err.message) });
    return false;
  }
}

export async function tickOnce() {
  const job = claimJob();
  if (!job) return false;
  logger.info('job_start', { id: job.id, type: job.type });
  await runJob(job);
  return true;
}

export async function drain(max = 5) {
  let n = 0;
  while (n < max) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await tickOnce();
    if (!ok) break;
    n += 1;
  }
  return n;
}

export function queueStats() {
  const db = getDb();
  const rows = db.prepare('SELECT status, COUNT(*) AS c FROM jobs GROUP BY status').all();
  const out = { queued: 0, running: 0, done: 0, failed: 0, dead: 0 };
  for (const r of rows) out[r.status] = r.c;
  out.depth = out.queued + out.running;
  return out;
}

export function recentJobs(limit = 50) {
  return getDb().prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?').all(limit);
}

export function retryJob(id) {
  getDb().prepare("UPDATE jobs SET status = 'queued', attempts = 0, run_after = ?, last_error = NULL, updated_at = ? WHERE id = ?")
    .run(nowIso(), nowIso(), id);
}
