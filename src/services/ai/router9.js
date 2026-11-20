import { config } from '../../config.js';
import { logger } from '../../logger.js';
import { getDb } from '../../db.js';

const cache = new Map();

export function templateFor(key) {
  if (cache.has(key)) return cache.get(key);
  try {
    const row = getDb()
      .prepare('SELECT body FROM prompt_templates WHERE key = ? AND active = 1 ORDER BY version DESC LIMIT 1')
      .get(key);
    if (row) {
      cache.set(key, row.body);
      return row.body;
    }
  } catch { /* db belum siap */ }
  return null;
}

export function clearPromptCache() {
  cache.clear();
}

export function router9Available() {
  return Boolean(config.router9.apiKey);
}

/**
 * Panggil 9Router (OpenAI-compatible) dan minta JSON.
 * Mengembalikan objek terparse, atau null bila gagal / tidak dikonfigurasi.
 */
export async function chatJson({ prompt, templateKey, model, temperature = 0.2, maxTokens = 1400 }) {
  if (!config.router9.apiKey) return null;
  const tpl = templateKey ? templateFor(templateKey) : null;
  const content = tpl ? tpl.replace('{{INPUT}}', prompt) : prompt;
  const useModel = model || config.router9.modelPrimary;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.router9.timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${config.router9.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.router9.apiKey}`,
      },
      body: JSON.stringify({
        model: useModel,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: 'Balas hanya dengan JSON valid tanpa penjelasan, tanpa markdown.' },
          { role: 'user', content },
        ],
      }),
    });
    if (!res.ok) {
      logger.warn('router9_http_error', { status: res.status, model: useModel });
      return null;
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    const json = extractJson(text);
    logger.info('router9_ok', { model: useModel, ms: Date.now() - started, chars: text.length });
    return json;
  } catch (err) {
    logger.warn('router9_failed', { error: String(err.message), model: useModel });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json/gi, '```').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch { /* lanjut */ }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* lanjut */ }
  }
  return null;
}

let healthCache = { at: 0, value: null };

export async function checkRouter9() {
  if (!config.router9.apiKey) return { ok: false, reason: 'not_configured' };
  if (healthCache.value && Date.now() - healthCache.at < 60000) return healthCache.value;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${config.router9.baseUrl}/models`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${config.router9.apiKey}` },
    });
    const value = { ok: res.ok, status: res.status, baseUrl: config.router9.baseUrl };
    healthCache = { at: Date.now(), value };
    return value;
  } catch (err) {
    const value = { ok: false, reason: String(err.message), baseUrl: config.router9.baseUrl };
    healthCache = { at: Date.now(), value };
    return value;
  } finally {
    clearTimeout(timer);
  }
}
