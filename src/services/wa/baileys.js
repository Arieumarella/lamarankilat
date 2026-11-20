import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { logger } from '../../logger.js';

/**
 * Baileys dimuat dinamis: hanya saat WA_ENABLED=true, agar RAM STB tidak terpakai
 * ketika kanal WhatsApp belum aktif (mode simulator / staging).
 */
const state = {
  sock: null,
  status: 'disconnected',
  qr: null,
  qrAt: null,
  lastConnected: null,
  lastError: null,
  startedAt: null,
  sentToday: 0,
  sentDay: new Date().toISOString().slice(0, 10),
};

export function waState() {
  return {
    enabled: config.wa.enabled,
    status: state.status,
    qr: state.qr,
    qrAt: state.qrAt,
    lastConnected: state.lastConnected,
    lastError: state.lastError,
    startedAt: state.startedAt,
    sentToday: state.sentToday,
    phone: config.wa.phone,
  };
}

function bumpSent() {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== state.sentDay) { state.sentDay = day; state.sentToday = 0; }
  state.sentToday += 1;
  if (state.sentToday > config.wa.dailyLimit) {
    throw new Error('batas pesan harian tercapai');
  }
}

export async function startWhatsApp({ onMessage, setTransport }) {
  if (!config.wa.enabled) {
    state.status = 'disabled';
    logger.info('wa_disabled', { reason: 'WA_ENABLED=false' });
    return waState();
  }
  let baileys;
  try {
    baileys = await import('@whiskeysockets/baileys');
  } catch (err) {
    state.status = 'error';
    state.lastError = `baileys tidak terpasang: ${err.message}`;
    logger.error('wa_module_missing', { error: String(err.message) });
    return waState();
  }
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;
  const sessionDir = path.join(config.wa.sessionDir, config.wa.sessionName);
  fs.mkdirSync(sessionDir, { recursive: true });

  const connect = async () => {
    const { state: authState, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));
    const sock = makeWASocket({ auth: authState, version, printQRInTerminal: false, syncFullHistory: false, markOnlineOnConnect: false });
    state.sock = sock;
    state.status = 'connecting';
    state.startedAt = new Date().toISOString();

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) { state.qr = qr; state.qrAt = new Date().toISOString(); state.status = 'qr'; }
      if (connection === 'open') {
        state.status = 'connected';
        state.qr = null;
        state.lastConnected = new Date().toISOString();
        logger.info('wa_connected');
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        state.status = 'disconnected';
        state.lastError = `close:${code || 'unknown'}`;
        const loggedOut = code === DisconnectReason?.loggedOut;
        if (loggedOut) {
          try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
        const delay = code === 401 ? 5000 : code === 428 ? 30000 : 120000;
        logger.warn('wa_disconnected', { code, retryInMs: delay });
        setTimeout(() => connect().catch((err) => logger.error('wa_reconnect_failed', { error: String(err.message) })), delay);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (msg.key?.fromMe) continue;
        const jid = msg.key?.remoteJid;
        if (!jid || jid.endsWith('@g.us')) continue;
        const waNumber = jid.split('@')[0];
        const text = msg.message?.conversation
          || msg.message?.extendedTextMessage?.text
          || msg.message?.buttonsResponseMessage?.selectedButtonId
          || msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId
          || '';
        const imageMsg = msg.message?.imageMessage;
        let mediaPath = null;
        if (imageMsg) {
          try {
            const { downloadMediaMessage } = baileys;
            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            if (buffer?.length && buffer.length <= 2 * 1024 * 1024) {
              const dir = path.join(config.mediaDir, 'proof');
              fs.mkdirSync(dir, { recursive: true });
              mediaPath = path.join(dir, `${Date.now()}-${waNumber}.jpg`);
              fs.writeFileSync(mediaPath, buffer);
            }
          } catch (err) {
            logger.warn('wa_media_download_failed', { error: String(err.message) });
          }
        }
        try {
          await onMessage({
            waNumber,
            text: text || (imageMsg ? '[bukti bayar]' : ''),
            waMessageId: msg.key.id,
            type: imageMsg ? 'image' : 'text',
            mediaPath,
            pushName: msg.pushName,
          });
        } catch (err) {
          logger.error('wa_inbound_failed', { error: String(err.message) });
        }
      }
    });

    setTransport(async ({ jid, kind, text, quickReplies, filePath, fileName, mimetype, caption }) => {
      bumpSent();
      await new Promise((r) => setTimeout(r, 800 + Math.floor(Math.random() * 1700))); // jeda anti-ban
      if (kind === 'text') {
        await sock.sendMessage(jid, { text });
      } else if (kind === 'image') {
        await sock.sendMessage(jid, { image: fs.readFileSync(filePath), caption: caption || '' });
      } else if (kind === 'document') {
        await sock.sendMessage(jid, {
          document: fs.readFileSync(filePath),
          fileName: fileName || path.basename(filePath),
          mimetype: mimetype || 'application/pdf',
        });
      }
    });
  };

  await connect();
  return waState();
}

export async function logoutWhatsApp() {
  try { await state.sock?.logout(); } catch { /* ignore */ }
  state.status = 'disconnected';
}
