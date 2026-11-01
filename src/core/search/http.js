/**
 * Small HTTP and HTML helpers shared by the search providers and the page reader.
 */

/** Runtime knobs. Dev scripts shorten the delays; the extension plugs in a permission check. */
export const tuning = {
  paceMs: 250,          // minimum gap between any two search requests
  naverPaceMs: 1500,    // Naver throttles harder: minimum gap between two Naver requests
  retryMs: 4000,        // pause before retrying a search that came back completely empty
  /** @type {null | ((url: string) => Promise<boolean>)} may this page be read? (null = always) */
  canRead: null
};

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * A pacer spaces out calls: each `await pacer()` resolves at least `gapMs()` after the previous one.
 * Search engines answer bursts with empty (but 200 OK) pages, so every search request is paced.
 */
export function makePacer(gapMs) {
  let nextAt = 0;
  return async () => {
    const startAt = Math.max(Date.now(), nextAt);
    nextAt = startAt + gapMs();
    if (startAt > Date.now()) await sleep(startAt - Date.now());
  };
}

/** Shared by all search providers. */
export const pace = makePacer(() => tuning.paceMs);

export async function fetchWithTimeout(url, opts = {}, ms = 15_000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Runs async tasks with at most `limit` in flight, keeping result order. */
export async function pool(tasks, limit) {
  const out = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  }));
  return out;
}

export const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// ---------- HTML ----------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Strips tags, decodes entities, collapses whitespace. */
export const cleanText = html => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// ---------- URLs ----------

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** True when the URL's host is one of `domains` or a subdomain of one. */
export function inDomains(url, domains) {
  const h = hostOf(url);
  return !!h && domains.some(d => h === d || h.endsWith('.' + d));
}

/**
 * The same article's address however it was linked: no scheme, www/m/mobile prefix, query, hash or
 * trailing slash. Used to recognise the page the reader is on among the search results.
 */
export function canonicalUrl(url) {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^(www|m|mobile|nwww)\./, '') + u.pathname).replace(/\/+$/, '').toLowerCase();
  } catch { return ''; }
}

/**
 * The publication date many outlets put in their article URLs (/2026/09/09/, AKR20260820…, 202610171002…),
 * as YYYY-MM-DD, or '' when there is none. Search results often come without a date; this fills the gap.
 */
export function dateFromUrl(url, now = new Date()) {
  const m = String(url).match(/(?<!\d)(20\d\d)([/-]?)(0[1-9]|1[0-2])\2(0[1-9]|[12]\d|3[01])/);
  if (!m) return '';
  const date = `${m[1]}-${m[3]}-${m[4]}`;
  return date <= now.toISOString().slice(0, 10) ? date : '';
}

const dedupeBy = key => {
  const seen = new Set();
  return item => !seen.has(key(item)) && seen.add(key(item));
};
/** Filter callback that keeps the first result per URL. */
export const firstPerUrl = () => dedupeBy(i => i.url);

/**
 * A search result, as every provider returns it.
 * @typedef {{ url: string, title: string, snippet: string, date: string, outlet: string,
 *   mirror?: string, external?: boolean }} SearchResult
 *   `date` is YYYY-MM-DD or ''; `mirror` is a readable copy (Naver); `external` = outlet on none of the lists.
 */
