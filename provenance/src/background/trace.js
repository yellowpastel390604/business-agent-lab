/**
 * Runs a trace requested by a page. The page opens a port (TRACE_PORT) and sends { text }; this
 * module answers { ok, claims } or { ok: false, error } and writes progress/results to the tab state.
 * The open port also keeps the service worker alive during the (slow) model calls and page fetches.
 */
import { runPipeline } from '../core/pipeline.js';
import { ko } from '../shared/i18n.js';
import { TRACE_PORT } from '../shared/messages.js';
import { getSettings, postId, cacheGet, cachePut, addHistory } from './store.js';
import { setTabState } from './tab-state.js';

const SNIPPET_CHARS = 160;

/** Cached result if this post was traced recently, else a new trace (cached on success). */
async function traceOrCached(text, pageUrl, onStep) {
  const settings = await getSettings();
  if (!settings.apiKey) throw new Error(ko.err.noKey);
  const id = await postId(text);
  const cached = await cacheGet(id);
  if (cached) return { id, data: { ...cached, cached: true } };

  const data = await runPipeline(text, settings, onStep, { pageUrl });
  if (data.allFailed) throw data.firstError;     // e.g. bad key or rate limit: show it, don't cache it
  delete data.firstError;
  await cachePut(id, data);
  return { id, data };
}

/** The page may be gone (or the port closed) by the time the answer is ready. */
const reply = (port, msg) => { try { port.postMessage(msg); } catch { /* port closed */ } };

async function handleTrace(port, text) {
  const tabId = port.sender?.tab?.id;
  const base = { snippet: text.replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS), pageUrl: port.sender?.url || '' };
  try {
    await setTabState(tabId, { ...base, status: 'tracing', step: 'read' });
    const { id, data } = await traceOrCached(text, base.pageUrl, step => setTabState(tabId, { ...base, status: 'tracing', step }));
    const { stats, ...result } = data;            // usage stats are for the dev harness, not the UI
    await setTabState(tabId, { ...base, status: 'done', data: result });
    await addHistory({ id, t: Date.now(), ...base, data: result });
    reply(port, { ok: true, claims: data.claims.length });
  } catch (e) {
    await setTabState(tabId, { ...base, status: 'error', error: e.message }).catch(() => {});
    reply(port, { ok: false, error: e.message });
  }
}

export function listenForTraces() {
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== TRACE_PORT) return;
    port.onMessage.addListener(msg => handleTrace(port, String(msg.text || '')));
  });
}
