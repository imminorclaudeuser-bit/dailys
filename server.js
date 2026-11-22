'use strict';
/**
 * «Дневничок» (Daily’s) — сервер без внешних зависимостей.
 * Node 22+: http, crypto, fs и встроенная база SQLite (node:sqlite).
 *
 * Запуск:  node server.js   →  http://127.0.0.1:3000
 * Переменные: PORT, HOST, DATA_DIR, COOKIE_SECURE=1 (за HTTPS), TRUST_PROXY=1 (за прокси)
 * ADMIN_EMAIL=you@example.com — this registered account becomes the admin (several: comma-separated).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const moderation = require('./moderation');

const scrypt = promisify(crypto.scrypt);
const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const SECURE = process.env.COOKIE_SECURE === '1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const COOKIE = SECURE ? '__Host-sid' : 'sid';
const REG_MAX = +process.env.REG_PER_HOUR || 10;      // регистраций в час с одного IP
const GUEST_MAX = +process.env.GUEST_PER_HOUR || 20;  // гостевых входов в час с одного IP
/* Google sign-in (optional): set all three to turn it on. The secret stays on the server. */
const GOOGLE = { id: process.env.GOOGLE_CLIENT_ID || '', secret: process.env.GOOGLE_CLIENT_SECRET || '', base: (process.env.PUBLIC_URL || '').replace(/\/+$/, '') };
const GOOGLE_ON = !!(GOOGLE.id && GOOGLE.secret && /^https?:\/\/[^/]+$/.test(GOOGLE.base));
const OAUTH_KEY = crypto.randomBytes(32);   // signs the short-lived sign-in cookie; a restart only cancels sign-ins in progress
const ADMIN_EMAILS = new Set(String(process.env.ADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean));

const LIMITS = {
  json: 14 * 1024 * 1024, small: 16 * 1024, photo: 3 * 1024 * 1024, audio: 20 * 1024 * 1024, voice: 10 * 1024 * 1024, video: 40 * 1024 * 1024,
  photosPerDay: 8, textLen: 5000, daysPerUser: 1000, bytesPerUser: 1024 * 1024 * 1024,
  sessionMs: 14 * 24 * 3600 * 1000, guestMs: 7 * 24 * 3600 * 1000
};

process.umask(0o077);   // every file and folder the server creates is readable by this user only
fs.mkdirSync(path.join(DATA_DIR, 'media'), { recursive: true, mode: 0o700 });

/* ======================= база данных ======================= */
const db = new DatabaseSync(path.join(DATA_DIR, 'memoir.db'));
for (const f of ['memoir.db', 'memoir.db-wal', 'memoir.db-shm']) { try { fs.chmodSync(path.join(DATA_DIR, f), 0o600); } catch { /* not created yet */ } }
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  is_guest INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS days (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  mood TEXT NOT NULL,
  technique TEXT NOT NULL,
  text TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_days_user ON days(user_id, date DESC);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  day_id TEXT NOT NULL REFERENCES days(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('photo','audio','voice','video')),
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  pos INTEGER NOT NULL DEFAULT 0,
  file TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_day ON media(day_id, kind, pos);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);
