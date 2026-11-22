"use strict";
/* Движок оформления: анализ текста, фото и песни → настроение → приём → палитра → карточка дня.
   Работает в браузере; чистые функции можно запускать и в Node (см. test/engine.test.js). */
/* ---------- 1. утилиты и цвет ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (r, g, b) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
function mix(a, b, t) { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
function rgb2hsl(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
function hsl2rgb(h, s, l) { if (s === 0) { const v = l * 255; return [v, v, v]; } const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; const f = t => { t = (t + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < .5) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }; return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]; }
function satAdjust(hex, k) { const [r, g, b] = hex2rgb(hex); const [h, s, l] = rgb2hsl(r, g, b); return rgb2hex(...hsl2rgb(h, clamp(s * k, 0, 1), l)); }
function hexSat(hex) { const [r, g, b] = hex2rgb(hex); return rgb2hsl(r, g, b)[1]; }
const pad2 = n => String(n).padStart(2, '0');
/* Interface language: 'en' or 'ru'. i18n.js sets it; the engine defaults to Russian (tests rely on it). */
var LANG = 'ru';
const WEEKDAYS = { ru: ['вс','пн','вт','ср','чт','пт','сб'], en: ['sun','mon','tue','wed','thu','fri','sat'] };
function fmtDate(iso) { const d = new Date(iso + 'T12:00:00'); if (isNaN(d)) return ''; return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} · ${(WEEKDAYS[LANG] || WEEKDAYS.ru)[d.getDay()]}`; }
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

/* ---------- 3. словари для текста ---------- */
const NEG = new Set(['не', 'ни', 'без', 'нет', 'никуда', 'никакой', 'никогда', 'not', 'no', 'never', 'without', 'don', 'didn', 'wasn', 'isn', 'nothing', 'nowhere']);
/* [регулярка по началу слова, слово для показа, {настроение: вес}, годится для названия] */
const LEX = [
  [/^гуля|^прогул|^walk|^stroll/, 'прогулка', { calm: 1 }],
  [/^какао|^cocoa|^hot-chocolate/, 'какао', { calm: 1 }, true],
  [/^тепл|^уют|^warm|^cozy|^cosy/, 'тепло', { calm: 1 }],
  [/^спокой|^неспеш|^медленн|^calm|^slow|^peaceful/, 'спокойно', { calm: 1, quiet: .5 }],
  [/^разговар|^говорил|^болтал|^talk|^chat/, 'разговор', { calm: .5 }, true],
  [/^чай|^tea$/, 'чай', { calm: .5, quiet: .5 }, true],
  [/^кофе|^coffee/, 'кофе', { calm: .5 }, true],
  [/^книг|^читал|^book|^read/, 'книга', { calm: .5, quiet: .5 }, true],
  [/^закат|^sunset/, 'закат', { calm: .5 }, true],
  [/^костер|^bonfire|^campfire/, 'костёр', { calm: 1 }, true],
  [/^пирог|^pie$|^cake/, 'пирог', { calm: .5 }, true],
  [/^дожд|^rain/, 'дождь', { quiet: 1 }, true],
  [/^снег|^snow/, 'снег', { quiet: 1 }, true],
  [/^туман|^fog|^mist/, 'туман', { quiet: 1 }, true],
  [/^тих|^тишин|^quiet|^silen/, 'тишина', { quiet: 1 }],
  /* sad, lonely, tired, disappointed — quiet */
  [/^одинок|^грустн|^грусть|^грущ|^скучал|^скучаю|^печал|^тоск|^уныл|^плак|^плач|^слез|^слёз|^рыда|^разочаров|^устал|^вымота|^опустош|^обид|^гор(е|я|ю|ем)$|^горюю|^депресс|^хандр|^апати|^безнадеж|^безнадёж|^ностальг|^сожале|^разбит|^lonely|^alone$|^sad|^sorrow|^grief|^griev|^heartbr|^miserab|^melanchol|^gloom|^depress|^unhappy|^upset|^miss|^cry|^cried|^crying|^tear(s|ful)$|^sob|^weep|^wept|^hurt|^tired|^exhaust|^drained|^numb$|^empty$|^hopeless|^disappoint|^regret|^nostalg|^homesick|^bored|^heavy-hearted/, 'грусть', { quiet: 1 }],
  /* happy, excited, proud, celebrating — lively */
  [/^рад(а|ый|ость|остн|овал)?$|^счаст|^весел|^восторг|^восхит|^классн|^круто|^отличн|^супер$|^ура$|^кайф|^обожа|^горж|^гордост|^побед|^улыб|^ликов|^happy|^happiness|^joy|^glad|^cheer|^excit|^thrill|^delight|^ecsta|^elat|^fun$|^funny|^great$|^amazing|^awesome|^wonderful|^fantastic|^perfect|^brilliant|^celebrat|^proud|^win$|^won$|^success|^yay|^hooray|^smil|^grin|^energ|^lively|^blessed/, 'радость', { lively: 1 }],
  /* angry, anxious, scared, stressed — tense */
  [/^зл(ой|ая|юсь|ость|ился|илась)|^бесит|^бесил|^раздраж|^ярост|^гнев|^ненавиж|^ненавист|^тревог|^тревож|^волну|^беспоко|^страх|^страшн|^боюс|^боял|^паник|^стресс|^напряж|^ссор|^ругал|^поругал|^ревн|^завид|^стыд|^винова|^бессонн|^нервнич|^angry|^anger|^mad$|^furious|^rage$|^raging|^irritat|^annoy|^frustrat|^pissed|^hate|^hated|^anxi|^nervous|^worr|^scare|^afraid|^fear|^terrif|^panic|^stress|^overwhelm|^tense$|^pressure|^chaos|^chaotic|^argu|^fight|^jealous|^envy|^envious|^ashamed|^shame|^guilt|^restless|^insomnia|^frantic/, 'тревога', { tense: 1 }],
  /* calm, safe, loved, grateful — calm */
  [/^любл|^любов|^благодар|^нежн|^умиротвор|^безмятеж|^расслаб|^отдохн|^отдых|^гармони|^обня|^обним|^безопасн|^медитац|^love|^loved|^lovely|^grateful|^gratitude|^thank|^relax|^peace|^serene|^tranquil|^content|^comfort|^gentle|^soft$|^rest$|^rested|^safe$|^mindful|^meditat|^hug|^cuddl|^balanced|^at-ease/, 'любовь', { calm: 1 }],
  [/^срочн|^дедлайн|^сдач|^спеш|^нерв|^горит|^аврал|^urgent|^deadline|^rush|^hurr|^stress|^nervous/, 'спешка', { tense: 1 }],
  [/^офис|^проект|^работ|^office|^project|^work/, 'работа', { tense: .5 }],
  [/^друз|^подруг|^компани|^friend/, 'друзья', { lively: 1 }],
  [/^смех|^смея|^хохот|^смеял|^laugh/, 'смех', { lively: 1 }],
  [/^толп|^шумн|^шум$|^crowd|^noisy|^loud/, 'шум', { lively: 1 }],
  [/^ярк|^bright|^colou?rful/, 'яркие краски', { lively: 1 }],
  [/^праздник|^вечеринк|^концерт|^танц|^party|^concert|^danc|^festival/, 'праздник', { lively: 1 }],
  [/^рынок|^рынк|^market/, 'рынок', { lively: .5 }],
  [/^абрикос|^apricot/, 'абрикосы', { lively: .5 }, true],
  [/^телефон|^phone/, 'телефон', {}, true],
  [/^ветер|^wind$|^windy/, 'ветер', {}, true]
];
/* [регулярка, именительный, «где», род] */
const PLACES = [
  [/^парк|^park/, 'парк', 'в парке', 'm'], [/^офис|^office/, 'офис', 'в офисе', 'm'], [/^пруд|^pond/, 'пруд', 'у пруда', 'm'],
  [/^лес(у|е|а|ом)?$|^forest|^woods$/, 'лес', 'в лесу', 'm'], [/^мор(е|я|ю|ем)$|^sea$|^ocean/, 'море', 'у моря', 'n'], [/^дом(а|ой|у|е|ом)?$|^home$|^house$/, 'дом', 'дома', 'm'],
  [/^город(е|а|у|ом)?$|^city$|^town$/, 'город', 'в городе', 'm'], [/^вокзал|^station/, 'вокзал', 'у вокзала', 'm'], [/^рын(ок|к)|^market/, 'рынок', 'на рынке', 'm'],
  [/^кафе$|^cafe$|^café$/, 'кафе', 'в кафе', 'n'], [/^пляж|^beach/, 'пляж', 'на пляже', 'm'], [/^озер|^lake/, 'озеро', 'у озера', 'n'],
  [/^рек(а|е|у|и|ой)$|^river/, 'река', 'у реки', 'f'], [/^двор|^yard|^courtyard/, 'двор', 'во дворе', 'm'], [/^набережн|^embankment|^waterfront/, 'набережная', 'на набережной', 'f']
];
const TIMES = [[/^вечер|^evening/, 'вечер', 'Вечер', 'm'], [/^утр|^morning/, 'утро', 'Утро', 'n'], [/^ноч|^night/, 'ночь', 'Ночь', 'f'], [/^днем$|^днём$|^полдень|^afternoon|^noon/, 'день', 'День', 'm']];
const SEASONS = [
  ['autumn', /^осен|^желт|^листь|^листв|^листопад|^autumn|^fall$|^yellow|^leaves/], ['winter', /^зим|^снег|^мороз|^сугроб|^winter|^snow|^frost/],
  ['spring', /^весн|^весен|^подснеж|^сирен|^капел|^spring|^blossom|^lilac/], ['summer', /^лето$|^летн|^лета$|^жарк|^пляж|^купал|^summer|^hot$|^swim/]
];
const SEASON_NAME = { autumn: 'осень', winter: 'зима', spring: 'весна', summer: 'лето' };
const SEASON_ADJ = { autumn: ['Осенний', 'Осеннее', 'Осенняя'], winter: ['Зимний', 'Зимнее', 'Зимняя'], spring: ['Весенний', 'Весеннее', 'Весенняя'], summer: ['Летний', 'Летнее', 'Летняя'] };
const WEEKDAY_ADJ = [[/^воскресень|^воскресн|^sunday/, ['Воскресный', 'Воскресное', 'Воскресная']], [/^суббот|^saturday/, ['Субботний', 'Субботнее', 'Субботняя']], [/^пятниц|^friday/, ['Пятничный', 'Пятничное', 'Пятничная']]];
const PEOPLE = [[/^мы$|^вдвоем|^we$/, 'вдвоём'], [/^друз|^подруг|^friend/, 'друзья'], [/^девушк|^girlfriend/, 'девушка'], [/^парн|^boyfriend/, 'парень'], [/^семь|^family/, 'семья'], [/^коллег|^colleague|^coworker/, 'коллеги'], [/^мам|^mom$|^mum$|^mother/, 'мама'], [/^пап|^dad$|^father/, 'папа']];
const GENDER_IDX = { m: 0, n: 1, f: 2 };
const MOOD_NOUN = { calm: 'уют', tense: 'спешка', lively: 'смех', quiet: 'тишина' };
const MOOD_FALLBACK = { calm: 'Спокойный день дома', tense: 'Напряжённый рабочий день', lively: 'Шумный день с людьми', quiet: 'Тихий день без спешки' };
const MOOD_SIG = { calm: 'тепло', tense: 'до утра', lively: 'шумно и ярко', quiet: 'тихо' };

/* English names for canonical words (keys stay Russian so saved days keep working). */
const EN_WORD = {
  'прогулка': 'a walk', 'какао': 'cocoa', 'тепло': 'warmth', 'спокойно': 'calm', 'разговор': 'a talk', 'чай': 'tea', 'кофе': 'coffee', 'книга': 'a book',
  'закат': 'sunset', 'костёр': 'a bonfire', 'пирог': 'pie', 'дождь': 'rain', 'снег': 'snow', 'туман': 'fog', 'тишина': 'silence', 'грусть': 'sadness',
  'спешка': 'rush', 'работа': 'work', 'друзья': 'friends', 'смех': 'laughter', 'шум': 'noise', 'яркие краски': 'bright colours', 'праздник': 'a party',
  'рынок': 'market', 'абрикосы': 'apricots', 'телефон': 'the phone', 'ветер': 'wind', 'ночь': 'night', 'уют': 'coziness',
  'радость': 'joy', 'тревога': 'anxiety', 'любовь': 'love', 'вдвоём': 'the two of us', 'девушка': 'girlfriend', 'парень': 'boyfriend', 'семья': 'family', 'коллеги': 'colleagues', 'мама': 'mom', 'папа': 'dad'
};
const EN_PLACE = { 'парк': ['park', 'in the park'], 'офис': ['office', 'at the office'], 'пруд': ['pond', 'by the pond'], 'лес': ['forest', 'in the forest'], 'море': ['sea', 'by the sea'],
  'дом': ['home', 'at home'], 'город': ['city', 'in the city'], 'вокзал': ['station', 'at the station'], 'рынок': ['market', 'at the market'], 'кафе': ['café', 'at the café'],
  'пляж': ['beach', 'on the beach'], 'озеро': ['lake', 'by the lake'], 'река': ['river', 'by the river'], 'двор': ['yard', 'in the yard'], 'набережная': ['waterfront', 'on the waterfront'] };
const EN_TIME = { 'вечер': 'evening', 'утро': 'morning', 'ночь': 'night', 'день': 'day' };
const EN_WEEKDAY = { 'Воскресный': 'Sunday', 'Субботний': 'Saturday', 'Пятничный': 'Friday' };
const EN_WEATHER = { 'ясно': 'clear', 'облачно': 'cloudy', 'туман': 'fog', 'дождь': 'rain', 'снег': 'snow', 'гроза': 'thunderstorm', 'пасмурно': 'overcast' };
const enWord = w => EN_WORD[w] || w;
/** Translate a canonical word for display in the current language. */
const word = (w, lang = LANG) => lang === 'en' ? enWord(w) : w;
const weatherKind = (k, lang = LANG) => lang === 'en' ? (EN_WEATHER[k] || k) : k;

function tokenize(text) { return String(text || '').toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9-]+/).filter(Boolean); }

/** Читает текст: сезон, время суток, места, люди, слова-настроения. Слова с отрицанием («не спешу») не считаются. */
function analyzeText(text) {
  const tokens = tokenize(text);
  const out = { tokens: tokens.length, mood: { calm: 0, tense: 0, lively: 0, quiet: 0 }, words: { calm: [], tense: [], lively: [], quiet: [] }, objects: [], places: [], people: [], time: null, season: null, weekdayAdj: null, deadline: false };
  tokens.forEach((t, i) => {
    const negated = tokens.slice(Math.max(0, i - 3), i).some(x => NEG.has(x));
    if (!out.season) for (const [k, re] of SEASONS) if (re.test(t) && !negated) { out.season = k; break; }
    for (const [re, wd] of WEEKDAY_ADJ) if (re.test(t) && !out.weekdayAdj) out.weekdayAdj = wd;
    for (const [re, canon, loc, g] of PLACES) if (re.test(t) && !out.places.some(p => p.nom === canon)) out.places.push({ nom: canon, loc, g });
    for (const [re, canon, disp, g] of TIMES) if (re.test(t) && !out.time) out.time = { canon, disp, g };
    for (const [re, canon] of PEOPLE) if (re.test(t) && !out.people.includes(canon)) out.people.push(canon);
    if (/^сдач|^дедлайн|^deadline/.test(t) && !negated) out.deadline = true;
    if (negated) return;
    for (const [re, canon, w, isObj] of LEX) {
      if (!re.test(t)) continue;
      for (const m in w) { out.mood[m] += w[m]; if (!out.words[m].includes(canon)) out.words[m].push(canon); }
      if (isObj && !out.objects.includes(canon)) out.objects.push(canon);
      break;
    }
  });
  if (out.time && out.time.canon === 'ночь') { out.mood.tense += .5; if (!out.words.tense.includes('ночь')) out.words.tense.push('ночь'); }
  return out;
}

/* ---------- 4. анализ фото и аудио ---------- */
function loadImage(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; }); }

/** Уменьшает загруженное фото, чтобы оно помещалось в хранилище. */
async function shrinkPhoto(file, max = 900) {
  const url = URL.createObjectURL(file);
  try {
    const im = await loadImage(url); const k = Math.min(1, max / Math.max(im.width, im.height));
    const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', .82);
  } finally { URL.revokeObjectURL(url); }
}

/** Главные цвета, яркость, насыщенность и самый «звонкий» акцентный цвет одного фото. */
async function analyzePhoto(dataUrl) {
  const im = await loadImage(dataUrl); const S = 40; const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, S, S); const d = g.getImageData(0, 0, S, S).data;
  const buckets = new Map(); let lum = 0, sat = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2]; lum += (.2126 * r + .7152 * gg + .0722 * b) / 255; sat += rgb2hsl(r, gg, b)[1]; n++;
    const key = (r >> 5) << 6 | (gg >> 5) << 3 | (b >> 5); const e = buckets.get(key) || { r: 0, g: 0, b: 0, c: 0 }; e.r += r; e.g += gg; e.b += b; e.c++; buckets.set(key, e);
  }
  const list = [...buckets.values()].map(e => ({ hex: rgb2hex(e.r / e.c, e.g / e.c, e.b / e.c), c: e.c })).sort((a, b) => b.c - a.c);
  const colors = []; for (const e of list) { if (colors.every(x => colorDist(x, e.hex) > 60)) colors.push(e.hex); if (colors.length === 4) break; }
  let accent = colors[0] || '#888888', best = -1;
  for (const e of list.slice(0, 12)) { const sc = hexSat(e.hex) * Math.sqrt(e.c); if (sc > best) { best = sc; accent = e.hex; } }
  return { colors, accent, brightness: lum / n, saturation: sat / n };
}
function colorDist(a, b) { const A = hex2rgb(a), B = hex2rgb(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); }
async function analyzePhotos(list) {
  const res = []; for (const p of list) { try { res.push(await analyzePhoto(p)); } catch (e) { /* пропускаем битое фото */ } }
  if (!res.length) return { count: list.length, colors: [], accent: '#C8731F', brightness: .5, saturation: .4 };
  const colors = []; res.forEach(r => r.colors.forEach(c => { if (colors.length < 4 && colors.every(x => colorDist(x, c) > 50)) colors.push(c); }));
  const accent = res.map(r => r.accent).sort((a, b) => hexSat(b) - hexSat(a))[0];
  return { count: list.length, colors, accent, brightness: res.reduce((s, r) => s + r.brightness, 0) / res.length, saturation: res.reduce((s, r) => s + r.saturation, 0) / res.length };
}

/** Темп (ударов в минуту) и энергия громкости по загруженному аудиофайлу. */
async function analyzeAudio(file) {
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  const ctx = new AC();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer()); const sr = buf.sampleRate; const x = buf.getChannelData(0);
    const n = Math.min(x.length, sr * 60), hop = Math.floor(sr * .01), env = [];
    for (let i = 0; i + hop * 2 < n; i += hop) { let s = 0; for (let j = 0; j < hop * 2; j += 4) s += x[i + j] * x[i + j]; env.push(Math.sqrt(s / (hop / 2))); }
    const energy = clamp(env.reduce((a, b) => a + b, 0) / env.length / .22, 0, 1);
    const on = env.map((v, i) => i ? Math.max(0, v - env[i - 1]) : 0);
    let bestLag = 50, best = -1;
    for (let lag = 33; lag <= 100; lag++) { let s = 0; for (let i = 0; i + lag < on.length; i++) s += on[i] * on[i + lag]; if (s > best) { best = s; bestLag = lag; } }
    let bpm = 6000 / bestLag; while (bpm < 70) bpm *= 2; while (bpm > 170) bpm /= 2;
    return { bpm: Math.round(bpm), energy };
  } catch (e) { return null; } finally { ctx.close && ctx.close(); }
}
const tempoFromBpm = b => b < 90 ? 'slow' : b < 120 ? 'mid' : 'fast';

/** Погода по координатам (Open-Meteo, без ключа). Только по согласию пользователя. */
async function fetchWeather(lat, lon) {
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`);
  const j = await r.json(); const code = j.current.weather_code, t = Math.round(j.current.temperature_2m);
  const kind = code === 0 ? 'ясно' : code <= 3 ? 'облачно' : code <= 48 ? 'туман' : code <= 67 || (code >= 80 && code <= 82) ? 'дождь' : code <= 77 ? 'снег' : code >= 95 ? 'гроза' : 'пасмурно';
  return { kind, temp: t };
}

