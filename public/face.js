"use strict";
/* Face mood: reads facial expressions from the camera, on this device only (nothing is uploaded).
   Google MediaPipe Face Landmarker (public/vendor/mediapipe) gives 478 face points and 52 expression scores.
   Accuracy comes from two things:
   1. A personal baseline: the first second with a face is your resting face; only changes from it count
      (resting brows, squint and lips differ a lot between people).
   2. Rules checked against real photos: a laugh shows the lower teeth more than an open jaw,
      a frown is brows down with no smile, sadness is inner brows up, lip corners down and a raised chin. */
const Face = (() => {
  const BASE = '/vendor/mediapipe', CALIB = 30;
  /* MediaPipe expression scores used, by FACS action unit (AU):
     AU1 browInnerUp · AU2 browOuterUp · AU4 browDown · AU5 eyeWide · AU6 cheekSquint (MediaPipe rarely fires it, so eyeSquint helps)
     AU7 eyeSquint · AU9 noseSneer · AU12 mouthSmile · AU14 mouthDimple · AU15 mouthFrown · AU16 mouthLowerDown
     AU20 mouthStretch · AU23 mouthPress · AU26 jawOpen */
  const KEYS = ['browInnerUp', 'browOuterUp', 'browDown', 'eyeWide', 'cheekSquint', 'eyeSquint', 'noseSneer', 'mouthSmile', 'mouthDimple', 'mouthFrown', 'mouthLowerDown', 'mouthStretch', 'mouthPress', 'jawOpen', 'smileAsym', 'dimpleAsym'];
  let lib = null, landmarker = null, stream = null, ownStream = false, raf = 0, lastTime = -1, smooth = null, base = null, calib = [], steady = 0, lastTop = '';

  async function load() {
    if (landmarker) return;
    lib = lib || await import(BASE + '/vision_bundle.mjs');
    const files = await lib.FilesetResolver.forVisionTasks(BASE + '/wasm');
    const make = delegate => lib.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: BASE + '/face_landmarker.task', delegate }, outputFaceBlendshapes: true, runningMode: 'VIDEO', numFaces: 1 });
    landmarker = await make('GPU').catch(() => make('CPU'));
  }

  /** The 12 expression scores we use; left and right sides are averaged. */
  function features(cats) {
    const b = {}; cats.forEach(c => { b[c.categoryName] = c.score; });
    const f = Object.fromEntries(KEYS.map(k => [k, b[k] ?? ((b[k + 'Left'] || 0) + (b[k + 'Right'] || 0)) / 2]));
    f.smileAsym = Math.abs((b.mouthSmileLeft || 0) - (b.mouthSmileRight || 0));       // contempt is a one-sided smile (R12A+R14A)
    f.dimpleAsym = Math.abs((b.mouthDimpleLeft || 0) - (b.mouthDimpleRight || 0));
    return f;
  }

  /** Basic emotions from FACS action units (Ekman's prototypes), measured as change from the person's resting face. */
  const EMO = {
    happy: au => (au[12] * 1.2 + au[6] * .5) * (1 - au[26]) * (1 - au[16]),       // AU6 + AU12, closed smile
    joyful: au => au[12] * (au[26] * 2.5 + au[16] * 2),                             // big smile with the jaw/teeth open (laughing)
    surprised: au => (au[1] + au[2] + au[5] * 1.5 + au[26]) / 2 * (1 - au[12]),     // AU1 + AU2 + AU5 + AU26
    sad: au => (au[1] * 1.2 + au[4] * .6 + au[15] * 1.8) / 1.6 * (1 - au[12]),     // AU1 + AU4 + AU15
    afraid: au => (au[1] + au[2] + au[4] + au[5] + au[20] + au[26]) / 3 * (1 - au[12]),   // AU1+2+4+5+7+20+26
    angry: au => (au[4] * 1.3 + au[7] * .6 + au[23] * 1.2 + au[5] * .4) / 1.6 * (1 - au[12]),   // AU4 + AU5 + AU7 + AU23
    disgusted: au => (au[9] * 1.6 + au[15] + au[16] * .6) / 1.6 * (1 - au[12]),     // AU9 + AU15 + AU16
    contempt: au => (au.smileAsym * 1.5 + au.dimpleAsym) * (1 - au[26]),            // R12A + R14A
    neutral: () => .1
  };
  /* emotion → the diary's four moods */
  const MOOD_OF = { happy: 'calm', neutral: 'calm', joyful: 'lively', surprised: 'lively', sad: 'quiet', afraid: 'tense', angry: 'tense', disgusted: 'tense', contempt: 'tense' };

  function moods(f, b = base) {
    const d = k => Math.max(0, f[k] - b[k]);
    const au = { 1: d('browInnerUp'), 2: d('browOuterUp'), 4: d('browDown'), 5: d('eyeWide'), 6: Math.max(d('cheekSquint'), d('eyeSquint') * .6), 7: d('eyeSquint'),
      9: d('noseSneer'), 12: Math.min(1, d('mouthSmile') * 1.3), 14: d('mouthDimple'), 15: d('mouthFrown'), 16: d('mouthLowerDown'), 20: d('mouthStretch'),
      23: d('mouthPress'), 26: d('jawOpen'), smileAsym: d('smileAsym'), dimpleAsym: d('dimpleAsym') };
    const emo = Object.fromEntries(Object.entries(EMO).map(([k, fn]) => [k, Math.max(0, fn(au))]));
    const r = { calm: 0, tense: 0, quiet: 0, lively: 0 };
    for (const k in emo) r[MOOD_OF[k]] += emo[k];
    const sum = r.lively + r.calm + r.tense + r.quiet;
    for (const k in r) r[k] /= sum;
    const emotion = Object.keys(emo).sort((a, c) => emo[c] - emo[a])[0];
    return { r, energy: sum - .1, emotion };
  }

  /** Starts reading the face; onFrame gets { face, calibrating, moods, top, conf, emotion, steady } every frame.
      Pass a stream to share a camera that is also recording; otherwise the front camera is opened here. */
  async function start(video, canvas, onFrame, shared) {
    stop();
    ownStream = !shared;
    stream = shared || await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream; video.muted = true; await video.play();
    await load();
    const ctx = canvas.getContext('2d'), draw = new lib.DrawingUtils(ctx), FL = lib.FaceLandmarker;
    recalibrate();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (video.readyState < 2 || video.currentTime === lastTime) return;
      lastTime = video.currentTime;
      if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
      const res = landmarker.detectForVideo(video, performance.now()), pts = res.faceLandmarks && res.faceLandmarks[0];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!pts) { steady = 0; onFrame({ face: false }); return; }
      draw.drawConnectors(pts, FL.FACE_LANDMARKS_TESSELATION, { color: 'rgba(255,255,255,.18)', lineWidth: .6 });
      draw.drawConnectors(pts, FL.FACE_LANDMARKS_FACE_OVAL, { color: '#F0A04B', lineWidth: 2 });
      [FL.FACE_LANDMARKS_LIPS, FL.FACE_LANDMARKS_LEFT_EYEBROW, FL.FACE_LANDMARKS_RIGHT_EYEBROW, FL.FACE_LANDMARKS_LEFT_EYE, FL.FACE_LANDMARKS_RIGHT_EYE]
        .forEach(c => draw.drawConnectors(pts, c, { color: '#FFFFFF', lineWidth: 1.6 }));
      const f = features((res.faceBlendshapes[0] || {}).categories || []);
      if (!base) {                                    // learning the resting face
        calib.push(f);
        if (calib.length >= CALIB) base = Object.fromEntries(KEYS.map(k => [k, calib.reduce((a, x) => a + x[k], 0) / calib.length]));
        onFrame({ face: true, calibrating: true, progress: calib.length / CALIB }); return;
      }
      const { r, energy, emotion } = moods(f);
      smooth = smooth ? Object.fromEntries(Object.keys(r).map(k => [k, smooth[k] * .85 + r[k] * .15])) : r;
      const top = Object.keys(smooth).sort((a, b) => smooth[b] - smooth[a])[0];
      steady = top === lastTop ? steady + 1 : 0; lastTop = top;
      /* confidence: how clearly one mood leads, scaled down when the face barely moves */
      const conf = Math.min(1, smooth[top] * Math.min(1, .45 + energy * 2));
      onFrame({ face: true, moods: smooth, raw: r, top, conf, emotion, steady: steady > 15 });
    };
    tick();
  }
  function recalibrate() { base = null; calib = []; smooth = null; steady = 0; lastTop = ''; }

  /** A still frame from the camera as a JPEG (not mirrored), for the day's photos. */
  function snapshot(video, max = 900) {
    const k = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight)), c = document.createElement('canvas');
    c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', .85);
  }
  function stop() {
    cancelAnimationFrame(raf); raf = 0; lastTime = -1;
    if (stream && ownStream) stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  /** Sums up face readings over a video: how often a face was seen, the mood split, the main expressions
      and a 20-step timeline. samples: [{ t, r, emotion }] (t in seconds), frames: all frames looked at. */
  function summarize(samples, frames, dur) {
    const seen = frames ? samples.length / frames : 0;
    if (!samples.length) return { seen: 0 };
    const avg = { calm: 0, tense: 0, quiet: 0, lively: 0 }, emo = {};
    for (const x of samples) { for (const k in avg) avg[k] += x.r[k] / samples.length; emo[x.emotion] = (emo[x.emotion] || 0) + 1 / samples.length; }
    const mood = Object.keys(avg).sort((a, b) => avg[b] - avg[a])[0];
    const emotions = Object.entries(emo).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([e, p]) => [e, Math.round(p * 100) / 100]);
    const timeline = Array.from({ length: 20 }, (_, i) => {
      const part = samples.filter(x => Math.min(19, Math.floor(x.t / Math.max(dur, .1) * 20)) === i);
      if (!part.length) return null;
      const m = { calm: 0, tense: 0, quiet: 0, lively: 0 }; part.forEach(x => { for (const k in m) m[k] += x.r[k]; });
      return Object.keys(m).sort((a, b) => m[b] - m[a])[0];
    });
    const round = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 100) / 100]));
    return { seen: Math.round(seen * 100) / 100, mood, conf: Math.round(avg[mood] * 100) / 100, moods: round(avg), emotions, timeline };
  }

  /** Reads the face in a video file at the given times. There is no resting face to learn from,
      so the calmest value of each movement (at most a small amount) is taken as the resting face. */
  async function scanVideo(v, times, seek, dur) {
    await load();
    const frames = [];
    for (const t of times) {
      await seek(v, t);
      const res = landmarker.detectForVideo(v, performance.now()), c = res.faceBlendshapes && res.faceBlendshapes[0];
      if (c) frames.push({ t, f: features(c.categories) });
    }
    if (!frames.length) return { seen: 0 };
    const rest = Object.fromEntries(KEYS.map(k => [k, Math.min(.15, ...frames.map(x => x.f[k]))]));
    return summarize(frames.map(x => { const m = moods(x.f, rest); return { t: x.t, r: m.r, emotion: m.emotion }; }), times.length, dur || v.duration);
  }
  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  return { start, stop, snapshot, supported, recalibrate, summarize, scanVideo };
})();
