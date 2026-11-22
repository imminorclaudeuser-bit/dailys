'use strict';
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
/** Загружает движок оформления в Node (без браузера) и возвращает его функции. */
function loadEngine() {
  const src = fs.readFileSync(path.join(__dirname, '../public/engine.js'), 'utf8') +
    '\n;globalThis.__e={analyzeText,decide,makeTitle,DEMO,DEMO_EN,linkKind,synthSongBlob,hash,esc};';
  const ctx = { console, Blob, document: {}, window: {} }; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
  return ctx.__e;
}
/** Корректный день для API, собранный тем же движком, что работает в браузере. */
function validDay(i = 0, over = {}) {
  const E = loadEngine(), x = E.DEMO[i];
  const textInfo = E.analyzeText(x.text), photoInfo = { count: 1, colors: x.ph, accent: x.ph[0], brightness: .5, saturation: .5 };
  const style = JSON.parse(JSON.stringify(E.decide({ textInfo, photoInfo, song: x.song, weather: null, date: x.date })));
  const tiny = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]), Buffer.alloc(64, 7)]).toString('base64');
  return { date: x.date, dateOn: true, voiceOn: true, text: x.text, photos: [tiny],
    song: { kind: 'link', url: 'https://example.com/song', title: 'Т', artist: 'А', tempo: x.song.tempo, mode: x.song.mode, bpm: null, energy: null, fileName: '' },
    weather: null, geo: null, photoInfo, textInfo: JSON.parse(JSON.stringify(textInfo)), style, ...over };
}
module.exports = { loadEngine, validDay };
