'use strict';
/**
 * Word guard for diary entries (English and Russian).
 * - BLOCK: clearly abusive words. A day containing them is not saved; the person is asked to rephrase.
 * - FLAG: words that may need a human look (self-harm, violence). The day is saved but marked for the admin.
 * Stems match the start of a word, so one stem covers all its forms ("fuck" → "fucking", "сук" → "сука").
 * The admin can add more words from the admin page; they are stored in the database, not here.
 */
const BLOCK = [
  // English
  'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'motherf', 'bastard', 'nigg', 'faggot', 'retard', 'whore', 'slut', 'dickhead', 'wanker', 'twat',
  // Russian
  'хуй', 'хуе', 'хуё', 'хуя', 'пизд', 'ебат', 'ебан', 'ебал', 'ебл', 'ебу', 'ёб', 'еби', 'бля', 'сука', 'суки', 'сучк', 'мудак', 'мудил', 'пидор', 'пидар', 'гандон', 'долбоеб', 'шлюх', 'уеб', 'залуп', 'дрочи'
];
const FLAG = [
  'suicide', 'kill myself', 'want to die', 'self-harm', 'cut myself', 'kill him', 'kill her', 'kill them',
  'суицид', 'самоубий', 'убить себя', 'покончить с собой', 'хочу умереть', 'убью', 'убить его', 'убить её', 'убить ее'
];

/** Lower case, ё→е, common look-alike digits and symbols to letters. */
function normalize(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е')
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/@/g, 'a').replace(/\$/g, 's');
}
const words = s => normalize(s).split(/[^a-zа-я'-]+/).filter(Boolean);

/**
 * Checks a text. Returns { blocked: [...], flagged: [...] } with the matched stems/phrases.
 * extra = { block: [], flag: [] } from the admin settings.
 */
function check(text, extra = {}) {
  const ws = words(text), joined = ' ' + ws.join(' ') + ' ';
  const block = BLOCK.concat(extra.block || []).map(normalize), flag = FLAG.concat(extra.flag || []).map(normalize);
  const blocked = [...new Set(block.filter(stem => stem && (stem.includes(' ') ? joined.includes(' ' + stem + ' ') : ws.some(w => w.startsWith(stem)))))];
  const flagged = [...new Set(flag.filter(p => p && (p.includes(' ') ? joined.includes(' ' + p) : ws.some(w => w.startsWith(p)))))];
  return { blocked, flagged };
}

module.exports = { check, BLOCK, FLAG };
