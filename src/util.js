import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const nowIso = () => new Date().toISOString();

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function slugify(value, fallback = 'x') {
  const s = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || fallback;
}

export function randHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

/** 08xx / 62xx / +62xx → 62xx */
export function normalizePhone(raw) {
  let s = String(raw ?? '').replace(/[^\d+]/g, '');
  s = s.replace(/^\+/, '');
  if (s.startsWith('0')) s = '62' + s.slice(1);
  if (s.startsWith('620')) s = '62' + s.slice(3);
  if (s.startsWith('8')) s = '62' + s;
  return s;
}

export function isValidPhone(raw) {
  const s = normalizePhone(raw);
  return /^62\d{8,14}$/.test(s);
}

export function formatRupiah(n) {
  return 'Rp' + Number(n || 0).toLocaleString('id-ID');
}

export function formatWIB(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short',
  }).format(d);
}

export function wibDay(iso = new Date().toISOString()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(iso));
}

export function safeJson(text, fallback = null) {
  try { return JSON.parse(text); } catch { return fallback; }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function signValue(value, secret) {
  const mac = crypto.createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${mac}`;
}

export function verifySigned(signed, secret) {
  if (typeof signed !== 'string' || !signed.includes('.')) return null;
  const idx = signed.lastIndexOf('.');
  const value = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', secret).update(value).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

export function truncate(text, max) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

export function capitalizeSentence(s) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function fileSize(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function addDaysIso(days) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

export function minuteDiff(fromIso, toIso) {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 60000);
}