/* ---------- 5. демо-дни (проходят тот же путь, что и ваши) ---------- */
const DEMO = [
  { date: '2026-11-14', text: 'Гуляли по парку, всё в жёлтых листьях, было холодно, но мы пили какао и долго разговаривали.', song: { title: 'Демо-мелодия', artist: 'Тёплый вечер', tempo: 'slow', mode: 'major' }, ph: ['#C8731F', '#E8A94B', '#7A431A'] },
  { date: '2026-11-18', text: 'Срочная сдача проекта, ночь в офисе, в наушниках электронная музыка.', song: { title: 'Электронная музыка', artist: 'Электроника', tempo: 'fast', mode: 'minor' }, ph: ['#1F3550', '#3F5873', '#8FA6BF'] },
  { date: '2026-11-19', text: 'Весь день дождь. Чай, книга и ни одного срочного дела.', song: { title: 'Медленная композиция', artist: 'Минор', tempo: 'slow', mode: 'minor' }, ph: ['#8A9A8E', '#E9E8E1', '#5B6F82'] },
  { date: '2026-11-08', text: 'Воскресенье на рынке: абрикосы, смех, друзья, толпа и яркие ящики.', song: { title: 'Живой ритм', artist: 'Живой ритм', tempo: 'mid', mode: 'major' }, ph: ['#E2573B', '#F2B84B', '#2F7D6B'] },
  { date: '2026-11-02', text: 'Первый снег у вокзала. Тихо, медленно, никуда не спешу.', song: { title: 'Мягкий минор', artist: 'Мягкий минор', tempo: 'slow', mode: 'minor' }, ph: ['#9FB3C4', '#DCE4EA', '#5B6F82'] },
  { date: '2026-11-11', text: 'Весенний вечер, окно открыто, долго говорили по телефону, не хотелось класть трубку.', song: { title: 'Акустика', artist: 'Акустика', tempo: 'slow', mode: 'major' }, ph: ['#A98A9A', '#D9B9A0', '#5A4A5E'] }
];
const DEMO_EN = [
  { date: '2026-11-14', text: 'We walked in the park, everything covered in yellow leaves. It was cold, but we drank cocoa and talked for a long time.', song: { title: 'Demo melody', artist: 'Warm evening', tempo: 'slow', mode: 'major' }, ph: DEMO[0].ph },
  { date: '2026-11-18', text: 'Urgent project deadline, a night at the office, electronic music in my headphones.', song: { title: 'Electronic music', artist: 'Electronica', tempo: 'fast', mode: 'minor' }, ph: DEMO[1].ph },
  { date: '2026-11-19', text: 'Rain all day. Tea, a book and not a single urgent task.', song: { title: 'Slow piece', artist: 'Minor', tempo: 'slow', mode: 'minor' }, ph: DEMO[2].ph },
  { date: '2026-11-08', text: 'Sunday at the market: apricots, laughter, friends, a crowd and bright crates.', song: { title: 'Live rhythm', artist: 'Live rhythm', tempo: 'mid', mode: 'major' }, ph: DEMO[3].ph },
  { date: '2026-11-02', text: 'First snow by the station. Quiet, slow, in no hurry at all.', song: { title: 'Soft minor', artist: 'Soft minor', tempo: 'slow', mode: 'minor' }, ph: DEMO[4].ph },
  { date: '2026-11-11', text: 'A spring evening, the window open, a long talk on the phone, I did not want to hang up.', song: { title: 'Acoustic', artist: 'Acoustic', tempo: 'slow', mode: 'major' }, ph: DEMO[5].ph }
];
const demoDays = () => LANG === 'en' ? DEMO_EN : DEMO;
/* Real photos for the example days (Wikimedia Commons, credits in public/demo/CREDITS.txt) */
const DEMO_IMG = [
  ['/demo/d1-park-1.jpg', '/demo/d1-park-2.jpg', '/demo/d1-park-3.jpg'],
  ['/demo/d2-office-1.jpg', '/demo/d2-office-2.jpg'],
  ['/demo/d3-rain-1.jpg', '/demo/d3-rain-2.jpg', '/demo/d3-rain-3.jpg'],
  ['/demo/d4-market-1.jpg', '/demo/d4-market-2.jpg', '/demo/d4-market-3.jpg'],
  ['/demo/d5-snow-1.jpg', '/demo/d5-snow-2.jpg', '/demo/d5-snow-3.jpg'],
  ['/demo/d6-spring-1.jpg', '/demo/d6-spring-2.jpg']
];

