import { config } from '../config.js';
import { parseCookies, signValue, verifySigned } from '../util.js';

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
