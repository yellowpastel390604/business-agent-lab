/**
 * Other perspectives: how different outlets covered the same story. Found from headlines only (no page
 * reads), so it costs one search round and one model call.
 */
import { chat, parseJson } from './llm/client.js';
import * as prompts from './prompts.js';
import { searchBackoff } from './discovery.js';
import { perspectivesFor, internationalFor } from './outlets.js';

const MAX_HEADLINES = 6;      // shown to the model, one per outlet
const MAX_PERSPECTIVES = 3;
const LOCAL_FIRST = 3;        // for non-English posts: this many local headlines before the international ones

/** @typedef {{ outlet: string, url: string, angle: string, summary: string }} Perspective */

/** The first headline of each outlet, up to MAX_HEADLINES. */
function onePerOutlet(results) {
  const outlets = new Set();
  return results.filter(r => !outlets.has(r.outlet) && outlets.add(r.outlet)).slice(0, MAX_HEADLINES);
}

/** @returns {Promise<Perspective[]>} */
export async function findPerspectives(settings, { topic, topicEn, claims }, lang, stats) {
  let found = await searchBackoff([topic || claims[0]], perspectivesFor(settings, lang), { lang });
  if (lang !== 'en' && topicEn) {
    // International coverage of the same story (Reuters, BBC, Al Jazeera ...) is in English.
    const intl = await searchBackoff([topicEn], internationalFor(settings), { lang: 'en' });
    found = [...found.slice(0, LOCAL_FIRST), ...intl, ...found.slice(LOCAL_FIRST)];
  }
  const headlines = onePerOutlet(found);
  if (!headlines.length) return [];

  const out = parseJson(await chat(settings, 'crawl', prompts.comparePerspectives(),
    headlines.map((h, i) => `[${i + 1}] <headline>${h.outlet} | ${h.date} | ${h.title}\n${h.snippet}</headline>`).join('\n\n'),
    stats));
  return (Array.isArray(out.perspectives) ? out.perspectives : [])
    .map(p => ({ p, src: headlines[Number(p?.n) - 1] }))
    .filter(x => x.src)                 // drop picks that point at no headline
    .slice(0, MAX_PERSPECTIVES)
    .map(({ p, src }) => ({ outlet: src.outlet, url: src.url, angle: String(p.angle || ''), summary: String(p.summary || '') }));
}
