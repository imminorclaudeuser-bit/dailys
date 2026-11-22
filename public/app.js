"use strict";
/* Daily’s (Дневничок): screens and talking to the server.
   Texts live in i18n.js (English and Russian), the design engine in engine.js, animations in motion.js. */

/* ---------- state and server calls ---------- */
let me = { user: null, csrf: null };
const state = { draft: null, result: null, filter: 'all', authTab: 'login', quick: null };
const main = () => $('#main');

/** API request: JSON, CSRF token on changing requests, one place for errors. */
async function api(method, url, body, opts = {}) {
  const headers = {};
  if (body !== undefined && !opts.raw) headers['Content-Type'] = 'application/json';
  if (opts.type) headers['Content-Type'] = opts.type;
  if (method !== 'GET' && me.csrf) headers['X-CSRF-Token'] = me.csrf;
  const r = await fetch(url, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : (opts.raw ? body : JSON.stringify(body)) });
  let data = null; try { data = await r.json(); } catch (e) { /* not JSON */ }
  if (!r.ok) {
    if (r.status === 401 && me.user && !opts.quiet401) { me = { user: null, csrf: null }; shell(); location.hash = '#/welcome'; }
    throw Object.assign(new Error(errText(data && data.error)), { status: r.status });
  }
  return data;
}
const fail = e => { toast(e && e.message ? e.message : t('errGeneric')); Daisy.react('oops'); };

