/**
 * Bing News, through its RSS output: free, key-less, and filterable with `site:` terms.
 * The main search provider. Covers roughly the last month of news.
 */
import { pace, fetchWithTimeout, decodeEntities, cleanText, hostOf } from './http.js';

const LOCALE = { ko: 'setmkt=ko-KR&setlang=ko', en: 'setmkt=en-US&setlang=en' };

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')).trim() : '';
}

/** Bing wraps some links as bing.com/news/apiclick.aspx?...&url=<real url>. */
function unwrap(link) {
  try {
    const u = new URL(link);
    if (u.hostname.endsWith('bing.com')) return u.searchParams.get('url') || link;
  } catch {}
  return link;
}

/** @returns {import('./http.js').SearchResult[]} */
export function parseBingRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(([, item]) => {
    const url = unwrap(tag(item, 'link'));
    const time = Date.parse(tag(item, 'pubDate'));
    return {
      url,
      title: cleanText(tag(item, 'title')),
      snippet: cleanText(tag(item, 'description')),
      date: Number.isNaN(time) ? '' : new Date(time).toISOString().slice(0, 10),
      outlet: hostOf(url)
    };
  }).filter(i => i.url && i.title);
}

/** `site:a OR site:b ...` clause. Bing handles about 8 terms per query. */
export const siteTerms = sites => '(' + sites.map(d => 'site:' + d).join(' OR ') + ')';

/**
 * @param {string} query
 * @param {{ sites?: string[], lang?: string }} opts  no sites = open search over every outlet
 * @returns {Promise<import('./http.js').SearchResult[]>}  [] on any failure
 */
async function search(query, { sites = [], lang = 'en' } = {}) {
  const q = encodeURIComponent(sites.length ? `${query} ${siteTerms(sites)}` : query);
  try {
    await pace();
    const res = await fetchWithTimeout(`https://www.bing.com/news/search?q=${q}&format=rss&${LOCALE[lang] || LOCALE.en}`);
    return res.ok ? parseBingRss(await res.text()) : [];
  } catch {
    return [];
  }
}

export const bing = { id: 'bing', search };
