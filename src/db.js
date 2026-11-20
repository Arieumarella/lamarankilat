import Database from 'better-sqlite3';
import { config, ensureDirs } from './config.js';

let db = null;

export function getDb() {
  if (db) return db;
  ensureDirs();
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

export function closeDb() {
  if (db) { db.close(); db = null; }
}

export function audit(actor, action, entity = null, entityId = null, meta = null) {
  getDb()
    .prepare('INSERT INTO audit_log (actor, action, entity, entity_id, meta_json, created_at) VALUES (?,?,?,?,?,?)')
    .run(actor, action, entity, entityId === null ? null : String(entityId), meta ? JSON.stringify(meta) : null, new Date().toISOString());
}
