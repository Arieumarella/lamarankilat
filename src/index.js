import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import { config, ensureDirs } from './config.js';
import { logger } from './logger.js';
import { getDb } from './db.js';
import { migrate } from './migrate.js';
import { startWorker, stopWorker } from './worker.js';
import { registerAll } from './jobs/index.js';
import { publicRoutes } from './routes/public.js';
import { simulatorRoutes } from './routes/simulator.js';
import { adminRoutes } from './routes/admin.js';
import { handleIncoming } from './services/conversation.js';
import { startWhatsApp, waState } from './services/wa/baileys.js';
import { setTransport } from './services/wa/sender.js';
import { audit } from './db.js';
import { checkRouter9 } from './services/ai/router9.js';
import { sendTelegram } from './services/alerts.js';
import { maybeDailyBackup } from './services/backup.js';

function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(express.static('public', { maxAge: '1h', index: false }));
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/assets') || req.path === '/favicon.ico') return;
      logger.info('http', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - started,
      });
    });
    next();
  });

  app.use(publicRoutes());
  app.use(simulatorRoutes());
  app.use(adminRoutes());

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
    res.status(404).type('html').send(`<!doctype html><html lang="id"><meta charset="utf-8"><title>404</title>
<body style="font-family:system-ui;background:#070b16;color:#e2e8f0;padding:60px">
<h1>404</h1><p>Halaman tidak ditemukan.</p><p><a style="color:#818cf8" href="/">Kembali ke beranda</a></p></body></html>`);
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error('request_failed', { path: req.path, error: String(err && err.message), stack: err?.stack?.split('\n').slice(0, 4).join(' | ') });
    if (res.headersSent) return;
    if (req.path.startsWith('/api/')) return res.status(400).json({ error: err.message || 'permintaan gagal' });
    res.status(400).type('html').send(`<!doctype html><meta charset="utf-8"><title>Gagal</title>
<body style="font-family:system-ui;background:#070b16;color:#e2e8f0;padding:60px"><h1>Permintaan gagal</h1>
<p>${String(err.message || 'Terjadi kesalahan').replace(/[<>&]/g, '')}</p><p><a style="color:#818cf8" href="/">Beranda</a></p></body>`);
  });

  return app;
}

let lastAiAlert = 0;

/**
 * Cek koneksi AI (9Router). Simpan status di DB agar badge dashboard akurat,
 * dan kirim satu alert Telegram saat status berubah jadi gagal.
 */
async function probeAi() {
  const health = await checkRouter9();
  let ok = Boolean(health.ok);
  let detail = health.ok ? `HTTP ${health.status || 200}` : (health.reason || `HTTP ${health.status || '-'}`);
  // /models bisa 401 walau key valid untuk chat; uji chat sekali bila perlu.
  if (!ok && config.router9.apiKey) {
    try {
      const res = await fetch(`${config.router9.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.router9.apiKey },
        body: JSON.stringify({
          model: config.router9.modelPrimary,
          max_tokens: 4,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      if (res.ok) { ok = true; detail = `chat ${res.status}`; }
      else detail = `chat ${res.status}`;
    } catch (err) {
      detail = String(err.message).slice(0, 120);
    }
  }
  const status = { ok, detail, at: new Date().toISOString(), models: health.status || null };
  try {
    getDb().prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('ai_health', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(JSON.stringify(status), status.at);
  } catch { /* settings table beda skema */ }
  audit('system', ok ? 'ai_probe_ok' : 'ai_probe_failed', 'ai', config.router9.modelPrimary, { detail });
  if (!ok && Date.now() - lastAiAlert > 3600 * 1000) {
    lastAiAlert = Date.now();
    await sendTelegram(`⚠️ AI (9Router) tidak aktif: ${detail}\nDokumen akan memakai template fallback sampai koneksi pulih.`);
  }
  return status;
}

async function main() {

  ensureDirs();
  migrate();
  registerAll();

  const app = buildApp();
  const server = http.createServer(app);
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolve());
  });

  logger.info('server_started', {
    host: config.host,
    port: config.port,
    env: config.env,
    version: config.version,
    db: config.dbPath,
    wa: config.wa.enabled,
    node: process.version,
  });
  audit('system', 'server_started', 'server', String(config.port));

  startWorker();
  maybeDailyBackup();
  setInterval(() => { maybeDailyBackup(); }, 30 * 60 * 1000).unref();

  // Probe 9Router saat boot: kalau mati, admin tahu sebelum pelanggan komplain.
  probeAi().catch(() => {});
  setInterval(() => { probeAi().catch(() => {}); }, 6 * 3600 * 1000).unref();

  if (config.wa.enabled) {
    try {
      await startWhatsApp({
        onMessage: (msg) => handleIncoming(msg),
        setTransport: (fn) => setTransport(fn),
      });
      logger.info('wa_started', { status: waState().status });
    } catch (err) {
      logger.error('wa_start_failed', { error: String(err.message) });
    }
  } else {
    logger.info('wa_gateway_off', { hint: 'set WA_ENABLED=true + scan QR di /admin/settings' });
  }

  const shutdown = async (signal) => {
    logger.info('shutdown_begin', { signal });
    stopWorker();
    server.close(() => logger.info('http_closed'));
    try { getDb().close(); } catch { /* ignore */ }
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled_rejection', { error: String(reason && (reason.message || reason)) });
  });
  process.on('uncaughtException', (err) => {
    logger.error('uncaught_exception', { error: String(err.message), stack: err.stack?.split('\n').slice(0, 5).join(' | ') });
  });
}

main().catch((err) => {
  logger.error('fatal_start', { error: String(err.message), stack: err.stack?.split('\n').slice(0, 6).join(' | ') });
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
