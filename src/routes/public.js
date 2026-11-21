import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { landingPage, atsPage } from '../views/landing.js';
import { simulatorPage } from '../views/simulator.js';
import { layout } from '../views/layout.js';
import { scoreRawText, bandLabel } from '../services/quickScore.js';
import { router9Available } from '../services/ai/router9.js';
import { queueStats } from '../services/jobs.js';
import { portalPage, legalPage } from '../views/portal.js';
import { orderForToken, latestDocuments } from '../services/access.js';
import { getOrder } from '../services/orders.js';
import { getDb } from '../db.js';

const hits = new Map();

function rateLimit(ip, max = 30, windowMs = 3600 * 1000) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length <= max;
}

export function publicRoutes() {
  const r = Router();

  const KIND_TITLES = {
    cv_pdf: 'CV (PDF)', cv_docx: 'CV (Word)', letter_pdf: 'Surat Lamaran',
    linkedin_txt: 'Teks LinkedIn', score_pdf: 'Laporan Skor ATS',
  };
  const kindTitle = (kind) => KIND_TITLES[kind] || kind;
  const safeSize = (file) => { try { return fs.statSync(file).size; } catch { return 0; } };

  r.get('/', (req, res) => {
    res.type('html').send(layout({ title: 'CV ATS dalam 15 menit', body: landingPage(), active: 'home' }));
  });

  r.get('/cek-ats', (req, res) => {
    res.type('html').send(layout({
      title: 'Cek Skor ATS Gratis',
      description: 'Hitung skor ATS CV kamu secara gratis: keyword, format, keterbacaan, kontak.',
      body: atsPage(),
      active: 'ats',
    }));
  });

  r.get('/simulator', (req, res, next) => {
    if (!config.simulator.enabled) return next();
    res.type('html').send(layout({
      title: 'Simulator WhatsApp',
      description: 'Coba alur pemesanan LamaranKilat tanpa nomor WhatsApp asli.',
      body: simulatorPage(),
      active: 'sim',
    }));
  });

  r.get('/health', (req, res) => {
    let ai = null;
    try {
      const row = getDb().prepare("SELECT value FROM app_settings WHERE key = 'ai_health'").get();
      ai = row ? JSON.parse(row.value) : null;
    } catch { ai = null; }
    res.json({
      ok: true,
      version: config.version,
      uptime_s: Math.round(process.uptime()),
      env: config.env,
      queue: queueStats(),
      router9: router9Available(),
      ai,
      ts: new Date().toISOString(),
    });
  });

  r.post('/api/public/score', (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    if (!rateLimit(ip)) return res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi nanti.' });
    const { cv, jd } = req.body || {};
    if (typeof cv !== 'string' || cv.trim().length < 60) {
      return res.status(400).json({ error: 'Isi CV minimal 60 karakter.' });
    }
    if (cv.length > 20000 || (jd && jd.length > 20000)) {
      return res.status(400).json({ error: 'Teks terlalu panjang (maksimal 20.000 karakter).' });
    }
    if (jd && jd.trim().length > 0 && jd.trim().length < 60) {
      return res.status(400).json({ error: 'Teks lowongan minimal 60 karakter, atau kosongkan.' });
    }
    const result = scoreRawText(cv, jd || '');
    logger.info('ats_check', { total: result.total, words: result.words });
    res.json({ ...result, band: bandLabel(result.total) });
  });

  r.get('/robots.txt', (req, res) => {
    res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\n');
  });

  r.get('/favicon.ico', (req, res) => res.status(204).end());

  r.get('/panduan', (req, res) => {
    res.type('html').send(layout({
      title: 'Panduan',
      body: `<section class="narrow" style="padding:48px 0">
        <h1 style="font-size:32px">Panduan singkat</h1>
        <div class="card"><h3>Untuk pelanggan</h3>
          <ol class="muted"><li>Chat WhatsApp, pilih paket.</li><li>Jawab 7 pertanyaan singkat.</li><li>Cek preview + skor ATS.</li><li>Bayar sesuai nominal unik.</li><li>Terima PDF + DOCX di chat.</li></ol>
          <p class="hint">Revisi pertama gratis. Data dihapus otomatis 30 hari.</p></div>
        <div class="card"><h3>Untuk admin</h3>
          <ol class="muted"><li>Buka /admin, verifikasi bukti bayar.</li><li>Approve → dokumen dibuat otomatis.</li><li>Pantau queue di /admin/jobs.</li></ol>
          <p class="hint">Alat bantu: <a href="/cek-ats">cek ATS</a> dan <a href="/simulator">simulator</a>.</p></div>
      </section>`,
      active: '',
    }));
  });

  r.get('/download/:file', (req, res) => {
    // endpoint legacy: diganti portal bertoken /pesanan/<kode>
    res.status(404).type('text/plain').send('not found');
  });

  // ---- portal pesanan (unduh ulang bertoken) ----
  r.get('/pesanan/:code', (req, res) => {
    const token = String(req.query.t || '');
    const order = orderForToken(token);
    if (!order || order.code !== req.params.code) {
      return res.status(404).type('html').send(layout({
        title: 'Pesanan tidak ditemukan',
        body: `<section class="narrow" style="padding:56px 0">
          <h1 style="font-size:28px">Link tidak valid atau kedaluwarsa</h1>
          <p class="muted">Minta link baru dengan membalas <strong>STATUS</strong> di WhatsApp. Link berlaku 30 hari.</p>
          <p><a class="btn" href="/">Kembali ke beranda</a></p>
        </section>`,
        active: '',
      }));
    }
    const docs = latestDocuments(order.id).map((doc) => ({
      ...doc,
      title: kindTitle(doc.kind),
      bytes: doc.bytes || safeSize(doc.path),
    }));
    res.type('html').send(layout({
      title: `Pesanan ${order.code}`,
      description: 'Unduh dokumen CV & surat lamaran kamu.',
      body: portalPage({ order, docs, token }),
      active: '',
    }));
  });

  r.get('/pesanan/:code/file/:id', (req, res) => {
    const order = orderForToken(String(req.query.t || ''));
    if (!order || order.code !== req.params.code) return res.status(404).type('text/plain').send('not found');
    const doc = getDb().prepare('SELECT * FROM documents WHERE id = ? AND order_id = ? AND deleted_at IS NULL')
      .get(Number(req.params.id), order.id);
    if (!doc || !fs.existsSync(doc.path)) return res.status(404).type('text/plain').send('not found');
    const base = path.basename(doc.path);
    const mime = base.endsWith('.docx')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : base.endsWith('.txt') ? 'text/plain; charset=utf-8' : 'application/pdf';
    res.type(mime);
    res.setHeader('Content-Disposition', `attachment; filename="${base.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(doc.path).pipe(res);
  });

  // ---- halaman legal ----
  for (const [slug, kind] of [['privasi', 'privasi'], ['syarat', 'syarat'], ['refund', 'refund']]) {
    r.get(`/${slug}`, (req, res) => {
      res.type('html').send(layout({ title: legalPage(kind).match(/<h1[^>]*>([^<]+)</)?.[1] || slug, body: legalPage(kind), active: '' }));
    });
  }

  r.get('/assets/:file', (req, res, next) => {
    const safe = path.basename(req.params.file);
    const file = path.join(process.cwd(), 'public', safe);
    if (!fs.existsSync(file)) return next();
    res.sendFile(file);
  });

  return r;
}
