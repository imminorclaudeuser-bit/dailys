"use strict";
/* Playground: floating shapes and wobbly lines drawn on a canvas behind a section.
   The cursor (or a finger) pushes shapes away and plucks the lines like strings; a fast flick throws shapes.
   Each mood has its own colours and way of moving. */
const Play = (() => {
  const PAL = {
    base: ['#F0A04B', '#E3672B', '#6F8DB5', '#F4B6C2', '#2A231E'],
    calm: ['#FFB25B', '#F7D2A1', '#E9874A', '#FFF1DE'],
    tense: ['#FFD23F', '#FF8A65', '#FFE3B3', '#5A1E22'],
    quiet: ['#FFF4E2', '#D9E6F7', '#F6C28B', '#5C7AA8'],
    lively: ['#E0457B', '#FF7FA8', '#7DE2FC', '#FFFFFF']
  };
  /* how each mood moves: speed, gravity (quiet things sink like rain), which shapes */
  const FEEL = {
    base: { speed: .35, gravity: 0, kinds: ['circle', 'ring', 'square', 'tri'] },
    calm: { speed: .25, gravity: 0, kinds: ['circle', 'ring', 'circle'] },
    tense: { speed: .9, gravity: 0, kinds: ['tri', 'square', 'tri'] },
    quiet: { speed: .2, gravity: .015, kinds: ['drop', 'circle', 'drop'] },
    lively: { speed: .7, gravity: 0, kinds: ['star', 'circle', 'square', 'ring'] }
  };
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* wide: the canvas spans the whole window width (pages with a narrow centre column) and follows the cursor anywhere */
  function mount(canvas, area, { count = 16, lines = 3, wide = false } = {}) {
    const hit = wide ? window : area, out = wide ? document.documentElement : area;
    const ctx = canvas.getContext('2d'), ptr = { x: -999, y: -999, vx: 0, vy: 0 };
    let W = 0, H = 0, mood = 'base', shapes = [], strings = [], raf = 0, visible = true, t = 0;
    const R = (a, b) => a + Math.random() * (b - a);
    const size = () => {
      const d = Math.min(devicePixelRatio || 1, 1.5), w0 = W, h0 = H; W = canvas.clientWidth; H = canvas.clientHeight;
      if (w0 > 1 && h0 > 1) shapes.forEach(s => { s.x *= W / w0; s.y *= H / h0; });          // keep shapes spread when the window changes size
      else shapes.forEach(s => { s.x = R(0, W); s.y = R(0, H); });
      canvas.width = W * d; canvas.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0);
      strings = Array.from({ length: lines }, (_, i) => ({ y: H * (i + 1) / (lines + 1), off: new Float32Array(32), vel: new Float32Array(32), ph: R(0, 6) }));
    };
    const shape = () => {
      const f = FEEL[mood], c = PAL[mood];
      return { x: R(0, W), y: R(0, H), vx: R(-1, 1) * f.speed, vy: R(-1, 1) * f.speed, r: R(10, 30), rot: R(0, 6.3), vr: R(-.01, .01),
        kind: f.kinds[Math.floor(R(0, f.kinds.length))], color: c[Math.floor(R(0, c.length))], seed: R(0, 100), ht: Math.random() < .4 };
    };
    function setMood(m) {
      mood = PAL[m] ? m : 'base';
      if (!shapes.length) shapes = Array.from({ length: count }, shape);
      else shapes = shapes.map(s => { const n = shape(); return { ...s, kind: n.kind, color: n.color, ht: n.ht }; });   // same positions, new look
    }

    /* halftone: some shapes are printed in dots instead of a flat colour */
    const pats = {};
    const dotsOf = c => {
      if (pats[c]) return pats[c];
      const t = document.createElement('canvas'); t.width = t.height = 7; const g = t.getContext('2d');
      g.fillStyle = c; g.beginPath(); g.arc(3.5, 3.5, 2.3, 0, 6.29); g.fill();
      return (pats[c] = ctx.createPattern(t, 'repeat'));
    };
    function drawShape(s) {
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot); ctx.strokeStyle = s.color; ctx.fillStyle = s.ht ? dotsOf(s.color) : s.color; ctx.lineWidth = 3;
      const r = s.ht ? s.r * 1.5 : s.r; ctx.beginPath();
      if (s.kind === 'circle') { ctx.arc(0, 0, r, 0, 6.29); ctx.fill(); }
      else if (s.kind === 'ring') { ctx.arc(0, 0, r, 0, 6.29); ctx.stroke(); }
      else if (s.kind === 'square') { ctx.roundRect(-r, -r, r * 2, r * 2, r * .35); ctx.fill(); }
      else if (s.kind === 'tri') { ctx.moveTo(0, -r); ctx.lineTo(r * .9, r * .7); ctx.lineTo(-r * .9, r * .7); ctx.closePath(); ctx.fill(); }
      else if (s.kind === 'drop') { ctx.rotate(-s.rot); ctx.moveTo(0, -r * 1.3); ctx.bezierCurveTo(r, -r * .2, r, r * .9, 0, r * .9); ctx.bezierCurveTo(-r, r * .9, -r, -r * .2, 0, -r * 1.3); ctx.fill(); }
      else { for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, q = i % 2 ? r * .45 : r; ctx.lineTo(Math.cos(a) * q, Math.sin(a) * q); } ctx.closePath(); ctx.fill(); }
      ctx.restore();
    }

    function frame() {
      raf = requestAnimationFrame(frame); t += 1 / 60;
      ctx.clearRect(0, 0, W, H);
      const f = FEEL[mood];
      /* wobbly lines: a slow wave plus a string that the cursor plucks */
      ctx.lineWidth = 2; ctx.strokeStyle = PAL[mood][0]; ctx.globalAlpha = .55;
      for (const s of strings) {
        const n = s.off.length;
        for (let i = 1; i < n - 1; i++) {
          const x = i / (n - 1) * W, near = Math.abs(ptr.x - x) < W / n && Math.abs(ptr.y - (s.y + s.off[i])) < 26;
          if (near) s.vel[i] += ptr.vy * .35;
          s.vel[i] += (s.off[i - 1] + s.off[i + 1] - 2 * s.off[i]) * .18 - s.off[i] * .02;   // neighbours pull, string returns to rest
          s.vel[i] *= .965;
        }
        for (let i = 1; i < n - 1; i++) s.off[i] += s.vel[i];
        ctx.beginPath();
        for (let i = 0; i < n; i++) { const x = i / (n - 1) * W, y = s.y + s.off[i] + Math.sin(i * .35 + t * 1.2 + s.ph) * 6; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
      ctx.globalAlpha = .9;
      /* shapes: drift, get pushed by the cursor, bounce off the edges */
      for (const s of shapes) {
        const dx = s.x - ptr.x, dy = s.y - ptr.y, d = Math.hypot(dx, dy), reach = 110 + s.r;
        if (d < reach && d > 0) { const k = (1 - d / reach) * 1.6; s.vx += dx / d * k + ptr.vx * .06; s.vy += dy / d * k + ptr.vy * .06; s.vr += ptr.vx * .0008; }
        s.vx += Math.sin(t * .7 + s.seed) * .01 * f.speed; s.vy += Math.cos(t * .6 + s.seed) * .01 * f.speed + f.gravity;
        s.vx *= .97; s.vy *= .97; s.vr *= .99;
        const min = f.speed * .3, sp = Math.hypot(s.vx, s.vy); if (sp < min) { s.vx += (s.vx / (sp || 1)) * .02; s.vy += (s.vy / (sp || 1)) * .02; }
        s.x += s.vx; s.y += s.vy; s.rot += s.vr + .002;
        if (s.x < s.r || s.x > W - s.r) { s.vx *= -.8; s.x = Math.min(W - s.r, Math.max(s.r, s.x)); }
        if (s.y > H + s.r && f.gravity) { s.y = -s.r; s.x = R(0, W); }                   // rain falls through and starts again
        else if (s.y < s.r || s.y > H - s.r) { s.vy *= -.8; s.y = Math.min(H - s.r, Math.max(s.r, s.y)); }
        drawShape(s);
      }
      ctx.globalAlpha = 1; ptr.vx *= .8; ptr.vy *= .8;
    }

    const move = e => { const b = canvas.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top; ptr.vx = x - (ptr.x < -900 ? x : ptr.x); ptr.vy = y - (ptr.y < -900 ? y : ptr.y); ptr.x = x; ptr.y = y; };
    const leave = () => { ptr.x = ptr.y = -999; };
    hit.addEventListener('pointermove', move, { passive: true }); out.addEventListener('pointerleave', leave);
    const run = () => { cancelAnimationFrame(raf); if (visible && !document.hidden && !reduced()) frame(); else { raf = 0; ctx.clearRect(0, 0, W, H); shapes.forEach(drawShape); } };
    const ro = new ResizeObserver(() => { size(); if (!shapes.length) setMood(mood); run(); }); ro.observe(canvas);
    const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; run(); }); io.observe(canvas);
    const vis = () => run(); document.addEventListener('visibilitychange', vis);
    size(); setMood('base'); run();
    return {
      setMood,
      destroy() { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', vis); hit.removeEventListener('pointermove', move); out.removeEventListener('pointerleave', leave); }
    };
  }
  return { mount };
})();
