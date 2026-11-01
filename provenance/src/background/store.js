/**
 * Persistent state in chrome.storage.local: settings, the result cache and the trace history.
 */
import { DEFAULTS } from '../shared/config.js';

const CACHE_PREFIX = 'cache:';
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;   // a week: the same post is traced once
const MAX_CACHE_ENTRIES = 200;
const MAX_HISTORY = 50;

/** Saved settings, with DEFAULTS for anything never saved. */
export const getSettings = () => chrome.storage.local.get(DEFAULTS);

/** Cache key for a post: SHA-256 of its normalized text. */
export async function postId(text) {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function cacheGet(id) {
  const key = CACHE_PREFIX + id;
  const entry = (await chrome.storage.local.get(key))[key];
  return entry && Date.now() - entry.t < CACHE_TTL_MS ? entry.data : null;
}

/** Stores a result, then drops expired entries and everything past the newest MAX_CACHE_ENTRIES. */
export async function cachePut(id, data) {
  await chrome.storage.local.set({ [CACHE_PREFIX + id]: { t: Date.now(), data } });
  const entries = Object.entries(await chrome.storage.local.get(null))
    .filter(([k]) => k.startsWith(CACHE_PREFIX))
    .sort((a, b) => b[1].t - a[1].t);
  const stale = entries
    .filter(([, v], i) => i >= MAX_CACHE_ENTRIES || Date.now() - v.t >= CACHE_TTL_MS)
    .map(([k]) => k);
  if (stale.length) await chrome.storage.local.remove(stale);
}

/**
 * Adds a trace to the history shown in the side panel (newest first, one entry per post).
 * @param {{ id: string, t: number, snippet: string, pageUrl: string, data: object }} entry
 */
export async function addHistory(entry) {
  const { history = [] } = await chrome.storage.local.get('history');
  const next = [entry, ...history.filter(h => h.id !== entry.id)].slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ history: next });
}
