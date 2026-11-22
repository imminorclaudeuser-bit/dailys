/* Whisper speech-to-text in a background worker, fully on the device (transformers.js + ONNX Runtime Web).
   The model files live on this server (/models/whisper-base); nothing is sent anywhere. */
import { pipeline, env } from '/vendor/transformers/transformers.min.js';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.backends.onnx.wasm.wasmPaths = '/vendor/transformers/';

let asr = null;
self.onmessage = async ({ data }) => {
  try {
    asr = asr || await pipeline('automatic-speech-recognition', 'whisper-base', {
      dtype: 'q8', device: 'wasm',
      progress_callback: p => { if (p.status === 'progress' && p.total) self.postMessage({ type: 'loading', file: p.file, pct: Math.round(p.loaded / p.total * 100) }); }
    });
    self.postMessage({ type: 'working' });
    /* the spoken language is given explicitly: without it this Whisper build falls back to English and translates */
    const out = await asr(data.audio, { language: data.language === 'ru' ? 'russian' : 'english', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
    const chunks = (out.chunks || []).map(c => ({ s: c.timestamp[0] || 0, e: c.timestamp[1] ?? null, t: c.text.trim() })).filter(c => c.t);
    self.postMessage({ type: 'done', text: out.text.trim(), chunks });
  } catch (e) {
    self.postMessage({ type: 'error', message: String((e && e.message) || e) });
  }
};
