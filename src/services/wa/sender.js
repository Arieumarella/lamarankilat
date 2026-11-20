import fs from 'node:fs';
import { getDb } from '../../db.js';
import { nowIso } from '../../util.js';
import { logger } from '../../logger.js';

let transport = null;

/** Transport nyata (Baileys). Dipasang hanya bila WA_ENABLED=true. */
export function setTransport(fn) {
  transport = fn;
}

export function transportActive() {
  return Boolean(transport);
}

function store(chatId, payload) {
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO wa_messages (chat_id, direction, type, body, media_path, status, quick_replies, created_at)
    VALUES (?, 'out', ?, ?, ?, ?, ?, ?)
  `).run(
    chatId, payload.type || 'text', payload.text || null, payload.mediaPath || null,
    payload.status || 'sent', payload.quickReplies ? JSON.stringify(payload.quickReplies) : null, nowIso(),
  );
  return db.prepare('SELECT * FROM wa_messages WHERE id = ?').get(info.lastInsertRowid);
}

export async function sendText(chatId, text, { quickReplies = null, jid = null } = {}) {
  const row = store(chatId, { type: 'text', text, quickReplies });
  if (transport) {
    try {
      await transport({ jid: jid || `${chatId}@s.whatsapp.net`, kind: 'text', text, quickReplies });
      getDb().prepare("UPDATE wa_messages SET status = 'sent' WHERE id = ?").run(row.id);
    } catch (err) {
      getDb().prepare("UPDATE wa_messages SET status = 'failed' WHERE id = ?").run(row.id);
      logger.error('wa_send_failed', { chatId, error: String(err.message) });
    }
  }
  return row;
}

export async function sendImage(chatId, filePath, caption = '') {
  const row = store(chatId, { type: 'image', text: caption, mediaPath: filePath });
  if (transport) {
    try {
      await transport({ jid: `${chatId}@s.whatsapp.net`, kind: 'image', filePath, caption });
      getDb().prepare("UPDATE wa_messages SET status = 'sent' WHERE id = ?").run(row.id);
    } catch (err) {
      getDb().prepare("UPDATE wa_messages SET status = 'failed' WHERE id = ?").run(row.id);
    }
  }
  return row;
}

export async function sendDocument(chatId, filePath, fileName, mimetype) {
  const bytes = (() => { try { return fs.statSync(filePath).size; } catch { return 0; } })();
  const row = store(chatId, { type: 'document', text: fileName, mediaPath: filePath });
  if (transport) {
    try {
      await transport({ jid: `${chatId}@s.whatsapp.net`, kind: 'document', filePath, fileName, mimetype, bytes });
      getDb().prepare("UPDATE wa_messages SET status = 'sent' WHERE id = ?").run(row.id);
    } catch (err) {
      getDb().prepare("UPDATE wa_messages SET status = 'failed' WHERE id = ?").run(row.id);
      throw err;
    }
  }
  return row;
}

export function listMessages(chatId, sinceId = 0, limit = 200) {
  return getDb().prepare(`
    SELECT * FROM wa_messages WHERE chat_id = ? AND id > ? ORDER BY id ASC LIMIT ?
  `).all(chatId, Number(sinceId) || 0, limit);
}

export function conversationList(limit = 50) {
  return getDb().prepare(`
    SELECT c.wa_number, c.display_name, cv.state, cv.updated_at,
           (SELECT body FROM wa_messages m WHERE m.chat_id = c.wa_number ORDER BY m.id DESC LIMIT 1) AS last_message,
           (SELECT COUNT(*) FROM wa_messages m WHERE m.chat_id = c.wa_number) AS message_count
    FROM customers c
    LEFT JOIN conversations cv ON cv.customer_id = c.id
    ORDER BY cv.updated_at DESC, c.last_seen_at DESC LIMIT ?
  `).all(limit);
}
