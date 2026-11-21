import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { nowIso, wibDay } from '../util.js';

function stamp(iso = nowIso()) {
  return String(iso).slice(0, 10).replaceAll('-', '');
}

/**
 * Backup konsisten SQLite via `VACUUM INTO` (aman saat WAL aktif, tanpa stop app).
 * Retensi BACKUP_KEEP_DAYS hari. Satu file per hari.
 */
export function runBackup({ force = false } = {}) {
  if (!config.backup.enabled && !force) return { skipped: true, reason: 'disabled' };
  fs.mkdirSync(config.backupDir, { recursive: true });
  const target = path.join(config.backupDir, `db-${stamp()}.sqlite`);
  const db = getDb();
  if (fs.existsSync(target)) {
    const size = fs.statSync(target).size;
    if (size > 0) return { skipped: true, reason: 'exists', file: target, bytes: size };
    fs.unlinkSync(target);
  }
  const tmp = `${target}.tmp`;
  try { fs.unlinkSync(tmp); } catch { /* tidak ada */ }
  db.prepare('VACUUM INTO ?').run(tmp);
  fs.renameSync(tmp, target);
  const bytes = fs.statSync(target).size;
  logger.info('backup_done', { file: path.basename(target), bytes });
  pruneBackups();
  return { ok: true, file: target, bytes };
}

/** Hapus backup lebih tua dari retensi. */
export function pruneBackups() {
  const kept = [];
  const removed = [];
  let files = [];
  try { files = fs.readdirSync(config.backupDir).filter((f) => /^db-\d{8}\.sqlite$/.test(f)).sort(); } catch { return { removed: 0 }; }
  const cutoff = Date.now() - config.backup.keepDays * 86400000;
  for (const name of files) {
    const full = path.join(config.backupDir, name);
    let mtime = 0;
    try { mtime = fs.statSync(full).mtimeMs; } catch { continue; }
    if (mtime < cutoff) {
      try { fs.unlinkSync(full); removed.push(name); } catch { /* ignore */ }
    } else {
      kept.push(name);
    }
  }
  if (removed.length) logger.info('backup_pruned', { removed: removed.length });
  return { removed: removed.length, kept, files: kept.length };
}

export function backupStatus() {
  let files = [];
  try { files = fs.readdirSync(config.backupDir).filter((f) => /^db-\d{8}\.sqlite$/.test(f)).sort(); } catch { files = []; }
  const latest = files.length ? files[files.length - 1] : null;
  let bytes = 0;
  let mtime = null;
  if (latest) {
    try {
      const st = fs.statSync(path.join(config.backupDir, latest));
      bytes = st.size;
      mtime = st.mtime.toISOString();
    } catch { /* ignore */ }
  }
  const today = wibDay();
  const fresh = latest ? latest.includes(stamp()) : false;
  return { latest, bytes, mtime, fresh, count: files.length, keepDays: config.backup.keepDays, today, dir: config.backupDir };
}

/** Dipanggil worker tiap tick: jalankan sekali sehari setelah jam BACKUP_HOUR. */
let lastBackupDay = null;

export function maybeDailyBackup() {
  if (!config.backup.enabled) return null;
  const day = wibDay();
  if (lastBackupDay === day) return null;
  const hourWib = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false }).format(new Date()));
  if (hourWib < config.backup.hour) return null;
  lastBackupDay = day;
  try {
    return runBackup();
  } catch (err) {
    logger.error('backup_failed', { error: String(err.message) });
    return { ok: false, error: String(err.message) };
  }
}
