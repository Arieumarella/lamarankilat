-- 001_init.sql — skema awal LamaranKilat v0.1
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY,
  wa_number     TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  email         TEXT,
  city          TEXT,
  referral_code TEXT UNIQUE,
  referred_by   INTEGER REFERENCES customers(id),
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  blocked       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  customer_id     INTEGER NOT NULL REFERENCES customers(id),
  product         TEXT NOT NULL,
  price           INTEGER NOT NULL,
  unique_amount   INTEGER,
  status          TEXT NOT NULL,
  payment_status  TEXT NOT NULL DEFAULT 'pending',
  source          TEXT,
  campaign        TEXT,
  input_json      TEXT NOT NULL,
  ats_score       INTEGER,
  ats_breakdown   TEXT,
  revision_count  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  paid_at         TEXT,
  generated_at    TEXT,
  delivered_at    TEXT,
  expires_at      TEXT,
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);

CREATE TABLE IF NOT EXISTS conversations (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  state        TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  order_id     INTEGER REFERENCES orders(id),
  updated_at   TEXT NOT NULL,
  UNIQUE(customer_id)
);

CREATE TABLE IF NOT EXISTS job_descriptions (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  raw_text    TEXT NOT NULL,
  parsed_json TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  path       TEXT NOT NULL,
  bytes      INTEGER,
  sha256     TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_order ON documents(order_id, kind);

CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL DEFAULT 'transfer_manual',
  provider_ref  TEXT UNIQUE,
  amount        INTEGER NOT NULL,
  status        TEXT NOT NULL,
  proof_path    TEXT,
  matched_by    TEXT,
  created_at    TEXT NOT NULL,
  paid_at       TEXT,
  raw_json      TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status, created_at);

CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued',
  attempts    INTEGER NOT NULL DEFAULT 0,
  run_after   TEXT NOT NULL,
  locked_at   TEXT,
  last_error  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_pick ON jobs(status, run_after);

CREATE TABLE IF NOT EXISTS wa_messages (
  id            INTEGER PRIMARY KEY,
  wa_message_id TEXT UNIQUE,
  chat_id       TEXT NOT NULL,
  customer_id   INTEGER REFERENCES customers(id),
  direction     TEXT NOT NULL,
  type          TEXT NOT NULL,
  body          TEXT,
  media_path    TEXT,
  status        TEXT NOT NULL DEFAULT 'sent',
  quick_replies TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_messages_chat ON wa_messages(chat_id, created_at);

CREATE TABLE IF NOT EXISTS wa_sessions (
  id              INTEGER PRIMARY KEY,
  session_name    TEXT NOT NULL UNIQUE,
  phone           TEXT,
  status          TEXT NOT NULL,
  creds_path      TEXT NOT NULL,
  last_connected  TEXT,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id         INTEGER PRIMARY KEY,
  key        TEXT NOT NULL,
  version    INTEGER NOT NULL,
  body       TEXT NOT NULL,
  model_hint TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(key, version)
);

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics_daily (
  day              TEXT PRIMARY KEY,
  chats_started    INTEGER DEFAULT 0,
  previews_sent    INTEGER DEFAULT 0,
  orders_created   INTEGER DEFAULT 0,
  orders_paid      INTEGER DEFAULT 0,
  orders_delivered INTEGER DEFAULT 0,
  revenue          INTEGER DEFAULT 0,
  refunds          INTEGER DEFAULT 0,
  revisions        INTEGER DEFAULT 0,
  avg_ats_score    REAL,
  avg_minutes_to_deliver REAL
);

CREATE TABLE IF NOT EXISTS content_posts (
  id           INTEGER PRIMARY KEY,
  platform     TEXT NOT NULL,
  hook         TEXT NOT NULL,
  asset_path   TEXT,
  scheduled_at TEXT,
  posted_at    TEXT,
  status       TEXT NOT NULL DEFAULT 'draft',
  views        INTEGER DEFAULT 0,
  clicks       INTEGER DEFAULT 0,
  orders       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  meta_json  TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
