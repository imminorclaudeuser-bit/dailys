'use strict';
/* Проверки безопасности API: запускают настоящий сервер на временной базе. */
const { spawn } = require('node:child_process'), path = require('node:path'), os = require('node:os'), fs = require('node:fs'), assert = require('node:assert/strict');
const { validDay, loadEngine } = require('./helpers');
const PORT = 3200 + Math.floor(Math.random() * 500), BASE = `http://127.0.0.1:${PORT}`, DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'memoir-'));
let srv, pass = 0, fail = 0;

const ok = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message); } };
function jar() { return { cookie: '', csrf: '' }; }
async function call(method, url, { u, body, raw, headers = {}, origin = BASE, type } = {}) {
  const h = { ...headers };
  if (origin && method !== 'GET') h.Origin = origin;
  if (u && u.cookie) h.Cookie = u.cookie;
  if (u && u.csrf && method !== 'GET' && !('X-CSRF-Token' in h)) h['X-CSRF-Token'] = u.csrf;
  let b; if (raw !== undefined) { b = raw; if (type) h['Content-Type'] = type; } else if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch(BASE + url, { method, headers: h, body: b, redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (u && sc) u.cookie = sc.split(';')[0];
  let data = null; const ct = r.headers.get('content-type') || ''; if (ct.includes('json')) data = await r.json(); else if (!ct.startsWith('image') && !ct.startsWith('audio')) data = await r.text();
  if (u && data && data.csrf) u.csrf = data.csrf;
  return { status: r.status, data, headers: r.headers, setCookie: sc };
}
const PW = 'correct-horse-battery';

(async () => {
  srv = spawn(process.execPath, ['--no-warnings', path.join(__dirname, '../server.js')], { env: { ...process.env, REG_PER_HOUR: '5', ADMIN_EMAIL: 'a@example.com', GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-secret', PUBLIC_URL: BASE, PORT, DATA_DIR: DATA, HOST: '127.0.0.1' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/me'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  console.log('Безопасность API\n');
  const A = jar(), B = jar();

  console.log('Заголовки и статические файлы');
  await ok('CSP, nosniff, запрет встраивания', async () => {
    const r = await call('GET', '/'); const csp = r.headers.get('content-security-policy');
    assert.match(csp, /default-src 'none'/); assert.match(csp, /script-src 'self'/); assert.doesNotMatch(csp, /script-src[^;]*https?:/); assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('x-frame-options'), 'DENY'); assert.match(csp, /frame-ancestors 'none'/);
  });
  await ok('нет inline-скриптов на странице', async () => { const r = await call('GET', '/'); assert.doesNotMatch(r.data, /<script(?![^>]*src=)[^>]*>/i); assert.doesNotMatch(r.data, /\son\w+=/i); });
  await ok('обход путей и серверные файлы недоступны', async () => {
    for (const p of ['/..%2f..%2fserver.js', '/server.js', '/data/memoir.db', '/%2e%2e/package.json', '/public/../server.js', '/..%5cserver.js']) {
      const r = await call('GET', p); assert.ok([400, 404].includes(r.status), `${p} → ${r.status}`);
    }
  });

  console.log('\nРегистрация и вход');
  await ok('без входа API закрыт', async () => { assert.equal((await call('GET', '/api/days')).status, 401); assert.equal((await call('GET', '/api/media/' + 'a'.repeat(24))).status, 401); });
  await ok('некорректный e-mail отклонён', async () => assert.equal((await call('POST', '/api/register', { u: jar(), body: { email: 'not-an-email', password: PW } })).status, 400));
  await ok('слабый пароль отклонён', async () => { assert.equal((await call('POST', '/api/register', { u: jar(), body: { email: 'w@example.com', password: 'short' } })).status, 400); });
  await ok('регистрация: cookie HttpOnly + SameSite=Strict, пароль не возвращается', async () => {
    const r = await call('POST', '/api/register', { u: A, body: { email: 'a@example.com', password: PW } });
    assert.equal(r.status, 201); assert.match(r.setCookie, /HttpOnly/); assert.match(r.setCookie, /SameSite=Strict/); assert.doesNotMatch(JSON.stringify(r.data), /password|hash/i);
  });
  await ok('пароль в базе — только хэш scrypt', async () => {
    const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(path.join(DATA, 'memoir.db'), { readOnly: true });
    const row = db.prepare('SELECT pass_hash FROM users WHERE email = ?').get('a@example.com'); db.close();
    assert.match(row.pass_hash, /^s2\$/); assert.ok(!row.pass_hash.includes(PW));
  });
  await ok('повторная регистрация того же e-mail: общий ответ', async () => { const r = await call('POST', '/api/register', { u: jar(), body: { email: 'A@example.com', password: PW } }); assert.equal(r.status, 409); });
  await ok('второй пользователь', async () => assert.equal((await call('POST', '/api/register', { u: B, body: { email: 'b@example.com', password: PW } })).status, 201));
  await ok('лимит регистраций с одного IP', async () => { const r = await call('POST', '/api/register', { u: jar(), body: { email: 'z@example.com', password: PW } }); assert.equal(r.status, 429); assert.ok(r.headers.get('retry-after')); });
  await ok('неверный пароль и неизвестный e-mail дают одинаковый ответ', async () => {
    const r1 = await call('POST', '/api/login', { u: jar(), body: { email: 'a@example.com', password: 'wrong-password-1' } });
    const r2 = await call('POST', '/api/login', { u: jar(), body: { email: 'nobody@example.com', password: 'wrong-password-1' } });
    assert.equal(r1.status, 401); assert.equal(r2.status, 401); assert.equal(r1.data.error, r2.data.error);
  });
  await ok('SQL-инъекция в логине не проходит', async () => {
    const r = await call('POST', '/api/login', { u: jar(), body: { email: "' OR 1=1 --", password: "' OR '1'='1" } }); assert.equal(r.status, 401);
  });

  console.log('\nCSRF и источник запроса');
  await ok('запрос без Origin отклонён', async () => assert.equal((await call('POST', '/api/days', { u: A, body: validDay(), origin: null })).status, 403));
  await ok('запрос с чужим Origin отклонён', async () => assert.equal((await call('POST', '/api/days', { u: A, body: validDay(), origin: 'https://evil.example' })).status, 403));
  await ok('без CSRF-токена отклонён', async () => assert.equal((await call('POST', '/api/days', { u: A, body: validDay(), headers: { 'X-CSRF-Token': '' } })).status, 403));
  await ok('чужой CSRF-токен отклонён', async () => assert.equal((await call('POST', '/api/days', { u: A, body: validDay(), headers: { 'X-CSRF-Token': B.csrf } })).status, 403));
  await ok('ввод не JSON отклонён', async () => assert.equal((await call('POST', '/api/days', { u: A, raw: 'a=b', type: 'text/plain' })).status, 415));

  console.log('\nДанные дня');
  let dayA;
  await ok('создание дня', async () => { const r = await call('POST', '/api/days', { u: A, body: validDay(0) }); assert.equal(r.status, 201); dayA = r.data.day; assert.equal(dayA.photos.length, 1); assert.match(dayA.photos[0], /^\/api\/media\/[a-f0-9]{24}$/); });
  await ok('фото отдаётся владельцу с верным типом и nosniff', async () => { const r = await call('GET', dayA.photos[0], { u: A }); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/jpeg'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); });
  await ok('чужой пользователь не видит день, фото и не может удалить', async () => {
    assert.equal((await call('GET', `/api/days/${dayA.id}`, { u: B })).status, 404);
    assert.equal((await call('GET', dayA.photos[0], { u: B })).status, 404);
    assert.equal((await call('DELETE', `/api/days/${dayA.id}`, { u: B })).status, 404);
    assert.equal((await call('GET', '/api/days', { u: B })).data.days.length, 0);
  });
  await ok('фото без входа недоступно', async () => assert.equal((await call('GET', dayA.photos[0])).status, 401));
  await ok('разметка в тексте хранится как текст (выводится через экранирование)', async () => {
    const r = await call('POST', '/api/days', { u: A, body: validDay(1, { text: '<img src=x onerror=alert(1)> дождь' }) }); assert.equal(r.status, 201); assert.equal(r.data.day.text, '<img src=x onerror=alert(1)> дождь');
    const E = loadEngine(); assert.equal(E.esc(r.data.day.text).includes('<'), false);
  });
  await ok('разметка в названии папки отклонена', async () => { const d = validDay(); d.style.title = 'Привет <script>'; assert.equal((await call('POST', '/api/days', { u: A, body: d })).status, 400); });
  await ok('внедрение CSS/HTML через цвет палитры отклонено', async () => { const d = validDay(); d.style.pal.base = 'red;background:url(//evil)'; assert.equal((await call('POST', '/api/days', { u: A, body: d })).status, 400); const d2 = validDay(); d2.style.pal.blobs[0] = '"><script>'; assert.equal((await call('POST', '/api/days', { u: A, body: d2 })).status, 400); });
  await ok('ссылка javascript: отклонена', async () => { const d = validDay(); d.song.url = 'javascript:alert(1)'; assert.equal((await call('POST', '/api/days', { u: A, body: d })).status, 400); });
  await ok('«фото» не изображение отклонено', async () => { const d = validDay(); d.photos = ['data:image/png;base64,' + Buffer.from('<?php system($_GET[0]); ?>' + 'x'.repeat(40)).toString('base64')]; assert.equal((await call('POST', '/api/days', { u: A, body: d })).status, 400); });
  await ok('SVG вместо фото отклонён', async () => { const d = validDay(); d.photos = ['data:image/svg+xml;base64,' + Buffer.from('<svg onload=alert(1)/>').toString('base64')]; assert.equal((await call('POST', '/api/days', { u: A, body: d })).status, 400); });
  await ok('слишком много фото и слишком большой запрос', async () => {
    const d = validDay(); d.photos = Array(9).fill(d.photos[0]); assert.equal((await call('POST', '/api/days', { u: A, body: d })).status, 400);
    const big = validDay(); big.text = 'я'.repeat(20 * 1024 * 1024); assert.equal((await call('POST', '/api/days', { u: A, body: big })).status, 413);
  });
  await ok('лишние и неверные поля отклонены', async () => { const d = validDay(); d.date = '2026-13-45'; assert.equal((await call('POST', '/api/days', { u: A, body: d })).status, 400); const e = validDay(); e.style.mood = 'evil'; assert.equal((await call('POST', '/api/days', { u: A, body: e })).status, 400); });
  await ok('прототип не загрязняется', async () => { const raw = '{"__proto__":{"admin":true}}'; const r = await call('POST', '/api/days', { u: A, raw, type: 'application/json' }); assert.ok(r.status >= 400); assert.equal({}.admin, undefined); });

  console.log('\nАудио');
  await ok('не-аудио отклонено', async () => assert.equal((await call('PUT', `/api/days/${dayA.id}/audio`, { u: A, raw: Buffer.from('MZ' + 'x'.repeat(100)), type: 'audio/mpeg' })).status, 415));
  let audioUrl;
  await ok('WAV принимается, Range-запрос работает', async () => {
    const E = loadEngine(); const blob = E.synthSongBlob({ tempo: 'slow', mode: 'minor' }, 3); const buf = Buffer.from(await blob.arrayBuffer());
    const r = await call('PUT', `/api/days/${dayA.id}/audio`, { u: A, raw: buf, type: 'audio/wav' }); assert.equal(r.status, 200); audioUrl = r.data.audioUrl;
    const part = await fetch(BASE + audioUrl, { headers: { Cookie: A.cookie, Range: 'bytes=0-99' } }); assert.equal(part.status, 206); assert.equal((await part.arrayBuffer()).byteLength, 100);
    assert.equal((await call('GET', audioUrl, { u: B })).status, 404);
  });
  await ok('чужой день: загрузка аудио запрещена', async () => assert.equal((await call('PUT', `/api/days/${dayA.id}/audio`, { u: B, raw: Buffer.from('ID3' + 'x'.repeat(50)), type: 'audio/mpeg' })).status, 404));

  console.log('\nСессии и удаление');
  await ok('вход по паролю и ограничение попыток на аккаунт', async () => {
    const C = jar(); assert.equal((await call('POST', '/api/login', { u: C, body: { email: 'a@example.com', password: PW } })).status, 200);
    let last; for (let i = 0; i < 9; i++) last = await call('POST', '/api/login', { u: jar(), body: { email: 'b@example.com', password: 'wrong-password-' + i } });
    assert.equal(last.status, 429);
  });
  await ok('выход делает сессию недействительной', async () => {
    const old = A.cookie; assert.equal((await call('POST', '/api/logout', { u: A, body: {} })).status, 200);
    const r = await fetch(BASE + '/api/days', { headers: { Cookie: old } }); assert.equal(r.status, 401);
  });
  await ok('гостевой аккаунт создаётся и удаляется вместе с данными', async () => {
    const G = jar(); const r = await call('POST', '/api/guest', { u: G, body: {} }); assert.equal(r.status, 201); assert.equal(r.data.user.guest, true);
    const d = await call('POST', '/api/days', { u: G, body: validDay(2) }); assert.equal(d.status, 201);
    const dirs = fs.readdirSync(path.join(DATA, 'media')).length;
    assert.equal((await call('DELETE', '/api/me', { u: G, body: {} })).status, 200);
    assert.equal(fs.readdirSync(path.join(DATA, 'media')).length, dirs - 1); assert.equal((await call('GET', '/api/days', { u: G })).status, 401);
  });
  console.log('Security hardening');
  await ok('hidden files are never served', async () => {
    for (const p of ['/.env', '/.DS_Store', '/.git/config', '/vendor/.hidden.js', '/%2eenv']) assert.equal((await call('GET', p)).status, 404, p);
  });
  await ok('unusual methods are refused (TRACE, OPTIONS) and no CORS is granted', async () => {
    const raw = m => new Promise((ok2, no) => require('node:http').request(BASE + '/api/me', { method: m, headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } }, r => { r.resume(); ok2(r); }).on('error', no).end());
    for (const m of ['TRACE', 'OPTIONS']) { const r = await raw(m); assert.equal(r.statusCode, 405, m); assert.equal(r.headers['access-control-allow-origin'], undefined); }
    const r = await fetch(BASE + '/api/me', { headers: { Origin: 'https://evil.example' } }); assert.equal(r.headers.get('access-control-allow-origin'), null);
  });
  await ok('extra security headers', async () => {
    const r = await call('GET', '/'); assert.equal(r.headers.get('x-permitted-cross-domain-policies'), 'none'); assert.match(r.headers.get('content-security-policy'), /worker-src 'self' blob:/);
    assert.match(r.headers.get('permissions-policy'), /payment=\(\)/); assert.match(r.headers.get('permissions-policy'), /usb=\(\)/);
  });
  await ok('old password hashes are upgraded at login', async () => {
    const { DatabaseSync } = require('node:sqlite'), crypto = require('node:crypto');
    const salt = crypto.randomBytes(16), h = crypto.scryptSync(PW, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const w = new DatabaseSync(path.join(DATA, 'memoir.db')); w.prepare('INSERT INTO users (email, pass_hash, is_guest, created_at) VALUES (?, ?, 0, ?)').run('old@example.com', `s1$${salt.toString('base64')}$${h.toString('base64')}`, Date.now()); w.close();
    assert.equal((await call('POST', '/api/login', { u: jar(), body: { email: 'old@example.com', password: PW } })).status, 200);
    const r = new DatabaseSync(path.join(DATA, 'memoir.db'), { readOnly: true }); const row = r.prepare('SELECT pass_hash FROM users WHERE email = ?').get('old@example.com'); r.close();
    assert.match(row.pass_hash, /^s2\$/);
  });
  await ok('session cookie is HttpOnly + SameSite=Strict, token never in the body', async () => {
    const r = await call('POST', '/api/login', { u: jar(), body: { email: 'old@example.com', password: PW } });
    assert.match(r.setCookie, /HttpOnly/); assert.match(r.setCookie, /SameSite=Strict/); assert.ok(!JSON.stringify(r.data).includes(r.setCookie.split(';')[0].split('=')[1]));
  });

  console.log('Voice messages, videos and music search');
  await ok('voice message and video upload with type checks and ownership', async () => {
    const V = jar(), X = jar(); await call('POST', '/api/guest', { u: V, body: {} }); await call('POST', '/api/guest', { u: X, body: {} });
    const day = (await call('POST', '/api/days', { u: V, body: validDay(1) })).data.day;
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(200, 1)]);
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(200, 2)]);
    const v1 = await call('PUT', `/api/days/${day.id}/voice`, { u: V, raw: webm, type: 'audio/webm' }); assert.equal(v1.status, 200);
    const v2 = await call('PUT', `/api/days/${day.id}/video`, { u: V, raw: mp4, type: 'video/mp4' }); assert.equal(v2.status, 200);
    assert.equal((await call('PUT', `/api/days/${day.id}/video`, { u: V, raw: Buffer.from('<html>not a video</html>'), type: 'video/mp4' })).status, 415);
    assert.equal((await call('PUT', `/api/days/${day.id}/voice`, { u: V, raw: webm, type: 'text/html' })).status, 415);
    assert.equal((await call('PUT', `/api/days/${day.id}/video`, { u: X, raw: mp4, type: 'video/mp4' })).status, 404);
    const got = (await call('GET', `/api/days/${day.id}`, { u: V })).data.day; assert.ok(got.voiceUrl && got.videoUrl);
    assert.equal((await call('GET', got.videoUrl, { u: X })).status, 404);
    const vid = await fetch(BASE + got.videoUrl, { headers: { Cookie: V.cookie, Range: 'bytes=0-9' } }); assert.equal(vid.status, 206); assert.equal(vid.headers.get('content-type'), 'video/mp4');
  });
  await ok('page settings: only known values are saved, each account keeps its own', async () => {
    const P = jar(), Q2 = jar(); await call('POST', '/api/guest', { u: P, body: {} }); await call('POST', '/api/guest', { u: Q2, body: {} });
    assert.deepEqual((await call('GET', '/api/me', { u: P })).data.prefs, {});
    const r = await call('PUT', '/api/prefs', { u: P, body: { order: ['photos', 'entry', 'song', 'camera', 'extra'], hidden: ['camera', 'entry', 'x'], layout: 'one', accent: 'sage', font: 'comic', size: 'large', heading: '  My day  ', shapes: false, daisy: false, evil: 1 } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.prefs, { order: ['photos', 'entry', 'song', 'camera', 'extra'], hidden: ['camera'], layout: 'one', accent: 'sage', size: 'large', heading: 'My day', shapes: false, daisy: false });
    assert.deepEqual((await call('GET', '/api/me', { u: P })).data.prefs, r.data.prefs);
    assert.deepEqual((await call('GET', '/api/me', { u: Q2 })).data.prefs, {});
    assert.equal((await call('PUT', '/api/prefs', { u: P, body: { order: ['entry', 'entry', 'song', 'camera', 'extra'] } })).data.prefs.order, undefined);
    assert.equal((await call('PUT', '/api/prefs', { u: P, body: { heading: '<script>' } })).status, 400);
    assert.equal((await call('PUT', '/api/prefs', { u: P, body: { layout: 'one' }, headers: { 'X-CSRF-Token': 'nope' } })).status, 403);
    assert.equal((await call('PUT', '/api/prefs', { body: { layout: 'one' } })).status, 401);
  });
  await ok('profile: nickname and picture are checked and kept per account', async () => {
    const P = jar(), Q2 = jar(); await call('POST', '/api/guest', { u: P, body: {} }); await call('POST', '/api/guest', { u: Q2, body: {} });
    const pic = 'data:image/jpeg;base64,' + Buffer.from('fake jpeg bytes').toString('base64');
    const r = await call('PUT', '/api/profile', { u: P, body: { name: '  Sunny   seal ', avatar: pic } });
    assert.equal(r.status, 200); assert.deepEqual(r.data, { name: 'Sunny seal', avatar: pic });
    const u = (await call('GET', '/api/me', { u: P })).data.user; assert.equal(u.name, 'Sunny seal'); assert.equal(u.avatar, pic);
    assert.equal((await call('GET', '/api/me', { u: Q2 })).data.user.avatar, null);
    for (const body of [{ name: '' }, { name: 'x'.repeat(41) }, { name: '<b>hi</b>' }, { name: 'ok', avatar: 'javascript:alert(1)' }, { name: 'ok', avatar: 'data:image/svg+xml;base64,PHN2Zz4=' }, { name: 'ok', avatar: 'data:image/png;base64,abc"onerror' }])
      assert.equal((await call('PUT', '/api/profile', { u: P, body })).status, 400, JSON.stringify(body));
    assert.equal((await call('PUT', '/api/profile', { u: P, body: { name: 'Sunny' } })).data.avatar, null);
    assert.equal((await call('PUT', '/api/profile', { u: P, body: { name: 'x' }, headers: { 'X-CSRF-Token': 'nope' } })).status, 403);
    assert.equal((await call('PUT', '/api/profile', { body: { name: 'x' } })).status, 401);
  });
  await ok('welcome wall: only days the author shared, without names; only that day\'s first photo is public', async () => {
    const P = jar(), Q2 = jar(); await call('POST', '/api/guest', { u: P, body: {} }); await call('POST', '/api/guest', { u: Q2, body: {} });
    const day = (await call('POST', '/api/days', { u: P, body: validDay(0, { photos: [validDay().photos[0], validDay().photos[0]] }) })).data.day;
    const other = (await call('POST', '/api/days', { u: P, body: validDay(1) })).data.day;
    const before = (await call('GET', '/api/wall')).data.days.length;
    assert.equal(day.shared, false);
    assert.equal((await call('PUT', `/api/days/${day.id}/share`, { u: Q2, body: { shared: true } })).status, 404);   // not someone else's day
    assert.equal((await call('PUT', `/api/days/${day.id}/share`, { u: P, body: { shared: 'yes' } })).status, 400);
    assert.equal((await call('PUT', `/api/days/${day.id}/share`, { u: P, body: { shared: true }, headers: { 'X-CSRF-Token': 'nope' } })).status, 403);
    assert.equal((await call('PUT', `/api/days/${day.id}/share`, { u: P, body: { shared: true } })).data.shared, true);
    const wall = (await call('GET', '/api/wall')).data.days;
    assert.equal(wall.length, before + 1);
    const w = wall[0]; assert.deepEqual(Object.keys(w).sort(), ['date', 'mood', 'photo', 'text', 'video']);
    assert.equal((await call('GET', w.photo)).status, 200);                                                   // public without a session
    assert.equal((await call('GET', day.photos[1].replace('/api/media/', '/api/wall/media/'))).status, 404);   // the second photo stays private
    assert.equal((await call('GET', other.photos[0].replace('/api/media/', '/api/wall/media/'))).status, 404); // a day that is not shared
    assert.equal((await call('GET', `/api/days/${day.id}`, { u: P })).data.day.shared, true);
    await call('PUT', `/api/days/${day.id}/share`, { u: P, body: { shared: false } });
    assert.equal((await call('GET', '/api/wall')).data.days.length, before);
    assert.equal((await call('GET', w.photo)).status, 404);
  });
  await ok('daily reminder: only a real HH:MM time or off is kept', async () => {
    const P = jar(); await call('POST', '/api/guest', { u: P, body: {} });
    assert.equal((await call('PUT', '/api/prefs', { u: P, body: { remind: '20:30' } })).data.prefs.remind, '20:30');
    for (const bad of ['24:00', '7:30', '20:30<script>', 2030, '20:60']) assert.equal((await call('PUT', '/api/prefs', { u: P, body: { remind: bad } })).data.prefs.remind, undefined, String(bad));
    assert.equal((await call('PUT', '/api/prefs', { u: P, body: { remind: '' } })).data.prefs.remind, '');
  });
  await ok('quick check-in: a day with no photo and no song is saved; more than 8 photos is not', async () => {
    const P = jar(); await call('POST', '/api/guest', { u: P, body: {} });
    const r = await call('POST', '/api/days', { u: P, body: validDay(2, { text: 'Quiet tea.', photos: [], song: { kind: 'link', url: '', title: '', artist: '', tempo: 'mid', mode: 'unknown', bpm: null, energy: null, fileName: '' } }) });
    assert.equal(r.status, 201); assert.deepEqual(r.data.day.photos, []); assert.equal(r.data.day.song.url, '');
    assert.equal((await call('POST', '/api/days', { u: P, body: validDay(2, { photos: Array(9).fill(validDay().photos[0]) }) })).status, 400);
  });
  await ok('music search checks input; the preview fetch only goes to Apple', async () => {
    const M = jar(); await call('POST', '/api/guest', { u: M, body: {} });
    assert.equal((await call('GET', '/api/music/search?q=a', { u: M })).status, 400);
    assert.equal((await call('GET', '/api/music/search?q=hello')).status, 401);
    for (const u of ['https://evil.example/a.m4a', 'http://audio-ssl.itunes.apple.com/a.m4a', 'https://itunes.apple.com.evil.example/a', 'file:///etc/passwd', 'https://127.0.0.1/x'])
      assert.equal((await call('GET', '/api/music/preview?u=' + encodeURIComponent(u), { u: M })).status, 400, u);
  });
  await ok('page allows the microphone and Apple covers, nothing more', async () => {
    const r = await call('GET', '/'); assert.match(r.headers.get('permissions-policy'), /microphone=\(self\)/); assert.match(r.headers.get('content-security-policy'), /img-src 'self' data: blob: https:\/\/\*\.mzstatic\.com;/);
  });

  console.log('Google sign-in');
  await ok('Google sign-in starts with PKCE, state and a locked-down cookie', async () => {
    assert.equal((await call('GET', '/api/config')).data.google, true);
    const r = await call('GET', '/api/auth/google'); assert.equal(r.status, 302);
    const loc = new URL(r.headers.get('location')); assert.equal(loc.origin, 'https://accounts.google.com');
    assert.equal(loc.searchParams.get('client_id'), 'test-client.apps.googleusercontent.com'); assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(loc.searchParams.get('state').length >= 30); assert.ok(loc.searchParams.get('nonce')); assert.equal(loc.searchParams.get('redirect_uri'), BASE + '/api/auth/google/callback');
    assert.match(r.setCookie, /^g_oauth=/); assert.match(r.setCookie, /HttpOnly/); assert.match(r.setCookie, /SameSite=Lax/); assert.match(r.setCookie, /Path=\/api\/auth\/google/);
  });
  await ok('Google callback rejects a forged or missing state and gives no session', async () => {
    const r = await call('GET', '/api/auth/google'), cookie = r.setCookie.split(';')[0];
    const bad = await fetch(BASE + '/api/auth/google/callback?code=x&state=forged-state-forged-state-forged', { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(bad.status, 302); assert.equal(bad.headers.get('location'), '/?auth=failed#/welcome'); assert.doesNotMatch(bad.headers.get('set-cookie') || '', /(^|, )sid=[^;]/);
    const none = await fetch(BASE + '/api/auth/google/callback?code=x&state=abc', { redirect: 'manual' }); assert.equal(none.headers.get('location'), '/?auth=failed#/welcome');
    const tampered = cookie.replace(/.$/, c => c === 'A' ? 'B' : 'A');
    const t2 = await fetch(BASE + '/api/auth/google/callback?code=x&state=' + new URL(r.headers.get('location')).searchParams.get('state'), { headers: { Cookie: tampered }, redirect: 'manual' });
    assert.equal(t2.headers.get('location'), '/?auth=failed#/welcome');
  });
  await ok('a Google-only account cannot be opened with a password', async () => {
    const { DatabaseSync } = require('node:sqlite'); const w = new DatabaseSync(path.join(DATA, 'memoir.db'));
    w.prepare('INSERT INTO users (email, pass_hash, is_guest, created_at, name) VALUES (?, ?, 0, ?, ?)').run('g@example.com', 'oauth$google', Date.now(), 'Gee'); w.close();
    for (const pw of ['oauth$google']) assert.equal((await call('POST', '/api/login', { u: jar(), body: { email: 'g@example.com', password: pw } })).status, 401);
  });

  console.log('Admin and word guard');
  await ok('word guard blocks abusive words and flags risky ones', async () => {
    const W = jar(); await call('POST', '/api/guest', { u: W, body: {} });
    assert.equal((await call('POST', '/api/days', { u: W, body: validDay(0, { text: 'what the fuck of a day' }) })).status, 422);
    assert.equal((await call('POST', '/api/days', { u: W, body: validDay(0, { text: 'Сука, какой день' }) })).status, 422);
    const f = await call('POST', '/api/days', { u: W, body: validDay(0, { text: 'Rain all day, I want to die of boredom' }) });
    assert.equal(f.status, 201); assert.deepEqual(f.data.day.flags, ['want to die']);
  });
  await ok('only the admin e-mail gets admin access', async () => {
    const C = jar(); await call('POST', '/api/login', { u: C, body: { email: 'a@example.com', password: PW } });
    const me = await call('GET', '/api/me', { u: C }); assert.equal(me.data.user.admin, true);
    const G2 = jar(); await call('POST', '/api/guest', { u: G2, body: {} });
    assert.equal((await call('GET', '/api/admin/days', { u: G2 })).status, 403);
    assert.equal((await call('PUT', '/api/admin/settings', { u: G2, body: { words: { block: ['x'] } } })).status, 403);
    const list = await call('GET', '/api/admin/days', { u: C }); assert.equal(list.status, 200); assert.ok(list.data.days.length > 0);
    const flagged = list.data.days.find(d => d.flags.length); assert.ok(flagged, 'flagged day is listed');
    assert.equal((await call('PATCH', '/api/admin/days/' + flagged.id, { u: C, body: { text: 'Rain all day, tea and a book.', clearFlags: true } })).status, 200);
    assert.equal((await call('GET', '/api/admin/days', { u: C })).data.days.find(d => d.id === flagged.id).flags.length, 0);
    assert.equal((await call('PUT', '/api/admin/settings', { u: C, body: { words: { block: ['brocoli'], flag: [] }, moods: { en: { calm: { name: 'Sunny' } } } } })).status, 200);
    assert.equal((await call('GET', '/api/content')).data.moods.en.calm.name, 'Sunny');
    assert.equal((await call('POST', '/api/days', { u: G2, body: validDay(0, { text: 'I hate brocoli' }) })).status, 422);
    assert.equal((await call('DELETE', '/api/admin/days/' + flagged.id, { u: C })).status, 200);
  });
  await ok('удаление аккаунта требует верный пароль', async () => {
    const C = jar(); await call('POST', '/api/login', { u: C, body: { email: 'a@example.com', password: PW } });
    assert.equal((await call('DELETE', '/api/me', { u: C, body: { password: 'nope-nope-nope' } })).status, 403);
    assert.equal((await call('DELETE', '/api/me', { u: C, body: { password: PW } })).status, 200);
    assert.equal((await call('POST', '/api/login', { u: jar(), body: { email: 'a@example.com', password: PW } })).status, 401);
  });

  srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(`\nИтого: ${pass} прошло, ${fail} упало`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); srv && srv.kill(); process.exit(1); });
