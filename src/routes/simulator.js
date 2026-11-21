import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { normalizePhone, isValidPhone, nowIso } from '../util.js';
import { handleIncoming, startConversation } from '../services/conversation.js';
import { listMessages, conversationList } from '../services/wa/sender.js';
import { findByNumber } from '../services/customers.js';
import { readSession } from './auth.js';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function phoneGuard(raw) {
  const phone = normalizePhone(raw);
  if (!isValidPhone(phone)) throw new Error('nomor tidak valid, contoh 6281234567890');
  return phone;
}

/** Simulator memakai jalur order asli — wajib login admin walau di dev. */
function simGuard(req, res, next) {
  if (!config.simulator.enabled) return res.status(404).json({ error: 'not found' });
  if (!readSession(req)) return res.status(401).json({ error: 'unauthorized' });
  return next();
}

export function simulatorRoutes() {
  const r = Router();
  r.use('/api/sim', simGuard);

  r.post('/api/sim/start', async (req, res, next) => {
    try {
      const phone = phoneGuard(req.body?.phone);
      await startConversation(phone, req.body?.name || null);
      res.json({ ok: true, phone });
    } catch (err) { next(err); }
  });

  r.post('/api/sim/send', async (req, res, next) => {
    try {
      const phone = phoneGuard(req.body?.phone);
      const text = String(req.body?.text || '').slice(0, 4000);
      if (!text.trim()) return res.status(400).json({ error: 'pesan kosong' });
      const result = await handleIncoming({ waNumber: phone, text, type: 'text' });
      res.json({ ok: true, result });
    } catch (err) { next(err); }
  });

  r.post('/api/sim/proof', async (req, res, next) => {
    try {
      const phone = phoneGuard(req.body?.phone);
      const dir = path.join(config.mediaDir, 'proof');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `sim-${Date.now()}.png`);
      fs.writeFileSync(file, PNG_1PX);
      const result = await handleIncoming({ waNumber: phone, text: '[bukti transfer simulasi]', type: 'image', mediaPath: file });
      res.json({ ok: true, result });
    } catch (err) { next(err); }
  });

  r.get('/api/sim/messages', (req, res) => {
    const phone = normalizePhone(req.query.phone || '');
    if (!isValidPhone(phone)) return res.status(400).json({ error: 'nomor tidak valid' });
    const since = Number(req.query.since || 0);
    const customer = findByNumber(phone);
    const conv = customer
      ? getDb().prepare('SELECT state, updated_at FROM conversations WHERE customer_id = ?').get(customer.id)
      : null;
    const all = listMessages(phone, 0, 300);
    const fresh = since ? listMessages(phone, since, 100) : all;
    res.json({
      ok: true,
      state: conv?.state || 'NEW',
      messages: fresh,
      all,
      conversations: conversationList(30),
      wa_enabled: config.wa.enabled,
    });
  });

  // Endpoint debug: reset percakapan (hanya untuk simulator)
  r.post('/api/sim/reset', (req, res, next) => {
    try {
      const phone = phoneGuard(req.body?.phone);
      const db = getDb();
      const customer = findByNumber(phone);
      if (customer) {
        db.prepare('DELETE FROM conversations WHERE customer_id = ?').run(customer.id);
        db.prepare('DELETE FROM wa_messages WHERE chat_id = ?').run(phone);
        logger.info('sim_reset', { phone, at: nowIso() });
      }
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  return r;
}
