/**
 * Reads one article page: fetch (with permission and domain checks), decode, extract the article text.
 * Plain fetch + regex extraction: no model, no browser DOM (so it also runs in Node for the dev scripts).
 */
import { tuning, fetchWithTimeout, cleanText, decodeEntities, inDomains } from './search/http.js';

const MIN_ARTICLE_CHARS = 400;    // less than this is a cookie wall, a teaser or an error page
const MAX_ARTICLE_CHARS = 12_000;
const MIN_PARAGRAPH_CHARS = 40;

/** Page chrome that never holds the article. */
const NON_CONTENT = /<(script|style|noscript|svg|nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi;
/** Containers many (especially Korean) sites put the article in when they don't use <p> paragraphs. */
const ARTICLE_BOX = /<(div|article)\b[^>]*(?:id|class|itemprop)="[^"]*(?:dic_area|articleBody|article_body|article-body|text_area|news_content|newsct_article|article_txt|art_txt)[^"]*"[^>]*>([\s\S]{0,20000})/i;
/** Where the article box usually ends: copyright line, reporter box, related news, comments. */
const BOX_TRAILER = /<[^>]+(?:class|id)="[^"]*(?:copyright|byline|reporter|relate|recommend|comment)/i;
const PUBLISHED = /(?:article:published_time|og:article:published_time|datePublished)["']?\s*(?:content=|:)\s*["']([^"']+)/i;
const DESCRIPTION = /<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']+)/i;

/** Korean sites still serve EUC-KR now and then: honor the declared charset instead of assuming UTF-8. */
async function decodeBody(res) {
  const buf = await res.arrayBuffer();
  const fromHeader = (res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1];
  const fromMeta = new TextDecoder('latin1').decode(buf.slice(0, 4096)).match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  for (const charset of [fromHeader, fromMeta, 'utf-8']) {
    if (!charset) continue;
    try { return new TextDecoder(charset).decode(buf); } catch { /* unknown charset: try the next */ }
  }
  return '';
}

/**
 * Title, publication date and main text of an article page.
 * Tries, in order: <p> paragraphs, a known article container, the meta description, the whole body.
 * @returns {{ title: string, date: string, text: string }}
 */
export function extractArticle(html) {
  const title = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const date = html.match(PUBLISHED)?.[1].slice(0, 10) || '';
  const body = html.replace(NON_CONTENT, ' ');

  let text = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => cleanText(m[1]))
    .filter(p => p.length > MIN_PARAGRAPH_CHARS)
    .join('\n');
  if (text.length < MIN_ARTICLE_CHARS) {
    const box = body.match(ARTICLE_BOX);
    const boxed = box ? cleanText(box[2].split(BOX_TRAILER)[0]) : '';
    if (boxed.length > text.length) text = boxed;
  }
  if (text.length < MIN_ARTICLE_CHARS) {
    const description = html.match(DESCRIPTION)?.[1];
    text = text || (description ? decodeEntities(description) : '') || cleanText(body);
  }
  return { title, date, text: text.slice(0, MAX_ARTICLE_CHARS) };
}

/**
 * @typedef {{ ok: boolean, status: number, error: string, title?: string, date?: string, text?: string }} Page
 *   ok = a readable article came back; otherwise `error` says why (shown in the result's page list).
 */

/**
 * Fetches and extracts one page.
 * @param {string} url
 * @param {string[]} domains  only these domains may be read...
 * @param {{ any?: boolean }} [opts]  ...unless `any` (results of open search, labelled as external)
 * @returns {Promise<Page>}
 */
export async function fetchPage(url, domains, { any = false } = {}) {
  if (!any && !inDomains(url, domains)) return { ok: false, status: 0, error: 'domain not allowed' };
  if (tuning.canRead && !(await tuning.canRead(url))) return { ok: false, status: 0, error: 'no access to this site' };
  try {
    const res = await fetchWithTimeout(url, { headers: { accept: 'text/html' } });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    if (!/html|xml/i.test(res.headers.get('content-type') || '')) {
      return { ok: false, status: res.status, error: 'not an HTML page' };
    }
    const page = extractArticle(await decodeBody(res));
    const ok = page.text.length > MIN_ARTICLE_CHARS;
    return { ok, status: res.status, ...page, error: ok ? '' : 'page had no readable article text' };
  } catch (e) {
    return { ok: false, status: 0, error: e.name === 'AbortError' ? 'timed out' : e.message };
  }
}