/* one-time upgrade of older databases: allow 'voice' and 'video' media (a backup copy is made first) */
if (!String((db.prepare("SELECT sql FROM sqlite_master WHERE name = 'media'").get() || {}).sql).includes("'voice'")) {
  const backup = path.join(DATA_DIR, `backup-before-media-upgrade-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  db.exec('PRAGMA foreign_keys = OFF'); db.exec('BEGIN');
  try {
    db.exec(`CREATE TABLE media_new (id TEXT PRIMARY KEY, day_id TEXT NOT NULL REFERENCES days(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('photo','audio','voice','video')), mime TEXT NOT NULL, bytes INTEGER NOT NULL, pos INTEGER NOT NULL DEFAULT 0, file TEXT NOT NULL);
      INSERT INTO media_new (id, day_id, user_id, kind, mime, bytes, pos, file) SELECT id, day_id, user_id, kind, mime, bytes, pos, file FROM media;
      DROP TABLE media; ALTER TABLE media_new RENAME TO media; CREATE INDEX IF NOT EXISTS idx_media_day ON media(day_id, kind, pos);`);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.exec('PRAGMA foreign_keys = ON'); }
  console.log('Database upgraded for voice and video; backup:', backup);
}
if (!db.prepare('PRAGMA table_info(days)').all().some(c => c.name === 'shared')) db.exec('ALTER TABLE days ADD COLUMN shared INTEGER NOT NULL DEFAULT 0');   // 1 = the author put it on the welcome wall
for (const col of ['name', 'prefs', 'avatar']) if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
const Q = {
  userByEmail: db.prepare('SELECT id, email, pass_hash, is_guest, name FROM users WHERE email = ?'),
  userInsertNamed: db.prepare('INSERT INTO users (email, pass_hash, is_guest, created_at, name) VALUES (?, ?, 0, ?, ?)'),
  userSetName: db.prepare('UPDATE users SET name = ? WHERE id = ?'),
  userInsert: db.prepare('INSERT INTO users (email, pass_hash, is_guest, created_at) VALUES (?, ?, ?, ?)'),
  userDel: db.prepare('DELETE FROM users WHERE id = ?'),
  userPass: db.prepare('SELECT pass_hash, is_guest FROM users WHERE id = ?'),
  prefsGet: db.prepare('SELECT prefs FROM users WHERE id = ?'),
  prefsSet: db.prepare('UPDATE users SET prefs = ? WHERE id = ?'),
  avatarGet: db.prepare('SELECT avatar FROM users WHERE id = ?'),
  profileSet: db.prepare('UPDATE users SET name = ?, avatar = ? WHERE id = ?'),
  userSetPass: db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?'),
  sessInsert: db.prepare('INSERT INTO sessions (token_hash, user_id, csrf, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
  sessGet: db.prepare(`SELECT s.token_hash, s.csrf, s.user_id, u.email, u.is_guest, u.name FROM sessions s JOIN users u ON u.id = s.user_id
                       WHERE s.token_hash = ? AND s.expires_at > ?`),
  sessDel: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  sessPurge: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  dayInsert: db.prepare('INSERT INTO days (id, user_id, date, title, mood, technique, text, data, created_at) VALUES (?,?,?,?,?,?,?,?,?)'),
  dayList: db.prepare('SELECT * FROM days WHERE user_id = ? ORDER BY date DESC, created_at DESC'),
  dayGet: db.prepare('SELECT * FROM days WHERE id = ? AND user_id = ?'),
  dayDel: db.prepare('DELETE FROM days WHERE id = ? AND user_id = ?'),
  dayCount: db.prepare('SELECT COUNT(*) AS n FROM days WHERE user_id = ?'),
  mediaInsert: db.prepare('INSERT INTO media (id, day_id, user_id, kind, mime, bytes, pos, file) VALUES (?,?,?,?,?,?,?,?)'),
  mediaForDay: db.prepare('SELECT id, kind, pos FROM media WHERE day_id = ? AND user_id = ? ORDER BY kind, pos'),
  mediaForUser: db.prepare('SELECT id, kind, pos, day_id FROM media WHERE user_id = ? ORDER BY day_id, kind, pos'),
  mediaGet: db.prepare('SELECT * FROM media WHERE id = ? AND user_id = ?'),
  mediaFilesOfDay: db.prepare('SELECT file FROM media WHERE day_id = ? AND user_id = ?'),
  mediaOfKind: db.prepare('SELECT id, file FROM media WHERE day_id = ? AND user_id = ? AND kind = ?'),
  mediaDel: db.prepare('DELETE FROM media WHERE id = ?'),
  bytesOfUser: db.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM media WHERE user_id = ?'),
  guestsOld: db.prepare('SELECT id FROM users WHERE is_guest = 1 AND created_at < ?'),
  /* admin */
  setGet: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setPut: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  dayAll: db.prepare(`SELECT d.id, d.user_id, d.date, d.title, d.mood, d.text, d.data, d.created_at, d.shared, u.email, u.is_guest FROM days d JOIN users u ON u.id = d.user_id
                      ORDER BY d.created_at DESC LIMIT 500`),
  dayAny: db.prepare('SELECT * FROM days WHERE id = ?'),
  dayShare: db.prepare('UPDATE days SET shared = ? WHERE id = ? AND user_id = ?'),
  dayShareAny: db.prepare('UPDATE days SET shared = 0 WHERE id = ?'),
  /* the welcome wall: newest shared days, each with only its first photo and its video */
  wall: db.prepare(`SELECT d.date, d.mood, d.text, d.data, (SELECT id FROM media WHERE day_id = d.id AND kind = 'photo' ORDER BY pos LIMIT 1) AS photo,
    (SELECT id FROM media WHERE day_id = d.id AND kind = 'video' LIMIT 1) AS video FROM days d WHERE d.shared = 1 ORDER BY d.created_at DESC LIMIT 60`),
  wallMedia: db.prepare(`SELECT m.* FROM media m JOIN days d ON d.id = m.day_id WHERE m.id = ? AND d.shared = 1
    AND (m.kind = 'video' OR m.id = (SELECT id FROM media WHERE day_id = d.id AND kind = 'photo' ORDER BY pos LIMIT 1))`),
  dayUpdate: db.prepare('UPDATE days SET title = ?, mood = ?, technique = ?, text = ?, data = ? WHERE id = ?'),
  dayDelAny: db.prepare('DELETE FROM days WHERE id = ?'),
  mediaFilesAny: db.prepare('SELECT file, user_id FROM media WHERE day_id = ?')
};
const setting = (key, fallback) => { const r = Q.setGet.get(key); if (!r) return fallback; try { return JSON.parse(r.value); } catch { return fallback; } };
const tx = fn => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

/* ======================= вспомогательное ======================= */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, status = 400) => new HttpError(status, msg);
const now = () => Date.now();
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const newId = () => crypto.randomBytes(12).toString('hex');
const ID_RE = /^[a-f0-9]{24}$/;

function clientIp(req) {
  if (TRUST_PROXY) { const x = req.headers['x-forwarded-for']; if (x) return String(x).split(',').pop().trim(); }
  return req.socket.remoteAddress || 'unknown';
}

/** Ограничитель частоты: окно в памяти, ключ — IP или аккаунт. */
const buckets = new Map();
function hit(key, max, windowMs) {
  const t = now(); let b = buckets.get(key);
  if (!b || b.reset <= t) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); }
  b.n++;
  return b.n <= max ? 0 : Math.ceil((b.reset - t) / 1000);
}
function limit(key, max, windowMs) { const wait = hit(key, max, windowMs); if (wait) throw Object.assign(bad('Слишком много попыток. Попробуйте позже.', 429), { retry: wait }); }
setInterval(() => { const t = now(); for (const [k, b] of buckets) if (b.reset <= t) buckets.delete(k); }, 60_000).unref();

function cookies(req) {
  const out = {}; (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return out;
}
function setCookie(res, token, maxAgeSec) {
  const attrs = [`${COOKIE}=${token}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${maxAgeSec}`];
  if (SECURE) attrs.push('Secure');
  res.setHeader('Set-Cookie', [...[].concat(res.getHeader('Set-Cookie') || []).filter(c => !c.startsWith(COOKIE + '=')), attrs.join('; ')]);
}

const CSP = [
  "default-src 'none'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' https://fonts.googleapis.com", "style-src-attr 'unsafe-inline'",
  "font-src https://fonts.gstatic.com", "img-src 'self' data: blob: https://*.mzstatic.com", "media-src 'self' blob: https:",
  "connect-src 'self' https://api.open-meteo.com", "frame-src https://www.youtube-nocookie.com https://open.spotify.com",
  "worker-src 'self' blob:", "manifest-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ...(SECURE ? ['upgrade-insecure-requests'] : [])
].join('; ');
function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=(self), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  if (SECURE) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const declared = +req.headers['content-length'];
    if (declared > max) return reject(bad('Слишком большой запрос', 413));
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > max) { reject(bad('Слишком большой запрос', 413)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, max = LIMITS.small) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw bad('Ожидается JSON', 415);
  const buf = await readBody(req, max);
  try { const v = JSON.parse(buf.toString('utf8')); if (v === null || typeof v !== 'object' || Array.isArray(v)) throw 0; return v; }
  catch { throw bad('Некорректный JSON'); }
}

/* ======================= пароли и сессии ======================= */
const SCRYPT = { s1: { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, s2: { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } };
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, 64, SCRYPT.s2);
  return `s2$${salt.toString('base64')}$${h.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  const [v, s, h] = String(stored).split('$'); if (!SCRYPT[v] || !s || !h) return false;
  const want = Buffer.from(h, 'base64');
  const got = await scrypt(pw, Buffer.from(s, 'base64'), want.length, SCRYPT[v]);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
const needsRehash = stored => !String(stored).startsWith('s2$');
let DUMMY_HASH = null; // чтобы ответ на неизвестный e-mail занимал столько же времени, как на известный
hashPassword('dummy-password').then(h => { DUMMY_HASH = h; });

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url'), csrf = crypto.randomBytes(24).toString('base64url');
  Q.sessInsert.run(sha256(token), userId, csrf, now(), now() + LIMITS.sessionMs);
  setCookie(res, token, LIMITS.sessionMs / 1000);
  return csrf;
}
function setOAuthCookie(res, data, maxAge) {
  const val = data ? Buffer.from(JSON.stringify(data)).toString('base64url') : '';
  const sig = data ? crypto.createHmac('sha256', OAUTH_KEY).update(val).digest('base64url') : '';
  const c = [`g_oauth=${val}.${sig}`, 'HttpOnly', 'SameSite=Lax', 'Path=/api/auth/google', `Max-Age=${maxAge}`]; if (SECURE) c.push('Secure');
  res.setHeader('Set-Cookie', [...[].concat(res.getHeader('Set-Cookie') || []), c.join('; ')]);
}
function readOAuthCookie(req) {
  const [val, sig] = String(cookies(req).g_oauth || '').split('.'); if (!val || !sig) return null;
  const want = crypto.createHmac('sha256', OAUTH_KEY).update(val).digest('base64url');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try { return JSON.parse(Buffer.from(val, 'base64url').toString('utf8')); } catch { return null; }
}
function getSession(req) {
  const tok = cookies(req)[COOKIE]; if (!tok || tok.length > 100 || !/^[\w-]+$/.test(tok)) return null;
  return Q.sessGet.get(sha256(tok), now()) || null;
}
function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]{2,}$/.test(e)) throw bad('Введите корректный e-mail');
  return e;
}
function cleanPassword(v) {
  const p = String(v || '');
  if (p.length < 10) throw bad('Пароль: не короче 10 символов');
  if (p.length > 128) throw bad('Пароль: не длиннее 128 символов');
  if (/^(.)\1+$/.test(p) || /^(?:password|qwerty|1234567890|0123456789)/i.test(p)) throw bad('Слишком простой пароль');
  return p;
}