/* ---------- 6. решение: настроение → приём → палитра ---------- */
const TECH = {
  monet: { name: 'Клод Моне: мазки и свет', mood: 'calm' },
  kandinsky: { name: 'Кандинский: геометрия', mood: 'tense' },
  japan: { name: 'Японская минималистичная графика', mood: 'quiet' },
  collage: { name: 'Коллаж и плёночное зерно', mood: 'lively' }
};
const MOOD_TECH = { calm: 'monet', tense: 'kandinsky', quiet: 'japan', lively: 'collage' };
const MOOD_LABEL = { calm: 'тёплый и спокойный день', tense: 'напряжённый, собранный день', quiet: 'тихий день', lively: 'шумный, живой день' };
const TEMPO_LABEL = { slow: 'медленный', mid: 'средний', fast: 'быстрый' };
const MODE_LABEL = { major: 'мажор', minor: 'минор', unknown: '' };
const VOICES = {
  calm: { label: 'Тихий и тёплый', rate: .85, pitch: .95 }, quiet: { label: 'Тихий и ровный', rate: .8, pitch: .85 },
  tense: { label: 'Собранный и быстрый', rate: 1.15, pitch: 1 }, lively: { label: 'Живой и быстрый', rate: 1.12, pitch: 1.15 }
};
const quote = a => a.slice(0, 3).map(x => `«${x}»`).join(', ');
/* Every sentence decide() writes, in both languages. */
const TXT = {
  ru: { tech: { monet: TECH.monet.name, kandinsky: TECH.kandinsky.name, japan: TECH.japan.name, collage: TECH.collage.name }, mood: MOOD_LABEL, tempo: TEMPO_LABEL, mode: MODE_LABEL,
    voice: { calm: 'Тихий и тёплый', quiet: 'Тихий и ровный', tense: 'Собранный и быстрый', lively: 'Живой и быстрый' }, season: SEASON_NAME,
    seasonWhy: { text: 'в тексте есть приметы сезона', date: 'сезон взят из даты', none: 'сезон не указан, взят тёплый свет по умолчанию' },
    pal: { autumn: 'охра и янтарь', summer: 'зелень и солнечный свет', spring: 'розовый и свежая зелень', winter: 'морозная голубизна', kandinsky: 'сине-серая гамма и один жёлтый акцент', japan: 'приглушённый фон и один акцент', collage: 'яркие плоские пятна' },
    texture: { monet: 'плёночное зерно поверх мягких мазков', collage: 'крупное зерно плёнки и наложение пятен', kandinsky: 'чистые линии, почти без зерна', japan: 'гладкая бумага, много воздуха' },
    textureWhy: { monet: 'Спокойный день просит мягкий свет.', collage: 'Шумному дню подходит неровная, пёстрая фактура.', kandinsky: 'Напряжённому дню нужна жёсткая сетка.', japan: 'Тишине нужно свободное место.' },
    k: ['Приём', 'Палитра', 'Ритм', 'Фактура', 'Голос'],
    techWhy: (w, t, m, md) => w ? `Слова ${w} и песня (${t} темп${m ? ', ' + m : ''}) дают ${md}.` : `Песня (${t} темп${m ? ', ' + m : ''}) и фото дают ${md}.`,
    accent: ' Самый звонкий цвет фото подмешан в палитру.', minor: ' Минор приглушает насыщенность.',
    rhythm: s => `Смена кадров каждые ${s} с`, rhythmWhy: { slow: 'Медленный темп песни: больше воздуха и меньше деталей.', fast: 'Быстрый темп песни: резкий ритм и больше деталей.', mid: 'Средний темп песни: ровный ритм.' },
    voiceWhy: md => `Подбирается по настроению: ${md}.`, weather: (k, t) => `Погода: ${k}, ${t}°.`, quote,
    videoK: 'Видео', videoWhy: (ai, p, mine) => `ИИ предположил по видео: ${ai} (${p}%). Вы выбрали: ${mine} — учитывается ваш выбор.`,
    faceK: 'Лицо', faceWord: { calm: 'спокойное, тёплое', tense: 'напряжённое', quiet: 'тихое, грустное', lively: 'радостное, живое' }, faceWhy: (md, p) => `Камера прочитала выражение лица: ${md} (уверенность ${p}%).` },
  en: { tech: { monet: 'Claude Monet: strokes and light', kandinsky: 'Kandinsky: geometry', japan: 'Japanese minimalist graphics', collage: 'Collage and film grain' },
    mood: { calm: 'a warm, calm day', tense: 'a tense, focused day', quiet: 'a quiet day', lively: 'a loud, lively day' },
    tempo: { slow: 'slow', mid: 'medium', fast: 'fast' }, mode: { major: 'major', minor: 'minor', unknown: '' },
    voice: { calm: 'Soft and warm', quiet: 'Soft and even', tense: 'Focused and quick', lively: 'Lively and quick' }, season: { autumn: 'autumn', winter: 'winter', spring: 'spring', summer: 'summer' },
    seasonWhy: { text: 'the text mentions the season', date: 'season taken from the date', none: 'no season given, warm light by default' },
    pal: { autumn: 'ochre and amber', summer: 'greenery and sunlight', spring: 'pink and fresh green', winter: 'frosty blue', kandinsky: 'blue-grey range with one yellow accent', japan: 'muted background and one accent', collage: 'bright flat patches' },
    texture: { monet: 'film grain over soft strokes', collage: 'coarse film grain and layered patches', kandinsky: 'clean lines, almost no grain', japan: 'smooth paper, lots of air' },
    textureWhy: { monet: 'A calm day asks for soft light.', collage: 'A loud day suits an uneven, busy texture.', kandinsky: 'A tense day needs a strict grid.', japan: 'Silence needs empty space.' },
    k: ['Technique', 'Palette', 'Rhythm', 'Texture', 'Voice'],
    techWhy: (w, t, m, md) => w ? `The words ${w} and the song (${t} tempo${m ? ', ' + m : ''}) make ${md}.` : `The song (${t} tempo${m ? ', ' + m : ''}) and the photos make ${md}.`,
    accent: ' The brightest photo colour is mixed into the palette.', minor: ' The minor key softens the saturation.',
    rhythm: s => `Photos change every ${s} s`, rhythmWhy: { slow: 'Slow song: more air, fewer details.', fast: 'Fast song: a sharp rhythm and more details.', mid: 'Medium tempo: an even rhythm.' },
    voiceWhy: md => `Chosen by mood: ${md}.`, weather: (k, t) => `Weather: ${k}, ${t}°.`,
    videoK: 'Video', videoWhy: (ai, p, mine) => `The AI guessed from the video: ${ai} (${p}%). You chose: ${mine}, and your choice is what counts.`,
    faceK: 'Face', faceWord: { calm: 'calm and warm', tense: 'tense', quiet: 'quiet or sad', lively: 'happy and lively' }, faceWhy: (md, p) => `The camera read your expression as ${md} (${p}% sure).`, quote: a => a.slice(0, 3).map(x => `“${enWord(x).replace(/^(a|the) /, "")}”`).join(', ') }
};

