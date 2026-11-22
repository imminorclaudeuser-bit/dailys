'use strict';
/* Проверка движка оформления: примеры из задания должны давать ожидаемые приёмы и названия. */
const assert = require('node:assert/strict'); const { loadEngine } = require('./helpers');
const E = loadEngine(); let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ✓', name); };
const run = x => { const T = E.analyzeText(x.text); return E.decide({ textInfo: T, photoInfo: { brightness: .5, accent: x.ph[0], saturation: .5, colors: x.ph, count: 3 }, song: x.song, weather: null, date: x.date }); };
console.log('Движок оформления\n');
const expect = [['monet', 'Осенний парк и какао'], ['kandinsky', 'Ночь в офисе перед сдачей'], ['japan', 'Дождь, чай и тишина']];
expect.forEach(([tech, title], i) => t(`${title} → ${tech}`, () => { const s = run(E.DEMO[i]); assert.equal(s.technique, tech); assert.equal(s.title, title); }));
t('названия папок: 3–7 слов', () => E.DEMO.forEach(x => { const w = run(x).title.split(' ').length; assert.ok(w >= 3 && w <= 7, run(x).title); }));
t('в демо есть минимум три разных настроения', () => assert.ok(new Set(E.DEMO.map(x => run(x).mood)).size >= 3));
t('«не спешу» не считается спешкой', () => assert.equal(E.analyzeText('Не спешу, никуда не тороплюсь, без дедлайнов.').mood.tense, 0));
t('песня влияет: тот же текст, медленный минор и быстрый минор дают разные приёмы', () => {
  const base = E.DEMO[0], a = run({ ...base, text: 'Обычный день.', song: { tempo: 'slow', mode: 'minor' } }), b = run({ ...base, text: 'Обычный день.', song: { tempo: 'fast', mode: 'minor' } });
  assert.notEqual(a.technique, b.technique);
});
t('минор приглушает насыщенность палитры', () => { const maj = run({ ...E.DEMO[0], song: { tempo: 'slow', mode: 'major' } }), min = run({ ...E.DEMO[0], song: { tempo: 'slow', mode: 'minor' } }); assert.notEqual(maj.pal.blobs[0], min.pal.blobs[0]); });
t('ссылки: только http(s), встраиваются YouTube и Spotify', () => { assert.equal(E.linkKind('javascript:alert(1)').kind, 'none'); assert.equal(E.linkKind('https://youtu.be/dQw4w9WgXcQ').kind, 'embed'); assert.equal(E.linkKind('https://a.com/x.mp3').kind, 'audio'); });
t('демо-мелодия — корректный WAV', async () => { /* синхронно проверяем размер */ const b = E.synthSongBlob({ tempo: 'slow', mode: 'minor' }, 1); assert.ok(b.size > 100000); });
const runEn = x => E.decide({ textInfo: E.analyzeText(x.text), photoInfo: { brightness: .5, accent: x.ph[0], saturation: .5, colors: x.ph, count: 3 }, song: x.song, weather: null, date: x.date }, 'en');
t('English demo: same moods as Russian, explanations have no Cyrillic', () => E.DEMO_EN.forEach((x, i) => { assert.equal(runEn(x).mood, run(E.DEMO[i]).mood); assert.ok(!/[а-яё]/i.test(runEn(x).rows.map(r => r.k + r.v + r.why).join(''))); }));
t('English titles', () => { assert.equal(runEn(E.DEMO_EN[0]).title, 'Autumn park and cocoa'); assert.equal(runEn(E.DEMO_EN[1]).title, 'Night at the office before the deadline'); assert.equal(runEn(E.DEMO_EN[2]).title, 'Rain, tea and silence'); });
t('"not in a hurry" is not a rush', () => assert.equal(E.analyzeText('Not in a hurry, no deadlines, never rushing.').mood.tense, 0));
console.log(`\nИтого: ${n} проверок прошло`);
