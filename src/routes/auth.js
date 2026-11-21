import { config } from '../config.js';
import { parseCookies, signValue, verifySigned } from '../util.js';
import { getDb } from '../db.js';

export const SESSION_COOKIE = 'lk_admin';

export function issueSession(username) {
  const payload = JSON.stringify({ u: username, exp: Date.now() + config.sessionHours * 3600 * 1000 });
  return signValue(Buffer.from(payload).toString('base64url'), config.sessionSecret);
}

export function readSession(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;
  const value = verifySigned(raw, config.sessionSecret);
  if (!value) return null;
  try {
    const data = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!data?.u || !data?.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function setSessionCookie(res, token) {
  const maxAge = config.sessionHours * 3600;
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

export function requireAdmin(req, res, next) {
  const session = readSession(req);
  if (!session) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
    return res.redirect('/admin');
  }
  req.admin = session;
  next();
}

/** Cegah CSRF sederhana: hanya terima POST dengan Origin/Host yang cocok. */
export function sameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // curl / internal
  try {
    const host = new URL(origin).host;
    if (host !== req.headers.host) return res.status(403).json({ error: 'origin tidak diizinkan' });
  } catch {
    return res.status(403).json({ error: 'origin tidak valid' });
  }
  return next();
}

// ---------- rate limit login admin (brute force) ----------

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/** Sisa waktu lock (ms) bila IP sedang diblokir. */
export function loginLockRemaining(ip) {
  const db = getDb();
  const since = new Date(Date.now() - config.login.lockMinutes * 60000).toISOString();
  const fails = db.prepare(
    'SELECT COUNT(*) AS c FROM login_attempts WHERE ip = ? AND ok = 0 AND created_at >= ?',
  ).get(ip, since).c;
  if (fails < config.login.maxFails) return 0;
  const last = db.prepare(
    'SELECT created_at FROM login_attempts WHERE ip = ? AND ok = 0 ORDER BY id DESC LIMIT 1',
  ).get(ip);
  if (!last) return 0;
  const until = new Date(new Date(last.created_at).getTime() + config.login.lockMinutes * 60000);
  return Math.max(0, until.getTime() - Date.now());
}

export function recordLoginAttempt(ip, username, ok) {
  const db = getDb();
  db.prepare('INSERT INTO login_attempts (ip, username, ok, created_at) VALUES (?,?,?,?)')
    .run(ip, String(username || '').slice(0, 60), ok ? 1 : 0, new Date().toISOString());
  if (ok) {
    // login sukses membersihkan riwayat gagal dari IP itu
    db.prepare('DELETE FROM login_attempts WHERE ip = ? AND ok = 0').run(ip);
  }
  // buang riwayat lebih dari 7 hari
  db.prepare("DELETE FROM login_attempts WHERE created_at < ?").run(new Date(Date.now() - 7 * 86400000).toISOString());
}

