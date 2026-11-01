/**
 * The two kinds of search the pipeline runs, on top of the providers:
 *
 *   searchListed  – only the outlets on the user's lists (Bing News with `site:` filters, plus
 *                   DuckDuckGo web results for official pages)
 *   searchOpen    – any outlet (Bing News without filters, plus Naver News for Korean)
 *
 * To add a provider: write a module exporting `{ id, search(query, opts) → SearchResult[] }` (see bing.js)
 * and add it to the lists below.
 */
import { pool, chunk, inDomains, firstPerUrl } from './http.js';
import { bing } from './bing.js';
import { duckduckgo } from './duckduckgo.js';
import { naver } from './naver.js';

const SITES_PER_QUERY = 8;   // `site:` terms per request
const CONCURRENCY = 2;       // requests in flight at once (more makes the engines throttle us)

/** News providers that accept a site filter, and web providers used when `web` is asked for. */
const LISTED_NEWS = [bing];
const LISTED_WEB = [duckduckgo];
/** Providers for open search, by language. */
const OPEN = { en: [bing], ko: [bing, naver] };

/**
 * Searches the listed `domains` (in batches of 8). Results from any other domain are dropped.
 * @param {string} query
 * @param {string[]} domains
 * @param {{ web?: boolean, lang?: string }} [opts]  web: add ordinary web results (official pages)
 * @returns {Promise<import('./http.js').SearchResult[]>}
 */
export async function searchListed(query, domains, { web = false, lang = 'en' } = {}) {
  const providers = web ? [...LISTED_NEWS, ...LISTED_WEB] : LISTED_NEWS;
  const tasks = chunk(domains, SITES_PER_QUERY).flatMap(sites =>
    providers.map(p => () => p.search(query, { sites, lang })));
  return (await pool(tasks, CONCURRENCY)).flat()
    .filter(i => inDomains(i.url, domains))
    .filter(firstPerUrl());
}

/**
 * Searches every outlet. With `when` (YYYY-MM), only providers that support a date window are asked
 * (Naver; Korean only).
 * @param {string} query
 * @param {{ lang?: string, when?: string }} [opts]
 * @returns {Promise<import('./http.js').SearchResult[]>}  results carry no trust: the caller labels them
 */
export async function searchOpen(query, { lang = 'en', when = '' } = {}) {
  const providers = (OPEN[lang] || OPEN.en).filter(p => !when || p.id === 'naver');
  const lists = [];
  for (const p of providers) lists.push(await p.search(query, { lang, when }));
  return lists.flat()
    .filter(i => /^https?:/.test(i.url))
    .filter(firstPerUrl());
}