/* ======================= проверка данных дня ======================= */
const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s%]+\))$/;
const BAD_CHARS = /[<>"`\\\u0000-\u001f]/;
/* How a person set up their "Write a day" page. Only known keys and values are kept. */
const PREF_CARDS = ['entry', 'song', 'camera', 'photos', 'extra'], PREF_HIDE = ['camera', 'extra', 'voice'];
const PREF_ONE = { layout: ['two', 'one'], accent: ['amber', 'rose', 'sage', 'sky', 'lavender', 'ink'], font: ['serif', 'sans', 'hand'], size: ['normal', 'large'] };
function cleanPrefs(b) {
  const out = {};
  if (Array.isArray(b.order) && b.order.length === PREF_CARDS.length && PREF_CARDS.every(c => b.order.includes(c))) out.order = b.order.slice();
  if (Array.isArray(b.hidden)) out.hidden = PREF_HIDE.filter(c => b.hidden.includes(c));
  for (const k in PREF_ONE) if (PREF_ONE[k].includes(b[k])) out[k] = b[k];
  if (typeof b.heading === 'string') { const h = b.heading.trim().slice(0, 60); if (BAD_CHARS.test(h)) throw bad('Недопустимые символы в заголовке'); out.heading = h; }
  if (typeof b.shapes === 'boolean') out.shapes = b.shapes;
  if (typeof b.daisy === 'boolean') out.daisy = b.daisy;
  if (b.remind === '' || (typeof b.remind === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.remind))) out.remind = b.remind;   // daily reminder time, '' = off
  return out;
}
/* Profile: a nickname (1–40 characters, no HTML characters) and a small picture the browser has already cut to a square.
   Only a JPEG/PNG/WebP data URL of real base64 up to 120 KB is kept; null removes it. */
const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
function cleanProfile(b) {
  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 40) throw bad('Никнейм — от 1 до 40 символов');
  if (BAD_CHARS.test(name)) throw bad('Недопустимые символы в никнейме');
  let avatar = null;
  if (b.avatar != null) { if (typeof b.avatar !== 'string' || b.avatar.length > 120 * 1024 || !AVATAR_RE.test(b.avatar)) throw bad('Неподходящая картинка профиля'); avatar = b.avatar; }
  return { name, avatar };
}
const prefsOf = id => { try { return JSON.parse(Q.prefsGet.get(id).prefs || '{}'); } catch { return {}; } };
const MOODS = ['calm', 'tense', 'lively', 'quiet'], TECHS = ['monet', 'kandinsky', 'japan', 'collage'], SEASONS = ['autumn', 'winter', 'spring', 'summer'];
const TEMPOS = ['slow', 'mid', 'fast'], MODES = ['major', 'minor', 'unknown'];

