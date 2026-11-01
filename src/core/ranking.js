/**
 * Scores search results against a claim (keyword overlap, no model) and picks the few candidates the
 * confirm model will read.
 */
import { keyTokens, overlapScore, numberTokens } from './text.js';
import { dateFromUrl } from './search/http.js';

export const CANDIDATES_PER_CLAIM = 3;
/** A result needs at least this share of the best result's score to count as relevant. */
const RELEVANCE_FLOOR = 0.5;
/**
 * The earliest-report slot accepts a lower share: the first report of a story is often worded differently
 * from the retellings that later dominate search results (an announcement vs. a punchy headline).
 */
const EARLIEST_FLOOR = 0.3;
/** Headlines sharing at least this share of keywords are one story copied around (syndication, reprints). */
const SAME_HEADLINE = 0.8;
const SAME_HEADLINE_MIN_WORDS = 3;
/** Score lost per number of the claim (4차, 2.5%) missing from a headline. */
const MISSING_NUMBER_PENALTY = 2;

/**
 * @typedef {import('./search/http.js').SearchResult & { overlap: number, exact: boolean }} Candidate
 *   overlap = keyword score; exact = the headline names every number in the claim
 */

/**
 * The minimum score a candidate needs for the search to stop early: 2 or 3 depending on how many
 * keywords the claim and queries have.
 */
export const strongScore = (claim, queries) =>
  Math.min(3, Math.max(2, Math.ceil(keyTokens(queries.join(' ') + ' ' + claim).length / 3)));

/** @returns {Candidate[]} every result once, scored */
function score(items, claim, queries) {
  const wanted = keyTokens(queries.join(' ') + ' ' + claim);
  const numbers = numberTokens(claim);
  const seen = new Set();
  const scored = [];
  for (const it of items) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    // A headline without the claim's numbers is about a different event (the 5th launch, not the 4th).
    const missing = numbers.length - overlapScore(numbers, it.title);
    const overlap = Math.max(0, overlapScore(wanted, it.title + ' ' + it.snippet) - MISSING_NUMBER_PENALTY * missing);
    scored.push({ ...it, date: it.date || dateFromUrl(it.url), overlap, exact: !missing });
  }
  return scored;
}

/** Headline keywords without the outlet name that search engines append (" - 뉴스1", " | Reuters"). */
const headlineWords = title => keyTokens(title.replace(/\s+[-|ㅣ]\s+[^-|ㅣ]+$/, ''));

function sameHeadline(a, b) {
  const shorter = Math.min(a.length, b.length);
  if (shorter < SAME_HEADLINE_MIN_WORDS) return false;
  const bs = new Set(b);
  return a.filter(w => bs.has(w)).length / shorter >= SAME_HEADLINE;
}

/**
 * One candidate per copied headline. A reprint carries the story but is not its origin, and a cluster of
 * copies must not fill every slot. The copy kept is the earliest dated one (else the best scored), and it
 * takes the cluster's best score so the story keeps its rank.
 * @param {Candidate[]} scored
 * @returns {Candidate[]}
 */
function oneCopyPerHeadline(scored) {
  const clusters = [];
  for (const c of scored) {
    const words = headlineWords(c.title);
    const cluster = clusters.find(k => sameHeadline(k.words, words));
    if (cluster) cluster.members.push(c); else clusters.push({ words, members: [c] });
  }
  return clusters.map(({ members }) => {
    const dated = members.filter(m => m.date).sort((a, b) => a.date.localeCompare(b.date));
    const keep = dated[0] || [...members].sort((a, b) => b.overlap - a.overlap)[0];
    return { ...keep, overlap: Math.max(...members.map(m => m.overlap)), exact: members.some(m => m.exact) };
  });
}

/**
 * Up to CANDIDATES_PER_CLAIM relevant results, chosen to mix the evidence:
 * the strongest match, the earliest report (closest to the origin; see EARLIEST_FLOOR), the latest report (the earliest alone
 * favours previews written before the event happened) and the best undated page (official pages carry no date).
 * @returns {Candidate[]}
 */
export function rankCandidates(items, claim, queries) {
  const scored = oneCopyPerHeadline(score(items, claim, queries));
  const best = Math.max(0, ...scored.map(s => s.overlap));
  const floorAt = share => Math.max(1, Math.ceil(best * share));
  const relevant = scored.filter(s => s.overlap >= floorAt(RELEVANCE_FLOOR));
  const oldestFirst = (a, b) => a.date.localeCompare(b.date) || b.overlap - a.overlap;

  const byScore = [...relevant].sort((a, b) => b.overlap - a.overlap || (b.date || '').localeCompare(a.date || ''));
  const byDate = relevant.filter(s => s.date).sort(oldestFirst);
  const earliest = scored.filter(s => s.date && s.overlap >= floorAt(EARLIEST_FLOOR)).sort(oldestFirst)[0];

  const top = [];
  const add = c => { if (c && !top.includes(c) && top.length < CANDIDATES_PER_CLAIM) top.push(c); };
  add(byScore[0]);
  add(earliest);
  add(byDate[byDate.length - 1]);
  add(byScore.find(s => !s.date));
  byScore.forEach(add);
  return top;
}