const MONET = {
  autumn: { base: '#5A2F12', blobs: ['#E8A94B', '#C8731F', '#F2D9A6', '#A85A1E'], strokes: ['#F2D9A6', '#E8A94B', '#FFF0C8', '#8E4A18', '#C8731F'], water: '#6F8C84', scrim: '#43220C', fg: '#FFF4DC', name: 'охра и янтарь' },
  summer: { base: '#1F4A3E', blobs: ['#9BCB7A', '#4FA38A', '#F2E3A0', '#2F7D6B'], strokes: ['#F2E3A0', '#9BCB7A', '#E8F5D8', '#2F7D6B', '#6FBF9C'], water: '#5FA3C8', scrim: '#12302A', fg: '#F4FBEF', name: 'зелень и солнечный свет' },
  spring: { base: '#4A3A55', blobs: ['#F2B8C6', '#9BCB9B', '#F6E7B4', '#C48AA8'], strokes: ['#F6E7B4', '#F2B8C6', '#FFFFFF', '#9BCB9B', '#C48AA8'], water: '#8FB5C9', scrim: '#2E2336', fg: '#FFF6F4', name: 'розовый и свежая зелень' },
  winter: { base: '#2C3F55', blobs: ['#BFD3E6', '#8FB0CF', '#EAF2F8', '#5E7F9F'], strokes: ['#EAF2F8', '#BFD3E6', '#FFFFFF', '#5E7F9F', '#8FB0CF'], water: '#9FB3C4', scrim: '#1B2938', fg: '#F2F7FB', name: 'морозная голубизна' }
};

