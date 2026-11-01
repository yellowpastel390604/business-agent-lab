/**
 * Service worker entry point: wires Chrome events to the modules that handle them.
 *
 *   trace.js      traces requested by pages (port TRACE_PORT)
 *   sites.js      per-site opt-in for automatic tracing
 *   migrate.js    settings migrations on update
 *   tab-state.js  live per-tab state + toolbar badge
 *   store.js      settings, cache, history
 */
import { tuning } from '../core/search/http.js';
import { ko } from '../shared/i18n.js';
import { OPEN_PANEL, MENU_TRACE } from '../shared/messages.js';
import { getSettings } from './store.js';
import { clearTabState } from './tab-state.js';
import { listenForTraces } from './trace.js';
import { listenForSiteGrants, restoreSites } from './sites.js';
import { migrateSettings } from './migrate.js';

// Reading an article needs host access: only pages the user has allowed are fetched.
tuning.canRead = async url => {
  try { return await chrome.permissions.contains({ origins: [new URL(url).origin + '/*'] }); } catch { return false; }
};

// A tab closing mid-call is normal and harmless; Chrome reports it as "No tab with id". Don't surface it.
self.addEventListener('unhandledrejection', e => {
  if (/No tab with id/.test(e.reason?.message || '')) e.preventDefault();
});

listenForTraces();
listenForSiteGrants();

// Side panel requests from the page pill. sidePanel.open needs the user's click gesture, which is lost
// after any await, so it must be the first call.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === OPEN_PANEL && sender.tab?.id != null) {
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch(e => console.error('Provenance:', e.message));
  }
});

// Right-click on selected text → trace it. The menu click grants activeTab, which allows injecting the
// pill on any site.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_TRACE || !tab?.id || !info.selectionText) return;
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});   // first call: uses the click gesture
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/overlay.js'] });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: text => window.__prov.trace(text), args: [info.selectionText]
    });
  } catch (e) {
    console.error('Provenance: could not run on this page:', e.message);
  }
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.contextMenus.create({ id: MENU_TRACE, title: ko.menu, contexts: ['selection'] });
  if (reason === 'update') await migrateSettings();
  await restoreSites();
  if (reason === 'install' && !(await getSettings()).apiKey) await chrome.runtime.openOptionsPage();
});

chrome.tabs.onRemoved.addListener(clearTabState);
