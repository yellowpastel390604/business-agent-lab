/**
 * Names shared by the extension's contexts (service worker, content scripts, side panel, popup).
 * Keeping them in one place means a rename cannot silently break one side of a conversation.
 *
 * Content scripts are classic scripts and cannot import modules, so src/content/overlay.js repeats
 * TRACE_PORT and OPEN_PANEL; keep those in sync with this file.
 */

/** Long-lived port a page opens for one trace (an open port keeps the service worker alive). */
export const TRACE_PORT = 'prov-trace';

/** One-off message from the page asking the service worker to open the side panel. */
export const OPEN_PANEL = 'prov:open-panel';

/** Context-menu item id ("trace this claim" on selected text). */
export const MENU_TRACE = 'prov-trace';

/** Scripts injected into pages, in order (the overlay defines window.__prov, which content.js uses). */
export const PAGE_SCRIPTS = ['src/content/overlay.js', 'src/content/content.js'];

/** chrome.storage.session key holding the live trace state of one tab. */
export const tabStateKey = tabId => `state:${tabId}`;

/** chrome.storage.session key for a site the user is enabling while Chrome shows the permission dialog. */
export const PENDING_SITE = 'pendingSite';

/** Id of the dynamically registered content script for an opted-in site. */
export const siteScriptId = host => `site-${host}`;

/**
 * Trace progress steps, in order. The side panel shows them as a stepper.
 * @typedef {'read' | 'find' | 'check'} Step
 */
export const STEPS = ['read', 'find', 'check'];