function str(v, min, max, what) {
  if (typeof v !== 'string') throw bad(`Поле «${what}» должно быть строкой`);
  const s = v.trim(); if (s.length < min || s.length > max) throw bad(`Поле «${what}»: длина от ${min} до ${max}`);
  if (BAD_CHARS.test(s) && what !== 'text') throw bad(`Поле «${what}» содержит недопустимые символы`);
  return s;
}
const num = (v, a, b, what) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < a || v > b) throw bad(`Поле «${what}» вне диапазона`); return v; };
const oneOf = (v, list, what) => { if (!list.includes(v)) throw bad(`Поле «${what}» имеет недопустимое значение`); return v; };
const color = (v, what) => { if (typeof v !== 'string' || !COLOR.test(v)) throw bad(`Поле «${what}» должно быть цветом`); return v; };

/** Безопасно копирует произвольный JSON: ограничивает глубину, размер и символы разметки. */
function cleanJson(v, depth = 0) {
  if (depth > 6) throw bad('Слишком глубокая вложенность');
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw bad('Недопустимое число'); return v; }
  if (typeof v === 'string') { if (v.length > 400 || BAD_CHARS.test(v)) throw bad('Недопустимая строка'); return v; }
  if (Array.isArray(v)) { if (v.length > 60) throw bad('Слишком длинный список'); return v.map(x => cleanJson(x, depth + 1)); }
  if (typeof v === 'object') {
    const keys = Object.keys(v); if (keys.length > 60) throw bad('Слишком много полей');
    const out = {}; for (const k of keys) { if (!/^[\w-]{1,40}$/.test(k) || k === '__proto__') throw bad('Недопустимое имя поля'); out[k] = cleanJson(v[k], depth + 1); }
    return out;
  }
  throw bad('Недопустимое значение');
}

