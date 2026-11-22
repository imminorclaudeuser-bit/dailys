"use strict";
/* Voice messages (recording + Whisper transcript) and atmosphere videos (recording + on-device mood guess).
   Everything here runs in the browser: Whisper in whisper-worker.js, the scene model through MediaPipe. */
const pickType = list => (window.MediaRecorder && list.find(t => MediaRecorder.isTypeSupported(t))) || '';

const Voice = (() => {
  const MAX_MS = 180000;   // three minutes
  let rec = null, worker = null;
  /** Records from the microphone until stop() (or 3 minutes); resolves with the audio Blob. onTick(ms) is called while recording. */
  async function start(onTick) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const type = pickType(['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']), parts = [];
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    rec.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
    const t0 = Date.now(), timer = setInterval(() => { const ms = Date.now() - t0; onTick(ms); if (ms >= MAX_MS) stop(); }, 200);
    rec.start(250);
    return new Promise(res => { rec.onstop = () => { clearInterval(timer); stream.getTracks().forEach(t => t.stop()); res(new Blob(parts, { type: rec.mimeType || 'audio/webm' })); }; });
  }
  function stop() { if (rec && rec.state !== 'inactive') rec.stop(); }
  /** Blob → 16 kHz mono samples, the format Whisper expects. */
  async function pcm(blob) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    try { return (await ctx.decodeAudioData(await blob.arrayBuffer())).getChannelData(0).slice(); } finally { ctx.close(); }
  }
  /** Turns a recording into text with timed subtitle lines. onStatus gets loading progress and "working". */
  async function transcribe(blob, onStatus, language = 'en') {
    const audio = await pcm(blob);
    worker = worker || new Worker('/whisper-worker.js', { type: 'module' });
    return new Promise((res, rej) => {
      worker.onmessage = ({ data }) => { if (data.type === 'done') res(data); else if (data.type === 'error') rej(new Error(data.message)); else onStatus(data); };
      worker.onerror = e => rej(new Error(e.message || 'worker'));
      worker.postMessage({ audio, language }, [audio.buffer]);
    });
  }
  const supported = () => !!(navigator.mediaDevices && window.MediaRecorder);
  return { start, stop, transcribe, supported };
})();

