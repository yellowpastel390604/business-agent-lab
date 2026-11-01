/**
 * Live trace state per tab (chrome.storage.session), shown by the side panel and the toolbar badge.
 */
import { tabStateKey } from '../shared/messages.js';

/** @typedef {'tracing' | 'done' | 'error'} Status */
const BADGES = {
  tracing: { text: '…', color: '#8e8e93' },
  done: { text: '✓', color: '#34c759' },
  error: { text: '!', color: '#ff3b30' }
};

/**
 * The tab can be closed, navigated or replaced while a trace runs; badge calls then throw
 * "No tab with id", which must never break (or leave unhandled) the trace itself.
 */
const ignoreGoneTab = promise => promise.catch(() => {});

/**
 * @param {number | undefined} tabId
 * @param {{ status: Status, step?: string, snippet?: string, pageUrl?: string, data?: object, error?: string }} state
 */
export async function setTabState(tabId, state) {
  if (tabId == null) return;
  await chrome.storage.session.set({ [tabStateKey(tabId)]: { ...state, t: Date.now() } });
  const badge = BADGES[state.status];
  if (badge) {
    await ignoreGoneTab(chrome.action.setBadgeText({ tabId, text: badge.text }));
    await ignoreGoneTab(chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color }));
  }
}

export const clearTabState = tabId => chrome.storage.session.remove(tabStateKey(tabId)).catch(() => {});
