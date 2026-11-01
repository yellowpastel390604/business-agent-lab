/**
 * Model steps before searching: find the claims in a post, then write search queries for each claim.
 */
import { chat, parseJson } from './llm/client.js';
import * as prompts from './prompts.js';
import { isCleanText } from './langcheck.js';

const MAX_POST_CHARS = 4000;
const FALLBACK_QUERY_CHARS = 80;

/**
 * @typedef {{ topic: string, topicEn: string, claims: string[] }} Extracted
 *   topic in the post's language, topicEn the same as an English search phrase
 */

/** @returns {Promise<Extracted>} */
async function askForClaims(settings, text, stats, opts) {
  const out = parseJson(await chat(settings, 'extract', prompts.extractClaims(settings),
    `<post>\n${text.slice(0, MAX_POST_CHARS)}\n</post>`, stats, opts));
  return {
    topic: String(out.topic || ''),
    topicEn: String(out.topic_en || ''),
    claims: (Array.isArray(out.claims) ? out.claims : [])
      .map(c => String(c?.claim ?? c ?? '')).filter(Boolean).slice(0, settings.maxClaims)
  };
}

const isClean = (x, lang) => [x.topic, ...x.claims].every(t => isCleanText(t, lang));

/**
 * The checkable claims of a post, restated in the post's language. If the model drifts into another
 * language while restating them, it is asked once more on a different model.
 * @returns {Promise<Extracted>}
 */
export async function extractClaims(settings, text, lang, stats) {
  const first = await askForClaims(settings, text, stats);
  if (isClean(first, lang)) return first;
  const retry = await askForClaims(settings, text, stats, { avoid: [stats.lastModel] }).catch(() => null);
  return retry && isClean(retry, lang) ? retry : first;
}

/**
 * Two queries in the claim's own language, plus (for non-English claims) one English query:
 * international stories are reported by Reuters, BBC and others in English, which Korean queries never reach.
 * @returns {Promise<{ queries: string[], english: string }>}
 */
export async function writeQueries(settings, claim, lang, stats) {
  const out = parseJson(await chat(settings, 'crawl', prompts.writeQueries({ lang }), `<post>${claim}</post>`, stats));
  const queries = (Array.isArray(out.queries) ? out.queries : []).map(String).filter(Boolean).slice(0, 2);
  return {
    queries: queries.length ? queries : [claim.slice(0, FALLBACK_QUERY_CHARS)],
    english: lang === 'en' ? '' : String(out.english || '').trim()
  };
}
