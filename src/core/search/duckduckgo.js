/**
 * DuckDuckGo's HTML endpoint: ordinary web results, which find official pages (developer blogs, store
 * pages, agency releases) that news indexes miss. A bonus provider: when it fails it is switched off
 * for a while instead of slowing every search down.
 */
import { pace, fetchWithTimeout, decodeEntities, cleanText, hostOf } from './http.js';
import { siteTerms } from './bing.js';

const REGION = { ko: 'kr-kr', en: 'us-en' };
const TIMEOUT_MS = 6000;
const COOL_DOWN_MS = 5 * 60_000;

let downUntil = 0;

/** @returns {import('./http.js').SearchResult[]} */
export function parseDdgHtml(html) {
  return [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)]
    .map(([, href, title, snippet]) => {
      let url = decodeEntities(href);
      try {
        // Result links go through duckduckgo.com/l/?uddg=<real url>.
        const u = new URL(url.startsWith('//') ? 'https:' + url : url);
        url = u.searchParams.get('uddg') || u.href;
      } catch {}
      return { url, title: cleanText(title), snippet: cleanText(snippet), date: '', outlet: hostOf(url) };
    })
    .filter(i => /^https?:/.test(i.url) && i.title);
}

/** @param {{ sites: string[], lang?: string }} opts */
async function search(query, { sites, lang = 'en' }) {
  if (Date.now() < downUntil) return [];
  try {
    await pace();
    const res = await fetchWithTimeout('https://html.duckduckgo.com/html/?kl=' + (REGION[lang] || REGION.en) + '&q=' +
      encodeURIComponent(`${query} ${siteTerms(sites)}`), {}, TIMEOUT_MS);
    return res.ok ? parseDdgHtml(await res.text()) : [];
  } catch {
    downUntil = Date.now() + COOL_DOWN_MS;
    return [];
  }
}

export const duckduckgo = { id: 'duckduckgo', search };
