/**
 * The tracing pipeline: post text in, verified sources out.
 *
 *   read   extract the claims (model "extract")
 *   find   per claim: write queries (model "crawl") → search → rank → read pages
 *          in parallel: other perspectives on the story (model "crawl")
 *   check  per claim: judge the sources (model "confirm"), checked in code
 *          then: translate the summaries (model "translate")
 *
 * Models only judge and write; code does all searching and fetching, and checks every link and quote.
 * Browser-independent (fetch only), so it runs the same in the service worker and in Node (dev/run.mjs).
 */
import { newStats } from './llm/client.js';
import { extractClaims, writeQueries } from './claims.js';
import { findCandidates } from './discovery.js';
import { readCandidates, confirm } from './verify.js';
import { findPerspectives } from './perspectives.js';
import { localize } from './localize.js';
import { trustedFor, outputLangFor } from './outlets.js';
import { detectLang } from './text.js';
import { canonicalUrl } from './search/http.js';
import { ko } from '../shared/i18n.js';

const notesFor = outLang => (outLang === 'ko' ? ko.pipeline : ko.pipelineEn);

const emptyResult = (claim, summary) =>
  ({ claim, verdict: 'not_found', outlet: '', title: '', url: '', date: '', quote: '', summary, pages: [] });

/** One claim, end to end. @returns {Promise<import('./verify.js').ClaimResult>} */
async function traceClaim(settings, claim, postText, lang, notes, stats, onStep, pageUrl) {
  const { queries, english } = await writeQueries(settings, claim, lang, stats);
  const candidates = await findCandidates(settings, claim, queries, lang, english, pageUrl);
  const base = emptyResult(claim, notes.notFound);
  if (!candidates.length) return base;

  const read = await readCandidates(candidates, trustedFor(settings, lang));
  base.pages = read.map(c => ({ url: c.url, readable: !!c.page.ok, status: c.page.status, error: c.page.error || '' }));
  onStep('check');
  return confirm(settings, claim, postText, read, base, notes, stats);
}

/**
 * @typedef {{ topic: string, lang: string, claims: import('./verify.js').ClaimResult[],
 *   perspectives: import('./perspectives.js').Perspective[], stats: object, note?: string,
 *   allFailed?: boolean, firstError?: Error }} TraceResult
 */

/**
 * @param {string} text      the post
 * @param {object} settings  saved settings (see shared/config.js)
 * @param {(step: import('../shared/messages.js').Step) => void} [onStep]  progress, for the side panel
 * @param {{ pageUrl?: string }} [where]  the page the post was read on; it is never offered as its own source
 * @returns {Promise<TraceResult>}
 */
export async function runPipeline(text, settings, onStep = () => {}, { pageUrl = '' } = {}) {
  const stats = newStats();
  const lang = detectLang(text);
  const outLang = outputLangFor(settings, lang);
  const notes = notesFor(outLang);

  onStep('read');
  const extracted = await extractClaims(settings, text, lang, stats);
  const { topic, claims } = extracted;
  onStep('find');
  if (!claims.length) return { topic, lang, claims: [], perspectives: [], note: notes.noClaims, stats };

  const [traces, perspectives] = await Promise.all([
    Promise.allSettled(claims.map(c => traceClaim(settings, c, text, lang, notes, stats, onStep, pageUrl))),
    // Perspectives are a bonus: a failure here must not fail the whole trace.
    findPerspectives(settings, extracted, lang, stats).catch(() => [])
  ]);
  const results = traces.map((t, i) => (t.status === 'fulfilled' ? t.value
    : { ...emptyResult(claims[i], notes.failed + (t.reason?.message || '?')), verdict: 'unclear' }));

  // A perspective that is the same article as a source, or the page being read, adds nothing.
  const known = new Set([pageUrl, ...results.map(r => r.url)].filter(Boolean).map(canonicalUrl));
  const shown = perspectives.filter(p => !known.has(canonicalUrl(p.url)));
  await localize(settings, outLang, results, shown, notes, stats).catch(() => {});

  return {
    topic, lang, claims: results, perspectives: shown, stats,
    allFailed: traces.every(t => t.status === 'rejected'),
    firstError: traces.find(t => t.status === 'rejected')?.reason
  };
}