/**
 * Главная функция системы: из текста, фото, песни и (по желанию) погоды собирает
 * настроение, приём, палитру, ритм, название, подпись и список причин.
 */
function decide(inp, lang = 'ru') {
  const X = TXT[lang] || TXT.ru;
  const T = inp.textInfo, P = inp.photoInfo, S = inp.song || {}, W = inp.weather;
  const score = { calm: T.mood.calm, tense: T.mood.tense, lively: T.mood.lively, quiet: T.mood.quiet };
  const textScore = { ...score }, reasons = [], rows = [];
  const tempo = S.tempo || 'mid', mode = S.mode || 'unknown';
  if (tempo === 'slow') { score.quiet += 1; if (mode === 'minor') score.quiet += 1; else score.calm += 1; }
  else if (tempo === 'fast') { score.tense += 1; if (mode !== 'major') score.tense += 1; else score.lively += 1; if (mode === 'major') score.lively += 1; }
  else { score.calm += .5; score.lively += .5; }
  if (S.energy > .6) { score.tense += .5; score.lively += .5; }
  if (W) { if (['дождь', 'снег', 'туман', 'пасмурно'].includes(W.kind)) score.quiet += 1; if (W.kind === 'ясно') score.lively += .3; }
  if (P) { if (P.brightness < .3) { score.tense += .5; score.quiet += .3; } if (P.brightness > .7) score.lively += .3; }
  /* facial expression from the camera, if the person used it */
  const F = T.face && MOOD_TECH[T.face.mood] ? T.face : null;
  if (F) score[F.mood] += 1.5 + 2 * clamp(+F.conf || 0, 0, 1);
  /* the atmosphere video: the AI only suggests, the person's own choice is the true mood */
  const V = T.video && MOOD_TECH[T.video.mood] ? T.video : null;
  if (V) score[V.mood] += 3;
  const order = ['calm', 'quiet', 'tense', 'lively'];
  const mood = inp.forceMood && MOOD_TECH[inp.forceMood] ? inp.forceMood : order.slice().sort((a, b) => (score[b] - score[a]) || (textScore[b] - textScore[a]) || (order.indexOf(a) - order.indexOf(b)))[0];
  const technique = MOOD_TECH[mood];

  /* сезон: слова в тексте важнее даты */
  let season = T.season, seasonWhy = season ? X.seasonWhy.text : '';
  if (!season && inp.date) { const m = new Date(inp.date + 'T12:00:00').getMonth() + 1; season = m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter'; seasonWhy = X.seasonWhy.date; }
  if (!season) { season = 'autumn'; seasonWhy = X.seasonWhy.none; }
  const night = (T.time && T.time.canon === 'ночь') || (P && P.brightness < .32);

  /* палитра */
  const accent = P && P.accent ? P.accent : null;
  let pal, paletteName, minor = mode === 'minor';
  const soften = c => minor ? satAdjust(c, .72) : c;
  if (technique === 'monet') {
    const b = MONET[season]; pal = { ...b, blobs: b.blobs.map(soften), strokes: b.strokes.map(soften) };
    if (accent) pal.blobs[1] = mix(pal.blobs[1], accent, .4);
    pal.chip = pal.scrim; pal.chipFg = pal.fg; pal.frame = 'rgba(30,14,6,.5)'; paletteName = X.pal[season];
  } else if (technique === 'kandinsky') {
    pal = night ? { base: '#0F1B2D', a: '#3F5873', b: '#8FA6BF', c: '#CBD6E2', grid: '#2B4059', fg: '#EAF0F6' } : { base: '#1E2328', a: '#4A5560', b: '#9AA7B2', c: '#D5DBE0', grid: '#323A42', fg: '#F1F4F6' };
    pal.accent = accent ? mix('#E3C45A', accent, .35) : '#E3C45A'; pal.chip = pal.base; pal.chipFg = pal.fg; pal.frame = 'rgba(10,18,30,.6)'; paletteName = X.pal.kandinsky;
  } else if (technique === 'japan') {
    const w = season === 'winter';
    pal = { base: w ? '#E6EBEF' : '#E9E8E1', line: w ? '#9FB3C4' : '#8A9A8E', fg: '#23262A', chip: '#23262A', chipFg: w ? '#E6EBEF' : '#E9E8E1', frame: 'rgba(35,38,42,.06)' };
    pal.accent = accent && hexSat(accent) > .45 ? accent : '#B83A26'; paletteName = X.pal.japan;
  } else {
    pal = { base: '#F3E6CF', c: ['#E2573B', '#F2B84B', '#2F7D6B', '#3F6FB5'].map(soften), fg: '#23262A', chip: '#23262A', chipFg: '#F3E6CF', frame: 'rgba(243,230,207,.5)' };
    if (accent) pal.c[0] = mix(pal.c[0], accent, .4); paletteName = X.pal.collage;
  }

  /* ритм, плотность, фактура */
  const energy = clamp(S.energy ?? (tempo === 'fast' ? .8 : tempo === 'slow' ? .2 : .5), 0, 1);
  const period = tempo === 'slow' ? 5200 : tempo === 'fast' ? 2000 : 3400;
  const grain = technique === 'monet' ? .35 : technique === 'collage' ? .22 : technique === 'kandinsky' ? .08 : .05;
  const texture = X.texture[technique];
  const voice = { ...VOICES[mood], label: X.voice[mood] };

  /* название и подпись */
  const title = lang === 'en' ? makeTitleEn(T, mood, season) : makeTitle(T, mood, season), signature = lang === 'en' ? makeSignatureEn(T, mood, season) : makeSignature(T, mood, season);

  /* объяснимая логика */
  const wTop = T.words[mood].length ? T.words[mood] : [];
  rows.push({ k: X.k[0], v: X.tech[technique], why: X.techWhy(wTop.length ? X.quote(wTop) : '', X.tempo[tempo], X.mode[mode], X.mood[mood]) });
  rows.push({ k: X.k[1], v: cap(paletteName), why: `${cap(X.season[season])}: ${seasonWhy}.${accent ? X.accent : ''}${minor ? X.minor : ''}` });
  rows.push({ k: X.k[2], v: X.rhythm(Math.round(period / 1000)), why: X.rhythmWhy[tempo] || X.rhythmWhy.mid });
  rows.push({ k: X.k[3], v: texture, why: X.textureWhy[technique] });
  rows.push({ k: X.k[4], v: voice.label, why: X.voiceWhy(X.mood[mood]) });
  if (V) rows.push({ k: X.videoK, v: cap(X.mood[V.mood]), why: X.videoWhy(X.mood[V.ai] || '—', Math.round(clamp(+V.conf || 0, 0, 1) * 100), X.mood[V.mood]) });
  if (F) rows.push({ k: X.faceK, v: cap(X.faceWord[F.mood]), why: X.faceWhy(X.faceWord[F.mood], Math.round(clamp(+F.conf || 0, 0, 1) * 100)) });
  if (W) reasons.push(X.weather(weatherKind(W.kind, lang), `${W.temp > 0 ? '+' : ''}${W.temp}`));

  return { mood, technique, season, night, pal, paletteName, tempo, mode, energy, period, grain, texture, voice, title, signature, rows, weatherNote: reasons[0] || '', ...(inp.forceMood ? { forcedMood: mood } : {}) };
}

function agree(arr, g) { return arr[GENDER_IDX[g] ?? 0]; }
/** Название папки: 3–7 слов, один тон. */
function makeTitle(T, mood, season) {
  const place = T.places[0], o = T.objects, noun = MOOD_NOUN[mood];
  const adj = T.weekdayAdj ? T.weekdayAdj : (T.season ? SEASON_ADJ[season] : null);
  let t;
  if (place && o.length) t = `${adj ? agree(adj, place.g) + ' ' : ''}${place.nom} и ${o[0]}`;
  else if (T.time && place) t = `${T.time.disp} ${place.loc}${T.deadline ? ' перед сдачей' : ''}`;
  else if (T.time && adj && o.length) t = `${agree(adj, T.time.g)} ${T.time.canon} и ${o[0]}`;
  else if (o.length >= 2) t = `${cap(o[0])}, ${o[1]} и ${noun}`;
  else if (o.length === 1 && T.time) t = `${T.time.disp} и ${o[0]}`;
  else if (o.length === 1) t = `${cap(o[0])} и ${noun}`;
  else if (place) t = `${adj ? agree(adj, place.g) + ' ' : ''}${place.nom} и ${noun}`;
  else t = MOOD_FALLBACK[mood];
  let w = t.split(/\s+/); if (w.length < 3) w = w.concat(['и', noun]); if (w.length > 7) w = w.slice(0, 7);
  return cap(w.join(' ').replace(/^(.)/, m => m.toUpperCase()));
}
/** Подпись от руки: до трёх слов. */
function makeSignature(T, mood, season) {
  if (T.time && T.time.canon === 'ночь' && mood === 'tense') return 'до утра';
  const parts = [MOOD_SIG[mood]]; if (T.objects[0] && mood !== 'quiet') parts.push(T.objects[0]); if (T.season && mood === 'calm') parts.push(SEASON_NAME[season]);
  return parts.slice(0, 3).join(', ');
}

/** English folder title: same rules as the Russian one, 3–7 words. */
function makeTitleEn(T, mood, season) {
  const pl = T.places[0] && EN_PLACE[T.places[0].nom], o = T.objects.map(enWord).map(x => x.replace(/^(a|the) /, '')), noun = enWord(MOOD_NOUN[mood]);
  const adj = T.weekdayAdj ? EN_WEEKDAY[T.weekdayAdj[0]] : (T.season ? cap(season) : null), time = T.time && EN_TIME[T.time.canon];
  let t;
  if (pl && o.length) t = `${adj ? adj + ' ' : ''}${pl[0]} and ${o[0]}`;
  else if (time && pl) t = `${cap(time)} ${pl[1]}${T.deadline ? ' before the deadline' : ''}`;
  else if (time && adj && o.length) t = `${adj} ${time} and ${o[0]}`;
  else if (o.length >= 2) t = `${cap(o[0])}, ${o[1]} and ${noun}`;
  else if (o.length === 1 && time) t = `${cap(time)} and ${o[0]}`;
  else if (o.length === 1) t = `${cap(o[0])} and ${noun}`;
  else if (pl) t = `${adj ? adj + ' ' : ''}${pl[0]} and ${noun}`;
  else t = { calm: 'A calm day at home', tense: 'A tense working day', lively: 'A loud day with people', quiet: 'A quiet, unhurried day' }[mood];
  let w = t.split(/\s+/); if (w.length < 3) w = w.concat(['and', noun]); if (w.length > 7) w = w.slice(0, 7);
  return cap(w.join(' '));
}
function makeSignatureEn(T, mood, season) {
  if (T.time && T.time.canon === 'ночь' && mood === 'tense') return 'until morning';
  const parts = [{ calm: 'warm', tense: 'until morning', lively: 'loud and bright', quiet: 'quiet' }[mood]];
  if (T.objects[0] && mood !== 'quiet') parts.push(enWord(T.objects[0]).replace(/^(a|the) /, '')); if (T.season && mood === 'calm') parts.push(season);
  return parts.slice(0, 3).join(', ');
}
/** Re-writes a saved day's titles and explanations in the current language (colours and layout stay as saved). */
function localizeDay(day) {
  if (!day || !day.textInfo || !day.textInfo.mood) return day;
  try {
    const s = decide({ textInfo: day.textInfo, photoInfo: day.photoInfo, song: day.song, weather: day.weather, date: day.dateOn ? day.date : null, forceMood: day.style.forcedMood }, LANG);
    /* a title the admin wrote by hand stays as written */
    return { ...day, style: { ...day.style, title: day.style.titleLocked ? day.style.title : s.title, signature: s.signature, rows: s.rows, texture: s.texture, paletteName: s.paletteName, voice: { ...day.style.voice, label: s.voice.label }, weatherNote: s.weatherNote } };
  } catch (e) { return day; }
}

/** Собирает «день» целиком из ввода пользователя: фото, аудио и погода анализируются здесь. */
async function buildDay(draft) {
  const textInfo = analyzeText(draft.text);
  if (draft.face && MOOD_TECH[draft.face.mood]) textInfo.face = { mood: draft.face.mood, conf: Math.round(draft.face.conf * 100) / 100 };
  const clean = t => String(t || '').replace(/[<>"`\\\u0000-\u001f]/g, '').slice(0, 300);
  if (draft.voice && draft.voice.keep && draft.voice.chunks) textInfo.voice = draft.voice.chunks.slice(0, 60).map(c => ({ s: Math.round((+c.s || 0) * 10) / 10, e: c.e == null ? null : Math.round(+c.e * 10) / 10, t: clean(c.t) }));
  if (draft.video && MOOD_TECH[draft.video.mood] && draft.video.ai) {
    const ai = draft.video.ai, f = ai.face || {}, num = x => Math.round((+x || 0) * 100) / 100, mood = m => MOOD_TECH[m] ? m : null;
    textInfo.video = { mood: draft.video.mood, ai: mood(ai.mood), conf: num(ai.conf), words: ai.words.concat(ai.things).slice(0, 8).map(clean),
      scene: ai.scene ? { mood: mood(ai.scene.mood), conf: num(ai.scene.conf) } : null,
      face: f.seen ? { seen: num(f.seen), mood: mood(f.mood), conf: num(f.conf), moods: Object.fromEntries(Object.keys(MOOD_TECH).map(m => [m, num(f.moods[m])])),
        emotions: (f.emotions || []).slice(0, 4).map(([e, x]) => [clean(e), num(x)]), timeline: (f.timeline || []).slice(0, 20).map(mood) } : { seen: 0 } };
  }
  const photoInfo = await analyzePhotos(draft.photos);
  const song = { ...draft.song };
  if (song.file && !song.bpm) { const a = await analyzeAudio(song.file); if (a) { song.bpm = a.bpm; song.energy = a.energy; if (!song.tempoSet) song.tempo = tempoFromBpm(a.bpm); } }
  const useDate = draft.dateOn ? draft.date : null;
  const style = decide({ textInfo, photoInfo, song, weather: draft.weatherOn ? draft.weather : null, date: useDate, forceMood: draft.mood }, LANG);
  return {
    id: uid(), createdAt: Date.now(), date: draft.date, dateOn: draft.dateOn, text: draft.text, photos: draft.photos.slice(), voiceOn: draft.voiceOn,
    song: { kind: song.file ? 'file' : 'link', url: song.url || '', title: song.title || '', artist: song.artist || '', tempo: song.tempo || 'mid', mode: song.mode || 'unknown', bpm: song.bpm || null, energy: song.energy ?? null, blob: song.file || null, fileName: song.file ? song.file.name : '' },
    weather: draft.weatherOn ? draft.weather : null, geo: draft.geoOn ? draft.geo : null,
    textInfo, photoInfo, style,
    voiceBlob: draft.voice && draft.voice.keep ? draft.voice.blob : null, videoBlob: draft.video ? draft.video.blob : null
  };
}

/* ---------- 7. рисование карточки ---------- */
let svgCounter = 0;
function artSvg(day) {
  const st = day.style, P = st.pal, id = 'a' + (++svgCounter), r = rng(hash(day.id)), e = st.energy, slow = st.tempo === 'slow', fast = st.tempo === 'fast';
  const j = (a, b) => a + r() * (b - a); let g = '';
  if (st.technique === 'monet') {
    const blur = slow ? 30 : fast ? 16 : 24;
    const bl = [[110, 190, 260, 220, 0], [300, 240, 240, 240, 1], [230, 140, 140, 120, 2], [90, 350, 220, 140, 3]].map(([x, y, w, h, i]) => `<ellipse cx="${x + j(-14, 14)}" cy="${y + j(-14, 14)}" rx="${w / 2}" ry="${h / 2}" fill="${P.blobs[i]}" opacity="${i === 2 ? .7 : .88}"/>`).join('');
    const n = Math.round(8 + e * 12 + (fast ? 4 : 0)); let sk = '';
    for (let i = 0; i < n; i++) { const x = j(30, 350), y = j(70, 400), l = j(34, 60), a = j(-.35, .35); sk += `<path d="M${x.toFixed(0)} ${y.toFixed(0)}L${(x + Math.cos(a) * l).toFixed(0)} ${(y + Math.sin(a) * l).toFixed(0)}" stroke="${P.strokes[i % P.strokes.length]}"/>`; }
    g = `<defs><filter id="${id}b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${blur}"/></filter><filter id="${id}g" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .7 0"/></filter>
<linearGradient id="${id}t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.scrim}" stop-opacity=".85"/><stop offset="1" stop-color="${P.scrim}" stop-opacity="0"/></linearGradient>
<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.scrim}" stop-opacity="0"/><stop offset=".45" stop-color="${P.scrim}" stop-opacity=".95"/><stop offset="1" stop-color="${P.scrim}" stop-opacity=".98"/></linearGradient></defs>
<rect width="400" height="500" fill="${P.base}"/><g filter="url(#${id}b)">${bl}<ellipse cx="250" cy="340" rx="190" ry="40" fill="${P.water}" opacity=".4"/></g>
<g stroke-linecap="round" stroke-width="10" opacity=".6" fill="none">${sk}</g>
<rect width="400" height="90" fill="url(#${id}t)"/><rect y="330" width="400" height="170" fill="url(#${id}s)"/><rect width="400" height="500" filter="url(#${id}g)" opacity="${st.grain}"/>`;
  } else if (st.technique === 'kandinsky') {
    let grid = ''; for (let x = 0; x <= 400; x += 40) grid += `M${x} 0V500`; for (let y = 0; y <= 500; y += 40) grid += `M0 ${y}H400`;
    const diag = 2 + Math.round(e * 3); let d = '';
    for (let i = 0; i < diag; i++) { const x0 = j(-40, 160), w = [3, 1.5, 6, 2, 4][i % 5]; d += `<path d="M${x0.toFixed(0)} 500L${(x0 + j(280, 440)).toFixed(0)} ${j(40, 180).toFixed(0)}" stroke="${[P.c, P.b, P.a][i % 3]}" stroke-width="${w}"/>`; }
    g = `<rect width="400" height="500" fill="${P.base}"/><path d="${grid}" stroke="${P.grid}" stroke-width="1" fill="none"/>
<circle cx="${j(250, 300)}" cy="${j(160, 210)}" r="120" fill="none" stroke="${P.b}" stroke-width="2"/><circle cx="${j(250, 300)}" cy="${j(160, 210)}" r="70" fill="${P.a}"/>
<circle cx="${j(90, 130)}" cy="${j(290, 330)}" r="46" fill="${P.base}" stroke="${P.b}" stroke-width="2"/>${d}
<polygon points="60,430 150,300 200,430" fill="none" stroke="${P.accent}" stroke-width="3"/>
<rect x="30" y="110" width="150" height="14" fill="${P.b}"/><rect x="30" y="132" width="90" height="14" fill="${P.a}"/>
<rect x="310" y="330" width="60" height="60" fill="none" stroke="${P.c}" stroke-width="2"/><rect y="370" width="400" height="130" fill="${P.base}" fill-opacity=".93"/>`;
  } else if (st.technique === 'japan') {
    const n = 4 + Math.round(e * 8); let rain = '';
    for (let i = 0; i < n; i++) { const x = 240 + (i * 150) / n + j(0, 8); rain += `<path d="M${x.toFixed(0)} 0V${j(120, 330).toFixed(0)}" stroke="${P.line}" stroke-opacity=".7" stroke-width="1"/>`; }
    g = `<rect width="400" height="500" fill="${P.base}"/>${rain}<circle cx="${j(300, 340)}" cy="${j(330, 360)}" r="30" fill="${P.accent}"/>`;
  } else {
    const n = 4 + Math.round(e * 2); let sh = '';
    for (let i = 0; i < n; i++) { const w = j(130, 200), h = j(100, 160), x = j(10, 400 - w - 10), y = j(40, 300 - h / 2); sh += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="${P.c[i % P.c.length]}" transform="rotate(${j(-7, 7).toFixed(1)} ${(x + w / 2).toFixed(0)} ${(y + h / 2).toFixed(0)})"/>`; }
    g = `<defs><filter id="${id}g" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .7 0"/></filter></defs>
<rect width="400" height="500" fill="${P.base}"/>${sh}<circle cx="${j(290, 340)}" cy="${j(310, 350)}" r="46" fill="${P.c[0]}"/><circle cx="${j(70, 110)}" cy="${j(130, 170)}" r="22" fill="${P.base}"/>
<rect y="370" width="400" height="130" fill="${P.base}" fill-opacity=".94"/><rect width="400" height="500" filter="url(#${id}g)" opacity="${st.grain}"/>`;
  }
  return `<svg viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${g}</svg>`;
}
function songLabel(day) { const s = day.song; const base = s.artist || s.title || (LANG === 'en' ? 'song' : 'песня'); const w = base.split(/\s+/); return (w[w.length - 1] || base).slice(0, 18); }
const PHOTO_STYLE = {
  monet: { pf: 'saturate(1.15) sepia(.28) contrast(.95) blur(.4px)', tintmode: 'soft-light', tinto: .5 },
  kandinsky: { pf: 'grayscale(.85) contrast(1.25) brightness(.9)', tintmode: 'color', tinto: .5 },
  japan: { pf: 'grayscale(.6) brightness(1.08) contrast(.9)', tintmode: 'multiply', tinto: .08 },
  collage: { pf: 'saturate(1.35) contrast(1.15)', tintmode: 'multiply', tinto: .12 }
};
/** Карточка дня 4:5. Размеры шрифтов считаются от ширины карточки, поэтому она одинаково выглядит и маленькой, и большой. */
function cardHtml(day, o = {}) {
  const st = day.style, P = st.pal, ps = PHOTO_STYLE[st.technique];
  const tint = st.technique === 'monet' ? P.blobs[0] : st.technique === 'kandinsky' ? P.a : st.technique === 'collage' ? P.c[1] : P.fg;
  const narrow = st.technique === 'japan', bw = st.technique === 'kandinsky' ? '2px' : st.technique === 'collage' ? '3px' : '1px';
  const vars = `--base:${P.base};--fg:${P.fg};--chip:${P.chip};--chipfg:${P.chipFg};--frame:${P.frame};--pf:${ps.pf};--tint:${tint};--tintmode:${ps.tintmode};--tinto:${ps.tinto};--bw:${bw};--tilt:${st.technique === 'collage' ? '-1.5deg' : '0deg'};--kb:${st.period + 1200}ms`;
  const imgs = day.photos.map((p, i) => `<div class="mc-img${i === 0 ? ' on' : ''}" style="background-image:url('${esc(p)}')"></div>`).join('');
  const date = day.dateOn ? fmtDate(day.date) : '';
  return `<div class="mcard${o.mini ? ' mini' : ''}" data-card="${esc(day.id)}" data-period="${st.period}" data-n="${day.photos.length}" style="${vars}">
  <div class="art">${artSvg(day)}</div>
  <div class="mc-layout">
    <div class="mc-top"><span class="mc-date">${esc(date)}</span>${day.song.title || day.song.artist || day.song.url || day.song.audioUrl ? `<span class="mc-song"><svg viewBox="0 0 14 12" aria-hidden="true"><rect x="0" y="5" width="2" height="7"/><rect x="4" y="1" width="2" height="11"/><rect x="8" y="4" width="2" height="8"/><rect x="12" y="7" width="2" height="5"/></svg>${esc(songLabel(day))}</span>` : ''}</div>
    ${day.photos.length ? `<div class="mc-photo${narrow ? ' narrow' : ''}">${imgs}<span class="mc-chip">${LANG === 'en' ? 'PHOTO' : 'ФОТО'} 1/${day.photos.length}</span></div>` : `<div class="mc-photo mc-words"><p>“${esc(String(day.text).slice(0, 180))}”</p></div>`}
    <div class="mc-bottom"><div class="mc-title">${esc(day.title || day.style.title)}</div><div class="mc-sig">${esc(day.style.signature)}</div></div>
  </div></div>`;
}
let cardTimers = [];
/** Запускает смену фото: частота зависит от темпа песни. */
function mountCards(root) {
  $$('.mcard', root).forEach(c => {
    const n = +c.dataset.n, imgs = $$('.mc-img', c), chip = $('.mc-chip', c); let i = 0;
    if (imgs[0]) { imgs[0].classList.remove('on'); requestAnimationFrame(() => requestAnimationFrame(() => imgs[0] && imgs[0].classList.add('on'))); }
    if (n < 2) return;
    cardTimers.push(setInterval(() => { imgs[i].classList.remove('on'); i = (i + 1) % n; imgs[i].classList.add('on'); if (chip) chip.textContent = `${LANG === 'en' ? 'PHOTO' : 'ФОТО'} ${i + 1}/${n}`; }, +c.dataset.period));
  });
}

/* ---------- ссылка на песню: встраиваемый плеер, прямой аудиофайл или обычная ссылка ---------- */
function linkKind(url) {
  if (!url || !/^https?:\/\//i.test(url)) return { kind: 'none' };
  let m = url.match(/(?:youtu\.be\/|[?&]v=|embed\/)([\w-]{11})/); if (m) return { kind: 'embed', src: `https://www.youtube-nocookie.com/embed/${m[1]}`, h: 220 };
  m = url.match(/^https:\/\/open\.spotify\.com\/(track|album|playlist)\/(\w+)/); if (m) return { kind: 'embed', src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, h: 152 };
  if (/\.(mp3|ogg|m4a|wav|aac|flac)(\?|#|$)/i.test(url)) return { kind: 'audio', src: url };
  return { kind: 'link', src: url };
}

/* ---------- демо-мелодия: короткая арпеджио-дорожка, чтобы у примеров был свой звук ---------- */
/** Собирает WAV: лад (мажор/минор) задаёт ноты, темп песни — скорость арпеджио. Свой материал, чужих записей нет. */
function synthSongBlob(song, seed) {
  const sr = 16000, bpm = song.tempo === 'slow' ? 72 : song.tempo === 'fast' ? 138 : 104, secs = 14, n = sr * secs, data = new Int16Array(n);
  const root = 196 * Math.pow(2, (seed % 5) / 12), third = song.mode === 'minor' ? 6 / 5 : 5 / 4;
  const notes = [1, third, 3 / 2, 2, 3 / 2, third].map(r => root * r), step = Math.round(sr * 60 / bpm / 2);
  for (let i = 0; i < n; i++) {
    const k = Math.floor(i / step), t = (i % step) / step, f = notes[k % notes.length] * (k % 12 === 11 ? .5 : 1);
    const env = Math.min(1, t * 18) * Math.exp(-t * (song.tempo === 'fast' ? 3.2 : 1.6));
    const pad = Math.sin(2 * Math.PI * root * .5 * i / sr) * .12;
    const v = (Math.sin(2 * Math.PI * f * i / sr) * .5 + Math.sin(4 * Math.PI * f * i / sr) * .12) * env + pad;
    data[i] = Math.max(-1, Math.min(1, v * .6)) * 32767;
  }
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), w = (o, s) => [...s].forEach((c, j) => v.setUint8(o + j, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  new Int16Array(buf, 44).set(data);
  return new Blob([buf], { type: 'audio/wav' });
}
