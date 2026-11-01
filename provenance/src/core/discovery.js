/**
 * Source discovery: from a claim and its queries to the few candidate articles worth reading.
 *
 * The search widens step by step and stops as soon as a strong match shows up, because every extra
 * request risks the engines throttling us:
 *
 *   1. listed outlets, likeliest first        (searchListed, one tier at a time)
 *   2. open search over every outlet          (only if settings.openSearch; results labelled external)
 *   3. Korean only: Naver, month by month     (older events, which the news indexes no longer list first)
 *   4. nothing at all: shorter queries         (searches need every word to match)
 */
import { searchListed, searchOpen } from './search/index.js';
import { inDomains, canonicalUrl, sleep, tuning } from './search/http.js';
import { rankCandidates, strongScore } from './ranking.js';
import { englishTiers, knownFor } from './outlets.js';
import { firstWords } from './text.js';

const MONTHS_BACK = 18;
const SHORT_QUERY_WORDS = 3;

/**
 * @typedef {{ domains: string[], queries: string[], lang: string, web: boolean, required?: boolean }} SearchStep
 *   web: also ask for ordinary web results; required: the search may not stop before this step has run
 */

/**
 * The listed-outlet steps, in order.
 * English posts: the outlet tiers. Korean posts: Korean outlets in Korean, then (when the model wrote an
 * English query) the international outlets in English. That English step is required, because Korean
 * results about a foreign event are usually recent follow-ups, not the original report.
 * @returns {SearchStep[]}
 */
export function searchPlan(settings, lang, queries, english) {
  if (lang !== 'ko') return englishTiers(settings).map(domains => ({ domains, queries, lang, web: true }));

  const steps = [{ domains: settings.koreanDomains || [], queries, lang: 'ko', web: true }];
  if (english) {
    const { trustedDomains: t, perspectiveDomains: p } = settings;
    [t.slice(0, 16), t.slice(16), p].filter(d => d.length).forEach((domains, i) =>
      steps.push({ domains, queries: [english], lang: 'en', web: i === 0, required: i === 0 }));
  } else {
    steps.push({ domains: settings.trustedDomains, queries, lang: 'ko', web: false });
  }
  return steps.filter(st => st.domains.length);
}

/** Last-day-first list of the previous `n` months as YYYY-MM (the current month is left to step 1-2). */
function previousMonths(n, now = new Date()) {
  return Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1)).toISOString().slice(0, 7));
}

/**
 * Searches `domains` with progressively shorter queries (all words, then the first 3, then 2) until
 * something turns up; if everything is empty (which can also mean throttling), pauses once and retries.
 */
export async function searchBackoff(queries, domains, { web = false, lang = 'en' } = {}) {
  const attempt = async () => {
    for (const n of [Infinity, 3, 2]) {
      const qs = queries.map(q => (n === Infinity ? q : firstWords(q, n)));
      const found = (await Promise.all(qs.map((q, i) => searchListed(q, domains, { web: web && i === 0, lang })))).flat();
      if (found.length) return found;
      if (qs.every(q => q.split(/\s+/).length <= 2)) break;
    }
    return [];
  };
  const found = await attempt();
  if (found.length) return found;
  await sleep(tuning.retryMs);
  return attempt();
}

/**
 * Up to three candidate articles for one claim (see rankCandidates for how they are chosen).
 * @param {object} settings
 * @param {string} claim
 * @param {string[]} queries  in the claim's language
 * @param {string} lang       'ko' | 'en'
 * @param {string} [english]  English query for non-English claims
 * @param {string} [skipUrl]  the page the post was read on: never its own source (that would be circular)
 * @returns {Promise<import('./ranking.js').Candidate[]>}
 */
export async function findCandidates(settings, claim, queries, lang, english = '', skipUrl = '') {
  const allQueries = english ? [...queries, english] : queries;
  const need = strongScore(claim, allQueries);
  const openSearch = settings.openSearch !== false;
  // Korean claims ask more of the early steps: a recent story that merely mentions the event (a
  // retrospective, the next launch) is not good enough to skip the month-by-month search for the original.
  const monthWalk = lang === 'ko' && openSearch;
  const earlyBar = monthWalk ? need + 1 : need;

  const external = known => item => ({ ...item, external: !inDomains(item.url, known) });
  let pool = [];
  const skip = skipUrl && canonicalUrl(skipUrl);
  const ranked = () => rankCandidates(skip ? pool.filter(r => canonicalUrl(r.url) !== skip) : pool, claim, allQueries);
  /** The ranked candidates if one of them reaches `bar` and names the claim's numbers, else null. */
  const strong = bar => {
    const top = ranked();
    return top.some(c => c.overlap >= bar && c.exact) ? top : null;
  };

  // 1. Listed outlets.
  const steps = searchPlan(settings, lang, queries, english);
  for (const [si, step] of steps.entries()) {
    for (const [qi, q] of step.queries.entries()) {
      pool.push(...await searchListed(q, step.domains, { web: step.web && qi === 0, lang: step.lang }));
      if (steps.slice(si + 1).some(st => st.required)) continue;
      const hit = strong(earlyBar);
      if (hit) return hit;
    }
  }

  if (openSearch) {
    const toResult = external(knownFor(settings, lang));

    // 2. Every outlet. A long query needs every word to match, so a query that finds nothing is retried shorter.
    const openQueries = [...queries.map(q => [q, lang]), ...(english ? [[english, 'en']] : [])];
    for (const [q, qlang] of openQueries) {
      for (const query of [q, firstWords(q, SHORT_QUERY_WORDS)]) {
        const found = await searchOpen(query, { lang: qlang });
        pool.push(...found.map(toResult));
        const hit = strong(earlyBar);
        if (hit) return hit;
        if (found.length) break;
      }
    }

    // 3. Older Korean events: month by month. The first month with a hit may hold only follow-ups,
    //    so one more month back is read for the original report before stopping.
    if (monthWalk) {
      let found = null;
      for (const when of previousMonths(MONTHS_BACK)) {
        pool.push(...(await searchOpen(queries[0], { lang, when })).map(toResult));
        if (found) return strong(need) || found;
        found = strong(need + 1);
      }
      if (found) return found;
    }
  }

  // 4. Nothing relevant at all: shorter queries on the likeliest outlets.
  if (!ranked().length) {
    const first = steps[0];
    pool = await searchBackoff(queries.map(q => firstWords(q, SHORT_QUERY_WORDS)), first?.domains || [],
      { web: true, lang: first?.lang || lang });
  }
  return ranked();
}