function cleanStyle(s) {
  if (!s || typeof s !== 'object') throw bad('Нет оформления');
  const out = cleanJson(s);
  oneOf(out.mood, MOODS, 'mood'); oneOf(out.technique, TECHS, 'technique'); oneOf(out.season, SEASONS, 'season');
  if (typeof out.title !== 'string' || !/^[\p{L}\p{N} ,.\-—:«»!?'’]{3,80}$/u.test(out.title)) throw bad('Недопустимое название папки');
  if (typeof out.signature !== 'string' || !/^[\p{L}\p{N} ,.\-—:«»!?'’]{0,60}$/u.test(out.signature)) throw bad('Недопустимая подпись');
  if (!out.pal || typeof out.pal !== 'object') throw bad('Нет палитры');
  for (const [k, v] of Object.entries(out.pal)) {
    if (k === 'name') continue;
    if (Array.isArray(v)) v.forEach(c => color(c, 'pal.' + k)); else color(v, 'pal.' + k);
  }
  if (!Array.isArray(out.rows) || out.rows.length > 10) throw bad('Недопустимые причины оформления');
  for (const k of ['energy', 'grain']) num(out[k], 0, 1, k);
  num(out.period, 500, 20000, 'period');
  if (!out.voice || typeof out.voice.rate !== 'number') throw bad('Нет голоса');
  num(out.voice.rate, .5, 2, 'voice.rate'); num(out.voice.pitch, .5, 2, 'voice.pitch');
  return out;
}

function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ['image/jpeg', 'jpg'];
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ['image/png', 'png'];
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return ['image/webp', 'webp'];
  return null;
}
const isEbml = buf => buf.length > 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;   // WebM / Matroska
function sniffVoice(buf) { return isEbml(buf) ? ['audio/webm', 'webm'] : sniffAudio(buf); }
function sniffVideo(buf) {
  if (isEbml(buf)) return ['video/webm', 'webm'];
  if (buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp') return buf.toString('latin1', 8, 12) === 'qt  ' ? ['video/quicktime', 'mov'] : ['video/mp4', 'mp4'];
  return null;
}
function sniffAudio(buf) {
  if (buf.length < 12) return null;
  const h4 = buf.toString('latin1', 0, 4);
  if (h4 === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return ['audio/mpeg', 'mp3'];
  if (h4 === 'OggS') return ['audio/ogg', 'ogg'];
  if (h4 === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') return ['audio/wav', 'wav'];
  if (buf.toString('latin1', 4, 8) === 'ftyp') return ['audio/mp4', 'm4a'];
  if (h4 === 'fLaC') return ['audio/flac', 'flac'];
  return null;
}
function cleanUrl(v) {
  if (v === '' || v == null) return '';
  const s = str(v, 1, 500, 'url');
  let u; try { u = new URL(s); } catch { throw bad('Некорректная ссылка'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw bad('Ссылка должна начинаться с http или https');
  return u.href;
}

function validateDay(b) {
  const date = str(b.date, 10, 10, 'date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date + 'T12:00:00Z'))) throw bad('Некорректная дата');
  const text = str(b.text, 1, LIMITS.textLen, 'text');
  if (!Array.isArray(b.photos) || b.photos.length > LIMITS.photosPerDay) throw bad(`Можно до ${LIMITS.photosPerDay} фото`);   // photos are optional (quick check-in)
  const photos = b.photos.map(p => {
    const m = typeof p === 'string' && /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(p);
    if (!m) throw bad('Фото должно быть JPEG, PNG или WebP');
    const buf = Buffer.from(m[1], 'base64'); if (buf.length > LIMITS.photo) throw bad('Фото слишком большое (до 3 МБ)', 413);
    const kind = sniffImage(buf); if (!kind) throw bad('Файл не похож на изображение');
    return { buf, mime: kind[0], ext: kind[1] };
  });
  const so = b.song || {}; const kind = oneOf(so.kind, ['file', 'link'], 'song.kind');
  const song = {
    kind, url: kind === 'link' ? cleanUrl(so.url) : '', title: so.title ? str(so.title, 0, 120, 'song.title') : '', artist: so.artist ? str(so.artist, 0, 120, 'song.artist') : '',
    tempo: oneOf(so.tempo, TEMPOS, 'song.tempo'), mode: oneOf(so.mode, MODES, 'song.mode'),
    bpm: so.bpm == null ? null : Math.round(num(so.bpm, 30, 300, 'song.bpm')), energy: so.energy == null ? null : num(so.energy, 0, 1, 'song.energy'),
    fileName: so.fileName ? str(so.fileName, 0, 150, 'song.fileName') : ''
  };
  let weather = null; if (b.weather) weather = { kind: str(b.weather.kind, 1, 20, 'weather.kind'), temp: Math.round(num(b.weather.temp, -90, 60, 'weather.temp')) };
  let geo = null; if (b.geo) geo = { lat: +num(b.geo.lat, -90, 90, 'geo.lat').toFixed(2), lon: +num(b.geo.lon, -180, 180, 'geo.lon').toFixed(2) };
  const pi = b.photoInfo || {};
  const photoInfo = { count: photos.length, colors: (Array.isArray(pi.colors) ? pi.colors.slice(0, 6) : []).map(c => color(c, 'photoInfo.colors')), accent: color(pi.accent, 'photoInfo.accent'), brightness: num(pi.brightness, 0, 1, 'brightness'), saturation: num(pi.saturation, 0, 1, 'saturation') };
  const style = cleanStyle(b.style);
  const textInfo = cleanJson(b.textInfo || {});
  const data = { dateOn: b.dateOn === true, voiceOn: b.voiceOn !== false, song, weather, geo, photoInfo, textInfo, style };
  return { date, text, title: style.title, mood: style.mood, technique: style.technique, data, photos };
}

/* ======================= выдача данных ======================= */
function dayOut(row, media) {
  const data = JSON.parse(row.data);
  const photos = media.filter(m => m.kind === 'photo').map(m => `/api/media/${m.id}`);
  const one = k => { const x = media.find(m => m.kind === k); return x ? `/api/media/${x.id}` : ''; };
  return { id: row.id, date: row.date, text: row.text, createdAt: row.created_at, shared: !!row.shared, ...data, photos, voiceUrl: one('voice'), videoUrl: one('video'), song: { ...data.song, audioUrl: one('audio') } };
}
const maskEmail = e => { const [n, d] = String(e).split('@'); return (n.length <= 2 ? n[0] + '*' : n.slice(0, 2) + '***') + '@' + d; };
function isAdmin(s) { return !!s && !s.is_guest && ADMIN_EMAILS.has(String(s.email).toLowerCase()); }
function removeFiles(userId, files) {
  for (const f of files) { try { fs.unlinkSync(path.join(DATA_DIR, 'media', String(userId), f)); } catch { /* уже удалён */ } }
}
function purgeGuests() {
  for (const g of Q.guestsOld.all(now() - LIMITS.guestMs)) deleteUser(g.id);
  Q.sessPurge.run(now());
}
function deleteUser(id) {
  Q.userDel.run(id);
  fs.rmSync(path.join(DATA_DIR, 'media', String(id)), { recursive: true, force: true });
}
purgeGuests(); setInterval(purgeGuests, 3600_000).unref();

/* ======================= маршруты API ======================= */
async function api(req, res, url) {
  const method = req.method, p = url.pathname, ip = clientIp(req);
  limit('api:' + ip, 600, 60_000);

  if (method !== 'GET' && method !== 'HEAD') { // защита от CSRF: запрос должен прийти с нашего же сайта
    const origin = req.headers.origin;
    let ok = false; try { ok = !!origin && new URL(origin).host === req.headers.host; } catch { /* нет */ }
    if (!ok) throw bad('Запрос с чужого источника отклонён', 403);
  }

  if (p === '/api/me' && method === 'GET') {
    const s = getSession(req);
    return send(res, 200, s ? { user: { email: s.is_guest ? null : s.email, name: s.name || null, avatar: Q.avatarGet.get(s.user_id).avatar || null, guest: !!s.is_guest, google: String(Q.userPass.get(s.user_id).pass_hash).startsWith('oauth$'), admin: isAdmin(s) }, prefs: prefsOf(s.user_id), csrf: s.csrf } : { user: null });
  }
  if (p === '/api/config' && method === 'GET') {
    return send(res, 200, { google: GOOGLE_ON });
  }
  if (p === '/api/content' && method === 'GET') { // public: mood names and descriptions edited by the admin
    return send(res, 200, { moods: setting('mood_texts', {}) });
  }
  if (p === '/api/wall' && method === 'GET') {
    limit('wall:' + ip, 60, 60_000);
    const cut = t => { const x = String(t).replace(/\s+/g, ' ').trim(); return x.length > 220 ? x.slice(0, 217).replace(/\s+\S*$/, '') + '…' : x; };
    const days = Q.wall.all().filter(r => !(JSON.parse(r.data).flags || []).length).slice(0, 24)
      .map(r => ({ date: r.date, mood: r.mood, text: cut(r.text), photo: r.photo ? `/api/wall/media/${r.photo}` : null, video: r.video ? `/api/wall/media/${r.video}` : null }));
    return send(res, 200, { days });
  }
  let wm = /^\/api\/wall\/media\/([a-f0-9]{24})$/.exec(p);
  if (wm && (method === 'GET' || method === 'HEAD')) { limit('wallm:' + ip, 300, 60_000); const row = Q.wallMedia.get(wm[1]); return serveMedia(req, res, row, row && row.user_id); }
  if (p === '/api/register' && method === 'POST') {
    limit('reg:' + ip, REG_MAX, 3600_000);
    const b = await readJson(req); const email = cleanEmail(b.email), pw = cleanPassword(b.password);
    const hash = await hashPassword(pw);
    let id; try { id = Number(Q.userInsert.run(email, hash, 0, now()).lastInsertRowid); }
    catch { throw bad('Не удалось создать аккаунт с этими данными', 409); }
    return send(res, 201, { user: { email, guest: false, admin: ADMIN_EMAILS.has(email) }, csrf: startSession(res, id) });
  }
  if (p === '/api/login' && method === 'POST') {
    limit('login:' + ip, 20, 15 * 60_000);
    const b = await readJson(req); const email = String(b.email || '').trim().toLowerCase().slice(0, 254), pw = String(b.password || '').slice(0, 128);
    limit('loginacc:' + email, 8, 15 * 60_000);
    const u = Q.userByEmail.get(email);
    const ok = await verifyPassword(pw, u ? u.pass_hash : DUMMY_HASH || 's1$AAAA$AAAA');
    if (!u || !ok || u.is_guest) throw bad('Неверный e-mail или пароль', 401);
    if (needsRehash(u.pass_hash)) Q.userSetPass.run(await hashPassword(pw), u.id);   // upgrade older, weaker hashes
    return send(res, 200, { user: { email: u.email, guest: false, admin: ADMIN_EMAILS.has(u.email) }, csrf: startSession(res, u.id) });
  }
  if (p === '/api/auth/google' && method === 'GET') {
    if (!GOOGLE_ON) throw bad('Не найдено', 404);
    limit('google:' + ip, 30, 3600_000);
    const state = crypto.randomBytes(24).toString('base64url'), verifier = crypto.randomBytes(48).toString('base64url'), nonce = crypto.randomBytes(16).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    setOAuthCookie(res, { state, verifier, nonce, exp: now() + 600_000 }, 600);
    const q = new URLSearchParams({ client_id: GOOGLE.id, redirect_uri: GOOGLE.base + '/api/auth/google/callback', response_type: 'code', scope: 'openid email profile',
      state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' });
    res.writeHead(302, { Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q, 'Cache-Control': 'no-store' }); return res.end();
  }
  if (p === '/api/auth/google/callback' && method === 'GET') {
    if (!GOOGLE_ON) throw bad('Не найдено', 404);
    limit('google:' + ip, 30, 3600_000);
    const back = to => { setOAuthCookie(res, null, 0); res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); };
    try {
      const saved = readOAuthCookie(req), state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
      if (!saved || saved.exp < now() || !code || code.length > 2048 || state.length !== saved.state.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(saved.state))) throw 0;
      const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(10_000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: GOOGLE.id, client_secret: GOOGLE.secret, redirect_uri: GOOGLE.base + '/api/auth/google/callback', grant_type: 'authorization_code', code_verifier: saved.verifier }) });
      const tok = await r.json(); if (!r.ok || typeof tok.id_token !== 'string') throw 0;
      /* the ID token came straight from Google over TLS, so its claims are trusted after these checks (OpenID Connect Core 3.1.3.7) */
      const c = JSON.parse(Buffer.from(tok.id_token.split('.')[1] || '', 'base64url').toString('utf8'));
      if (!['https://accounts.google.com', 'accounts.google.com'].includes(c.iss) || c.aud !== GOOGLE.id || !(c.exp * 1000 > now()) || c.nonce !== saved.nonce || c.email_verified !== true) throw 0;
      const email = cleanEmail(c.email), name = String(c.given_name || c.name || '').replace(/[<>"`\\\u0000-\u001f]/g, '').trim().slice(0, 60) || null;
      let u = Q.userByEmail.get(email);
      if (u && u.is_guest) throw 0;
      if (!u) { const id = Number(Q.userInsertNamed.run(email, 'oauth$google', now(), name).lastInsertRowid); u = { id }; }   // no password: this account signs in only through Google
      else if (!u.name && name) Q.userSetName.run(name, u.id);
      startSession(res, u.id);
      return back('/#/archive');
    } catch (e) { return back('/?auth=failed#/welcome'); }
  }
  if (p === '/api/guest' && method === 'POST') {
    limit('guest:' + ip, GUEST_MAX, 3600_000);
    const email = `guest-${crypto.randomBytes(8).toString('hex')}@guest.invalid`;
    const id = Number(Q.userInsert.run(email, await hashPassword(crypto.randomBytes(24).toString('base64')), 1, now()).lastInsertRowid);
    return send(res, 201, { user: { email: null, guest: true }, csrf: startSession(res, id) });
  }

  const s = getSession(req);
  if (!s) throw bad('Нужно войти', 401);
  if (method !== 'GET' && method !== 'HEAD') {
    const sent = String(req.headers['x-csrf-token'] || '');
    const a = Buffer.from(sent), b2 = Buffer.from(s.csrf);
    if (a.length !== b2.length || !crypto.timingSafeEqual(a, b2)) throw bad('Недействительный CSRF-токен', 403);
  }

  if (p === '/api/logout' && method === 'POST') { Q.sessDel.run(s.token_hash); setCookie(res, '', 0); return send(res, 200, { ok: true }); }
  if (p === '/api/profile' && method === 'PUT') {
    limit('profile:' + s.user_id, 30, 60_000);
    const pr = cleanProfile(await readJson(req, 160 * 1024)); Q.profileSet.run(pr.name, pr.avatar, s.user_id);
    return send(res, 200, pr);
  }
  if (p === '/api/prefs' && method === 'PUT') {
    limit('prefs:' + s.user_id, 120, 60_000);
    const prefs = cleanPrefs(await readJson(req)); Q.prefsSet.run(JSON.stringify(prefs), s.user_id);
    return send(res, 200, { prefs });
  }
  if (p === '/api/me' && method === 'DELETE') {
    if (!s.is_guest && !String(Q.userPass.get(s.user_id).pass_hash).startsWith('oauth$')) {   // Google accounts have no password to confirm
      const b = await readJson(req); limit('delacc:' + s.user_id, 5, 3600_000);
      if (!(await verifyPassword(String(b.password || '').slice(0, 128), Q.userPass.get(s.user_id).pass_hash))) throw bad('Неверный пароль', 403);
    }
    deleteUser(s.user_id); setCookie(res, '', 0); return send(res, 200, { ok: true });
  }

  if (p === '/api/days' && method === 'GET') {
    const byDay = new Map(); for (const m of Q.mediaForUser.all(s.user_id)) { if (!byDay.has(m.day_id)) byDay.set(m.day_id, []); byDay.get(m.day_id).push(m); }
    return send(res, 200, { days: Q.dayList.all(s.user_id).map(r => dayOut(r, byDay.get(r.id) || [])) });
  }
  if (p === '/api/days' && method === 'POST') {
    limit('write:' + s.user_id, 30, 60_000);
    const d = validateDay(await readJson(req, LIMITS.json));
    const subs = Array.isArray(d.data.textInfo.voice) ? d.data.textInfo.voice.map(x => x && x.t).join(' ') : '';   // voice-message subtitles are checked too
    const guard = moderation.check([d.text, d.title, d.data.style.signature, d.data.song.title, d.data.song.artist, subs].join(' \n '), setting('words', {}));
    if (guard.blocked.length) throw bad('Пожалуйста, перефразируйте: в записи есть недопустимые слова', 422);
    if (guard.flagged.length) d.data.flags = guard.flagged;
    if (Q.dayCount.get(s.user_id).n >= LIMITS.daysPerUser) throw bad('Достигнут лимит дней', 403);
    const used = Q.bytesOfUser.get(s.user_id).n + d.photos.reduce((a, x) => a + x.buf.length, 0);
    if (used > LIMITS.bytesPerUser) throw bad('Закончилось место в дневнике', 413);
    const id = newId(), dir = path.join(DATA_DIR, 'media', String(s.user_id)); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const written = [];
    try {
      tx(() => {
        Q.dayInsert.run(id, s.user_id, d.date, d.title, d.mood, d.technique, d.text, JSON.stringify(d.data), now());
        d.photos.forEach((ph, i) => { const mid = newId(), file = `${mid}.${ph.ext}`; fs.writeFileSync(path.join(dir, file), ph.buf, { mode: 0o600 }); written.push(file); Q.mediaInsert.run(mid, id, s.user_id, 'photo', ph.mime, ph.buf.length, i, file); });
      });
    } catch (e) { removeFiles(s.user_id, written); throw e; }
    return send(res, 201, { day: dayOut(Q.dayGet.get(id, s.user_id), Q.mediaForDay.all(id, s.user_id)) });
  }

  let m = /^\/api\/days\/([a-f0-9]{24})$/.exec(p);
  if (m) {
    const row = Q.dayGet.get(m[1], s.user_id); if (!row) throw bad('Не найдено', 404);
    if (method === 'GET') return send(res, 200, { day: dayOut(row, Q.mediaForDay.all(row.id, s.user_id)) });
    if (method === 'DELETE') { const files = Q.mediaFilesOfDay.all(row.id, s.user_id).map(x => x.file); Q.dayDel.run(row.id, s.user_id); removeFiles(s.user_id, files); return send(res, 200, { ok: true }); }
  }
  m = /^\/api\/days\/([a-f0-9]{24})\/share$/.exec(p);
  if (m && method === 'PUT') {
    const b = await readJson(req); if (typeof b.shared !== 'boolean') throw bad('Некорректный запрос');
    if (!Q.dayShare.run(b.shared ? 1 : 0, m[1], s.user_id).changes) throw bad('Не найдено', 404);
    return send(res, 200, { shared: b.shared });
  }
  m = /^\/api\/days\/([a-f0-9]{24})\/(audio|voice|video)$/.exec(p);
  if (m && method === 'PUT') {
    limit('write:' + s.user_id, 30, 60_000);
    const row = Q.dayGet.get(m[1], s.user_id); if (!row) throw bad('Не найдено', 404);
    const what = m[2], video = what === 'video';
    if (!(video ? /^video\//i : /^audio\//i).test(req.headers['content-type'] || '')) throw bad(video ? 'Ожидается видеофайл' : 'Ожидается аудиофайл', 415);
    const buf = await readBody(req, LIMITS[what]); const kind = (video ? sniffVideo : what === 'voice' ? sniffVoice : sniffAudio)(buf);
    if (!kind) throw bad(video ? 'Файл не похож на видео (mp4, mov, webm)' : 'Файл не похож на аудио (mp3, ogg, wav, m4a, flac)', 415);
    if (Q.bytesOfUser.get(s.user_id).n + buf.length > LIMITS.bytesPerUser) throw bad('Закончилось место в дневнике', 413);
    const dir = path.join(DATA_DIR, 'media', String(s.user_id)); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const old = Q.mediaOfKind.get(row.id, s.user_id, what); const mid = newId(), file = `${mid}.${kind[1]}`;
    fs.writeFileSync(path.join(dir, file), buf, { mode: 0o600 });
    tx(() => { if (old) Q.mediaDel.run(old.id); Q.mediaInsert.run(mid, row.id, s.user_id, what, kind[0], buf.length, 0, file); });
    if (old) removeFiles(s.user_id, [old.file]);
    return send(res, 200, { url: `/api/media/${mid}`, audioUrl: `/api/media/${mid}` });
  }

  if (p === '/api/music/search' && method === 'GET') {
    limit('music:' + s.user_id, 40, 60_000);
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 100); if (q.length < 2) throw bad('Введите название песни');
    const r = await fetch('https://itunes.apple.com/search?' + new URLSearchParams({ term: q, media: 'music', entity: 'song', limit: '8' }), { signal: AbortSignal.timeout(8000), redirect: 'error' }).catch(() => null);
    if (!r || !r.ok) throw bad('Поиск музыки сейчас недоступен', 502);
    const apple = u => typeof u === 'string' && /^https:\/\/([\w-]+\.)*(apple\.com|mzstatic\.com)\//.test(u) ? u : '';
    const songs = ((await r.json()).results || []).map(x => ({ title: String(x.trackName || '').slice(0, 120), artist: String(x.artistName || '').slice(0, 120), album: String(x.collectionName || '').slice(0, 120),
      year: String(x.releaseDate || '').slice(0, 4), cover: apple(String(x.artworkUrl100 || '').replace('100x100', '200x200')), preview: apple(x.previewUrl), link: apple(x.trackViewUrl) })).filter(x => x.title && x.preview);
    return send(res, 200, { songs });
  }
  if (p === '/api/music/preview' && method === 'GET') {   // the 30-second preview, fetched for tempo analysis (only Apple's own servers)
    limit('music:' + s.user_id, 40, 60_000);
    const u = String(url.searchParams.get('u') || '');
    if (!/^https:\/\/([\w-]+\.)*(itunes\.apple\.com|mzstatic\.com)\/[^\s]*$/.test(u)) throw bad('Некорректная ссылка');
    const r = await fetch(u, { signal: AbortSignal.timeout(10000), redirect: 'error' }).catch(() => null);
    if (!r || !r.ok || !/^audio\//.test(r.headers.get('content-type') || '')) throw bad('Не удалось получить отрывок', 502);
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 4 * 1024 * 1024) throw bad('Слишком большой файл', 413);
    res.writeHead(200, { 'Content-Type': r.headers.get('content-type'), 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=3600' }); return res.end(buf);
  }

  m = /^\/api\/media\/([a-f0-9]{24})$/.exec(p);
  if (m && (method === 'GET' || method === 'HEAD')) return serveMedia(req, res, Q.mediaGet.get(m[1], s.user_id), s.user_id);

  /* ---------- admin: moderate days and edit mood texts; the code itself cannot be changed from here ---------- */
  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(s)) throw bad('Нет доступа', 403);
    limit('admin:' + s.user_id, 120, 60_000);
    if (p === '/api/admin/days' && method === 'GET') {
      return send(res, 200, { days: Q.dayAll.all().map(r => { const d = JSON.parse(r.data); return { id: r.id, date: r.date, title: r.title, mood: r.mood, text: r.text, createdAt: r.created_at,
        author: r.is_guest ? 'guest' : maskEmail(r.email), shared: !!r.shared, flags: d.flags || [], textInfo: d.textInfo, photoInfo: d.photoInfo, song: d.song, weather: d.weather, dateOn: d.dateOn, style: d.style }; }) });
    }
    m = /^\/api\/admin\/days\/([a-f0-9]{24})$/.exec(p);
    if (m) {
      const row = Q.dayAny.get(m[1]); if (!row) throw bad('Не найдено', 404);
      if (method === 'DELETE') { const files = Q.mediaFilesAny.all(row.id); Q.dayDelAny.run(row.id); removeFiles(row.user_id, files.map(f => f.file)); return send(res, 200, { ok: true }); }
      if (method === 'PATCH') {
        const b = await readJson(req, 256 * 1024), data = JSON.parse(row.data);
        const text = b.text === undefined ? row.text : str(b.text, 1, LIMITS.textLen, 'text');
        const style = b.style === undefined ? data.style : cleanStyle(b.style);
        if (b.clearFlags) delete data.flags;
        if (b.shared === false) Q.dayShareAny.run(row.id);
        data.style = style;
        Q.dayUpdate.run(style.title, style.mood, style.technique, text, JSON.stringify(data), row.id);
        return send(res, 200, { ok: true });
      }
    }
    if (p === '/api/admin/settings' && method === 'GET') return send(res, 200, { moods: setting('mood_texts', {}), words: setting('words', { block: [], flag: [] }), builtIn: { block: moderation.BLOCK.length, flag: moderation.FLAG.length } });
    if (p === '/api/admin/settings' && method === 'PUT') {
      const b = await readJson(req, 64 * 1024);
      if (b.moods !== undefined) {
        const out = {};
        for (const lang of ['en', 'ru']) for (const mood of MOODS) for (const f of ['name', 'label', 'desc']) {
          const v = b.moods && b.moods[lang] && b.moods[lang][mood] && b.moods[lang][mood][f];
          if (v) { ((out[lang] ||= {})[mood] ||= {})[f] = str(v, 1, 240, 'moods'); }
        }
        Q.setPut.run('mood_texts', JSON.stringify(out));
      }
      if (b.words !== undefined) {
        const list = v => (Array.isArray(v) ? v : []).slice(0, 300).map(w => str(String(w), 1, 40, 'words').toLowerCase());
        Q.setPut.run('words', JSON.stringify({ block: list(b.words.block), flag: list(b.words.flag) }));
      }
      return send(res, 200, { ok: true });
    }
  }

  throw bad('Не найдено', 404);
}

function serveMedia(req, res, row, userId) {
  if (!row) throw bad('Не найдено', 404);
  const file = path.join(DATA_DIR, 'media', String(userId), row.file);
  let size; try { size = fs.statSync(file).size; } catch { throw bad('Не найдено', 404); }
  const headers = { 'Content-Type': row.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'inline' };
  const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0, end = size - 1, status = 200;
  if (r && (r[1] || r[2])) {
    if (r[1]) { start = +r[1]; if (r[2]) end = Math.min(+r[2], size - 1); } else { start = Math.max(0, size - +r[2]); }
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file, { start, end }).pipe(res);
}

/* ======================= статические файлы ======================= */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.onnx': 'application/octet-stream', '.tflite': 'application/octet-stream' };
function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw bad('Метод не поддерживается', 405);
  let rel; try { rel = decodeURIComponent(url.pathname); } catch { throw bad('Некорректный адрес'); }
  if (rel.includes('\0') || rel.includes('\\')) throw bad('Некорректный адрес');
  if (/(^|\/)\./.test(rel)) throw bad('Не найдено', 404);   // hidden files and folders
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw bad('Не найдено', 404);
  let st; try { st = fs.statSync(file); } catch { throw bad('Не найдено', 404); }
  if (!st.isFile()) throw bad('Не найдено', 404);
  const type = MIME[path.extname(file).toLowerCase()]; if (!type) throw bad('Не найдено', 404);
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/* ======================= сервер ======================= */
const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) throw bad('Метод не поддерживается', 405);
    if (url.pathname.startsWith('/api/')) await api(req, res, url); else serveStatic(req, res, url);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('Ошибка:', e && e.stack || e);
    if (res.headersSent) return res.end();
    if (e.retry) res.setHeader('Retry-After', e.retry);
    if (status === 413) res.setHeader('Connection', 'close');
    send(res, status, { error: status === 500 ? 'Внутренняя ошибка сервера' : e.message });
  }
});
server.requestTimeout = 60_000; server.headersTimeout = 15_000; server.keepAliveTimeout = 5_000; server.maxRequestsPerSocket = 1000;

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`Дневничок: http://${HOST}:${PORT}  (данные: ${DATA_DIR})`));
  const stop = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
module.exports = { server, db };
