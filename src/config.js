import fs from 'node:fs';
import path from 'node:path';

const env = process.env;

function bool(v, def = false) {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}
function int(v, def) {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : def;
}

const ROOT = process.cwd();
const dataRoot = env.DATA_ROOT || path.join(ROOT, 'data');

export const config = {
  version: env.APP_VERSION || '0.1.0',
  env: env.NODE_ENV || 'development',
  host: env.HOST || '0.0.0.0',
  port: int(env.PORT, 8092),
  baseUrl: env.BASE_URL || `http://127.0.0.1:${int(env.PORT, 8092)}`,
  internalToken: env.INTERNAL_TOKEN || '',
  sessionSecret: env.SESSION_SECRET || 'dev-insecure-session-secret-change-me',
  sessionHours: 12,

  dbPath: env.DB_PATH || path.join(dataRoot, 'db', 'lamarankilat.db'),
  artefactDir: env.ARTEFACT_DIR || path.join(dataRoot, 'artefacts'),
  mediaDir: env.MEDIA_DIR || path.join(dataRoot, 'media'),
  logDir: env.LOG_DIR || path.join(dataRoot, 'logs'),
  backupDir: env.BACKUP_DIR || path.join(dataRoot, 'backup'),
  artefactTtlDays: int(env.ARTEFACT_TTL_DAYS, 30),
  dataRetentionDays: int(env.DATA_RETENTION_DAYS, 30),
  retentionDays: int(env.DATA_RETENTION_DAYS, 30),
  contactEmail: env.CONTACT_EMAIL || 'halo@lamarankilat.id',

  // /simulator hanya untuk pengembangan. Di production harus opt-in eksplisit.
  simulator: {
    enabled: bool(env.SIMULATOR_ENABLED, (env.NODE_ENV || 'development') !== 'production'),
  },

  backup: {
    enabled: bool(env.BACKUP_ENABLED, true),
    keepDays: int(env.BACKUP_KEEP_DAYS, 14),
    hour: int(env.BACKUP_HOUR, 3),
  },

  login: {
    maxFails: int(env.ADMIN_LOGIN_MAX_FAILS, 5),
    lockMinutes: int(env.ADMIN_LOGIN_LOCK_MINUTES, 15),
  },

  preview: {
    watermark: bool(env.PREVIEW_WATERMARK, true),
    maxPerDay: int(env.PREVIEW_MAX_PER_DAY, 6),
  },

  referral: {
    credit: int(env.REFERRAL_CREDIT, 5000),
    maxSharePct: int(env.REFERRAL_MAX_SHARE_PCT, 50),
  },

  templates: (env.CV_TEMPLATES || 'ats,modern,executive').split(',').map((s) => s.trim()).filter(Boolean),

  admin: { user: env.ADMIN_USER || 'admin', pass: env.ADMIN_PASS || '' },

  wa: {
    enabled: bool(env.WA_ENABLED, false),
    sessionName: env.WA_SESSION_NAME || 'lamarankilat',
    phone: env.WA_PHONE || '',
    dailyLimit: int(env.WA_DAILY_LIMIT, 250),
    sessionDir: env.WA_SESSION_DIR || path.join(dataRoot, 'wa'),
  },

  router9: {
    baseUrl: (env.ROUTER9_BASE_URL || 'https://9router.q-devstb.my.id/v1').replace(/\/$/, ''),
    apiKey: env.ROUTER9_API_KEY || '',
    modelPrimary: env.ROUTER9_MODEL_PRIMARY || 'combo-coding-pertama-gan',
    modelFast: env.ROUTER9_MODEL_FAST || 'combo-coding-pertama-gan',
    timeoutMs: int(env.ROUTER9_TIMEOUT_MS, 45000),
  },

  payment: {
    mode: env.PAYMENT_MODE || 'transfer_manual',
    bankName: env.BANK_NAME || '',
    bankAccount: env.BANK_ACCOUNT || '',
    bankHolder: env.BANK_HOLDER || '',
    qrisImagePath: env.QRIS_IMAGE_PATH || '',
  },

  price: {
    cv: int(env.PRICE_CV, 15000),
    bundle: int(env.PRICE_BUNDLE, 35000),
    revision: int(env.PRICE_REVISION, 10000),
  },

  alert: {
    telegramChatId: env.ALERT_TELEGRAM_CHAT_ID || '',
    telegramToken: env.TELEGRAM_BOT_TOKEN || '',
  },
};

export function paymentConfigured() {
  const p = config.payment;
  if (p.mode === 'qris_static') return Boolean(p.qrisImagePath);
  if (p.mode === 'manual_confirm') return true;
  if (p.mode === 'gateway') return Boolean(env.GATEWAY_KEY);
  return Boolean(p.bankAccount && p.bankHolder);
}

export function ensureDirs() {
  for (const dir of [
    path.dirname(config.dbPath),
    config.artefactDir,
    config.mediaDir,
    config.logDir,
    config.backupDir,
    config.wa.sessionDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
