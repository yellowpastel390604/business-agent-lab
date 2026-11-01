/**
 * Verification: read the candidate pages, let the confirm model judge them against the claim, and check
 * its answer in code (the chosen candidate must exist, a quote must really be on the page, an unreadable
 * page can never yield "match", and a claim that drops the source's conditions is "distorted", not "match").
 */
import { chat, parseJson } from './llm/client.js';
import * as prompts from './prompts.js';
import { fetchPage } from './reader.js';
import { quoteInText } from './text.js';

const PAGE_CHARS_FOR_MODEL = 5000;
const POST_CONTEXT_CHARS = 800;
/** Dropped conditions named in the summary; the model may list a dozen, the reader needs the main ones. */
const CONDITIONS_SHOWN = 3;
export const VERDICTS = ['match', 'distorted', 'not_found', 'unclear'];

/**
 * @typedef {{ claim: string, verdict: string, outlet: string, title: string, url: string, date: string,
 *   quote: string, summary: string, external?: boolean,
 *   pages: { url: string, readable: boolean, status: number, error: string }[],
 *   unreadable?: boolean, needsTranslation?: boolean }} ClaimResult
 *   unreadable / needsTranslation are internal flags, removed by localize()
 */

/** Reads every candidate page; when the publisher blocks us, Naver's copy of the article is read instead. */
export async function readCandidates(candidates, domains) {
  return Promise.all(candidates.map(async c => {
    let page = await fetchPage(c.url, domains, { any: !!c.external });
    if (!page.ok && c.mirror) page = await fetchPage(c.mirror, ['naver.com']);
    return { ...c, page };
  }));
}

/** The candidates as the confirm model sees them: numbered, with page text or (if unreadable) the snippet. */
function describe(candidates) {
  return candidates.map((c, i) => {
    const body = c.page.ok
      ? `<page>\n${c.page.text.slice(0, PAGE_CHARS_FOR_MODEL)}\n</page>`
      : `<page unreadable="${c.page.error}">Only the search snippet is available: ${c.snippet}</page>`;
    return `[${i + 1}] ${c.outlet}${c.external ? ' (not on the trusted list)' : ''} | ${c.date || 'undated'} | ${c.title}\n${body}`;
  }).join('\n\n');
}

/**
 * The source's conditions on the claim, when the model says the claim drops them AND that this misleads, else [].
 * Both flags must agree: a claim that only leaves out details (who reported it, exact figures) stays a match.
 */
function droppedConditions(out) {
  if (out.claim_keeps_conditions !== false || out.misleading_without !== true || !Array.isArray(out.conditions)) return [];
  return out.conditions.map(c => String(c).trim().replace(/[.;\s]+$/, '')).filter(Boolean).slice(0, CONDITIONS_SHOWN);
}

/**
 * Asks the confirm model and turns its answer into a checked result.
 * @param {ClaimResult} base  the not-found result to build on
 * @param {{ noMatch: string }} notes
 * @returns {Promise<ClaimResult>}
 */
export async function confirm(settings, claim, postText, candidates, base, notes, stats) {
  const out = parseJson(await chat(settings, 'confirm', prompts.confirmSource(),
    `Claim: ${claim}\n\nPost context: <post>${postText.slice(0, POST_CONTEXT_CHARS)}</post>\n\nCandidates:\n${describe(candidates)}`,
    stats));

  let verdict = VERDICTS.includes(out.verdict) ? out.verdict : 'unclear';
  const chosen = Number.isInteger(out.best) ? candidates[out.best - 1] : undefined;
  if (!chosen) {
    // No candidate picked (or a made-up number): there is no source to show.
    return { ...base, verdict: verdict === 'not_found' ? 'not_found' : 'unclear',
      summary: String(out.summary || notes.noMatch), needsTranslation: !!out.summary };
  }

  let quote = '';
  let summary = String(out.summary || '');
  if (chosen.page.ok) {
    if (out.quote && quoteInText(String(out.quote), chosen.page.text)) quote = String(out.quote);
  } else if (verdict === 'match') {
    verdict = 'unclear';    // nothing was read, so nothing can be confirmed
  }
  const dropped = droppedConditions(out);
  if (verdict === 'match' && dropped.length) {
    // The source attaches limits the claim leaves out: "missing context" is a distortion, whatever the model chose.
    verdict = 'distorted';
    summary = `${summary} The claim leaves out these limits: ${dropped.join('; ')}.`.trim();
  }
  return {
    ...base, verdict, quote,
    outlet: chosen.outlet, title: chosen.title, url: chosen.url,
    date: chosen.date || chosen.page.date || '',
    summary,
    external: !!chosen.external,
    unreadable: !chosen.page.ok,
    needsTranslation: true
  };
}
