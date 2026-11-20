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

  r.get('/simulator', (req, res) => {
    res.type('html').send(layout({
      title: 'Simulator WhatsApp',
      description: 'Coba alur pemesanan LamaranKilat tanpa nomor WhatsApp asli.',
      body: simulatorPage(),
      active: 'sim',
    }));
  });

  r.get('/health', (req, res) => {
    res.json({
      ok: true,
      version: config.version,
      uptime_s: Math.round(process.uptime()),
      env: config.env,
      queue: queueStats(),
      router9: router9Available(),
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
    // endpoint legacy tidak dipakai; dokumen dikirim via WhatsApp & admin
    res.status(404).type('text/plain').send('not found');
  });

  r.get('/assets/:file', (req, res, next) => {
    const safe = path.basename(req.params.file);
    const file = path.join(process.cwd(), 'public', safe);
    if (!fs.existsSync(file)) return next();
    res.sendFile(file);
  });

  return r;
}
