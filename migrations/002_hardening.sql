-- 002_hardening.sql — P0/P1 hardening: diskon, promo, sesi unduh, rate-limit login, ATS gap
PRAGMA foreign_keys = ON;

-- Diskon / voucher & saldo referral (janji "potongan Rp5.000" harus bisa ditepati)
CREATE TABLE IF NOT EXISTS discounts (
  id           INTEGER PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL,              -- 'fixed' | 'percent'
  value        INTEGER NOT NULL,           -- rupiah atau persen
  max_uses     INTEGER NOT NULL DEFAULT 0, -- 0 = tanpa batas
  used_count   INTEGER NOT NULL DEFAULT 0,
  per_customer INTEGER NOT NULL DEFAULT 1,
  min_price    INTEGER NOT NULL DEFAULT 0,
  owner_customer_id INTEGER REFERENCES customers(id),
  source       TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'referral' | 'promo'
  expires_at   TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_discounts_code ON discounts(code, active);

CREATE TABLE IF NOT EXISTS discount_uses (
  id          INTEGER PRIMARY KEY,
  discount_id INTEGER NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id    INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  amount      INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discount_uses_once ON discount_uses(discount_id, customer_id);

-- orders: nominal diskon + template + jejak unduhan publik
ALTER TABLE orders ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN discount_code TEXT;
ALTER TABLE orders ADD COLUMN template TEXT NOT NULL DEFAULT 'ats';
ALTER TABLE orders ADD COLUMN download_token TEXT;
ALTER TABLE orders ADD COLUMN download_expires_at TEXT;

-- Token portal pelanggan (akses /pesanan/<code>) — HMAC disimpan, bukan plaintext
CREATE TABLE IF NOT EXISTS access_tokens (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  purpose     TEXT NOT NULL DEFAULT 'portal',
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_tokens_order ON access_tokens(order_id, purpose);

-- Rate-limit login admin (brute force)
CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY,
  ip         TEXT NOT NULL,
  username   TEXT,
  ok         INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, created_at);

-- Laporan ATS gap: kata kunci hilang per order, untuk upsell & bantu klien
CREATE TABLE IF NOT EXISTS ats_gaps (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  keyword    TEXT NOT NULL,
  priority   TEXT NOT NULL DEFAULT 'medium',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ats_gaps_order ON ats_gaps(order_id);

-- Riwayat revisi terstruktur (apa yang berubah, bukan teks bebas)
CREATE TABLE IF NOT EXISTS revisions (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  free       INTEGER NOT NULL DEFAULT 0,
  instruction TEXT NOT NULL,
  changes_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_order ON revisions(order_id, version);

-- Pemakaian AI per order (biaya token terlihat operator)
CREATE TABLE IF NOT EXISTS ai_usage (
  id             INTEGER PRIMARY KEY,
  order_id       INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  purpose        TEXT NOT NULL,
  model          TEXT,
  prompt_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  ok             INTEGER NOT NULL DEFAULT 1,
  error          TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at);

-- Pengingat follow-up lamaran (apply tracker)
CREATE TABLE IF NOT EXISTS reminders (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id  INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'followup',
  due_at       TEXT NOT NULL,
  sent_at      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, due_at);

-- Surat lamaran per lowongan
CREATE TABLE IF NOT EXISTS cover_letters (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  company     TEXT,
  role        TEXT,
  jd_text     TEXT,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cover_letters_order ON cover_letters(order_id);

-- Status internal (health AI, flag operasional) yang dibaca dashboard admin
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
