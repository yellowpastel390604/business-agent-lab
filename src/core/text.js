/**
 * Language-aware text helpers used to match search results against a claim, without a model.
 *
 * Korean attaches particles to words (삼성전자는, 삼성전자가), so Hangul words are reduced to a stem and
 * matched as substrings; other words must match exactly.
 */

/** 'ko' | 'en' */
export const LANG_NAME = { ko: 'Korean', en: 'English' };

const isHangul = w => /[가-힣]/.test(w);
const WORD_SPLIT = /[^\p{L}\p{N}%$.]+/u;

/**
 * Lower-cases, drops quote marks and collapses spaces. Numbers are normalized so that "2.50%" and "2.5%"
 * (or "10.0" and "10") compare equal.
 */
export const norm = s => s.toLowerCase()
  .replace(/(\d\.\d*?)0+(?!\d)/g, '$1')
  .replace(/(\d)\.(?!\d)/g, '$1')
  .replace(/[‘’“”"']/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/** The language of a post: 'ko' when more than a fifth of its letters are Hangul, else 'en'. */
export function detectLang(text) {
  const letters = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (!letters) return 'en';
  return (letters.match(/[가-힣]/g) || []).length / letters.length > 0.2 ? 'ko' : 'en';
}

/** Distinct keyword tokens of a text (short words dropped; Hangul words stemmed). */
export function keyTokens(s) {
  const words = norm(s).split(WORD_SPLIT).filter(w => (isHangul(w) ? w.length >= 2 : w.length > 3));
  return [...new Set(words.map(w => (isHangul(w) ? w.slice(0, Math.max(2, w.length - 1)) : w)))];
}

/** How many of the `wanted` tokens occur in `haystack`. */
export function overlapScore(wanted, haystack) {
  const text = norm(haystack);
  const words = new Set(text.split(WORD_SPLIT));
  return wanted.filter(w => (isHangul(w) ? text.includes(w) : words.has(w))).length;
}

/**
 * Tokens with digits, which tell one event from another (누리호 "4차" vs "5차", "3 people").
 * Years are left out: articles rarely repeat the year.
 */
export const numberTokens = s => keyTokens(s).filter(w => /\d/.test(w) && !/^(19|20)\d\d/.test(w));

/** First `n` words of a query (searches need every word to match, so shorter queries find more). */
export const firstWords = (query, n) => query.split(/\s+/).slice(0, n).join(' ');

/** True when `quote` (at least 12 characters) appears in `text`, ignoring case, quotes and spacing. */
export function quoteInText(quote, text) {
  const q = norm(quote);
  return q.length >= 12 && norm(text).includes(q);
}