const Atmo = (() => {
  const MAX_S = 30;
  let rec = null, cls = null;
  /* ImageNet scene/object names (MediaPipe classifier) that hint at a mood */
  const HINTS = {
    calm: ['candle', 'teapot', 'cup', 'coffee mug', 'espresso', 'book', 'library', 'quilt', 'studio couch', 'pillow', 'lakeside', 'seashore', 'sandbar', 'valley', 'alp', 'daisy', 'vase', 'lampshade', 'table lamp', 'wool', 'rocking chair', 'park bench', 'hammock', 'window shade', 'cradle'],
    lively: ['balloon', 'carousel', 'stage', 'theater curtain', 'restaurant', 'plate', 'pizza', 'ice cream', 'fountain', 'toyshop', 'confectionery', 'grocery', 'swing', 'maypole', 'soccer ball', 'basketball', 'volleyball', 'go-kart', 'sombrero', 'pinwheel', 'bicycle', 'bakery', 'jersey', 'fireboat'],
    quiet: ['umbrella', 'church', 'monastery', 'boathouse', 'snowmobile', 'ski', 'dogsled', 'lighthouse', 'breakwater', 'window screen', 'cloak', 'bookcase', 'shoji', 'mosquito net'],
    tense: ['traffic light', 'police van', 'ambulance', 'fire engine', 'streetcar', 'trolleybus', 'cab', 'minivan', 'passenger car', 'crane', 'monitor', 'screen', 'desktop computer', 'laptop', 'notebook', 'computer keyboard', 'mouse', 'web site', 'scoreboard', 'parking meter', 'barrier']
  };

  /** Records the given camera stream (the same one the face reader watches), up to 30 s. Resolves with the video Blob. */
  async function record(stream, onTick) {
    const audio = stream.getAudioTracks().length > 0, parts = [];
    const type = pickType(audio ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']);
    try { rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 2_500_000 }); }
    catch (e) { rec = new MediaRecorder(stream); }   // let the browser pick its own format
    rec.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
    const t0 = Date.now(), timer = setInterval(() => { const s = (Date.now() - t0) / 1000; onTick(s); if (s >= MAX_S) stop(); }, 200);
    rec.start(500);
    return new Promise(res => { rec.onstop = () => { clearInterval(timer); res(new Blob(parts, { type: (rec.mimeType || 'video/webm').split(';')[0] })); }; });
  }
  function stop() { if (rec && rec.state !== 'inactive') rec.stop(); }

  /** Length of a video file in seconds. */
  async function duration(blob) {
    const v = await load(blob), d = await lengthOf(v);
    drop(v); return d;
  }
  function load(blob) {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
    /* kept on the page (invisible) while it is read: Safari does not load videos that are not on the page */
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(v); v.src = URL.createObjectURL(blob); v.load();
    return new Promise((res, rej) => {
      const tm = setTimeout(() => { drop(v); rej(new Error('The video did not load')); }, 15000);
      v.onloadeddata = () => { clearTimeout(tm); res(v); };
      v.onerror = () => { clearTimeout(tm); drop(v); rej(new Error('This video format cannot be read here')); };
    });
  }
  const drop = v => { URL.revokeObjectURL(v.src); v.remove(); };
  /* moves to a time; never waits more than 3 s, so a stubborn file cannot stop the scan */
  const seek = (v, t) => new Promise(r => {
    const done = () => { clearTimeout(tm); v.removeEventListener('seeked', done); r(); }, tm = setTimeout(done, 3000);
    v.addEventListener('seeked', done); v.currentTime = Math.max(0, t);
  });
  /* recorded WebM files have no length written in them ("Infinity") until the player has gone to the end */
  async function lengthOf(v, known) {
    if (isFinite(v.duration) && v.duration > 0) return v.duration;
    await seek(v, 1e9);
    if (isFinite(v.duration) && v.duration > 0) return v.duration;
    const end = v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0;
    return isFinite(end) && end > 0 ? end : known || 1;
  }

  async function classifier() {
    if (cls) return cls;
    const lib = await import('/vendor/mediapipe/vision_bundle.mjs'), files = await lib.FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
    cls = await lib.ImageClassifier.createFromOptions(files, { baseOptions: { modelAssetPath: '/vendor/mediapipe/efficientnet_lite0.tflite' }, maxResults: 5, runningMode: 'IMAGE' });
    return cls;
  }

  /** Guesses the mood of a video from its light, colours, motion, sound and what is in it.
      face: a face summary already made while filming; without it the face is read from the file.
      The person still chooses the true mood. */
  async function analyze(blob, face, known) {
    const v = await load(blob), dur = await lengthOf(v, known);
    const S = 48, small = Object.assign(document.createElement('canvas'), { width: S, height: S }), g = small.getContext('2d', { willReadFrequently: true });
    const big = Object.assign(document.createElement('canvas'), { width: 224, height: 224 }), bg = big.getContext('2d');
    const model = await classifier().catch(() => null), labels = {};
    let lum = 0, sat = 0, warm = 0, motion = 0, n = 0;
    const N = 6;
    for (let i = 0; i < N; i++) {
      const t = Math.min(dur - .3, (i + .5) / N * dur);
      await seek(v, Math.max(0, t)); g.drawImage(v, 0, 0, S, S); const a = g.getImageData(0, 0, S, S).data;
      if (model && i % 2 === 0) { try { bg.drawImage(v, 0, 0, 224, 224); for (const c of model.classify(big).classifications[0].categories) labels[c.categoryName] = (labels[c.categoryName] || 0) + c.score; } catch (e) { /* the scene names are a bonus */ } }
      await seek(v, Math.max(0, t) + .2); g.drawImage(v, 0, 0, S, S); const b = g.getImageData(0, 0, S, S).data;
      for (let j = 0; j < a.length; j += 4) {
        const r = a[j], gr = a[j + 1], bl = a[j + 2], mx = Math.max(r, gr, bl), mn = Math.min(r, gr, bl);
        lum += (.2126 * r + .7152 * gr + .0722 * bl) / 255; sat += (mx - mn) / 255;   /* chroma: dark pixels do not count as colourful */ warm += (r - bl) / 255;
        motion += (Math.abs(r - b[j]) + Math.abs(gr - b[j + 1]) + Math.abs(bl - b[j + 2])) / 765; n++;
      }
    }
    if (!face) { try { face = await Face.scanVideo(v, Array.from({ length: 12 }, (_, i) => Math.min(dur - .2, (i + .5) / 12 * dur)), seek, dur); } catch (e) { face = { seen: 0 }; } }
    drop(v);
    lum /= n; sat /= n; warm /= n; motion /= n;
    let loud = null;   // loudness of the sound track (videos without sound are fine)
    try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const x = (await ctx.decodeAudioData(await blob.arrayBuffer())).getChannelData(0); ctx.close(); let s = 0, k = 0; for (let i = 0; i < x.length; i += 16) { s += x[i] * x[i]; k++; } loud = Math.sqrt(s / k); } catch (e) { /* no sound */ }

    const sc = { calm: .1, tense: .1, quiet: .1, lively: .1 };
    sc.lively += Math.max(0, lum - .5) * 1.2 + Math.max(0, sat - .25) * 1.5 + motion * 4 * Math.min(1, lum / .4) + (loud == null ? 0 : Math.max(0, loud - .08) * 4);
    sc.calm += Math.max(0, warm) * 1.5 + Math.max(0, .06 - motion) * 4 * Math.min(1, lum / .45) + Math.max(0, .25 - Math.abs(lum - .55)) * 1.2;
    sc.quiet += (Math.max(0, .45 - lum) * 1.2 + Math.max(0, .15 - sat) * 1.5 + Math.max(0, -warm) * 1.5) * (motion > .06 ? .5 : 1) + (loud == null ? 0 : Math.max(0, .03 - loud) * 6);   /* quiet = dim AND still */
    sc.tense += Math.max(0, .35 - lum) * (motion > .05 ? 1.6 : .8) + (loud == null ? 0 : Math.max(0, loud - .15) * 3) + Math.max(0, motion - .1) * 2;
    const top = Object.entries(labels).sort((x, y) => y[1] - x[1]).slice(0, 4);
    for (const [name, score] of top) for (const m in HINTS) if (HINTS[m].some(h => name.includes(h))) sc[m] += score / 3 * .8;
    const sum = Object.values(sc).reduce((x, y) => x + y, 0);
    for (const m in sc) sc[m] /= sum;
    const mood = Object.keys(sc).sort((x, y) => sc[y] - sc[x])[0];
    const words = [lum > .6 ? 'bright' : lum < .35 ? 'dim' : 'softLight', warm > .08 ? 'warm' : warm < -.04 ? 'cool' : 'neutral', sat > .3 ? 'colourful' : sat < .1 ? 'muted' : null,
      motion > .06 ? 'busy' : motion < .02 ? 'still' : 'gentle', loud == null ? null : loud > .12 ? 'loud' : loud < .03 ? 'quietSound' : 'softSound'].filter(Boolean);
    const things = top.filter(([, s]) => s / 3 > .1).map(([name]) => name.split(',')[0]).slice(0, 3);
    /* the whole scan: atmosphere and face together; the face counts fully once it is seen half of the time */
    const fw = face && face.seen ? Math.min(1, face.seen / .5) * .5 : 0, all = {};
    for (const m in sc) all[m] = sc[m] * (1 - fw) + (fw ? face.moods[m] * fw : 0);
    const overall = Object.keys(all).sort((x, y) => all[y] - all[x])[0], r2 = x => Math.round(x * 100) / 100;
    return { mood: overall, conf: r2(all[overall]), scene: { mood, conf: r2(sc[mood]), scores: Object.fromEntries(Object.entries(sc).map(([k, x]) => [k, r2(x)])) },
      face: face || { seen: 0 }, words, things, dur: Math.round(dur * 10) / 10 };
  }
  const supported = () => !!(navigator.mediaDevices && window.MediaRecorder);
  return { record, stop, duration, analyze, supported, MAX_S };
})();