/** A capsule toast at the top that grows with a spring and shrinks back. */
function toast(msg) {
  const el = document.createElement('div'); el.className = 'island'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(msg)}</span>`; $('#islands').appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
  setTimeout(() => { el.classList.remove('open'); setTimeout(() => el.remove(), 700); }, 3400);
}
function busy(on, msg) { const l = $('#loader'); l.classList.toggle('on', on); if (msg) $('#loadmsg').textContent = msg; }

/** Saves a day: data and photos first, then the uploaded audio file if there is one. */
/** The 10-second check-in: a mood and one line make a whole day (no photo, song or camera needed). */
async function quickSave() {
  const line = $('#qline').value.trim(), m = state.quick; if (!m) return;
  if (!line) { $('#qline').focus(); toast(t('qNeedLine')); return; }
  busy(true, t('saving'));
  try {
    const day = await buildDay({ ...newDraft(), text: line, mood: m });
    await saveDay(day); state.quick = null; toast(t('saved')); location.hash = '#/calendar'; Daisy.happy(t('daisy').quick);
  } catch (e) { fail(e); } finally { busy(false); }
}
/* ---------- daily reminder: a calendar file for the phone, and a nudge while the site is open ---------- */
/** A daily repeating calendar event with an alert, so the phone or computer reminds even when the site is closed. */
function reminderIcs(time) {
  const [h, m] = time.split(':'), d = new Date(), p2 = n => String(n).padStart(2, '0'), url = location.origin + '/#/new';
  const esc2 = x => String(x).replace(/[\\;,]/g, c => '\\' + c), stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, '');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dailys//Reminder//EN', 'BEGIN:VEVENT', `UID:dailys-reminder-${location.host}`, `DTSTAMP:${stamp}`,
    `DTSTART:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}T${h}${m}00`, 'DURATION:PT5M', 'RRULE:FREQ=DAILY',
    `SUMMARY:${esc2(t('remSummary'))}`, `DESCRIPTION:${esc2(t('remBody'))} ${url}`, `URL:${url}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', `DESCRIPTION:${esc2(t('remSummary'))}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = 'dailys-reminder.ics';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast(t('remIcsDone'));
}
/** Once a minute: after the reminder time, if nothing is written today, Daisy waves and (if allowed) the browser shows a notification. Once a day. */
async function remindTick() {
  const r = me.user && prefs().remind, today = todayISO(), key = 'reminded-' + today, now = new Date();
  if (!r || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` < r) return;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (e) { return; }
  try { if ((await api('GET', '/api/days')).days.some(d => d.date === today)) return; } catch (e) { return; }
  Daisy.wave(); Daisy.say(t('daisy').remind, 7000);
  if (window.Notification && Notification.permission === 'granted' && document.hidden) {
    const n = new Notification(t('brand'), { body: t('remBody'), tag: 'dailys-remind' }); n.onclick = () => { focus(); location.hash = '#/new'; n.close(); };
  }
}
async function saveDay(day) {
  const s = day.song;
  const payload = {
    date: day.date, dateOn: day.dateOn, voiceOn: day.voiceOn, text: day.text, photos: day.photos,
    song: { kind: s.blob ? 'file' : 'link', url: s.url || '', title: s.title, artist: s.artist, tempo: s.tempo, mode: s.mode, bpm: s.bpm, energy: s.energy, fileName: s.fileName || '' },
    weather: day.weather, geo: day.geo, photoInfo: day.photoInfo, textInfo: day.textInfo, style: day.style
  };
  const { day: saved } = await api('POST', '/api/days', payload);
  if (s.blob) {
    try { const r = await api('PUT', `/api/days/${saved.id}/audio`, s.blob, { raw: true, type: s.blob.type && /^audio\//.test(s.blob.type) ? s.blob.type : 'audio/mpeg' }); saved.song.audioUrl = r.audioUrl; }
    catch (e) { toast(t('savedNoSong', e.message)); }
  }
  for (const [what, blob, re, fallback] of [['voice', day.voiceBlob, /^audio\//, 'audio/webm'], ['video', day.videoBlob, /^video\//, 'video/webm']]) {
    if (!blob) continue;
    try { await api('PUT', `/api/days/${saved.id}/${what}`, blob, { raw: true, type: re.test(blob.type) ? blob.type.split(';')[0] : fallback }); } catch (e) { toast(e.message); }
  }
  return saved;
}

/* ---------- music and voice ---------- */
const player = { audio: null, url: null, speaking: false };
let plays = [];
/** Mounts an interactive playground (play.js) behind an element. */
function playIn(el, opts) { if (!el) return null; const c = document.createElement('canvas'); c.className = 'playground' + (opts && opts.wide ? ' wide' : ''); c.setAttribute('aria-hidden', 'true'); el.prepend(c); const p = Play.mount(c, el, opts); plays.push(p); return p; }
/** Mood from typed words: the strongest mood word wins; no mood words → null (base colours). */
function moodOf(text) { const m = analyzeText(text).mood, top = Object.keys(m).sort((a, b) => m[b] - m[a])[0]; return m[top] > 0 ? top : null; }
function stopAll() {
  cardTimers.forEach(clearInterval); cardTimers = []; plays.forEach(p => p.destroy()); plays = [];
  if (player.audio) { player.audio.pause(); player.audio = null; }
  if (player.preview) { player.preview.pause(); player.preview = null; }
  if (player.url) { URL.revokeObjectURL(player.url); player.url = null; }
  if (window.speechSynthesis) speechSynthesis.cancel(); player.speaking = false;
}
const songSrc = s => s.blob ? 'blob' : s.audioUrl ? s.audioUrl : (linkKind(s.url).kind === 'audio' ? linkKind(s.url).src : '');
function toggleSong(day, btn) {
  const s = day.song;
  if (player.audio && !player.audio.paused) { player.audio.pause(); btn.dataset.state = 'paused'; return; }
  if (!player.audio) {
    let src = songSrc(s); if (!src) return;
    if (src === 'blob') { player.url = URL.createObjectURL(s.blob); src = player.url; }
    const a = new Audio(src); player.audio = a;
    a.addEventListener('timeupdate', () => { const b = $('#songbar'); if (b && a.duration) b.style.width = (a.currentTime / a.duration * 100) + '%'; });
    a.addEventListener('ended', () => { btn.dataset.state = 'paused'; });
  }
  player.audio.play().then(() => { btn.dataset.state = 'playing'; }).catch(() => toast(t('noPlay')));
}
function toggleVoice(day, btn) {
  if (!window.speechSynthesis) { toast(t('noSpeech')); return; }
  if (player.speaking) { speechSynthesis.cancel(); player.speaking = false; btn.dataset.state = 'paused'; return; }
  /* read the entry in the language it was written in */
  const lang = /[а-яё]/i.test(day.text) ? 'ru' : 'en';
  const u = new SpeechSynthesisUtterance(day.text), v = day.style.voice; u.lang = lang === 'ru' ? 'ru-RU' : 'en-US'; u.rate = v.rate; u.pitch = v.pitch;
  const voice = speechSynthesis.getVoices().find(x => x.lang.toLowerCase().startsWith(lang)); if (voice) u.voice = voice;
  u.onend = u.onerror = () => { player.speaking = false; btn.dataset.state = 'paused'; };
  player.speaking = true; btn.dataset.state = 'playing'; speechSynthesis.speak(u);
}
const PLAY_SVG = '<svg viewBox="0 0 14 16" aria-hidden="true"><path d="M2 1.5L13 8L2 14.5Z"/></svg>';
function waveHtml(day) { const calm = day.style.mood === 'calm' || day.style.mood === 'quiet'; const r = rng(hash(day.id)); let s = ''; for (let i = 0; i < 48; i++) { const h = calm ? 4 + Math.round(22 * Math.abs(Math.sin(i * .33)) * (.65 + .35 * Math.cos(i * .11))) : Math.min(6 + Math.round(r() * 26) + (i % 3 === 0 ? 8 : 0), 30); s += `<i style="height:${h}px;background:${day.style.mood === 'tense' ? '#2F4A68' : '#C2601F'}"></i>`; } return s; }

/* ---------- shared pieces ---------- */
function shell() {
  document.body.classList.toggle('authed', !!me.user);
  document.body.classList.toggle('admin', !!(me.user && me.user.admin));
}
/** The name in the greeting: Google name, otherwise the part of the e-mail before @. */
const displayName = () => me.user.name || (me.user.guest ? t('guestWord') : cap(String(me.user.email || '').split('@')[0].split(/[._+\-\d]/)[0] || String(me.user.email).split('@')[0]));
function paint(html, o = {}) {
  if (me.user && !o.welcome) html = `<p class="hello reveal">${esc(t('hello', displayName()))}</p>` + html;
  main().innerHTML = html;
  document.body.classList.toggle('welcome', !!o.welcome);
  if (o.quiet) $$('.reveal', main()).forEach(e => e.classList.add('in'));
  mountCards(main()); Motion.enter(main());
}
const SEC = (n, title) => `<span class="secnum">${n}</span> ${esc(title)}`;
const TX = () => TXT[LANG] || TXT.en;
/** The sliding mark under the active link in the bottom bar. */
function markDock(el) {
  $$('.dock-links .on').forEach(x => x.classList.remove('on'));
  const bar = el && el.closest('.dock-links'); if (!bar) return;
  el.classList.add('on'); bar.style.setProperty('--x', el.offsetLeft + 'px'); bar.style.setProperty('--w', el.offsetWidth + 'px');
}

/* ---------- welcome page: centred sections, the bottom bar follows the one on screen ---------- */
const MOOD_PILL = { calm: '☀', tense: '⚡', quiet: '☂', lively: '✦' };
/** Three columns of vertical emotion words on each side, moving up and down in turn; each list is doubled so the loop is seamless. */
function sideWords(side) {
  const f = t('feel'), moods = ['calm', 'tense', 'quiet', 'lively'];
  const col = k => { const order = moods.map((_, i) => moods[(i + k + (side === 'right' ? 2 : 0)) % 4]);
    const words = order.flatMap(m => f[m].filter((_, i) => i % 3 === k).map((w, i) => `<span data-m="${m}" style="--s:${[1, .85, 1.15][(i + k) % 3]}">${esc(w)}</span>`)).join('');
    return `<div class="roll c${k}">${words}${words}</div>`; };
  return `<div class="side-words ${side}" aria-hidden="true">${col(0)}${col(1)}${col(2)}</div>`;
}
/** Moves the side columns: each drifts on its own and also follows page scrolling (eased), in its own direction. */
function rollSideWords() {
  const cols = $$('.side-words .roll'); if (!cols.length || Motion.reduced() || !matchMedia('(min-width:1360px)').matches) return { destroy() {} };
  const conf = cols.map((el, i) => ({ el, dir: (i % 3 === 1 ? -1 : 1) * (i >= 3 ? -1 : 1),   /* left: up, down, up; right mirrored: down, up, down */ speed: [22, 17, 27][i % 3], half: el.scrollHeight / 2, off: Math.random() * 400 }));
  let raf = 0, last = performance.now(), sy = scrollY, drift = 0;
  const frame = now => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - last) / 1000); last = now; drift += dt;
    sy += (scrollY - sy) * Math.min(1, dt * 7);                    // eased scroll, so the words glide instead of jumping
    for (const c of conf) {
      const pos = ((c.off + c.dir * (drift * c.speed + sy * .6)) % c.half + c.half) % c.half;
      c.el.style.transform = `translate3d(0,${(-pos).toFixed(1)}px,0)`;
    }
  };
  const vis = () => { cancelAnimationFrame(raf); if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', vis); vis();
  return { destroy() { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', vis); } };
}
const G_LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.1 5.5c4.2-3.9 7.2-9.6 7.2-17z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.2-8.8 2.2-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';
function showcaseDays() {
  return demoDays().map((x, i) => {
    const photos = DEMO_IMG[i];
    const textInfo = analyzeText(x.text), photoInfo = { count: photos.length, colors: x.ph, accent: x.ph[0], brightness: .5, saturation: .5 };
    return { id: 'show' + i, date: x.date, dateOn: true, text: x.text, photos, song: { ...x.song }, textInfo, style: decide({ textInfo, photoInfo, song: x.song, weather: null, date: x.date }, LANG) };
  });
}
/** Section 01: example days roll past in columns (up and down) and a row of feelings slides sideways. */
function wallHtml(all) {
  const P = [], S = [], W = [], feel = t('feel');
  all.forEach((d, i) => {
    d.photos.forEach(src => P.push(`<img class="wt wp" src="${esc(src)}" alt="" loading="lazy">`));
    if (d.video) P.push(`<video class="wt wp" src="${esc(d.video)}" muted loop playsinline autoplay preload="metadata"></video>`);
    d.text.split(/(?<=[.!?])\s+/).forEach(x => S.push(`<p class="wt ws" data-m="${d.style.mood}">${moodFace(d.style.mood)}<span>${esc(x)}</span><i>${esc(fmtDate(d.date))}</i></p>`));
    (feel[d.style.mood] || []).slice(0, 3).forEach(w => W.push(`<span class="wt ww" data-m="${d.style.mood}">${esc(w)}</span>`));
  });
  const mix = []; while (P.length || S.length) { if (P.length) mix.push(P.shift()); if (S.length) mix.push(S.shift()); }
  const cols = [[], [], [], []]; mix.forEach((x, i) => cols[i % 4].push(x));
  return `<div class="wall" aria-hidden="true">${cols.map((c, k) => `<div class="wcol"><div class="wroll${k % 2 ? ' down' : ''}" style="--dur:${[46, 38, 52, 42][k]}s">${c.join('')}${c.join('')}</div></div>`).join('')}</div>
    <div class="wrow" aria-hidden="true"><div class="wroll side">${W.join('')}${W.join('')}</div></div>`;
}
/** The sign-in card: a sliding Log in / Sign up switch, a typed example e-mail and a password maker. */
function authInner() {
  const login = state.authTab === 'login';
  return `<div class="eyebrow" id="autheye">${esc(login ? t('welcomeBack') : t('createDiary'))}</div>
      <div class="seg2" data-v="${login ? 'login' : 'register'}" role="tablist"><i class="knob" aria-hidden="true"></i><button type="button" role="tab" aria-selected="${login}" data-act="authtab" data-v="login">${esc(t('login'))}</button><button type="button" role="tab" aria-selected="${!login}" data-act="authtab" data-v="register">${esc(t('register'))}</button></div>
      <form id="authform" novalidate>
        <label class="field"><span class="field-label">${esc(t('email'))}</span><input type="email" name="email" autocomplete="email" required maxlength="254"></label>
        <label class="field"><span class="field-label">${esc(t('password'))}</span><input type="password" name="password" autocomplete="${login ? 'current-password' : 'new-password'}" required minlength="10" maxlength="128"></label>
        <div class="reg-only"${login ? ' hidden' : ''}><button type="button" class="link" data-act="pw-gen">${esc(t('pwGen'))}</button><p class="small" id="pwnote">${esc(t('pwHint'))}</p></div>
        <p class="err" id="autherr" role="alert"></p>
        <button class="btn primary" type="submit" style="width:100%">${esc(login ? t('login') : t('createBtn'))}</button>
      </form>
      <div class="or"><span>${esc(t('or'))}</span></div>
      <a class="btn outline google" href="/api/auth/google" data-act="google" style="width:100%">${G_LOGO}${esc(t('google'))}</a>
      <button class="btn outline" data-act="guest" style="width:100%">${esc(t('guest'))}</button>
      <p class="small">${esc(t('guestHint'))}</p>`;
}
function fillAuth() {
  const a = $('#auth'); if (!a || !a.querySelector('.skel')) return;
  a.innerHTML = authInner(); ghostEmail();
  if (!Motion.reduced()) gsap.from(a.children, { autoAlpha: 0, y: 10, stagger: .04, duration: .6, clearProps: 'transform,opacity,visibility' });
}
function authTab(v) {
  if (state.authTab === v) return;
  state.authTab = v; const login = v === 'login', f = $('#authform');
  $('.seg2').dataset.v = v; $$('.seg2 button').forEach(b => b.setAttribute('aria-selected', b.dataset.v === v));
  $('#autheye').textContent = login ? t('welcomeBack') : t('createDiary');
  f.password.autocomplete = login ? 'current-password' : 'new-password'; f.password.type = 'password';
  $('.reg-only', f).hidden = login; $('button[type=submit]', f).textContent = login ? t('login') : t('createBtn'); $('#autherr').textContent = '';
  if (!Motion.reduced()) gsap.fromTo(f, { x: login ? -36 : 36, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: .7, ease: 'expo.out', clearProps: 'transform,opacity,visibility' });
}
/** Example e-mails type themselves into the empty field, like a ghost writing. */
function ghostEmail() {
  const inp = $('#authform [name=email]'); if (!inp || Motion.reduced()) return;
  const list = t('ghostMails'); let i = 0, n = 0, back = false, stop = false;
  const tick = () => {
    if (stop || !inp.isConnected) return;
    const w = list[i % list.length];
    if (document.activeElement === inp || inp.value) { inp.placeholder = ''; return void setTimeout(tick, 600); }
    n += back ? -1 : 1; inp.placeholder = w.slice(0, n);
    if (n >= w.length) { back = true; return void setTimeout(tick, 1600); }
    if (n <= 0) { back = false; i++; return void setTimeout(tick, 400); }
    setTimeout(tick, back ? 30 : 85);
  };
  tick(); plays.push({ destroy: () => { stop = true; } });
}
/** A strong password made on this device, in the easy-to-read style of Apple's: abcdef-Ghijk2-mnopqr. */
function strongPassword() {
  const L = 'abcdefghijkmnopqrstuvwxyz', r = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const g = Array.from({ length: 3 }, () => Array.from({ length: 6 }, () => L[r(L.length)]));
  const d = [r(3), r(6)]; g[d[0]][d[1]] = String(r(10));
  let u; do { u = [r(3), r(6)]; } while (u[0] === d[0] && u[1] === d[1]); g[u[0]][u[1]] = g[u[0]][u[1]].toUpperCase();
  return g.map(x => x.join('')).join('-');
}
function makePassword() {
  const p = $('#authform [name=password]'); p.value = strongPassword(); p.type = 'text'; p.classList.add('pw-strong');
  $('#pwnote').innerHTML = `${esc(t('pwMade'))} <button type="button" class="link" data-act="pw-copy">${esc(t('pwCopy'))}</button>`;
  p.addEventListener('input', () => { p.type = 'password'; p.classList.remove('pw-strong'); }, { once: true });
  Daisy.react('wow', t('daisy').pw);
}
function viewWelcome() {
  stopAll(); const all = showcaseDays(), days = all.slice(0, 4); showcase.moods = days.map(d => d.style.mood);
  const X = TX();
  const caps = days.map((d, i) => `<div class="cap" data-i="${i}" data-m="${d.style.mood}"><div class="eyebrow">${esc(X.mood[d.style.mood])}</div><h3>${esc(X.tech[d.style.technique])}</h3><p class="quote">“${esc(d.text)}”</p>${d.style.rows.slice(0, 2).map(r => `<p class="why-line"><b>${esc(r.k)}.</b> ${esc(r.why)}</p>`).join('')}</div>`).join('');
  paint(`
  <section class="t-hero" id="top">
    <h1 class="t-h1" data-words>${esc(t('welcomeTo'))}</h1>
    <p class="t-lead" data-words="300">${esc(t('introP1'))}</p>
    <div class="cta-row reveal"><button class="btn primary" data-act="jump" data-to="sec4">${esc(t('start'))}</button><button class="btn" data-act="guest">${esc(t('guest'))}</button></div>
    <span class="t-hero-hint">${esc(t('playHint'))}</span>
  </section>
  <div class="after-hero">
  <div class="side-rail left" aria-hidden="true">${sideWords('left')}</div><div class="side-rail right" aria-hidden="true">${sideWords('right')}</div>
  <section class="t-row" id="sec1">
    <h2 class="t-h2 reveal">${SEC('01', t('secStory'))}</h2>
    <p class="big" data-words>${esc(t('storyBig'))}</p><p class="t-lead reveal">${esc(t('storyP'))}</p>
    <div id="wallbox">${wallHtml(all)}</div>
  </section>
  <section class="t-row" id="sec2">
    <h2 class="t-h2 reveal">${SEC('02', t('secMoods'))}</h2>
    <p class="t-lead reveal">${esc(t('moodsP'))}</p>
    <label class="mood-type reveal"><span class="field-label">${esc(t('typeFeel'))}</span><input id="moodtype" type="text" maxlength="200" autocomplete="off" placeholder="${esc(t('typeFeelPh'))}"></label>
    <div class="moods reveal">${days.map((d, i) => `<button class="mood-pill" data-act="pickmood" data-i="${i}" data-m="${d.style.mood}"><span aria-hidden="true">${MOOD_PILL[d.style.mood]}</span>${esc(t('moodShort')[d.style.mood])}</button>`).join('')}</div>
    <div class="show" id="show">
      <div class="capbox">${caps}</div>
      <div class="deck">${days.map((d, i) => `<div class="dc" data-i="${i}">${cardHtml(d)}</div>`).join('')}<div class="dots">${days.map((_, i) => `<button data-act="pickmood" data-i="${i}" aria-label="${i + 1}"></button>`).join('')}</div></div>
    </div>
  </section>
  <section class="t-row" id="sec3">
    <h2 class="t-h2 reveal">${SEC('03', t('secHow'))}</h2>
    <div class="board">${[1, 2, 3].map(n => `<div class="note" data-n="${n}"><i class="pin" aria-hidden="true"></i><span class="num">0${n}</span><h3>${esc(t('how' + n + 'T'))}</h3><p>${esc(t('how' + n))}</p></div>`).join('')}</div>
  </section>
  <section class="t-row" id="sec4">
    <h2 class="t-h2 reveal">${SEC('04', t('secStart'))}</h2>
    <div class="card authcard reveal" id="auth">${state.cfgReady ? authInner() : '<div class="skel" aria-busy="true">' + '<i></i>'.repeat(6) + '</div>'}</div>
  </section>
  </div>
  <footer class="t-foot">
    <span class="t-foot-logo"><i class="mark" aria-hidden="true"></i>${esc(t('brand'))}</span>
    <p>© 2026 ${esc(t('brand'))} · ${esc(t('footNote'))} · <button class="link" data-act="credits">${esc(t('photoCredits'))}</button> · ${esc(t('rights'))}</p>
  </footer>`, { welcome: true });
  /* mood cards change by themselves every 4.5 s; hovering pauses, a click picks one */
  const show = $('#show'), caps2 = $$('.cap', show), dcs = $$('.dc', show), dots = $$('.dots button', show), pills = $$('.mood-pill', main());
  let idx = 0, hold = false;
  showcase.set = i => { idx = i; caps2.forEach((c, k) => c.classList.toggle('on', k === i)); dcs.forEach((c, k) => c.dataset.s = k === i ? 'on' : k < i ? 'prev' : 'next'); [dots, pills].forEach(l => l.forEach((d, k) => d.classList.toggle('on', k === i))); };
  showcase.stop = () => { hold = true; };
  show.addEventListener('pointerenter', () => { show.dataset.hover = '1'; }); show.addEventListener('pointerleave', () => { delete show.dataset.hover; });
  cardTimers.push(setInterval(() => { if (!hold && !show.dataset.hover && !document.hidden) showcase.set((idx + 1) % dcs.length); }, 4500));
  showcase.set(0);
  playIn($('.t-hero'), { count: 16, lines: 2 });
  /* the wall rolls only while it is on screen; the notes are pinned up one by one */
  const io = new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle('on', e.isIntersecting)));
  $$('.wall, .wrow').forEach(x => io.observe(x)); plays.push({ destroy: () => io.disconnect() });
  api('GET', '/api/wall').then(({ days: shared }) => {
    const box = $('#wallbox'); if (!box || !shared.length) return;
    box.innerHTML = wallHtml([...shared.map(x => ({ ...x, style: { mood: x.mood }, photos: x.photo ? [x.photo] : [] })), ...all]);
    $$('.wall, .wrow', box).forEach(x => io.observe(x));
  }, () => { /* the examples stay */ });
  Motion.onView($('.board'), b => {
    if (Motion.reduced()) return;
    gsap.from($$('.note', b), { y: -60, scale: .6, rotation: i => [-16, 14, -10][i], autoAlpha: 0, duration: .9, ease: 'back.out(1.6)', stagger: .18, clearProps: 'transform,opacity,visibility' });
    gsap.from($$('.pin', b), { y: -30, scale: 2.4, autoAlpha: 0, duration: .6, ease: 'bounce.out', stagger: .18, delay: .45, clearProps: 'transform,opacity,visibility' });
  });
  if (state.cfgReady) ghostEmail();
  const sec2 = $('#sec2'), sec2Play = playIn(sec2, { count: 10, lines: 2 });
  /* the mood colours and shapes live only inside section 02 */
  showcase.mood = m => { if (m) sec2.dataset.mood = m; else delete sec2.dataset.mood; sec2Play.setMood(m || 'base'); const i = showcase.moods.indexOf(m); if (i >= 0) { showcase.stop(); showcase.set(i); } };
  $('#moodtype').addEventListener('input', e => { const m = moodOf(e.target.value); showcase.mood(m); Daisy.setMood(m, !m, true); });
  plays.push(rollSideWords());
  /* the bottom bar marks the section on screen */
  const btns = $$('#gnav button'), spy = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) markDock(btns.find(b => b.dataset.to === en.target.id) || null); }), { rootMargin: '-45% 0px -45% 0px' });
  ['top', 'sec1', 'sec2', 'sec3', 'sec4'].forEach(id => spy.observe(document.getElementById(id)));
  plays.push({ destroy: () => spy.disconnect() });
}
const showcase = { set() {}, stop() {}, mood() {}, moods: [] };
async function afterLogin(data, demo) {
  me = { user: data.user, csrf: data.csrf }; shell();
  try { me.prefs = (await api('GET', '/api/me')).prefs || {}; } catch (e) { me.prefs = {}; }
  Daisy.show(prefs().daisy); dockAvatar(); Daisy.react('cheer', t('daisy').welcome);
  if (demo) { await loadDemo(true); return; }
  const { days } = await api('GET', '/api/days'); location.hash = days.length ? '#/archive' : '#/new';
}
async function submitAuth(form) {
  const login = state.authTab === 'login', err = $('#autherr'); err.textContent = ''; form.password.type = 'password';
  const email = form.email.value.trim(), password = form.password.value;
  if (!email || !password) { err.textContent = t('needEmailPw'); return; }
  if (!login && password.length < 10) { err.textContent = t('pwShort'); return; }
  const btn = $('button[type=submit]', form); btn.disabled = true;
  try { await afterLogin(await api('POST', login ? '/api/login' : '/api/register', { email, password }, { quiet401: true })); }
  catch (e) { err.textContent = e.message; } finally { btn.disabled = false; }
}

/* ---------- screen 1: write a day ---------- */
function newDraft() { return { voice: null, video: null, text: '', photos: [], song: { tab: 'search', q: '', picked: null, url: '', title: '', artist: '', tempo: 'mid', mode: 'unknown', tempoSet: false, file: null, analyzing: false, bpm: null, energy: null }, voiceOn: true, dateOn: true, date: todayISO(), weatherOn: false, weather: null, geoOn: false, geo: null, face: null }; }
state.draft = newDraft();
const validLink = u => /^https?:\/\/\S+\.\S+/i.test(u.trim());
function songReady(d) { return d.song.tab === 'file' ? !!d.song.file : d.song.tab === 'search' ? !!d.song.picked : validLink(d.song.url); }
/* How the person set up this page (saved on the server for their account). */
const PREF_DEF = { order: ['entry', 'song', 'camera', 'photos', 'extra'], hidden: [], layout: 'two', accent: 'amber', font: 'serif', size: 'normal', heading: '', shapes: true, daisy: true, remind: '' };
const prefs = () => ({ ...PREF_DEF, ...((me && me.prefs) || {}) });
let prefTimer = 0;
function setPrefs(change, rerender = true) {
  me.prefs = { ...prefs(), ...change }; Daisy.show(me.prefs.daisy);
  clearTimeout(prefTimer);
  prefTimer = setTimeout(() => api('PUT', '/api/prefs', me.prefs).catch(fail), 400);
  if (rerender) viewNew(true);
}
const ACCENTS = ['amber', 'rose', 'sage', 'sky', 'lavender', 'ink'];
function custUi(p) {
  const C = t('custCards'), sw = (on, act, extra, label) => `<button class="sw" role="switch" aria-label="${esc(label)}" aria-checked="${on}" data-act="${act}"${extra}></button>`;
  const seg = (k, items) => `<div class="row">${items.map(([v, x]) => `<button class="pill${p[k] === v ? ' on' : ''}" data-act="cust-set" data-k="${k}" data-v="${v}" aria-pressed="${p[k] === v}">${esc(x)}</button>`).join('')}</div>`;
  return `<section class="card cust reveal"><div class="field-label">${esc(t('custTitle'))}</div>
    <div class="cust-grid"><div>
      <div class="small">${esc(t('custOrder'))}</div>
      <ol class="cust-order">${p.order.map((c, i) => `<li><span>${esc(C[c])}</span>
        ${c === 'camera' || c === 'extra' ? sw(!p.hidden.includes(c), 'cust-hide', ` data-c="${c}"`, t('custShow', C[c])) : ''}
        <button class="icon-btn" data-act="cust-move" data-i="${i}" data-d="-1" aria-label="${esc(t('custUp', C[c]))}"${i ? '' : ' disabled'}>↑</button>
        <button class="icon-btn" data-act="cust-move" data-i="${i}" data-d="1" aria-label="${esc(t('custDown', C[c]))}"${i < p.order.length - 1 ? '' : ' disabled'}>↓</button></li>`).join('')}</ol>
      <div class="opt"><span>${esc(C.voice)}</span>${sw(!p.hidden.includes('voice'), 'cust-hide', ' data-c="voice"', t('custShow', C.voice))}</div>
      <div class="opt"><span>${esc(t('custShapes'))}</span>${sw(p.shapes, 'cust-shapes', '', t('custShapes'))}</div>
      <div class="opt"><span>${esc(t('custDaisy'))}</span>${sw(p.daisy, 'cust-daisy', '', t('custDaisy'))}</div>
    </div><div>
      <label class="small" for="custhead">${esc(t('custHeading'))}</label>
      <input type="text" id="custhead" maxlength="60" placeholder="${esc(t('newTitle'))}" value="${esc(p.heading)}">
      <div class="small">${esc(t('custLayout'))}</div>${seg('layout', [['two', t('custTwo')], ['one', t('custOne')]])}
      <div class="small">${esc(t('custAccent'))}</div>
      <div class="row swatches">${ACCENTS.map(a => `<button class="swatch" data-a="${a}" data-act="cust-set" data-k="accent" data-v="${a}" aria-pressed="${p.accent === a}" aria-label="${esc(t('accents')[a])}"></button>`).join('')}</div>
      <div class="small">${esc(t('custFont'))}</div>${seg('font', [['serif', t('fontSerif')], ['sans', t('fontSans')], ['hand', t('fontHand')]])}
      <div class="small">${esc(t('custSize'))}</div>${seg('size', [['normal', t('sizeN')], ['large', t('sizeL')]])}
      <button class="link" data-act="cust-reset">${esc(t('custReset'))}</button>
    </div></div></section>`;
}

/* ---------- On this day: what was written on today's date a year, some months or a week ago ---------- */
function onThisDay(days) {
  const now = new Date(), iso = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, rtf = new Intl.RelativeTimeFormat(LANG, { numeric: 'auto' });
  const want = [], same = d => d.getDate() === now.getDate();   // 31st or 29 Feb have no twin in shorter months
  for (let y = 5; y >= 1; y--) { const d = new Date(now.getFullYear() - y, now.getMonth(), now.getDate()); if (same(d)) want.push([iso(d), rtf.format(-y, 'year')]); }
  for (let m = 11; m >= 1; m--) { const d = new Date(now.getFullYear(), now.getMonth() - m, now.getDate()); if (same(d)) want.push([iso(d), rtf.format(-m, 'month')]); }
  const w = new Date(now); w.setDate(w.getDate() - 7); want.push([iso(w), rtf.format(-1, 'week')]);
  return want.map(([date, label]) => [days.find(x => x.date === date), label]).filter(([d]) => d).slice(0, 3);
}
function otdHtml() {
  const list = state.otd || []; if (!list.length) return '';
  return `<section class="card otd"><div class="field-label">${esc(t('otdTitle'))}</div>
    <ol class="rc-notes">${list.map(([d, label]) => `<li data-m="${d.style.mood}"><a href="#/day/${esc(d.id)}">${moodFace(d.style.mood)}<span><span class="otd-when">${esc(cap(label))}</span><b>${esc(d.style.title)}</b><span class="small">${esc(String(d.text).split(/(?<=[.!?…])\s/)[0].slice(0, 120))}</span></span>${d.photos[0] ? `<img src="${esc(d.photos[0])}" alt="">` : ''}</a></li>`).join('')}</ol></section>`;
}
async function otdLoad() {
  try { state.otd = onThisDay((await api('GET', '/api/days')).days.map(localizeDay)); } catch (e) { state.otd = []; }
  const box = $('#otd'); if (!box || !state.otd.length) return;
  box.innerHTML = otdHtml(); Motion.pop($$('#otd li'), { y: 14, scale: .9, stagger: { each: .08 } });
  try { const k = 'otd-' + todayISO(); if (!localStorage.getItem(k)) { localStorage.setItem(k, '1'); setTimeout(() => Daisy.happy(t('daisy').otd), 900); } } catch (e) { /* private mode */ }
}
function viewNew(quiet) {
  stopAll(); const d = state.draft, s = d.song, p = prefs();
  const opts = [['voiceOn', t('optVoice')], ['dateOn', t('optDate')], ['weatherOn', t('optWeather')], ['geoOn', t('optGeo')]].map(([k, x]) => `<div class="opt"><span>${esc(x)}</span><button class="sw" role="switch" aria-label="${esc(x)}" aria-checked="${d[k]}" data-act="opt" data-k="${k}"></button></div>`).join('');
  const seg = (items, key, cur) => items.map(([v, x]) => `<button class="pill${cur === v ? ' on' : ''}" data-act="${key}" data-v="${v}">${esc(x)}</button>`).join('');
  const CARDS = {
    entry: () => `<section class="card reveal"><label class="field-label" for="text">${esc(t('entry'))}</label><textarea id="text" maxlength="5000" placeholder="${esc(t('entryPh'))}">${esc(d.text)}</textarea>
        ${p.hidden.includes('voice') ? '' : `<div class="voice-box">${voiceUi(d)}</div>`}</section>`,
    song: () => `<section class="card reveal"><div class="field-label">${esc(t('song'))}</div>
        <div class="row">${seg([['search', t('songSearch')], ['link', t('link')], ['file', t('ownFile')]], 'songtab', s.tab)}</div>
        ${s.tab === 'search' ? (s.picked
          ? `<div class="song-pick">${s.picked.cover ? `<img src="${esc(s.picked.cover)}" alt="">` : ''}<div><b>${esc(s.picked.title)}</b><span>${esc(s.picked.artist)}${s.picked.year ? ' · ' + esc(s.picked.year) : ''}</span><span class="small">${esc(t('songFrom'))}</span></div><button class="link" data-act="sq-change">${esc(t('songChange'))}</button></div>`
          : `<input type="search" id="songq" maxlength="100" autocomplete="off" placeholder="${esc(t('songQ'))}" value="${esc(s.q)}" aria-label="${esc(t('songQ'))}"><div class="song-results" id="songres" aria-live="polite"></div>`)
        : `${s.tab === 'link'
          ? `<input type="url" id="songurl" maxlength="500" placeholder="${esc(t('songUrlPh'))}" value="${esc(s.url)}" aria-label="${esc(t('songUrlPh'))}">`
          : `<label class="drop" style="padding:18px"><input type="file" id="songfile" accept="audio/*" hidden><span>${s.file ? esc(s.file.name) : esc(t('pickAudio'))}</span></label>`}
          <div class="row"><input type="text" id="songtitle" maxlength="120" placeholder="${esc(t('songTitle'))}" value="${esc(s.title)}" style="flex:1;min-width:140px" aria-label="${esc(t('songTitle'))}"><input type="text" id="songartist" maxlength="120" placeholder="${esc(t('songArtist'))}" value="${esc(s.artist)}" style="flex:1;min-width:140px" aria-label="${esc(t('songArtist'))}"></div>`}
      </section>`,
    camera: () => p.hidden.includes('camera') ? '' : `<section class="card reveal cam-card"><div class="field-label">${esc(t('cvTitle'))}</div>${camCardUi(d)}</section>`,
    photos: () => `<section class="card reveal"><div class="field-label">${esc(t('photo'))}</div>
        <label class="drop" id="drop"><input type="file" id="photos" accept="image/*" multiple hidden><svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M14 5V23M5 14H23"/></svg><span>${esc(t('dropPhotos'))}</span></label>
        ${d.photos.length ? `<div class="thumbs">${d.photos.map((x, i) => `<div class="thumb"><img src="${esc(x)}" alt="${esc(t('photoN', i + 1))}"><button aria-label="${esc(t('removePhoto', i + 1))}" data-act="rmphoto" data-i="${i}">×</button></div>`).join('')}</div>` : ''}
      </section>`,
    extra: () => p.hidden.includes('extra') ? '' : `<section class="card reveal"><div class="field-label">${esc(t('optional'))}</div>${opts}
        ${d.dateOn ? `<input type="date" id="date" value="${esc(d.date)}" aria-label="${esc(t('dayDate'))}">` : ''}
        ${d.weatherOn && d.weather ? `<div class="small">${esc(t('weatherIs', `${weatherKind(d.weather.kind)}, ${d.weather.temp}°`))}</div>` : ''}
        <div class="small">${esc(t('consent'))}</div></section>`
  };
  const cards = p.order.map(c => CARDS[c]());
  const cols = p.layout === 'one' ? `<div class="col">${cards.join('')}</div>` : `<div class="col">${cards.slice(0, 2).join('')}</div><div class="col">${cards.slice(2).join('')}</div>`;
  paint(`<div class="write" data-accent="${p.accent}" data-font="${p.font}" data-size="${p.size}">
  <header class="head reveal"><div class="eyebrow" id="eyedate">${esc(fmtDate(d.date))} · ${esc(t('step1'))}</div><h1 id="whead">${esc(p.heading || t('newTitle'))}</h1><p>${esc(t('newP'))}</p>
    <button class="btn outline small cust-btn" data-act="cust" aria-expanded="${!!state.cust}">${esc(state.cust ? t('custDone') : t('custBtn'))}</button></header>
  ${state.cust ? custUi(p) : ''}
  <div id="otd">${otdHtml()}</div>
  <section class="card quick reveal"><div class="field-label">${esc(t('qTitle'))}</div>
    <div class="q-moods" role="radiogroup" aria-label="${esc(t('qMood'))}">${MOODS.map(m => `<button class="q-mood" role="radio" aria-checked="${state.quick === m}" data-act="q-mood" data-m="${m}">${moodFace(m)}<span>${esc(t('moodShort')[m])}</span></button>`).join('')}</div>
    <div class="q-row"><input type="text" id="qline" maxlength="200" autocomplete="off" placeholder="${esc(state.quick ? t('qPh')[state.quick] : t('qPh0'))}" aria-label="${esc(t('qLine'))}"><button class="btn primary" data-act="q-save"${state.quick ? '' : ' disabled'}>${esc(t('qSave'))}</button></div>
    <p class="small">${esc(t('qHint'))}</p>
  </section>
  <div class="formgrid${p.layout === 'one' ? ' one' : ''}">${cols}</div>
  <div class="actions reveal"><button class="btn primary xl" id="go" data-act="submit" disabled><span>${esc(t('submit'))}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg></button><button class="btn" id="go2" data-act="build" disabled>${esc(t('preview'))}</button><span class="small" id="hint"></span></div></div>`, { quiet });
  refreshForm(); if (!quiet) otdLoad();
  $('#qline').addEventListener('keydown', e => { if (e.key === 'Enter') quickSave(); });
  if (state.quick) main().dataset.mood = state.quick;
  const ta = $('#text'), wPlay = p.shapes ? playIn(main(), { count: Math.min(48, Math.max(14, Math.round(innerWidth * Math.max(innerHeight, main().scrollHeight) / 80000))), lines: 4, wide: true }) : null;   // shapes and lines fill the whole width; more shapes on bigger pages
  const tint = () => { const m = moodOf(d.text); if (m) main().dataset.mood = m; else delete main().dataset.mood; Daisy.setMood(m, !m, true); if (wPlay) wPlay.setMood(m || 'base'); };
  ta.addEventListener('input', () => { d.text = ta.value; refreshForm(); tint(); }); tint();
  const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener('input', () => fn(el.value)); };
  bind('#songurl', v => { s.url = v; refreshForm(); }); bind('#songtitle', v => s.title = v); bind('#songartist', v => s.artist = v);
  bind('#date', v => { d.date = v || todayISO(); $('#eyedate').textContent = `${fmtDate(d.date)} · ${t('step1')}`; });
  bind('#custhead', v => { $('#whead').textContent = v.trim() || t('newTitle'); setPrefs({ heading: v }, false); });
  const pf = $('#photos'); pf.addEventListener('change', () => addPhotos([...pf.files]));
  const dz = $('#drop'); ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); })); ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => addPhotos([...e.dataTransfer.files].filter(f => f.type.startsWith('image/'))));
  syncSubs($('#vmaudio'), $('.voice-box .subs'));
  const sq = $('#songq'); if (sq) { let timer = 0; sq.addEventListener('input', () => { s.q = sq.value; clearTimeout(timer); timer = setTimeout(() => songSearch(s.q), 350); }); if (s.q) songSearch(s.q); }
  if (d.video && d.video.ai && !d.video.shown) { d.video.shown = true; Motion.results($('.cam-card')); }
  const vf = $('#vidfile'); if (vf) vf.addEventListener('change', async () => { const f = vf.files[0]; if (f) useVideo(f); });
  const sf = $('#songfile'); if (sf) sf.addEventListener('change', async () => {
    const f = sf.files[0]; if (!f) return;
    if (f.size > 20 * 1024 * 1024) { toast(t('file20')); return; }
    s.file = f; s.bpm = null; s.energy = null; s.analyzing = true; if (!s.title) s.title = f.name.replace(/\.[^.]+$/, '').slice(0, 120); viewNew(true);
    const a = await analyzeAudio(f); s.analyzing = false; if (a) { s.bpm = a.bpm; s.energy = a.energy; s.tempo = tempoFromBpm(a.bpm); }
    if (location.hash === '#/new' || location.hash === '') viewNew(true);
  });
}
/* ---------- voice message: record → Whisper on the device → subtitles → words into the entry ---------- */
const clock = ms => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function voiceUi(d) {
  const v = d.voice;
  /* the speech language is the page language: choosing RU here turns the whole site Russian */
  const langSw = `<span class="small">${esc(t('voiceLang'))}</span><div class="langsw" role="group" aria-label="${esc(t('voiceLangAria'))}"><button data-act="lang" data-lang="en" aria-pressed="${LANG === 'en'}">EN</button><button data-act="lang" data-lang="ru" aria-pressed="${LANG === 'ru'}">RU</button></div>`;
  if (!v) return `<div class="row"><button class="btn outline small vm-btn" data-act="vm-rec"${Voice.supported() ? '' : ' disabled'}><i class="rec-dot" aria-hidden="true"></i>${esc(t('voiceRec'))}</button>${langSw}</div><p class="small">${esc(t('voicePrivacy'))}</p>`;
  if (v.recording) return `<button class="btn primary small vm-btn" data-act="vm-rec"><i class="rec-dot live" aria-hidden="true"></i>${esc(t('voiceStop'))} · <span id="vmtime">${clock(v.ms || 0)}</span></button><p class="small">${esc(t('voiceRecording'))}</p>`;
  const subs = (v.chunks || []).map(c => `<li data-s="${esc(c.s)}" data-e="${esc(c.e ?? '')}"><time>${clock(c.s * 1000)}</time>${esc(c.t)}</li>`).join('');
  return `<audio id="vmaudio" controls src="${esc(v.url)}"></audio>
    ${v.status ? `<p class="small vm-status">${esc(v.status)}</p>` : ''}
    ${v.chunks ? (subs ? `<div class="field-label">${esc(t('voiceSubs'))}</div><ol class="subs">${subs}</ol>` : `<p class="small">${esc(t('voiceNone'))}</p>`) : ''}
    <div class="row">${v.text ? `<button class="btn primary small" data-act="vm-insert">${esc(t('voiceInsert'))}</button>` : ''}<button class="link" data-act="vm-del">${esc(t('voiceDel'))}</button></div>
    <div class="opt"><span>${esc(t('voiceKeep'))}</span><button class="sw" role="switch" aria-label="${esc(t('voiceKeep'))}" aria-checked="${v.keep}" data-act="vm-keep"></button></div>`;
}
/** Highlights the subtitle line being spoken while the recording plays. */
function syncSubs(audio, list) {
  if (!audio || !list) return;
  const items = $$('li', list);
  audio.addEventListener('timeupdate', () => items.forEach(li => { const s = +li.dataset.s, e = li.dataset.e === '' ? Infinity : +li.dataset.e; li.classList.toggle('on', audio.currentTime >= s && audio.currentTime < e); }));
  list.addEventListener('click', e => { const li = e.target.closest('li'); if (li) { audio.currentTime = +li.dataset.s; audio.play(); } });
}
async function voiceToggle() {
  const d = state.draft;
  if (d.voice && d.voice.recording) { Voice.stop(); return; }
  d.voice = { recording: true, ms: 0, keep: true }; viewNew(true);
  let blob;
  try { blob = await Voice.start(ms => { if (d.voice) d.voice.ms = ms; const el = $('#vmtime'); if (el) el.textContent = clock(ms); }); }
  catch (e) { d.voice = null; viewNew(true); toast(t('voiceNoMic')); return; }
  if (!d.voice) return;
  d.voice = { blob, url: URL.createObjectURL(blob), keep: true, status: t('voiceLoading', 0), chunks: null, text: '' }; viewNew(true);
  try {
    const out = await Voice.transcribe(blob, st => { if (!d.voice) return; d.voice.status = st.type === 'loading' ? t('voiceLoading', st.pct) : t('voiceWorking'); const el = $('.vm-status'); if (el) el.textContent = d.voice.status; }, LANG);
    if (!d.voice || d.voice.blob !== blob) return;
    Object.assign(d.voice, { status: '', text: out.text, chunks: out.chunks });
  } catch (e) { if (d.voice) d.voice.status = t('voiceFail'); }
  if (location.hash === '#/new' || location.hash === '') viewNew(true);
}

/* ---------- one camera window: reads the face live, films the atmosphere, then shows the whole AI scan ---------- */
const MOODS4 = ['calm', 'tense', 'quiet', 'lively'];
const pct = x => Math.round((+x || 0) * 100);
function moodBars(o) {
  const top = MOODS4.slice().sort((a, b) => o[b] - o[a])[0];
  return `<div class="cam-bars">${MOODS4.map(m => `<div class="cam-bar${m === top ? ' top' : ''}" data-m="${m}" style="--v:${+o[m] || 0}"><span>${esc(t('moodShort')[m])}</span><i><u></u></i><em>${pct(o[m])}%</em></div>`).join('')}</div>`;
}
/** The full result of the AI scan: overall guess, the face over time and the atmosphere. */
function scanHtml(ai) {
  const M = t('moodShort'), f = ai.face || { seen: 0 }, sc = ai.scene || null;
  const chips = list => `<div class="row">${list.map(w => `<span class="chip">${esc(t('atmo')[w] || w)}</span>`).join('')}</div>`;
  return `<div class="scan">
    <p class="ai-guess">${esc(t('scanOverall', [M[ai.mood] || '—', pct(ai.conf)]))}</p>
    <div class="scan-grid">
      <section><div class="field-label">${esc(t('scanFace'))}</div>
        ${f.seen ? `<p class="small">${esc(t('scanFaceSeen', pct(f.seen)))}</p>
          <p class="scan-emo">${(f.emotions || []).map(([e, x]) => `<span class="chip">${esc(t('emo')[e] || e)} · ${pct(x)}%</span>`).join('')}</p>
          ${f.moods ? moodBars(f.moods) : ''}
          ${f.timeline ? `<div class="small">${esc(t('scanTimeline'))}</div><div class="timeline" aria-hidden="true">${f.timeline.map(m => `<i data-m="${m || ''}"></i>`).join('')}</div>` : ''}`
        : `<p class="small">${esc(t('scanNoFace'))}</p>`}
      </section>
      <section><div class="field-label">${esc(t('scanScene'))}</div>
        ${sc ? `<p class="small">${esc(t('scanSceneMood', [M[sc.mood] || '—', pct(sc.conf)]))}</p>${sc.scores ? moodBars(sc.scores) : ''}` : ''}
        ${chips(ai.words || [])}
        ${(ai.things || []).length ? `<div class="small">${esc(t('scanThings'))}</div>${chips(ai.things)}` : ''}
      </section>
    </div></div>`;
}
const truePills = (cur, act) => `<div class="moods vid-moods">${MOODS4.map(m => `<button class="mood-pill${cur === m ? ' on' : ''}" data-act="${act}" data-m="${m}" aria-pressed="${cur === m}"><span aria-hidden="true">${MOOD_PILL[m]}</span>${esc(t('moodShort')[m])}</button>`).join('')}</div>`;

function camCardUi(d) {
  const v = d.video, face = d.face && !v ? `<div class="row"><span class="chip face-chip" data-m="${d.face.mood}">${esc(t('camUsed', t('faceWord')[d.face.mood]))} · ${pct(d.face.conf)}%</span><button class="link" data-act="faceclear">${esc(t('camClear'))}</button></div>` : '';
  if (!v) return `<p class="small">${esc(t('cvP'))}</p>${face}<div class="row"><button class="btn outline small" data-act="camvid"${Face.supported() ? '' : ' disabled'}>${esc(t('cvOpen'))}</button><label class="btn outline small">${esc(t('vidUpload'))}<input type="file" id="vidfile" accept="video/*" hidden></label></div>`;
  const ai = v.ai;
  return `<video class="vid-prev" src="${esc(v.url)}" muted loop autoplay playsinline></video>
    ${ai ? `<p class="ai-guess">${esc(t('scanOverall', [t('moodShort')[ai.mood], pct(ai.conf)]))}</p>
      <p class="small scan-sum">${esc(ai.face && ai.face.seen ? t('scanFaceShort', [t('emo')[ai.face.emotions[0][0]] || '', pct(ai.face.seen)]) : t('scanNoFace'))}</p>
      <button class="btn outline small" data-act="scan-show">${esc(t('scanShow'))}</button>` : `<p class="small">${esc(v.status || t('cvScanning'))}</p>`}
    <div class="field-label">${esc(t('vidTrue'))}</div>${truePills(v.mood, 'vid-mood')}
    <p class="small">${esc(t('vidTrueHint'))}</p><button class="link" data-act="vid-del">${esc(t('remove'))}</button>`;
}
/** A video picked from the device: the face and the atmosphere are both read from the file. */
async function useVideo(blob, ai) {
  const d = state.draft;
  if (blob.size > 40 * 1024 * 1024) { toast(t('vidTooBig')); return; }
  if (!ai) try { if (await Atmo.duration(blob) > Atmo.MAX_S + .5) { toast(t('vidTooLong')); return; } } catch (e) { console.error('video', e); toast(`${t('vidFail')}: ${(e && e.message) || ''}`); return; }
  if (d.video) URL.revokeObjectURL(d.video.url);
  d.video = { blob, url: URL.createObjectURL(blob), ai: ai || null, mood: null }; viewNew(true);
  if (!ai) { try { const a = await Atmo.analyze(blob); if (d.video && d.video.blob === blob) d.video.ai = a; } catch (e) { console.error('scan', e); if (d.video) d.video.status = `${t('vidFail')}: ${(e && e.message) || ''}`; } }
  if (d.video && d.video.ai && d.video.ai.face.seen > .2) d.face = { mood: d.video.ai.face.mood, conf: d.video.ai.face.conf };
  if (location.hash === '#/new' || location.hash === '') viewNew(true);
}

let camOpen = false;
function openCamVideo() {
  if (!Face.supported()) { toast(t('camNo')); return; }
  const el = document.createElement('div'); el.className = 'cam'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', t('cvTitle'));
  document.body.appendChild(el); camOpen = true;
  let stream = null, facing = 'user', last = null, rec = null;
  const stopStream = () => { Face.stop(); if (stream) stream.getTracks().forEach(x => x.stop()); stream = null; };

  function live() {
    el.innerHTML = `<div class="cam-box">
      <div class="cam-stage${facing === 'user' ? '' : ' back'}"><video playsinline muted></video><canvas></canvas><div class="cam-pill">${esc(t('camLoading'))}</div>
        <div class="rec-badge" hidden><i class="rec-dot live" aria-hidden="true"></i><span>0:00 / 0:${Atmo.MAX_S}</span></div></div>
      <aside class="cam-side">
        <div class="eyebrow">${esc(t('camLive'))}</div>
        <div class="cam-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="bg"/><circle cx="60" cy="60" r="52" class="fg"/></svg><b>–</b><span>${esc(t('camSure'))}</span></div>
        ${moodBars({ calm: 0, tense: 0, quiet: 0, lively: 0 })}
        <button class="btn primary" data-act="cv-rec"${Atmo.supported() ? '' : ' disabled'}><i class="rec-dot" aria-hidden="true"></i>${esc(t('cvRec'))}</button>
        <button class="btn outline" data-act="camuse" disabled>${esc(t('camUse'))}</button>
        <div class="row cam-tools"><button class="btn small" data-act="cv-flip">${esc(t('cvFlip'))}</button><button class="btn small" data-act="camphoto" disabled>${esc(t('camPhoto'))}</button><button class="btn small" data-act="camcalib">${esc(t('camReset'))}</button></div>
        <button class="btn" data-act="camclose">${esc(t('camOff'))}</button>
        <p class="small">${esc(t('cvPrivacy'))}</p>
      </aside></div>`;
    requestAnimationFrame(() => el.classList.add('open'));
    const video = $('video', el), canvas = $('canvas', el), pill = $('.cam-pill', el), ring = $('.cam-ring', el);
    const onFrame = f => {
      $('[data-act=camphoto]', el).disabled = false;
      if (rec) { rec.frames++; if (f.face && !f.calibrating) rec.samples.push({ t: (performance.now() - rec.t0) / 1000, r: f.raw, emotion: f.emotion }); }
      if (!f.face) { pill.textContent = t(facing === 'user' ? 'camNoFace' : 'cvNoFaceBack'); pill.dataset.m = ''; $('[data-act=camuse]', el).disabled = true; last = null; return; }
      if (f.calibrating) { pill.textContent = `${t('camCalib')} ${Math.round(f.progress * 100)}%`; pill.dataset.m = ''; return; }
      last = f; pill.textContent = f.steady ? t('camLooks', t('emo')[f.emotion] || t('faceWord')[f.top]) : t('camHold'); pill.dataset.m = f.steady ? f.top : '';
      $('[data-act=camuse]', el).disabled = !f.steady || !!rec;
      $('b', ring).textContent = pct(f.conf) + '%'; ring.style.setProperty('--p', f.conf); ring.dataset.m = f.top;
      $$('.cam-bar', el).forEach(b => { const v = f.moods[b.dataset.m]; b.style.setProperty('--v', v); $('em', b).textContent = pct(v) + '%'; b.classList.toggle('top', b.dataset.m === f.top); });
    };
    const want = audio => navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio });
    (async () => {
      /* camera and microphone; if the microphone is blocked or missing, the camera alone still works (video without sound) */
      try { stream = await want(true); }
      catch (e) {
        try { stream = await want(false); toast(t('cvNoMic')); }
        catch (e2) { pill.textContent = e2 && e2.name === 'NotAllowedError' ? t('camDenied') : t('camFail'); console.error('camera', e2); return; }
      }
      if (!el.isConnected) { stopStream(); return; }
      try { await Face.start(video, canvas, onFrame, stream); } catch (e) { pill.textContent = t('camFail'); }
    })();
  }

  async function record() {
    if (rec) { Atmo.stop(); return; }
    if (!stream) return;
    rec = { t0: performance.now(), frames: 0, samples: [] };
    const btn = $('[data-act=cv-rec]', el), badge = $('.rec-badge', el);
    btn.innerHTML = `<i class="rec-dot live" aria-hidden="true"></i>${esc(t('vidStopRec'))}`; badge.hidden = false;
    $$('[data-act=cv-flip],[data-act=camuse],[data-act=camcalib]', el).forEach(b => { b.disabled = true; });
    let blob;
    try { blob = await Atmo.record(stream, sec => { $('span', badge).textContent = `${clock(sec * 1000)} / 0:${Atmo.MAX_S}`; }); }
    catch (e) { console.error('recording', e); rec = null; toast(t('cvRecFail')); stopStream(); live(); return; }
    const dur = (performance.now() - rec.t0) / 1000, face = Face.summarize(rec.samples, rec.frames, dur);
    rec = null; stopStream();
    if (!blob.size) { toast(t('cvRecFail')); live(); return; }
    scan(blob, face, dur);
  }

  async function scan(blob, face, dur) {
    const url = URL.createObjectURL(blob);
    el.innerHTML = `<div class="cam-box scan-box"><div class="cam-stage back"><video src="${esc(url)}" playsinline muted loop autoplay></video></div>
      <aside class="cam-side"><div class="eyebrow">${esc(t('scanTitle'))}</div><div class="scan-out"><p class="small">${esc(t('cvScanning'))}</p><div class="loader-dot" aria-hidden="true"></div></div></aside></div>`;
    let ai;
    try { ai = await Atmo.analyze(blob, face, dur); }
    catch (e) { console.error('scan', e); if (el.isConnected) $('.scan-out', el).innerHTML = `<p class="small">${esc(t('vidFail'))}: ${esc(e && e.message || '')}</p><button class="btn" data-act="cv-again">${esc(t('cvAgain'))}</button>`; return; }
    if (!el.isConnected) { URL.revokeObjectURL(url); return; }
    el._mood = null;
    $('.cam-side', el).innerHTML = `<div class="eyebrow">${esc(t('scanTitle'))}</div>${scanHtml(ai)}
      <div class="field-label">${esc(t('vidTrue'))}</div><div class="cv-pick">${truePills(null, 'cv-mood')}</div><p class="small">${esc(t('vidTrueHint'))}</p>
      <button class="btn primary" data-act="cv-use">${esc(t('cvUse'))}</button><div class="row cam-tools"><button class="btn small" data-act="cv-again">${esc(t('cvAgain'))}</button><button class="btn small" data-act="camclose">${esc(t('camOff'))}</button></div>`;
    Motion.results($('.cam-side', el));
    Daisy.say(t('daisy').scanDone, 4200);
    el._pickMood = m => { el._mood = m; $('.cv-pick', el).innerHTML = truePills(m, 'cv-mood'); Daisy.setMood(m); };
    el._useVideo = () => { URL.revokeObjectURL(url); closeCamera(false); useVideo(blob, ai).then(() => { if (state.draft.video) { state.draft.video.mood = el._mood; viewNew(true); } }); };
  }

  el._rec = record;
  el._flip = () => { if (rec) return; facing = facing === 'user' ? 'environment' : 'user'; stopStream(); live(); };
  el._again = () => { stopStream(); live(); };
  el._use = () => { if (!last || !last.steady) return; state.draft.face = { mood: last.top, conf: last.conf }; closeCamera(); Daisy.setMood(last.top); };
  el._photo = () => { if (state.draft.photos.length >= 8) { toast(t('max8')); return; } state.draft.photos.push(Face.snapshot($('video', el))); toast(t('camAdded')); };
  el._close = () => { if (rec) { Atmo.stop(); rec = null; } stopStream(); el.remove(); camOpen = false; };
  live();
}
function closeCamera(rerender = true) {
  const el = $('.cam'); if (el && el._close) el._close(); camOpen = false;
  if (rerender && (location.hash === '#/new' || location.hash === '')) viewNew(true);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && camOpen) closeCamera(); });

/* ---------- song search by name (Apple Music / iTunes) ---------- */
async function songSearch(q) {
  const box = $('#songres'); if (!box) return;
  if (q.trim().length < 2) { box.innerHTML = ''; return; }
  box.innerHTML = `<p class="small">${esc(t('songSearching'))}</p>`;
  let songs = [];
  try { songs = (await api('GET', '/api/music/search?q=' + encodeURIComponent(q.trim()))).songs; } catch (e) { box.innerHTML = `<p class="small">${esc(e.message)}</p>`; return; }
  if ($('#songq') && $('#songq').value.trim() !== q.trim()) return;   // a newer search is on its way
  state.songs = songs;
  box.innerHTML = songs.length ? songs.map((x, i) => `<div class="song-row">
      <button class="play sq-play" data-act="sq-play" data-i="${i}" aria-label="${esc(t('songPreview'))}">${PLAY_SVG}</button>
      ${x.cover ? `<img src="${esc(x.cover)}" alt="" loading="lazy">` : '<i class="cover-empty"></i>'}
      <div class="meta"><b>${esc(x.title)}</b><span>${esc(x.artist)}${x.year ? ' · ' + esc(x.year) : ''}</span></div>
      <button class="btn small outline" data-act="sq-pick" data-i="${i}">${esc(t('songChoose'))}</button></div>`).join('') : `<p class="small">${esc(t('songNone'))}</p>`;
}
async function songPick(x) {
  const s = state.draft.song;
  if (player.preview) { player.preview.pause(); player.preview = null; }
  Object.assign(s, { picked: x, url: x.preview, title: x.title, artist: x.artist, bpm: null, energy: null, analyzing: true }); viewNew(true);
  try {   /* tempo and energy are measured from the 30-second preview */
    const r = await fetch('/api/music/preview?u=' + encodeURIComponent(x.preview), { credentials: 'same-origin' });
    if (r.ok) { const a = await analyzeAudio(await r.blob()); if (a && s.picked === x) { s.bpm = a.bpm; s.energy = a.energy; s.tempo = tempoFromBpm(a.bpm); } }
  } catch (e) { /* the tempo stays medium */ }
  s.analyzing = false; if (location.hash === '#/new' || location.hash === '') viewNew(true);
}

function refreshForm() {
  const d = state.draft, miss = []; if (!d.text.trim()) miss.push(t('missEntry')); if (d.video && !d.video.mood) miss.push(t('missVideoMood')); if (d.song.tab === 'link' && d.song.url.trim() && !validLink(d.song.url)) miss.push(t('missLink'));
  [$('#go'), $('#go2')].forEach(go => { if (go) go.disabled = miss.length > 0 || d.song.analyzing; }); const h = $('#hint'); if (h) h.textContent = miss.length ? t('needAdd', miss.join(', ')) : t('canChange');
}
async function addPhotos(files) {
  const room = 8 - state.draft.photos.length; if (files.length > room) toast(t('max8'));
  for (const f of files.slice(0, Math.max(0, room))) { try { state.draft.photos.push(await shrinkPhoto(f)); } catch (e) { toast(t('badPhoto')); } }
  viewNew(true);
}
async function optToggle(k) {
  const d = state.draft;
  if (k === 'weatherOn' || k === 'geoOn') {
    if (!d[k]) {
      if (!navigator.geolocation) { toast(t('noGeo')); return; }
      try {
        const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 }));
        d.geo = { lat: +pos.coords.latitude.toFixed(2), lon: +pos.coords.longitude.toFixed(2) };
        if (k === 'weatherOn') d.weather = await fetchWeather(d.geo.lat, d.geo.lon);
        d[k] = true;
      } catch (e) { toast(t('geoFail')); d[k] = false; }
    } else d[k] = false;
  } else d[k] = !d[k];
  viewNew(true);
}

/* ---------- screen 2: what we heard ---------- */
function viewAnalysis() {
  if (!state.result) { location.hash = '#/new'; return; }
  const day = localizeDay(state.result), X = TX();
  const T = day.textInfo, P = day.photoInfo, S = day.song, st = day.style;
  const chips = a => a.map(x => `<span class="chip">${esc(x)}</span>`).join('') || `<span class="small">${esc(t('nothing'))}</span>`;
  const place = p => LANG === 'en' && EN_PLACE[p.nom] ? EN_PLACE[p.nom][0] : p.nom;
  const tChips = [].concat(T.season ? [X.season[T.season]] : [], T.time ? [LANG === 'en' ? EN_TIME[T.time.canon] : T.time.canon] : [], T.places.map(place), T.people.map(p => word(p)), [...new Set([].concat(...Object.values(T.words)))].map(w => word(w)));
  const mChips = [S.artist, S.title, t('tempoWord', X.tempo[S.tempo]), X.mode[S.mode]].filter(Boolean).concat(S.bpm ? [`≈${S.bpm} bpm`] : []);
  const wChips = day.weather ? [weatherKind(day.weather.kind), `${day.weather.temp}°`] : [];
  paint(`
  <header class="head reveal"><div class="eyebrow">${esc(t('step2'))}</div><h1>${esc(t('heardTitle'))}</h1><p>${esc(t('heardP'))}</p></header>
  <div class="three">
    <section class="card reveal"><h3>${esc(t('text'))}</h3><div class="row">${chips(tChips)}</div></section>
    <section class="card reveal"><h3>${esc(t('photo'))}</h3><div class="swatches">${P.colors.map(c => `<i style="background:${esc(c)}" title="${esc(c)}"></i>`).join('')}</div><p class="small" style="font-size:15px;color:var(--body)">${esc(t('brightness', P.brightness < .35 ? t('darkShots') : P.brightness > .65 ? t('lightShots') : t('mid')))} ${esc(t('frames', P.count))}</p></section>
    <section class="card reveal"><h3>${esc(t('music'))}</h3><div class="row">${chips(mChips)}</div>${wChips.length ? `<div class="field-label" style="margin-top:6px">${esc(t('weather'))}</div><div class="row">${chips(wChips)}</div>` : ''}</section>
  </div>
  <section class="dec reveal"><h3>${esc(t('howDesign'))}</h3>${st.rows.map(r => `<div class="rule reveal"><span class="k">${esc(r.k)}</span><b>${esc(r.v)}</b><span class="w">${esc(r.why)}</span></div>`).join('')}</section>
  <div class="actions reveal"><a class="btn primary" href="#/result">${esc(t('showMemory'))}</a><a class="btn" href="#/new">${esc(t('editDay'))}</a></div>`);
}

/* ---------- screens 3 and 4: the memory ---------- */
function memoryScreen(raw, saved) {
  const day = localizeDay(raw), st = day.style, s = day.song, k = linkKind(s.url), canPlay = !!songSrc(s);
  const reasons = st.rows.slice(0, 3).map(r => r.why).concat([t('sameFrame')]);
  paint(`
  <header class="head reveal" style="margin-bottom:24px"><div class="eyebrow">${esc(saved ? t('memOfDay') : t('step3'))}</div></header>
  <div class="result">
    <div class="tilt" data-tilt>${cardHtml(day)}</div>
    <div class="stack">
      <div class="head reveal" style="margin:0"><div class="eyebrow">${esc(t('folder'))}</div><h2 class="folder">${esc(st.title)}</h2></div>
      <div class="player reveal"><button class="play" data-act="song" data-state="paused" aria-label="${esc(t('playSong'))}"${canPlay ? '' : ' disabled style="opacity:.35"'}>${PLAY_SVG}</button>
        <div class="pbody"><div class="ptitle"><b>${esc(s.artist || s.title || t('songWord'))}</b><span class="eyebrow">${esc(canPlay ? t('inMemory') : k.kind === 'embed' ? t('inEmbed') : k.kind === 'link' ? t('byLink') : t('noMusic'))}</span></div>
        ${canPlay ? '<div class="bar"><i id="songbar"></i></div>' : ''}
        ${k.kind === 'embed' ? `<iframe src="${esc(k.src)}" height="${k.h}" style="border:0;width:100%;border-radius:4px" allow="autoplay; encrypted-media" title="${esc(t('songWord'))}" referrerpolicy="no-referrer"></iframe>` : ''}
        ${k.kind === 'link' ? `<a class="link" href="${esc(k.src)}" target="_blank" rel="noopener noreferrer">${esc(t('openSong'))}</a>` : ''}</div></div>
      <div class="player reveal"><button class="play" data-act="voice" data-state="paused" aria-label="${esc(t('listen'))}">${PLAY_SVG}</button>
        <div class="pbody"><div class="ptitle"><b>${esc(t('voiceReading'))}</b><span class="eyebrow">${esc(t('voiceOf', st.voice.label))}</span></div><div class="wave">${waveHtml(day)}</div></div></div>
      <div class="why reveal"><div class="eyebrow" style="margin-bottom:2px">${esc(t('whyLooks'))}</div>${reasons.map(r => `<p>${esc(r)}</p>`).join('')}</div>
      <div class="actions reveal" style="margin:0">${saved ? `<a class="btn primary" href="#/day/${esc(day.id)}">${esc(t('openFolder'))}</a><a class="btn" href="#/archive">${esc(t('toArchive'))}</a>` : `<button class="btn primary" data-act="save">${esc(t('saveDiary'))}</button><button class="btn" data-act="rebuild">${esc(t('rebuild'))}</button>`}</div>
    </div>
  </div>`);
}
const ID_RE = /^[a-f0-9]{24}$/;   // day ids from the address bar go into API paths, so check them first
async function viewDay(id) {
  let raw; try { if (!ID_RE.test(id)) throw 0; raw = (await api('GET', `/api/days/${id}`)).day; } catch (e) { paint(`<div class="empty"><h3>${esc(t('noDay'))}</h3><a class="btn" href="#/archive">${esc(t('archive'))}</a></div>`); return; }
  const day = localizeDay(raw);
  main().dataset.day = id; main()._day = day;
  const s = day.song, k = linkKind(s.url), canPlay = !!songSrc(s);
  const row = (label, body, act) => `<div class="frow reveal"><span class="k">${esc(label)}</span><div>${body}</div>${act}</div>`;
  const open = (a, x = t('open')) => `<button class="link" data-act="${a}">${esc(x)}</button>`;
  paint(`
  <header class="head reveal"><div class="eyebrow"><a href="#/archive" style="text-decoration:underline">${esc(t('archive'))}</a> / ${esc(day.style.title)}</div><h1>${esc(day.style.title)}</h1><p>${esc(fmtDate(day.date))} · ${esc(t('filesInFolder', 2 + day.photos.length + (s.title || s.artist || s.url || s.audioUrl ? 1 : 0)))}${day.weather ? ` · ${esc(weatherKind(day.weather.kind))}, ${esc(day.weather.temp)}°` : ''}</p></header>
  <div class="folderhead"><a href="#/memory/${esc(day.id)}" aria-label="${esc(t('openMemory'))}" class="tilt" data-tilt>${cardHtml(day)}</a>
    <div class="files">
      ${row(t('entryRow'), `<span>${esc(day.text)}</span>`, open('f-text'))}
      ${day.photos.length ? row(t('photosRow'), `<div class="mini-ph">${day.photos.slice(0, 4).map(p => `<img src="${esc(p)}" alt="">`).join('')}</div>`, open('f-photos')) : ''}
      ${s.title || s.artist || s.url || s.audioUrl ? row(t('songRow'), `<b style="font-weight:600">${esc(s.artist || s.title || t('songWord'))}</b> <span class="small">${esc(s.audioUrl ? t('audioFile') : s.url ? t('serviceLink') : t('noLink'))}</span>`, canPlay ? open('f-song', t('listenBtn')) : (k.kind !== 'none' ? `<a class="link" href="${esc(k.src || s.url)}" target="_blank" rel="noopener noreferrer">${esc(t('open'))}</a>` : '<span></span>')) : ''}
      ${row(t('memoryRow'), `<span>${esc(t('readyDesign'))}</span>`, `<a class="link" href="#/memory/${esc(day.id)}">${esc(t('open'))}</a>`)}
      ${row(t('voiceRow'), `<span>${esc(t('voiceIs', day.style.voice.label))}</span>`, open('f-voice', t('listenBtn')))}
      ${day.voiceUrl ? row(t('voiceMsg'), `<span>${esc((day.textInfo.voice || []).map(c => c.t).join(' ').slice(0, 140) || '—')}</span>`, open('f-vm', t('listenBtn'))) : ''}
      ${day.videoUrl ? row(t('videoRow'), `<span>${esc(day.textInfo.video ? t('moodShort')[day.textInfo.video.mood] : '')}</span>`, open('f-video')) : ''}
    </div>
  </div>
  <div class="opt share-box card reveal"><span><b>${esc(t('shareTitle'))}</b><span class="small">${esc(t('shareNote'))}</span></span><button class="sw" role="switch" aria-checked="${!!raw.shared}" aria-label="${esc(t('shareTitle'))}" data-act="share"></button></div>
  <div class="actions reveal"><button class="btn small" data-act="delete">${esc(t('deleteDay'))}</button></div>`);
}
async function viewMemory(id) {
  let day; try { if (!ID_RE.test(id)) throw 0; day = (await api('GET', `/api/days/${id}`)).day; } catch (e) { location.hash = '#/archive'; return; }
  main().dataset.day = id; main()._day = day; memoryScreen(day, true);
}

/* ---------- screen 5: archive, screen 6: ribbon check ---------- */
async function viewArchive() {
  const { days: raw } = await api('GET', '/api/days'), days = raw.map(localizeDay);
  const F = [['all', t('fAll')], ['calm', t('fCalm')], ['tense', t('fTense')], ['quiet', t('fQuiet')], ['lively', t('fLively')]];
  const list = days.filter(d => state.filter === 'all' || d.style.mood === state.filter);
  paint(`
  <header class="head reveal"><div class="eyebrow">${esc(t('diaryDays', days.length))}</div><h1>${esc(t('allDays'))}</h1><p>${esc(t('allDaysP'))}</p></header>
  <div class="row reveal" style="margin-bottom:24px">${F.map(([v, x]) => `<button class="pill${state.filter === v ? ' on' : ''}${v === 'all' ? '' : ' mood-pill'}" data-act="filter" data-v="${v}" data-m="${v}">${MOOD_PILL[v] ? `<span aria-hidden="true">${MOOD_PILL[v]}</span>` : ''}${esc(x)}</button>`).join('')}</div>
  ${days.length ? `<div class="grid">${list.map(d => `<a class="tile reveal tilt" data-tilt data-id="${esc(d.id)}" href="#/day/${esc(d.id)}" aria-label="${esc(d.style.title)}">${cardHtml(d)}</a>`).join('')}</div>${list.length ? '' : `<p class="muted">${esc(t('noneInCat'))}</p>`}`
    : `<div class="empty reveal"><h3>${esc(t('emptyDiary'))}</h3><p class="muted">${esc(t('emptyP'))}</p><div class="row"><a class="btn primary" href="#/new">${esc(t('navNew'))}</a><button class="btn" data-act="demo">${esc(t('loadDemo'))}</button></div></div>`}`);
}
async function viewRibbon() {
  const { days } = await api('GET', '/api/days'), six = days.slice(0, 6).map(localizeDay);
  paint(`
  <header class="head reveal"><div class="eyebrow">${esc(t('ribbon'))}</div><h1>${esc(t('sixDays'))}</h1><p>${esc(t('sixP'))}</p></header>
  ${six.length >= 5 ? `<div class="ribbon">${six.map(d => `<a class="tile reveal" href="#/day/${esc(d.id)}" aria-label="${esc(d.style.title)}">${cardHtml(d, { mini: true })}</a>`).join('')}</div>`
    : `<div class="empty reveal" style="margin-bottom:32px"><p class="muted">${esc(t('needFive', six.length))}</p><button class="btn" data-act="demo">${esc(t('loadDemo'))}</button></div>`}
  <div class="three">
    <section class="card reveal"><h3>${esc(t('same'))}</h3><p style="color:var(--body);font-size:15px">${esc(t('sameP'))}</p></section>
    <section class="card reveal"><h3>${esc(t('diff'))}</h3><p style="color:var(--body);font-size:15px">${esc(t('diffP'))}</p></section>
    <section class="card reveal"><h3>${esc(t('check'))}</h3><p style="color:var(--body);font-size:15px">${esc(t('checkP'))}</p></section>
  </div>`);
}

async function loadDemo(thenArchive) {
  busy(true, t('buildingDemo'));
  try {
    const demo = demoDays();
    for (const [i, x] of demo.entries()) {
      busy(true, t('demoN', [i + 1, demo.length]));
      const photos = await Promise.all(DEMO_IMG[i].map(async u => shrinkPhoto(await (await fetch(u)).blob())));
      const file = new File([synthSongBlob(x.song, hash(x.date))], 'demo.wav', { type: 'audio/wav' });
      await saveDay(await buildDay({ text: x.text, photos, song: { ...x.song, url: '', file, bpm: x.song.tempo === 'slow' ? 72 : x.song.tempo === 'fast' ? 138 : 104, tempoSet: true }, voiceOn: true, dateOn: true, date: x.date, weatherOn: false, geoOn: false }));
    }
  } catch (e) { fail(e); } finally { busy(false); }
  if (thenArchive && location.hash !== '#/archive') location.hash = '#/archive'; else render();
}

/* ---------- face camera: live video with the face mesh, a prompt on top and live mood bars on the side ---------- */
/* ---------- admin: review entries, fix moods and titles, edit mood texts and the word guard ---------- */
async function viewAdmin() {
  if (!me.user || !me.user.admin) { location.hash = '#/new'; return; }
  const [{ days }, conf] = await Promise.all([api('GET', '/api/admin/days'), api('GET', '/api/admin/settings')]);
  const flagged = days.filter(d => d.flags && d.flags.length);
  const moods = ['calm', 'tense', 'quiet', 'lively'];
  const item = d => `<article class="adm-day card${d.flags.length ? ' flagged' : ''}" data-id="${esc(d.id)}">
    <div class="adm-meta"><span class="eyebrow">${esc(fmtDate(d.date))} · ${esc(d.author === 'guest' ? t('guestName') : d.author)}</span>${d.flags.length ? `<span class="adm-flag">${esc(t('admFlags', d.flags.join(', ')))}</span>` : ''}</div>
    <div class="adm-grid">
      <label class="field"><span class="field-label">${esc(t('admMood'))}</span><select name="mood">${moods.map(m => `<option value="${m}"${d.mood === m ? ' selected' : ''}>${esc(t('moodShort')[m])}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">${esc(t('admTitleF'))}</span><input type="text" name="title" maxlength="80" value="${esc(d.style.title)}"></label>
    </div>
    <label class="field"><span class="field-label">${esc(t('admText'))}</span><textarea name="text" maxlength="5000" rows="3">${esc(d.text)}</textarea></label>
    <div class="row"><button class="btn primary small" data-act="admsave">${esc(t('admSave'))}</button>${d.flags.length ? `<button class="btn outline small" data-act="admok">${esc(t('admOk'))}</button>` : ''}${d.shared ? `<button class="btn outline small" data-act="admunshare">${esc(t('admUnshare'))}</button>` : ''}<button class="btn small danger" data-act="admdel">${esc(t('admDelete'))}</button></div>
  </article>`;
  const mt = conf.moods || {}, field = (lang, m, f) => esc((mt[lang] && mt[lang][m] && mt[lang][m][f]) || '');
  paint(`
  <header class="head reveal"><div class="eyebrow">${esc(t('navAdmin'))}</div><h1>${esc(t('admTitle'))}</h1><p>${esc(t('admP'))}</p></header>
  <section class="adm-sec reveal"><h2 class="t-h3">${esc(t('admFlagged'))} <span class="muted">${flagged.length}</span></h2>${flagged.length ? flagged.map(item).join('') : `<p class="muted">${esc(t('admNoFlag'))}</p>`}</section>
  <section class="adm-sec reveal"><h2 class="t-h3">${esc(t('admMoodTexts'))}</h2><p class="small">${esc(t('admMoodTextsP'))}</p>
    <form id="admtexts" class="adm-texts">${moods.map(m => `<fieldset><legend><i class="dot" data-m="${m}"></i>${esc(t('moodShort')[m])}</legend>${['en', 'ru'].map(lang => `<div class="adm-lang"><b>${lang.toUpperCase()}</b>
      <input type="text" name="${lang}.${m}.name" maxlength="60" placeholder="${esc(t('admName'))}" value="${field(lang, m, 'name')}">
      <input type="text" name="${lang}.${m}.label" maxlength="120" placeholder="${esc(t('admLabel'))}" value="${field(lang, m, 'label')}">
</div>`).join('')}</fieldset>`).join('')}
    <h2 class="t-h3" style="margin-top:12px">${esc(t('admWords'))}</h2><p class="small">${esc(t('admWordsP', conf.builtIn.block))}</p>
    <div class="adm-grid"><label class="field"><span class="field-label">${esc(t('admBlock'))}</span><textarea name="block" rows="5">${esc((conf.words.block || []).join('\n'))}</textarea></label>
      <label class="field"><span class="field-label">${esc(t('admFlag'))}</span><textarea name="flag" rows="5">${esc((conf.words.flag || []).join('\n'))}</textarea></label></div>
    <div class="row"><button class="btn primary" type="submit">${esc(t('admSaveAll'))}</button></div></form></section>
  <section class="adm-sec reveal"><h2 class="t-h3">${esc(t('admAll'))} <span class="muted">${days.length}</span></h2>${days.length ? days.filter(d => !d.flags.length).map(item).join('') : `<p class="muted">${esc(t('admEmpty'))}</p>`}</section>`);
  main()._adminDays = new Map(days.map(d => [d.id, d]));
}
async function adminSave(card, extra = {}) {
  const d = main()._adminDays.get(card.dataset.id); if (!d) return;
  const mood = $('[name=mood]', card).value, title = $('[name=title]', card).value.trim(), text = $('[name=text]', card).value.trim();
  /* a new mood means a new design: rebuild the style with the mood fixed, keep a hand-written title */
  let style = d.style;
  if (mood !== d.mood) style = decide({ textInfo: d.textInfo, photoInfo: d.photoInfo, song: d.song, weather: d.weather, date: d.dateOn ? d.date : null, forceMood: mood }, LANG);
  if (title && title !== d.style.title) style = { ...style, title, titleLocked: true }; else if (d.style.titleLocked) style = { ...style, title: d.style.title, titleLocked: true };
  await api('PATCH', `/api/admin/days/${d.id}`, { text, style, ...extra });
  toast(t('admSaved')); viewAdmin();
}

/** Light/dark switch: the new theme spreads as a circle from the button that was tapped. */
function switchTheme(btn) {
  const next = theme() === 'dark' ? 'light' : 'dark';
  if (!document.startViewTransition || Motion.reduced()) { setTheme(next); return; }
  const r = btn.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const root = document.documentElement; root.classList.add('theme-vt');
  const vt = document.startViewTransition(() => setTheme(next));
  vt.ready.then(() => root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
    { duration: 650, easing: 'cubic-bezier(.25,.1,.3,1)', pseudoElement: '::view-transition-new(root)' })).catch(() => {});
  vt.finished.finally(() => root.classList.remove('theme-vt'));
}

/* ---------- mood faces: small drawn emoji (our own, not a system font), one per mood ---------- */
const MOOD_FACE = {
  calm: '<path d="M12 18.5q3 3 6 0M22 18.5q3 3 6 0" stroke-width="2.4"/><path d="M14 25q6 5 12 0" stroke-width="2.4"/>',
  tense: '<path d="M11.5 14.5l6-2M28.5 14.5l-6-2" stroke-width="2.2"/><circle cx="15" cy="19" r="2.2" class="f"/><circle cx="25" cy="19" r="2.2" class="f"/><path d="M13 27.5l3-2 3 2 3-2 3 2 2-1.3" stroke-width="2.2"/>',
  quiet: '<path d="M11.5 19h6.5M22 19h6.5" stroke-width="2.4"/><path d="M17 26q3 1.6 6 0" stroke-width="2.2"/><path d="M31 8c2 3 3 4.4 3 5.6a3 3 0 0 1-6 0c0-1.2 1-2.6 3-5.6z" class="drop"/>',
  lively: '<path d="M15 14.5l1.2 2.8 2.8 1.2-2.8 1.2-1.2 2.8-1.2-2.8-2.8-1.2 2.8-1.2zM25 14.5l1.2 2.8 2.8 1.2-2.8 1.2-1.2 2.8-1.2-2.8-2.8-1.2 2.8-1.2z" class="f"/><path d="M12.5 24h15q0 7.5-7.5 7.5T12.5 24z" class="f"/><path d="M16.5 29q3.5-2.4 7 0q-1.4 2.4-3.5 2.4t-3.5-2.4z" class="tongue"/>'
};
const moodFace = m => MOOD_FACE[m] ? `<svg class="face" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" class="skin"/><g class="cheek"><circle cx="9.5" cy="23" r="1.3"/><circle cx="12.5" cy="23" r="1.3"/><circle cx="11" cy="25.4" r="1.3"/><circle cx="27.5" cy="23" r="1.3"/><circle cx="30.5" cy="23" r="1.3"/><circle cx="29" cy="25.4" r="1.3"/></g><g class="ink">${MOOD_FACE[m]}</g></svg>` : '';
const MOODS = ['calm', 'tense', 'quiet', 'lively'];
const monthName = (y, m) => cap(new Intl.DateTimeFormat(LANG === 'ru' ? 'ru-RU' : 'en-GB', { month: 'long' }).format(new Date(y, m, 15)));
const isoOf = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const wordsIn = s => (String(s || '').match(/[\p{L}\p{N}’'-]+/gu) || []).length;

/* ---------- profile: nickname, picture, settings, account ---------- */
function avatarHtml(cls = 'ava') {
  const u = me.user || {}, letter = esc((displayName()[0] || '?').toUpperCase());
  return u.avatar ? `<span class="${cls}"><img src="${esc(u.avatar)}" alt=""></span>` : `<span class="${cls} none" aria-hidden="true">${letter}</span>`;
}
function dockAvatar() { const el = $('#dockava'); if (el) el.innerHTML = me.user ? avatarHtml('ava dock-ava') : ''; }
/** Cuts the middle square of a picture and makes it 256×256 JPEG. */
async function squarePic(file) {
  const url = URL.createObjectURL(file);
  try {
    const im = await loadImage(url), s = Math.min(im.width, im.height), c = document.createElement('canvas'); c.width = c.height = 256;
    c.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, 256, 256); return c.toDataURL('image/jpeg', .85);
  } finally { URL.revokeObjectURL(url); }
}
async function viewProfile() {
  const { days: raw } = await api('GET', '/api/days'), days = raw.map(localizeDay), p = prefs(), u = me.user;
  const words = days.reduce((n, d) => n + wordsIn(d.text), 0), photos = days.reduce((n, d) => n + (d.photos || []).length, 0);
  const sw = (on, act, label) => `<button class="sw" role="switch" aria-label="${esc(label)}" aria-checked="${on}" data-act="${act}"></button>`;
  const seg = (act, cur, items) => `<div class="row">${items.map(([v, x]) => `<button class="pill${cur === v ? ' on' : ''}" data-act="${act}" data-v="${v}" aria-pressed="${cur === v}">${esc(x)}</button>`).join('')}</div>`;
  paint(`
  <header class="head reveal"><div class="eyebrow">${esc(t('profile'))}</div>
    <div class="ava-edit">${avatarHtml('ava ava-xl')}<label class="ava-btn" aria-label="${esc(t('pfpChange'))}"><input type="file" id="pfp" accept="image/*" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></label></div>
    <h1 id="pname">${esc(displayName())}</h1><p>${esc(u.guest ? t('guestNote') : u.email || '')}</p>
  </header>
  <div class="prof-stats reveal">${[[days.length, t('stDays')], [words, t('stWords')], [photos, t('stPhotos')]].map(([n, x]) => `<div><b class="cnt" data-n="${n}">${n}</b><span>${esc(x)}</span></div>`).join('')}</div>
  <div class="prof-grid">
    <section class="card reveal"><div class="field-label">${esc(t('pfTitle'))}</div>
      <label class="small" for="nick">${esc(t('nick'))}</label>
      <input type="text" id="nick" maxlength="40" autocomplete="nickname" value="${esc(u.name || '')}" placeholder="${esc(displayName())}">
      <p class="small">${esc(t('nickHint'))}</p>
      <div class="row"><button class="btn primary small" data-act="pf-save">${esc(t('pfSave'))}</button>${u.avatar ? `<button class="link" data-act="pf-unpic">${esc(t('pfpRemove'))}</button>` : ''}</div>
    </section>
    <section class="card reveal"><div class="field-label">${esc(t('settings'))}</div>
      <div class="small">${esc(t('setTheme'))}</div>${seg('pf-theme', theme(), [['light', t('themeLight')], ['dark', t('themeDark')]])}
      <div class="small">${esc(t('setLang'))}</div><div class="row"><button class="pill${LANG === 'en' ? ' on' : ''}" data-act="lang" data-lang="en">English</button><button class="pill${LANG === 'ru' ? ' on' : ''}" data-act="lang" data-lang="ru">Русский</button></div>
      <div class="small">${esc(t('custAccent'))}</div>
      <div class="row swatches">${ACCENTS.map(a => `<button class="swatch" data-a="${a}" data-act="pf-accent" data-v="${a}" aria-pressed="${p.accent === a}" aria-label="${esc(t('accents')[a])}"></button>`).join('')}</div>
      <div class="opt"><span>${esc(t('custDaisy'))}</span>${sw(p.daisy, 'cust-daisy', t('custDaisy'))}</div>
      <div class="opt"><span>${esc(t('custShapes'))}</span>${sw(p.shapes, 'pf-shapes', t('custShapes'))}</div>
      <a class="link" href="#/new" data-act="pf-cust">${esc(t('pfCust'))}</a>
    </section>
    <section class="card reveal"><div class="field-label">${esc(t('remTitle'))}</div>
      <div class="opt"><span>${esc(t('remOn'))}</span>${sw(!!p.remind, 'pf-remind', t('remOn'))}</div>
      <label class="opt"><span>${esc(t('remTime'))}</span><input type="time" id="rtime" value="${esc(p.remind || '20:00')}" style="width:auto"></label>
      <button class="btn outline small" data-act="pf-ics">${esc(t('remIcs'))}</button>
      <p class="small">${esc(t('remNote'))}</p>
    </section>
    <section class="card reveal"><div class="field-label">${esc(t('account'))}</div>
      <p class="small">${esc(u.guest ? t('guestNote') : t('acctNote'))}</p>
      <div class="row"><button class="btn primary small" data-act="logout">${esc(t('logout'))}</button><button class="btn small danger" data-act="delacct">${esc(t('delAcct'))}</button></div>
    </section>
  </div>`);
  $$('.prof-stats .cnt').forEach((c, i) => Motion.count(c, +c.dataset.n, .2 + i * .08));
  $('#pfp').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const pic = await squarePic(f); await saveProfile({ avatar: pic }); Daisy.react('wow', t('daisy').pfp); } catch (err) { if (err && err.status) fail(err); else toast(t('badPhoto')); }
  });
  $('#nick').addEventListener('keydown', e => { if (e.key === 'Enter') $('[data-act=pf-save]').click(); });
  $('#rtime').addEventListener('change', e => { if (prefs().remind && e.target.value) { setPrefs({ remind: e.target.value }, false); toast(t('remSet', e.target.value)); } });
}
async function saveProfile(change) {
  const u = me.user, body = { name: (change.name !== undefined ? change.name : u.name || displayName()), avatar: change.avatar !== undefined ? change.avatar : u.avatar || null };
  const r = await api('PUT', '/api/profile', body); u.name = r.name; u.avatar = r.avatar;
  dockAvatar(); if (location.hash === '#/profile') { await viewProfile(); Motion.showAll(main()); }
}

/* ---------- calendar: every day in its mood colour with a little face; a recap for each month ---------- */
state.cal = null;
async function viewCalendar(arg) {
  const now = new Date(), m0 = /^(\d{4})-(\d{2})$/.exec(arg || '');
  const y = m0 ? +m0[1] : now.getFullYear(), m = m0 ? Math.min(11, Math.max(0, +m0[2] - 1)) : now.getMonth();
  const { days: raw } = await api('GET', '/api/days'), all = raw.map(localizeDay);
  const byDate = new Map(); for (const d of all) { if (!byDate.has(d.date)) byDate.set(d.date, []); byDate.get(d.date).push(d); }
  state.cal = { byDate };
  const first = new Date(y, m, 1), len = new Date(y, m + 1, 0).getDate(), monStart = LANG === 'ru' ? 1 : 0, lead = (first.getDay() - monStart + 7) % 7;
  const wd = Array.from({ length: 7 }, (_, i) => (WEEKDAYS[LANG] || WEEKDAYS.en)[(i + monStart) % 7]);
  const today = todayISO(), ym = (yy, mm) => `${yy}-${pad2(mm + 1)}`, prev = new Date(y, m - 1, 1), next = new Date(y, m + 1, 1);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="cal-cell pad"></span>');
  for (let d = 1; d <= len; d++) {
    const iso = isoOf(y, m, d), list = byDate.get(iso) || [], top = list[0], mood = top && top.style.mood, future = iso > today;
    const label = top ? `${fmtDate(iso)}: ${t('moodShort')[mood] || ''}, ${top.style.title}` : `${fmtDate(iso)}${future ? '' : ' · ' + t('calWrite')}`;
    cells.push(`<button class="cal-cell${top ? ' has' : ''}${iso === today ? ' today' : ''}" ${top ? `data-m="${mood}"` : ''} data-act="cal-day" data-d="${iso}"${future ? ' disabled' : ''} aria-label="${esc(label)}">
      <span class="cal-num">${d}</span>${top ? `<span class="cal-fill"></span>${moodFace(mood)}${list.length > 1 ? `<span class="cal-more">${list.length}</span>` : ''}` : ''}</button>`);
  }
  const month = all.filter(d => d.date.startsWith(ym(y, m) + '-')).sort((a, b) => a.date.localeCompare(b.date));
  const ended = new Date(y, m + 1, 0) < new Date(now.getFullYear(), now.getMonth(), now.getDate()) || today === isoOf(y, m, len);
  /* a fresh month: point at last month's recap once */
  const lastM = new Date(now.getFullYear(), now.getMonth() - 1, 1), lastKey = ym(lastM.getFullYear(), lastM.getMonth());
  let fresh = false; try { fresh = !m0 && all.some(d => d.date.startsWith(lastKey + '-')) && !localStorage.getItem('recapSeen-' + lastKey); } catch (e) { /* private mode */ }
  paint(`
  <header class="head reveal"><div class="eyebrow">${esc(t('calEyebrow'))}</div><h1>${esc(t('calTitle'))}</h1><p>${esc(t('calP'))}</p></header>
  ${fresh ? `<a class="recap-ready reveal" href="#/calendar/${lastKey}" data-act="recap-open" data-k="${lastKey}">${moodFace('lively')}<span><b>${esc(t('recapReady', monthName(lastM.getFullYear(), lastM.getMonth())))}</b><span class="small">${esc(t('recapReadyP'))}</span></span></a>` : ''}
  <section class="card cal reveal">
    <div class="cal-head"><a class="icon-btn" href="#/calendar/${ym(prev.getFullYear(), prev.getMonth())}" aria-label="${esc(t('calPrev'))}">‹</a>
      <h2>${esc(monthName(y, m))} <span>${y}</span></h2>
      <a class="icon-btn" href="#/calendar/${ym(next.getFullYear(), next.getMonth())}" aria-label="${esc(t('calNext'))}">›</a></div>
    ${m0 && (y !== now.getFullYear() || m !== now.getMonth()) ? `<a class="link cal-today" href="#/calendar">${esc(t('calToday'))}</a>` : ''}
    <div class="cal-grid" role="group" aria-label="${esc(monthName(y, m) + ' ' + y)}">${wd.map(w => `<span class="cal-wd">${esc(w)}</span>`).join('')}${cells.join('')}</div>
    <div class="cal-legend">${MOODS.map(k => `<span data-m="${k}">${moodFace(k)}${esc(t('moodShort')[k])}</span>`).join('')}</div>
  </section>
  ${recapHtml(month, y, m, ended)}`);
  Motion.pop($$('.cal-cell:not(.pad)'), { scale: .6, delay: .2, stagger: { each: .012 } });
  Motion.pop($$('.cal-cell.has .face'), { scale: 0, y: -18, rotation: -35, delay: .6, duration: .8, ease: 'back.out(2.6)', stagger: { each: .07 } });
  const recap = $('.recap'); if (recap) Motion.onView(recap, el => {
    $$('.recap .cnt', el).forEach((c, i) => Motion.count(c, +c.dataset.n, i * .06));
    Motion.pop($$('.rc-bar i, .rc-tile', el), { scale: .2, transformOrigin: 'left center', stagger: { each: .06 } });
    if (ended && month.length) Daisy.react('cheer', t('daisy').recap);
  });
  if (m0) try { localStorage.setItem('recapSeen-' + ym(y, m), '1'); } catch (e) { /* private mode */ }
}
function recapHtml(month, y, m, ended) {
  const name = monthName(y, m);
  if (!month.length) return `<section class="card recap empty-recap reveal"><div class="field-label">${esc(t('recapTitle', name))}</div><p class="muted">${esc(t('recapEmpty'))}</p><a class="btn primary small" href="#/new">${esc(t('navNew'))}</a></section>`;
  const count = k => month.filter(d => d.style.mood === k).length, total = month.length;
  const top = [...MOODS].sort((a, b) => count(b) - count(a))[0];
  const words = month.reduce((n, d) => n + wordsIn(d.text), 0), photos = month.flatMap(d => d.photos || []);
  const songs = [...new Map(month.filter(d => d.song && d.song.title).map(d => [d.song.title + '|' + d.song.artist, d.song])).values()], voices = month.filter(d => d.voiceUrl).length, videos = month.filter(d => d.videoUrl).length;
  const dates = [...new Set(month.map(d => d.date))].sort(); let streak = 0, run = 0, prev = null;
  for (const iso of dates) { const dt = new Date(iso + 'T12:00:00'); run = prev && (dt - prev) / 864e5 === 1 ? run + 1 : 1; streak = Math.max(streak, run); prev = dt; }
  const longest = month.reduce((a, d) => wordsIn(d.text) > wordsIn(a.text) ? d : a, month[0]);
  const first = s => { const x = String(s || '').trim().split(/(?<=[.!?…])\s/)[0]; return x.length > 140 ? x.slice(0, 137) + '…' : x; };
  const tiles = [[dates.length, t('rcDays')], [words, t('stWords')], [photos.length, t('stPhotos')], [songs.length, t('rcSongs')], [streak, t('rcStreak')]];
  if (voices) tiles.push([voices, t('rcVoices')]); if (videos) tiles.push([videos, t('rcVideos')]);
  return `<section class="card recap reveal" data-m="${top}">
    <div class="rc-head">${moodFace(top)}<div><div class="field-label">${esc(ended ? t('recapTitle', name) : t('recapSoFar', name))}</div>
      <h2>${esc(t('rcTop', t('moodShort')[top].toLowerCase()))}</h2><p class="small">${esc(ended ? t('rcLine')[top] : t('recapWait'))}</p></div></div>
    <div class="rc-tiles">${tiles.map(([n, x]) => `<div class="rc-tile"><b class="cnt" data-n="${n}">${n}</b><span>${esc(x)}</span></div>`).join('')}</div>
    <div class="small">${esc(t('rcMix'))}</div>
    <div class="rc-bar">${MOODS.filter(count).map(k => `<i data-m="${k}" style="flex:${count(k)}" title="${esc(t('moodShort')[k])}: ${count(k)}"></i>`).join('')}</div>
    <div class="rc-mix">${MOODS.filter(count).map(k => `<span data-m="${k}">${moodFace(k)}${esc(t('moodShort')[k])} · <b class="cnt" data-n="${Math.round(count(k) / total * 100)}">${Math.round(count(k) / total * 100)}</b>%</span>`).join('')}</div>
    ${photos.length ? `<div class="small">${esc(t('rcPhotos'))}</div><div class="rc-photos">${photos.slice(0, 8).map(src => `<img class="rc-tile" src="${esc(src)}" alt="" loading="lazy">`).join('')}</div>` : ''}
    ${songs.length ? `<div class="small">${esc(t('rcSongList'))}</div><ul class="rc-songs">${songs.map(s => `<li><b>${esc(s.title)}</b>${s.artist ? ' · ' + esc(s.artist) : ''}</li>`).join('')}</ul>` : ''}
    <div class="small">${esc(t('rcLongest'))}</div><blockquote class="rc-quote">“${esc(first(longest.text))}” <a class="link" href="#/day/${esc(longest.id)}">${esc(fmtDate(longest.date))}</a></blockquote>
    <div class="small">${esc(t('rcNotes'))}</div>
    <ol class="rc-notes">${month.map(d => `<li data-m="${d.style.mood}"><a href="#/day/${esc(d.id)}">${moodFace(d.style.mood)}<span class="rc-date">${esc(fmtDate(d.date))}</span><span><b>${esc(d.style.title)}</b><span class="small">${esc(first(d.text))}</span></span></a></li>`).join('')}</ol>
  </section>`;
}
/** A click on a calendar day: open what was written, or start writing for that date. */
function calDay(iso) {
  const list = (state.cal && state.cal.byDate.get(iso)) || [];
  if (!list.length) { state.draft.date = iso; state.draft.dateOn = true; location.hash = '#/new'; Daisy.say(t('daisy').calNew, 3600); return; }
  if (list.length === 1) { location.hash = '#/day/' + list[0].id; return; }
  dlg(`<p class="eyebrow">${esc(fmtDate(iso))}</p><ul class="rc-notes">${list.map(d => `<li data-m="${d.style.mood}"><a href="#/day/${esc(d.id)}">${moodFace(d.style.mood)}<span><b>${esc(d.style.title)}</b><span class="small">${esc(String(d.text).slice(0, 90))}</span></span></a></li>`).join('')}</ul>`);
  $$('#dlg a').forEach(a => a.addEventListener('click', () => $('#dlg').close()));
}

/* ---------- routing ---------- */
function dlg(html) { const d = $('#dlg'); d.innerHTML = html + `<form method="dialog" style="margin-top:12px"><button class="btn small">${esc(t('close'))}</button></form>`; d.showModal(); }
async function route(keepScroll) {
  stopAll(); closeCamera(false); delete main().dataset.day; delete main()._day; delete main().dataset.mood;
  const h = location.hash.replace(/^#\/?/, '') || (me.user ? 'new' : 'welcome'); const [name, arg] = h.split('/');
  if (!me.user && name !== 'welcome') { location.hash = '#/welcome'; return; }
  if (me.user && name === 'welcome') { location.hash = '#/archive'; return; }
  const r = { new: 'new', analysis: 'new', result: 'new', archive: 'archive', day: 'archive', memory: 'archive', ribbon: 'ribbon', admin: 'admin', calendar: 'calendar', profile: 'profile' }[name] || 'new';
  if (me.user) requestAnimationFrame(() => markDock($(`#nav a[data-r="${r}"]`)));
  if (keepScroll !== true) window.scrollTo(0, 0);
  try {
    if (name === 'welcome') viewWelcome();
    else if (name === 'analysis') viewAnalysis();
    else if (name === 'result') { if (!state.result) { location.hash = '#/new'; return; } memoryScreen(state.result, false); }
    else if (name === 'archive') await viewArchive();
    else if (name === 'day') await viewDay(arg);
    else if (name === 'memory') await viewMemory(arg);
    else if (name === 'ribbon') await viewRibbon();
    else if (name === 'admin') await viewAdmin();
    else if (name === 'calendar') await viewCalendar(arg);
    else if (name === 'profile') await viewProfile();
    else viewNew();
  } catch (e) { fail(e); }
}
/* renders run one after another, never two at once (two at once made pages appear twice) */
let routing = Promise.resolve();
const render = () => (routing = routing.then(() => Promise.race([Motion.transition(route), new Promise(r => setTimeout(r, 4000))])).catch(fail));   // never let one stuck page change block the rest
/** Goes to a page: a new hash renders by itself (hashchange), the same hash renders once here. */
const go = h => { if (location.hash === h) render(); else location.hash = h; };
const curDay = async () => main()._day || (state.result && !main().dataset.day ? localizeDay(state.result) : null);
const jump = id => { const el = id === 'top' ? document.body : document.getElementById(id); if (!el) { location.hash = '#/welcome'; return; } el.scrollIntoView({ behavior: Motion.reduced() ? 'auto' : 'smooth', block: 'start' }); };

/* clicks on elements with data-act */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return; const act = b.dataset.act, d = state.draft;
  if (act === 'lang') { const y = scrollY; setLang(b.dataset.lang); shell(); await route(true); Motion.showAll(main()); scrollTo(0, y); }
  else if (act === 'jump') jump(b.dataset.to);
  else if (act === 'top') { e.preventDefault(); if (me.user) location.hash = '#/new'; else jump('top'); }
  else if (act === 'songtab') { d.song.tab = b.dataset.v; viewNew(true); }
  else if (act === 'rmphoto') { d.photos.splice(+b.dataset.i, 1); viewNew(true); }
  else if (act === 'opt') optToggle(b.dataset.k);
  else if (act === 'authtab') authTab(b.dataset.v);
  else if (act === 'pw-gen') makePassword();
  else if (act === 'pw-copy') { try { await navigator.clipboard.writeText($('#authform [name=password]').value); toast(t('pwCopied')); } catch (err) { toast(t('pwCopyFail')); } }
  else if (act === 'guest') { busy(true, t('makingGuest')); try { await afterLogin(await api('POST', '/api/guest', {}, { quiet401: true }), true); } catch (err) { busy(false); fail(err); } }
  else if (act === 'logout') { if ($('#dlg').open) $('#dlg').close(); try { await api('POST', '/api/logout', {}); } catch (err) { /* already out */ } me = { user: null, csrf: null }; state.draft = newDraft(); state.result = null; shell(); go('#/welcome'); Daisy.show(true); Daisy.setMood('base', true); Daisy.wave(); Daisy.say(t('daisy').bye[0], 3500); }
  else if (act === 'delacct') {
    if ($('#dlg').open) $('#dlg').close();
    dlg(`<h3 style="font:500 24px var(--sans);margin-bottom:8px">${esc(t('delAcctQ'))}</h3><p class="muted" style="margin-bottom:12px">${esc(t('delAcctP'))}</p>
    <form id="delform" class="stack" style="gap:12px">${me.user.guest || me.user.google ? '' : `<input type="password" name="password" placeholder="${esc(t('yourPw'))}" autocomplete="current-password" required maxlength="128" aria-label="${esc(t('yourPw'))}">`}<button class="btn primary small" type="submit">${esc(t('delForever'))}</button><p class="err" id="delerr" role="alert"></p></form>`);
  }
  else if (act === 'build') {
    busy(true, t('loading'));
    try { const s = d.song; state.result = await buildDay({ ...d, song: { ...s, url: s.tab === 'file' ? '' : s.url.trim(), file: s.tab === 'file' ? s.file : null } }); location.hash = '#/analysis'; }
    catch (err) { toast(t('buildFail')); } finally { busy(false); }
  }
  else if (act === 'save') {
    busy(true, t('saving')); b.disabled = true;
    try { const saved = await saveDay(state.result); state.draft = newDraft(); state.result = null; toast(t('saved')); location.hash = '#/day/' + saved.id; }
    catch (err) { fail(err); b.disabled = false; } finally { busy(false); }
  }
  else if (act === 'rebuild') location.hash = '#/new';
  else if (act === 'submit') {
    busy(true, t('submitting')); b.disabled = true;
    try { const s = d.song; const day = await buildDay({ ...d, song: { ...s, url: s.tab === 'file' ? '' : s.url.trim(), file: s.tab === 'file' ? s.file : null } }); const saved = await saveDay(day); state.draft = newDraft(); state.result = null; toast(t('saved')); location.hash = '#/day/' + saved.id; Daisy.happy(t('daisy').saved); }
    catch (err) { fail(err); b.disabled = false; } finally { busy(false); }
  }
  else if (act === 'google') { if (!state.google) { e.preventDefault(); toast(t('googleOff')); } }
  else if (act === 'camvid') openCamVideo();
  else if (act === 'cv-rec') { const el = $('.cam'); if (el) el._rec(); }
  else if (act === 'cv-flip') { const el = $('.cam'); if (el) el._flip(); }
  else if (act === 'cv-again') { const el = $('.cam'); if (el) el._again(); }
  else if (act === 'cv-mood') { const el = $('.cam'); if (el) el._pickMood(b.dataset.m); }
  else if (act === 'cv-use') { const el = $('.cam'); if (el) el._useVideo(); }
  else if (act === 'scan-show') { if (d.video && d.video.ai) { dlg(`<p class="eyebrow">${esc(t('scanTitle'))}</p>${scanHtml(d.video.ai)}`); Motion.results($('#dlg .scan')); } }
  else if (act === 'cust') { state.cust = !state.cust; viewNew(true); }
  else if (act === 'cust-set') setPrefs({ [b.dataset.k]: b.dataset.v });
  else if (act === 'cust-shapes') setPrefs({ shapes: !prefs().shapes });
  else if (act === 'cust-daisy') { const on = !prefs().daisy, here = location.hash.startsWith('#/new'); setPrefs({ daisy: on }, here); if (!here) b.setAttribute('aria-checked', on); if (on) Daisy.happy(t('daisy').back); }
  else if (act === 'pf-shapes') { const on = !prefs().shapes; setPrefs({ shapes: on }, false); b.setAttribute('aria-checked', on); }
  else if (act === 'pf-accent') { setPrefs({ accent: b.dataset.v }, false); $$('[data-act=pf-accent]').forEach(x => x.setAttribute('aria-pressed', x === b)); }
  else if (act === 'pf-theme') { if (b.dataset.v !== theme()) switchTheme(b); $$('[data-act=pf-theme]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); }
  else if (act === 'pf-cust') state.cust = true;
  else if (act === 'pf-save') { try { await saveProfile({ name: $('#nick').value }); toast(t('pfSaved')); Daisy.happy(t('daisy').nick(displayName())); } catch (err) { fail(err); } }
  else if (act === 'pf-unpic') { try { await saveProfile({ avatar: null }); } catch (err) { fail(err); } }
  else if (act === 'cal-day') calDay(b.dataset.d);
  else if (act === 'pf-remind') {
    const on = !prefs().remind, time = $('#rtime').value || '20:00'; setPrefs({ remind: on ? time : '' }, false); b.setAttribute('aria-checked', on);
    toast(on ? t('remSet', time) : t('remOff'));
    if (on) { Daisy.happy(t('daisy').remindOn); if (window.Notification && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); }
  }
  else if (act === 'pf-ics') reminderIcs($('#rtime').value || prefs().remind || '20:00');
  else if (act === 'q-mood') { state.quick = b.dataset.m; $$('.q-mood').forEach(x => x.setAttribute('aria-checked', x === b)); $('[data-act=q-save]').disabled = false; $('#qline').placeholder = t('qPh')[state.quick]; main().dataset.mood = state.quick; Daisy.setMood(state.quick); $('#qline').focus(); }
  else if (act === 'q-save') quickSave();
  else if (act === 'share') { const on = b.getAttribute('aria-checked') !== 'true'; try { await api('PUT', `/api/days/${main().dataset.day}/share`, { shared: on }); b.setAttribute('aria-checked', on); toast(t(on ? 'shareOn' : 'shareOff')); if (on) Daisy.happy(t('daisy').shared); } catch (err) { fail(err); } }
  else if (act === 'admunshare') { try { await adminSave(b.closest('.adm-day'), { shared: false }); } catch (err) { fail(err); } }
  else if (act === 'recap-open') { try { localStorage.setItem('recapSeen-' + b.dataset.k, '1'); } catch (err) { /* private mode */ } }
  else if (act === 'cust-hide') { const h = prefs().hidden, c = b.dataset.c; setPrefs({ hidden: h.includes(c) ? h.filter(x => x !== c) : h.concat(c) }); }
  else if (act === 'cust-move') { const o = prefs().order.slice(), i = +b.dataset.i, j = i + +b.dataset.d; if (j >= 0 && j < o.length) { [o[i], o[j]] = [o[j], o[i]]; setPrefs({ order: o }); } }
  else if (act === 'cust-reset') setPrefs({ ...PREF_DEF });
  else if (act === 'vm-rec') voiceToggle();
  else if (act === 'vm-keep') { d.voice.keep = !d.voice.keep; viewNew(true); }
  else if (act === 'vm-del') { if (d.voice) { Voice.stop(); if (d.voice.url) URL.revokeObjectURL(d.voice.url); } d.voice = null; viewNew(true); }
  else if (act === 'vm-insert') { d.text = (d.text.trim() ? d.text.trim() + ' ' : '') + d.voice.text; toast(t('voiceAdded')); viewNew(true); }
  else if (act === 'vid-mood') { d.video.mood = b.dataset.m; viewNew(true); Daisy.setMood(b.dataset.m); }
  else if (act === 'vid-del') { if (d.video) URL.revokeObjectURL(d.video.url); d.video = null; viewNew(true); }
  else if (act === 'sq-play') {
    const x = state.songs[+b.dataset.i], playing = player.preview && player.preview._src === x.preview && !player.preview.paused;
    if (player.preview) player.preview.pause();
    if (!playing) { player.preview = new Audio(x.preview); player.preview._src = x.preview; player.preview.play().catch(() => toast(t('noPlay'))); }
  }
  else if (act === 'sq-pick') songPick(state.songs[+b.dataset.i]);
  else if (act === 'sq-change') { Object.assign(d.song, { picked: null, url: '', bpm: null }); viewNew(true); }
  else if (act === 'credits') {
    let list = []; try { list = await (await fetch('/demo/credits.json')).json(); } catch (err) { /* offline */ }
    dlg(`<h3 style="font:500 22px var(--sans);margin-bottom:10px">${esc(t('photoCredits'))}</h3><ul class="credits">${list.map(c => `<li>“${esc(c.title)}” — ${esc(c.author)}, ${esc(c.license)}, <a class="link" href="${esc(c.source)}" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a></li>`).join('')}</ul>`);
  }
  else if (act === 'camclose') closeCamera();
  else if (act === 'camcalib') Face.recalibrate();
  else if (act === 'camuse') { const el = $('.cam'); if (el) el._use(); }
  else if (act === 'camphoto') { const el = $('.cam'); if (el) el._photo(); }
  else if (act === 'faceclear') { d.face = null; viewNew(true); }
  else if (act === 'admsave') { try { await adminSave(b.closest('.adm-day')); } catch (err) { fail(err); } }
  else if (act === 'admok') { try { await adminSave(b.closest('.adm-day'), { clearFlags: true }); } catch (err) { fail(err); } }
  else if (act === 'admdel') { if (confirm(t('admDelQ'))) { try { await api('DELETE', `/api/admin/days/${b.closest('.adm-day').dataset.id}`); viewAdmin(); } catch (err) { fail(err); } } }
  else if (act === 'song') { const day = await curDay(); if (day) toggleSong(day, b); }
  else if (act === 'voice') { const day = await curDay(); if (day) toggleVoice(day, b); }
  else if (act === 'filter') { state.filter = b.dataset.v; viewArchive(); }
  else if (act === 'demo') loadDemo(false);
  else if (act === 'pickmood') { const m = showcase.moods[+b.dataset.i], sec = $('#sec2'), off = sec && sec.dataset.mood === m; showcase.mood(off ? null : m); Daisy.setMood(off ? 'base' : m, off); }
  else if (act === 'theme') switchTheme(b);
  else if (act === 'delete') { if (confirm(t('confirmDelete'))) { try { await api('DELETE', `/api/days/${main().dataset.day}`); location.hash = '#/archive'; } catch (err) { fail(err); } } }
  else if (act.startsWith('f-')) {
    const day = main()._day; if (!day) return;
    if (act === 'f-text') dlg(`<p class="eyebrow" style="margin-bottom:8px">${esc(t('entryOf', fmtDate(day.date)))}</p><p style="font:400 20px/1.6 var(--serif);white-space:pre-wrap">${esc(day.text)}</p>`);
    else if (act === 'f-photos') dlg(day.photos.map(p => `<img src="${esc(p)}" alt="">`).join(''));
    else if (act === 'f-song') toggleSong(day, b);
    else if (act === 'f-voice') toggleVoice(day, b);
    else if (act === 'f-vm') {
      const subs = (day.textInfo.voice || []).map(c => `<li data-s="${esc(c.s)}" data-e="${esc(c.e ?? '')}"><time>${clock(c.s * 1000)}</time>${esc(c.t)}</li>`).join('');
      dlg(`<p class="eyebrow" style="margin-bottom:8px">${esc(t('voiceMsg'))}</p><audio id="dlgaudio" controls src="${esc(day.voiceUrl)}" style="width:100%"></audio>${subs ? `<ol class="subs">${subs}</ol>` : ''}`);
      syncSubs($('#dlgaudio'), $('#dlg .subs'));
    }
    else if (act === 'f-video') {
      const v = day.textInfo.video;
      dlg(`<video controls playsinline src="${esc(day.videoUrl)}" style="width:100%;border-radius:10px"></video>${v ? `<p class="small" style="margin:10px 0 0">${esc(t('vidTrue'))}: <b>${esc(t('moodShort')[v.mood])}</b></p>
        ${scanHtml({ mood: v.ai, conf: v.conf, scene: v.scene || null, face: v.face || { seen: 0 }, words: v.words || [], things: [] })}` : ''}`);
      Motion.results($('#dlg .scan'));
    }
  }
});
document.addEventListener('submit', async e => {
  if (e.target.id === 'authform') { e.preventDefault(); submitAuth(e.target); }
  else if (e.target.id === 'admtexts') {
    e.preventDefault(); const f = new FormData(e.target), moods = {};
    for (const [k, v] of f.entries()) { const [lang, m, field] = k.split('.'); if (field && String(v).trim()) ((moods[lang] ||= {})[m] ||= {})[field] = String(v).trim(); }
    const lines = v => String(v || '').split('\n').map(x => x.trim()).filter(Boolean);
    try { await api('PUT', '/api/admin/settings', { moods, words: { block: lines(f.get('block')), flag: lines(f.get('flag')) } }); applyContent(moods); toast(t('admSaved')); } catch (err) { fail(err); }
  }
  else if (e.target.id === 'delform') {
    e.preventDefault(); const err = $('#delerr');
    try { await api('DELETE', '/api/me', me.user.guest || me.user.google ? {} : { password: e.target.password.value }); $('#dlg').close(); me = { user: null, csrf: null }; shell(); toast(t('acctDeleted')); go('#/welcome'); }
    catch (x) { err.textContent = x.message; }
  }
});
window.addEventListener('hashchange', () => render());

/* ---------- start ---------- */
async function init() {
  applyStatic();
  try { applyContent((await api('GET', '/api/content')).moods); } catch (e) { /* defaults stay */ }
  api('GET', '/api/config').then(c => { state.google = !!c.google; }, () => { state.google = false; }).finally(() => { state.cfgReady = true; fillAuth(); });
  if (new URLSearchParams(location.search).get('auth') === 'failed') { history.replaceState(null, '', '/' + location.hash); setTimeout(() => toast(t('googleFail')), 600); }
  try { me = { csrf: null, ...(await api('GET', '/api/me')) }; } catch (e) { me = { user: null, csrf: null }; }
  Daisy.mount(); Daisy.show(prefs().daisy);
  /* floating specks over the site: CSS moves them (transform only), so they cost almost nothing */
  const C = ['#F0A04B', '#E3672B', '#6F8DB5', '#F4B6C2', '#7FAF88'], R = (a, b) => (a + Math.random() * (b - a)).toFixed(1);
  document.body.insertAdjacentHTML('beforeend', `<div class="motes" aria-hidden="true">${Array.from({ length: 16 }, (_, i) => `<i style="--x:${R(0, 100)}%;--s:${R(3, 6)}px;--c:${C[i % 5]};--d:${R(16, 30)}s;--dl:-${R(0, 30)}s;--dx:${R(-60, 60)}px"></i>`).join('')}</div>`);
  shell(); dockAvatar(); await render();
  remindTick(); setInterval(remindTick, 60000);
  if (window.speechSynthesis) speechSynthesis.getVoices();
}
if (typeof document !== 'undefined' && document.getElementById('main')) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init(); }
