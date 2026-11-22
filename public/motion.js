"use strict";
/* Motion on GSAP (public/vendor, 3.13): only transforms and opacity move, so it holds 60–120 fps.
   Things rise in once when they scroll into view (ScrollTrigger.batch), results arrive fast and settle slowly (expo.out),
   Each page gets its own gsap.matchMedia(), reverted on the next page,
   and "Reduce motion" shows everything at once. */
const Motion = (() => {
  gsap.registerPlugin(ScrollTrigger);
  gsap.defaults({ ease: 'expo.out', duration: .9 });
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mm = null;

  /** Fade-up for .reveal elements further down the page when they scroll into view.
      What is already on screen just appears: the page change itself already fades the page in, so it never "loads twice". */
  function reveal(root) {
    const els = [...root.querySelectorAll('.reveal:not(.in)')], h = innerHeight;
    const below = els.filter(e => { const top = e.getBoundingClientRect().top; if (top < h) { e.classList.add('in'); return false; } return true; });
    if (!below.length) return;
    gsap.set(below, { autoAlpha: 0, y: 28 });
    ScrollTrigger.batch(below, {
      start: 'top 94%', once: true,
      onEnter: batch => gsap.to(batch, { autoAlpha: 1, y: 0, stagger: .07, overwrite: true, clearProps: 'opacity,visibility,transform',
        onComplete: () => batch.forEach(e => e.classList.add('in')) })
    });
  }
  /** Shows everything without moving (reduce motion, language switch). */
  function showAll(root) {
    const els = root.querySelectorAll('.reveal');
    gsap.killTweensOf(els); gsap.set(els, { clearProps: 'opacity,visibility,transform' });
    root.querySelectorAll('.reveal').forEach(e => e.classList.add('in')); root.querySelectorAll('[data-words]').forEach(e => e.classList.add('lit'));
  }

  /** Runs fn(el) once, when el first comes into view. */
  function onView(el, fn) {
    if (!el) return;
    if (reduced()) { fn(el); return; }
    const o = new IntersectionObserver(es => { if (es[0].isIntersecting) { o.disconnect(); fn(el); } }, { rootMargin: '0px 0px -20% 0px' });
    o.observe(el);
  }

  /** Words of a paragraph light up one after another (CSS transitions, as before). */
  function words(root) {
    root.querySelectorAll('[data-words]').forEach(el => {
      el.innerHTML = el.textContent.trim().split(/\s+/).map((w, i) => `<span class="w" style="--wi:${i}">${esc(w)}</span>`).join(' ');
      if (el.dataset.words) el.style.setProperty('--w0', el.dataset.words + 'ms');
      onView(el, x => x.classList.add('lit'));
    });
  }

  /** Cards tilt after the cursor (quickTo reuses one tween per axis). */
  function tilt(root) {
    root.querySelectorAll('[data-tilt]').forEach(el => {
      const rx = gsap.quickTo(el, 'rotationX', { duration: .6, ease: 'power3' }), ry = gsap.quickTo(el, 'rotationY', { duration: .6, ease: 'power3' });
      el.addEventListener('pointermove', e => {
        if (e.pointerType === 'touch') return;
        const r = el.getBoundingClientRect();
        rx((.5 - (e.clientY - r.top) / r.height) * 9); ry(((e.clientX - r.left) / r.width - .5) * 11);
      });
      el.addEventListener('pointerenter', () => gsap.set(el, { transformPerspective: 1100 }));
      el.addEventListener('pointerleave', () => { rx(0); ry(0); });
    });
  }

  /** Page changes: the new page simply fades in. (A browser page transition drew the page on top of everything,
      so cards covered the bottom bar and Daisy, and the title doubled while it moved.) */
  async function transition(update) {
    await update();
    const m = document.getElementById('main');
    if (m && !reduced()) gsap.fromTo(m, { opacity: 0 }, { opacity: 1, duration: .35, ease: 'power2.out', overwrite: true, clearProps: 'opacity' });
  }

  /** Results appear like on apple.com: fast at the start, slowing to a soft stop (expo.out).
      Parts rise one after another, bars grow from zero and every "NN%" counts up on the same curve. */
  function results(root) {
    if (!root || reduced()) return;
    const parts = root.querySelectorAll('.ai-guess, .scan-grid > section > *:not(.cam-bars):not(.row):not(.timeline):not(.scan-emo), .cam-bar, .scan .chip, .scan-sum');
    const tl = gsap.timeline();
    tl.from(parts, { autoAlpha: 0, y: 14, scale: .98, stagger: .055, clearProps: 'transform,opacity,visibility' }, 0)
      .from(root.querySelectorAll('.cam-bar u'), { scaleX: 0, transformOrigin: 'left center', duration: 1.3, stagger: .055, clearProps: 'transform' }, .12)
      .from(root.querySelectorAll('.timeline i'), { autoAlpha: 0, scaleY: .2, duration: .7, stagger: .03, clearProps: 'transform,opacity,visibility' }, .2);
    root.querySelectorAll('.ai-guess, .cam-bar em, .scan .chip, .scan .small, .scan-sum').forEach((el, i) => {
      el.innerHTML = el.innerHTML.replace(/(\d+)%/g, (m, n) => `<span class="cnt" data-n="${n}">0</span>%`);
      el.querySelectorAll('.cnt').forEach(c => count(c, +c.dataset.n, .12 + Math.min(i, 22) * .055));
    });
    return tl;
  }
  function count(el, to, delay = 0, duration = 1.3) {
    if (reduced()) { el.textContent = to; return; }
    const o = { n: 0 };
    return gsap.to(o, { n: to, duration, delay, onUpdate: () => { el.textContent = Math.round(o.n); } });
  }
  /** Things pop in like bubbles (calendar days, recap tiles). */
  function pop(els, vars = {}) {
    if (reduced() || !els.length) return;
    return gsap.from(els, { autoAlpha: 0, scale: .4, duration: .7, ease: 'back.out(2.2)', stagger: { each: .02 }, clearProps: 'transform,opacity,visibility', ...vars });
  }

  /** Halftone: dots that shrink away from a point, like old print. Made once as tiny SVGs and used as masks,
      so any colour (accent, mood, chosen accent) can be printed through them. */
  function halftone() {
    const N = 22, C = 10, W = N * C;
    const make = v => {
      let s = '';
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const cx = (x + (y % 2) * .5 + .5) * C, cy = (y + .5) * C, r = C * .62 * Math.max(0, Math.min(1, v(cx / W, cy / W)));
        if (r > .45) s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"/>`;
      }
      return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}">${s}</svg>`)}")`;
    };
    const st = document.documentElement.style;
    st.setProperty('--ht-radial', make((x, y) => 1.05 - Math.hypot(x - .5, y - .5) * 2.1));
    st.setProperty('--ht-corner', make((x, y) => 1 - Math.hypot(1 - x, y) * 1.05));
  }
  halftone();

  /** Felt: a fine grain, drawn once on a canvas (one for light, one for dark pages). */
  function felt(rgb, max, key) {
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.random(); d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = v > .5 ? (v - .5) * 2 * max : 0; }
    g.putImageData(img, 0, 0);
    c.toBlob(b => document.documentElement.style.setProperty(key, `url(${URL.createObjectURL(b)})`));
  }
  felt([62, 44, 31], 46, '--felt-l'); felt([255, 238, 214], 30, '--felt-d');

  /** Every switch group (a row of pills, the language switch) gets a knob that slides to the chosen one, fast then slow,
      like Log in / Sign up. Pages are often drawn again on a click, so the knob remembers where it was and slides on from there. */
  const knobAt = new Map(), isOn = b => b.classList.contains('on') || b.getAttribute('aria-pressed') === 'true';
  function segs(root = document) {
    if (reduced()) return;
    root.querySelectorAll('.row, .langsw').forEach(g => {
      const kids = [...g.children].filter(c => !c.classList.contains('seg-knob')), on = kids.find(isOn);
      if (!on || kids.length < 2 || kids.some(c => c.tagName !== 'BUTTON' || c.classList.contains('mood-pill') || c.classList.contains('swatch'))) return;
      if (!on.offsetWidth) return;   // hidden right now (e.g. phone layout): measure later
      let k = g.querySelector(':scope > .seg-knob'); const fresh = !k;
      if (fresh) { k = document.createElement('i'); k.className = 'seg-knob'; k.setAttribute('aria-hidden', 'true'); g.prepend(k); g.classList.add('segs'); }
      const key = (kids[0].dataset.act || '') + (kids[0].dataset.k || '') + (g.classList.contains('langsw') ? g.closest('.dock') ? 'dock' : 'box' : ''), from = knobAt.get(key);
      const to = { x: on.offsetLeft, y: on.offsetTop, width: on.offsetWidth, height: on.offsetHeight }; knobAt.set(key, to);
      if (fresh && !from) gsap.set(k, to); else gsap.fromTo(k, fresh ? from : { x: '+=0' }, { ...to, duration: .55, ease: 'expo.out', overwrite: true });
    });
  }
  let rz = 0; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => segs(), 150); });
  /* after a click the chosen one may change (or the page is drawn again): move the knobs on the next frame */
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.segs')) requestAnimationFrame(() => segs()); });
  /* a soft ripple from the point where a button is pressed */
  document.addEventListener('pointerdown', e => {
    const b = e.target.closest && e.target.closest('.btn'); if (!b || b.disabled || reduced()) return;
    const r = b.getBoundingClientRect(), box = document.createElement('span'), dot = document.createElement('i'); box.className = 'rip';
    dot.style.left = e.clientX - r.left + 'px'; dot.style.top = e.clientY - r.top + 'px'; box.appendChild(dot); b.appendChild(box);
    dot.addEventListener('animationend', () => box.remove(), { once: true });
  });

  /** A new page was painted: forget the old page's animations and set up this one's. */
  function enter(root) {
    requestAnimationFrame(() => segs());
    if (mm) mm.revert();
    mm = gsap.matchMedia();
    mm.add({ move: '(prefers-reduced-motion: no-preference)', still: '(prefers-reduced-motion: reduce)' }, c => {
      if (c.conditions.still) { showAll(root); return; }
      reveal(root); words(root); tilt(root);
    });
  }
  return { transition, enter, reduced, onView, results, count, pop, showAll, segs };
})();
