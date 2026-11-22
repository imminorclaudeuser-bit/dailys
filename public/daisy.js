"use strict";
/* Daisy, the site's seal friend. An original character in a flat, rounded mascot style made of felt:
   no outlines, big eyes, a lighter belly, stitched seams and halftone blush. She breathes, blinks, follows the cursor,
   takes the colour of the mood the person chooses, reacts to what they do (typing, songs, photos, the camera,
   saving a day, errors, the theme), says goodbye near closing buttons and waves when nobody has touched the page.
   Only transform and opacity move (60–120 fps). */
const Daisy = (() => {
  const dots = (x, y) => [[-4, -2], [0, -2.4], [4, -2], [-2, 2], [2, 2]].map(([a, b]) => `<circle cx="${x + a}" cy="${y + b}" r="1.7"/>`).join('');
  const SVG = `<svg viewBox="-14 -46 148 182" aria-hidden="true" focusable="false">
    <g class="d-pool"><circle cx="60" cy="74" r="66" fill="#CFE8F7"/><path d="M8 122q13-7 26 0t26 0 26 0 26 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/></g>
    <g class="d-all">
      <path class="d-dark" d="M47 112c-10 2-19 8-21 17 10 3 21-2 27-10z"/><path class="d-dark" d="M73 112c10 2 19 8 21 17-10 3-21-2-27-10z"/>
      <g class="d-body">
        <path class="d-fill" d="M60 20c27 0 40 25 40 53 0 29-17 46-40 46S20 102 20 73c0-28 13-53 40-53z"/>
        <path class="d-dark d-shade" d="M79 27c13 11 21 28 21 46 0 29-17 46-40 46 17-6 28-21 28-45 0-19-3-35-9-47z"/>
        <ellipse class="d-belly" cx="60" cy="90" rx="24" ry="25"/>
        <path class="d-seam" d="M60 25.2c24.3 0 36 22.5 36 47.7 0 26.1-15.3 41.4-36 41.4S24 99 24 72.9c0-25.2 11.7-47.7 36-47.7z"/>
        <ellipse class="d-seam d-seam-b" cx="60" cy="90" rx="20.5" ry="21.5"/>
        <g class="d-flip d-flip-l"><path class="d-dark" d="M27 76c-12 4-19 13-20 25 11 0 20-6 25-15z"/></g>
        <g class="d-flip d-flip-r"><path class="d-dark" d="M93 76c12 4 19 13 20 25-11 0-20-6-25-15z"/></g>
        <g class="d-face">
          <g class="d-cheek">${dots(35, 66)}${dots(85, 66)}</g>
          <g class="d-eye"><circle cx="45" cy="50" r="11.5" fill="#fff"/><g class="d-pupil"><circle cx="45" cy="51" r="6.6" fill="#2B2A33"/><circle cx="47.6" cy="48.2" r="2.3" fill="#fff"/></g></g>
          <g class="d-eye"><circle cx="75" cy="50" r="11.5" fill="#fff"/><g class="d-pupil"><circle cx="75" cy="51" r="6.6" fill="#2B2A33"/><circle cx="77.6" cy="48.2" r="2.3" fill="#fff"/></g></g>
          <g class="d-lid"><rect class="d-fill" x="32" y="37" width="26" height="26" rx="13"/><rect class="d-fill" x="62" y="37" width="26" height="26" rx="13"/></g>
          <path class="d-joy" d="M36 53q9-10 18 0M66 53q9-10 18 0" stroke="#2B2A33" stroke-width="3.4" stroke-linecap="round" fill="none"/>
          <path class="d-brow" d="M35 40.5q8-1.5 15-6M85 40.5q-8-1.5-15-6" stroke="#2B2A33" stroke-width="3.4" stroke-linecap="round" fill="none"/>
          <ellipse class="d-belly" cx="60" cy="69" rx="14.5" ry="9.5"/>
          <path d="M55.6 62.6c0-2 8.8-2 8.8 0 0 2.4-2.6 4.3-4.4 4.3s-4.4-1.9-4.4-4.3z" fill="#2B2A33"/>
          <path class="d-mouth d-smile" d="M54 71.5q6 5.5 12 0" stroke="#2B2A33" stroke-width="2.6" stroke-linecap="round" fill="none"/>
          <path class="d-mouth d-frown" d="M54.5 74q5.5-4.5 11 0" stroke="#2B2A33" stroke-width="2.6" stroke-linecap="round" fill="none"/>
          <ellipse class="d-mouth d-o" cx="60" cy="73.5" rx="3.4" ry="4.2" fill="#2B2A33"/>
          <circle cx="50" cy="69" r="1.1" fill="#2B2A33" opacity=".45"/><circle cx="70" cy="69" r="1.1" fill="#2B2A33" opacity=".45"/>
        </g>
        <g class="d-flower" transform="translate(80 22)">
          ${[0, 45, 90, 135, 180, 225, 270, 315].map(a => `<ellipse cx="0" cy="-7.5" rx="3.6" ry="6.6" fill="#fff" transform="rotate(${a})"/>`).join('')}
          <circle r="4.6" fill="#FFC531"/>
        </g>
      </g>
    </g>
    <g class="d-buoy"><circle cx="60" cy="108" r="25" fill="none" stroke="#fff" stroke-width="11"/><circle cx="60" cy="108" r="25" fill="none" stroke="#E5484D" stroke-width="11" stroke-dasharray="19.6 19.6" transform="rotate(-24 60 108)"/><circle cx="60" cy="108" r="30.5" fill="none" stroke="rgba(0,0,0,.1)" stroke-width="1"/></g></svg>`;

  /* where the closing / leaving controls are; hovering them makes Daisy sad */
  const BYE = '[data-act=camclose],#dlg form[method=dialog] button,[data-act=logout],[data-act=delete],[data-act=delacct],[data-act=vid-del],[data-act=vm-del],[data-act=faceclear],.thumb button';
  const IDLE_MS = 25000;
  /* one-off animations and how long each one runs (ms) */
  const ANIM = { hop: 900, wave: 1700, cheer: 1300, dance: 1900, nod: 750, peek: 500, wow: 1500, oops: 1100, sleep: 2700, stretch: 1400, spin: 1100, dive: 1100, splash: 900 };
  let root = null, bubble = null, fx = null, sayTimer = 0, blinkTimer = 0, idleTimer = 0, animTimer = 0, listenTimer = 0, lookUntil = 0;
  let nudges = 0, hoverBye = null, mood = 'base', hidden = false, pokes = [], wordsSaid = 0, drag = null, dragged = false, bx = 0, by = 0, lastTap = 0;
  const buoy = () => root.classList.contains('buoy');
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pick = a => Array.isArray(a) ? a[Math.floor(Math.random() * a.length)] : a;
  const L = () => t('daisy');
  const dark = () => { const th = document.documentElement.dataset.theme; return th ? th === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };

  function mount() {
    if (root) return;
    root = document.createElement('div'); root.className = 'daisy'; root.dataset.tone = mood;
    root.innerHTML = `<div class="daisy-fx" aria-hidden="true"></div><div class="daisy-dots" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="daisy-bubble" aria-hidden="true"></div><button class="daisy-btn" type="button" aria-label="${esc(L().name)}">${SVG}</button>`;
    document.body.appendChild(root);
    bubble = root.querySelector('.daisy-bubble'); fx = root.querySelector('.daisy-fx');
    const btn = root.querySelector('.daisy-btn');
    btn.addEventListener('click', poke);
    /* in the lifebuoy she can be dragged anywhere on the screen */
    btn.addEventListener('pointerdown', e => { if (!buoy()) return; drag = { x: e.clientX, y: e.clientY, bx: bx, by: by, moved: false }; btn.setPointerCapture(e.pointerId); });
    btn.addEventListener('pointermove', e => {
      if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 6) { drag.moved = true; root.classList.add('dragging'); }
      if (drag.moved) place(drag.bx + dx, drag.by + dy);
    });
    btn.addEventListener('pointerup', () => { if (drag && drag.moved) dragged = true; drag = null; root.classList.remove('dragging'); });

    blink();
    /* eyes follow the cursor (a few pixels, eased) unless she is looking at something */
    let raf = 0, px = 0, py = 0;
    addEventListener('pointermove', e => {
      px = e.clientX; py = e.clientY; if (raf || reduced()) return;
      raf = requestAnimationFrame(() => { raf = 0; if (performance.now() > lookUntil) aim(px, py); });
    }, { passive: true });
    /* goodbye near closing buttons, excitement near Submit */
    document.addEventListener('pointerover', e => {
      const b = e.target.closest && e.target.closest(BYE); if (b && b !== hoverBye) { hoverBye = b; bye(b); }
      const go = e.target.closest && e.target.closest('[data-act=submit]:not(:disabled)'); if (go) root.classList.add('eager');
    });
    document.addEventListener('pointerout', e => {
      if (hoverBye && !(e.relatedTarget && hoverBye.contains(e.relatedTarget))) { hoverBye = null; root.classList.remove('sad'); hush(); }
      if (e.target.closest && e.target.closest('[data-act=submit]')) root.classList.remove('eager');
    });
    document.addEventListener('focusin', e => { const b = e.target.closest && e.target.closest(BYE); if (b) bye(b); });
    document.addEventListener('focusout', e => { if (e.target.closest && e.target.closest(BYE)) { root.classList.remove('sad'); hush(); } });
    /* she reacts to what the person does */
    document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-act]'); if (b && !b.disabled) onAct(b); });
    document.addEventListener('input', e => typing(e.target));
    document.addEventListener('change', e => { if (e.target.id === 'photos' && e.target.files.length) react('wow', L().photo); else if (e.target.id === 'songfile' && e.target.files.length) react('dance', L().song); });
    document.addEventListener('dragenter', e => { if (e.target.closest && e.target.closest('.drop') && !root.classList.contains('wow')) react('wow', L().drop); });
    document.addEventListener('drop', e => { if (e.target.closest && e.target.closest('.drop')) react('cheer', L().photo); });
    /* waving when the page has been left alone */
    ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart', 'pointermove'].forEach(ev => addEventListener(ev, active, { passive: true }));
    active();
    try { if (!sessionStorage.getItem('daisyHi')) { sessionStorage.setItem('daisyHi', '1'); setTimeout(() => { wave(); say(L().hi, 4200); }, 1400); } } catch (e) { /* private mode */ }
  }

  /* where the eyes point: towards a screen point, or a direction for a moment */
  function aim(x, y) {
    const r = root.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height * .38;
    const dx = x - cx, dy = y - cy, k = Math.min(1, Math.hypot(dx, dy) / 300), a = Math.atan2(dy, dx);
    root.style.setProperty('--lx', (Math.cos(a) * 3.2 * k).toFixed(2) + 'px'); root.style.setProperty('--ly', (Math.sin(a) * 2.6 * k).toFixed(2) + 'px');
  }
  function lookAt(el, ms = 1200) { if (!el || !el.getBoundingClientRect) return; const b = el.getBoundingClientRect(); aim(b.left + b.width / 2, b.top + b.height / 2); lookUntil = performance.now() + ms; }

  function blink() {
    clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => { if (!reduced()) { root.classList.add('blink'); setTimeout(() => root.classList.remove('blink'), 170); } blink(); }, 2600 + Math.random() * 3800);
  }
  function say(text, ms = 3600) {
    if (!root || hidden || !text) return;
    clearTimeout(sayTimer);
    bubble.textContent = text; root.classList.add('talk');
    if (ms) sayTimer = setTimeout(hush, ms);
  }
  function hush() { clearTimeout(sayTimer); if (root) root.classList.remove('talk'); }

  /** Plays one animation (and its little particles), optionally with a line. */
  function react(name, line, ms) {
    if (!root || hidden) return;
    if (line) say(pick(line), ms || 3400);
    if (buoy() && name !== 'dive') name = 'splash';   // in the lifebuoy every reaction is a splash
    if (reduced() || !ANIM[name]) return;
    clearTimeout(animTimer);
    root.classList.remove(...Object.keys(ANIM)); void root.offsetWidth; root.classList.add(name);
    animTimer = setTimeout(() => root.classList.remove(name), ANIM[name]);
    burst(name);
  }
  const hop = () => react('hop'), wave = () => react('wave');

  /* particles: petals for joy, notes for music, z for sleep, a drop for oops, stars for a spin */
  const FX = { splash: ['drip', 6], dive: ['drip', 8], cheer: ['petal', 10], dance: ['note', 4], sleep: ['zz', 3], oops: ['sweat', 1], spin: ['star', 5], wow: ['spark', 3], stretch: ['spark', 3] };
  function burst(name) {
    const f = FX[name]; if (!f) return;
    const [kind, n] = f;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span'); s.className = 'fx ' + kind;
      const a = (i / n) * Math.PI * 2 + Math.random() * .5, d = 46 + Math.random() * 26;
      s.style.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + 'px'); s.style.setProperty('--dy', (Math.sin(a) * d * .8 - 18).toFixed(1) + 'px');
      s.style.setProperty('--r', Math.round(Math.random() * 300 - 150) + 'deg'); s.style.setProperty('--d', (i * (kind === 'zz' ? 420 : kind === 'note' ? 260 : 18)) + 'ms');
      if (kind === 'note') s.textContent = i % 2 ? '♫' : '♪'; else if (kind === 'zz') s.textContent = 'z';
      s.dataset.c = i % 4;
      fx.appendChild(s); s.addEventListener('animationend', () => s.remove(), { once: true });
      setTimeout(() => s.remove(), 3000);
    }
  }

  /* what she does after a click on the site */
  function onAct(b) {
    const x = L(), act = b.dataset.act;
    const MAP = {
      submit: () => react('cheer', x.go), build: () => react('nod', x.peek), demo: () => react('cheer', x.demo),
      'sq-pick': () => react('dance', x.song), 'sq-play': () => react('dance'), 'f-song': () => react('dance'), song: () => react('dance'),
      'vm-rec': () => react('nod', x.listen), camvid: () => react('wow', x.camera), 'cv-rec': () => react('wow', x.rec), camphoto: () => react('wow'),
      cust: () => react('nod', x.cust), 'cust-set': () => { lookAt(b); react('peek'); }, 'cust-move': () => react('peek'),
      'vm-insert': () => react('nod', x.words), credits: () => react('peek'),
      theme: () => setTimeout(() => dark() ? react('sleep', x.night) : react('stretch', x.day), 450),
      'pf-theme': () => setTimeout(() => dark() ? react('sleep', x.night) : react('stretch', x.day), 450),
      lang: () => setTimeout(() => { react('wave', L().hi); }, 80)
    };
    if (MAP[act]) MAP[act]();
    else if (!b.matches(BYE) && !['pickmood', 'vid-mood', 'cv-mood', 'guest', 'cust-daisy'].includes(act)) { lookAt(b, 900); react('peek'); }
  }

  /* typing: she leans in and listens; long entries get a cheer now and then */
  function typing(el) {
    if (!root || hidden || !el.matches || !el.matches('textarea, input[type=text], input[type=search], input:not([type])')) return;
    root.classList.add('listen'); lookAt(el, 1600);
    clearTimeout(listenTimer); listenTimer = setTimeout(() => { root.classList.remove('listen'); react('nod'); }, 1300);
    if (el.id !== 'text') return;
    const n = (el.value.trim().match(/\S+/g) || []).length, marks = [25, 80, 200], hit = marks.filter(m => n >= m).length;
    if (hit > wordsSaid) { wordsSaid = hit; clearTimeout(listenTimer); root.classList.remove('listen'); react('cheer', L().words2[hit - 1], 3200); }
    else if (!n) wordsSaid = 0;
  }

  function poke() {
    const now = performance.now();
    if (dragged) { dragged = false; return; }
    if (buoy()) { if (now - lastTap < 400) leaveBuoy(); else react('splash', pick(L().buoyTap), 2600); lastTap = now; return; }
    pokes = pokes.filter(p => now - p < 2500); pokes.push(now);
    if (pokes.length >= 5) { pokes = []; react('spin', L().dizzy); } else react('hop', pick(L().poke), 3200);
  }
  function bye(b) {
    const act = b.dataset.act, x = L();
    root.classList.add('sad');
    say(act === 'delete' || act === 'delacct' ? pick(x.sure) : act === 'logout' ? x.logout : ['vid-del', 'vm-del', 'faceclear', 'rmphoto'].includes(act) ? pick(x.remove) : pick(x.bye), 0);
  }
  /** The person chose a mood, or their words show one: Daisy takes its colour and answers once per change.
      quiet = colour only; typed = she answers what was written ("sad", "happy"…) instead of a chosen mood,
      with a gentle nod for sad or tense words and a hop only for happy ones. */
  function setMood(m, quiet, typed) {
    if (!root) return;
    const next = ['calm', 'tense', 'quiet', 'lively'].includes(m) ? m : 'base';
    const changed = next !== mood; mood = next; root.dataset.tone = mood;
    if (!quiet && next !== 'base' && (changed || !typed)) { clearTimeout(listenTimer); root.classList.remove('listen'); react(!typed ? 'cheer' : next === 'lively' ? 'hop' : 'nod', (typed ? L().moodTyped : L().mood)[next], 3800); }
    return changed;
  }
  function active() {
    if (!root) return;
    nudges = 0; clearTimeout(idleTimer); idleTimer = setTimeout(nudge, IDLE_MS);
  }
  function nudge() {
    if (document.hidden || hidden) { idleTimer = setTimeout(nudge, IDLE_MS); return; }
    const x = L(), h = location.hash || '#/', ta = document.getElementById('text');
    const line = document.body.classList.contains('welcome') ? x.nudgeGuest
      : h.startsWith('#/new') ? (ta && ta.value.trim() ? x.nudgeSubmit : x.nudgeWrite)
      : h.startsWith('#/archive') ? x.nudgeArchive : pick(x.nudge);
    if (buoy()) return;
    wave(); say(line, 6000);
    idleTimer = setTimeout(++nudges < 2 ? nudge : enterBuoy, IDLE_MS * 1.8);
  }
  function place(x, y) {
    const r = root.getBoundingClientRect();
    bx = Math.max(-r.left + bx - 30, Math.min(innerWidth - r.right + bx + 30, x)); by = Math.max(-r.top + by - 40, Math.min(innerHeight - r.bottom + by + 20, y));
    root.style.translate = `${bx}px ${by}px`;
  }
  function enterBuoy() { if (!root || hidden || buoy()) return; hush(); root.classList.add('buoy'); react('dive', L().buoyIn, 4200); }
  function leaveBuoy() { root.classList.remove('buoy'); bx = by = 0; root.style.translate = ''; react('hop', L().buoyOut, 3000); active(); }
  function show(on) { hidden = !on; if (root) root.hidden = hidden; if (hidden) hush(); }
  function happy(text) { react('cheer', text, 4000); }
  return { mount, say, setMood, show, happy, wave, react };
})();
