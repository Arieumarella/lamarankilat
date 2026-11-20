import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { nowIso } from './util.js';
import { PROMPTS } from './prompts/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const N = 16384, r = 8, p = 1;
  const hash = crypto.scryptSync(String(password), salt, 64, { N, r, p }).toString('hex');
  return `scrypt$${N}$${r}$${p}$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const candidate = crypto.scryptSync(String(password), salt, 64, { N: Number(N), r: Number(r), p: Number(p) });
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function seedPrompts(db) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO prompt_templates (key, version, body, model_hint, active, created_at) VALUES (?,?,?,?,1,?)',
  );
  for (const [key, def] of Object.entries(PROMPTS)) {
    insert.run(key, 1, def.body.trim(), def.modelHint || 'fast', nowIso());
  }
}

export function seedAdmin(db) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM admins').get().c;
  if (count > 0) return;
  if (!config.admin.pass) {
    logger.warn('seed_admin_skipped', { reason: 'ADMIN_PASS kosong' });
    return;
  }
  db.prepare('INSERT INTO admins (username, password_hash, role, created_at) VALUES (?,?,?,?)')
    .run(config.admin.user, hashPassword(config.admin.pass), 'admin', nowIso());
  logger.info('seed_admin_created', { username: config.admin.user });
}

export function migrate() {
  const db = getDb();
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?,?)').run(file, nowIso());
      db.exec('COMMIT');
      logger.info('migration_applied', { file });
    } catch (err) {
      db.exec('ROLLBACK');
      logger.error('migration_failed', { file, error: String(err.message) });
      throw err;
    }
  }
  seedPrompts(db);
  seedAdmin(db);
  return { applied: files.length };
}

if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  migrate();
  logger.info('migrate_done', { db: config.dbPath });
}
