/**
 * Naver News, the main Korean news search (HTML results page).
 *
 * Class names on the page are obfuscated, but every result carries the original publisher URL in a
 * `data-url` attribute, plus a link to Naver's own copy of the article (the "mirror"), which stays
 * readable when the publisher blocks automated requests.
 *
 * Naver lists recent stories first, and inside a date window it lists the window's edge, so an older
 * event is only found by searching its own month (`when`).
 */
import { pace, makePacer, tuning, fetchWithTimeout, decodeEntities, cleanText, hostOf } from './http.js';

const naverPace = makePacer(() => tuning.naverPaceMs);   // on top of the shared pace: Naver throttles harder

const RELATIVE_MS = { 분: 60e3, 시간: 3600e3, 일: 86400e3, 주: 7 * 86400e3 };
const DATE_TEXT = /\d{4}\.\d{2}\.\d{2}\.|\d+\s*(?:분|시간|일|주)\s*전/g;
const MIRROR_LINK = /href="(https:\/\/n\.news\.naver\.com\/[^"]+)"/g;

/** "2025.11.27." or "3시간 전" (3 hours ago) → YYYY-MM-DD. */
function parseDate(text) {
  const abs = text.match(/(\d{4})\.(\d{2})\.(\d{2})\./);
  if (abs) return `${abs[1]}-${abs[2]}-${abs[3]}`;
  const rel = text.match(/(\d+)\s*(분|시간|일|주)\s*전/);
  return rel ? new Date(Date.now() - Number(rel[1]) * RELATIVE_MS[rel[2]]).toISOString().slice(0, 10) : '';
}

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @returns {import('./http.js').SearchResult[]} */
export function parseNaverNews(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/data-url="(https?:\/\/[^"]+)"/g)) {
    const url = decodeEntities(m[1]);
    if (seen.has(url) || /(^|\.)naver\.com$/.test(hostOf(url))) continue;
    seen.add(url);

    const headline = html.match(new RegExp(`<a[^>]*href="${escapeRegExp(url).replace(/&/g, '(?:&|&amp;)')}"[^>]*>([\\s\\S]*?)</a>`));
    const title = headline ? cleanText(headline[1]).replace(/\s*새 창 열림$/, '') : '';
    if (!title) continue;

    // Current markup: date, mirror link and data-url come before the headline, the snippet after it.
    // Older markup had all of them after the headline. So: date and mirror are the last ones just before
    // data-url, and the snippet is the first long text after the headline.
    const before = html.slice(Math.max(0, m.index - 1500), m.index);
    const lastMatch = re => [...before.matchAll(re)].pop();
    const headlineEnd = headline.index + headline[0].length;
    const after = html.slice(headlineEnd, headline.index > m.index ? headlineEnd + 3000 : m.index).slice(0, 6000);
    const snippet = after.match(/<a[^>]*>(?:<span[^>]*>)+([^<]{20,})/);

    out.push({
      url, title, outlet: hostOf(url),
      snippet: snippet ? cleanText(snippet[1]) : '',
      date: parseDate(lastMatch(DATE_TEXT)?.[0] || ''),
      mirror: lastMatch(MIRROR_LINK)?.[1] || ''
    });
  }
  return out;
}

/** URL parameters that limit the search to `when` (YYYY or YYYY-MM); '' for no limit. */
export function dateRange(when) {
  const m = String(when || '').match(/^(\d{4})(?:-(\d{2}))?/);
  if (!m) return '';
  const [, y, mo] = m;
  const lastDay = mo ? new Date(Date.UTC(+y, +mo, 0)).getUTCDate() : 31;
  return `&pd=3&ds=${y}.${mo || '01'}.01&de=${y}.${mo || '12'}.${lastDay}`;
}

/**
 * @param {string} query
 * @param {{ when?: string }} opts
 * @returns {Promise<import('./http.js').SearchResult[]>}  [] on any failure
 */
async function search(query, { when = '' } = {}) {
  try {
    await naverPace();
    await pace();
    const res = await fetchWithTimeout('https://search.naver.com/search.naver?where=news&sort=0' + dateRange(when) +
      '&query=' + encodeURIComponent(query));
    return res.ok ? parseNaverNews(await res.text()) : [];
  } catch {
    return [];
  }
}

export const naver = { id: 'naver', search };
