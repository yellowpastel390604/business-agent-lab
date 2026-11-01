/**
 * Automatic tracing on sites beyond X and Reddit. The user opts a site in from the toolbar popup; Chrome
 * asks for access to it; once granted, the page scripts are registered for that site.
 *
 * The popup cannot finish the job itself: Chrome's permission dialog may close the popup. So the popup
 * stores the site as PENDING_SITE and requests the permission, and this module completes the opt-in
 * when chrome.permissions.onAdded fires.
 */
import { PAGE_SCRIPTS, PENDING_SITE, siteScriptId } from '../shared/messages.js';

/** @typedef {{ host: string, origin: string, tabId: number }} Site */

const registration = (host, origin) => ({
  id: siteScriptId(host), matches: [origin], js: PAGE_SCRIPTS, runAt: 'document_idle', persistAcrossSessions: true
});

/** Registers the page scripts for a newly allowed site, runs them in its open tab, and saves the site. */
async function enableSite({ host, origin, tabId }) {
  await chrome.scripting.registerContentScripts([registration(host, origin)]).catch(() => {});   // already registered
  await chrome.scripting.executeScript({ target: { tabId }, files: PAGE_SCRIPTS }).catch(() => {});
  const { sites } = await chrome.storage.local.get({ sites: [] });
  if (!sites.includes(host)) await chrome.storage.local.set({ sites: [...sites, host] });
}

/**
 * Re-registers the scripts of every saved site. Registrations are dropped or point at stale file paths
 * after an extension update, so each one is replaced.
 */
export async function restoreSites() {
  const { sites } = await chrome.storage.local.get({ sites: [] });
  for (const host of sites) {
    const id = siteScriptId(host);
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
      await chrome.scripting.registerContentScripts([registration(host, `https://${host}/*`)]);
    } catch (e) {
      console.warn('Provenance: could not restore', host, e.message);
    }
  }
}

export function listenForSiteGrants() {
  chrome.permissions.onAdded.addListener(async perms => {
    const { [PENDING_SITE]: pending } = await chrome.storage.session.get(PENDING_SITE);
    if (pending && perms.origins?.includes(pending.origin)) {
      await enableSite(pending);
      await chrome.storage.session.remove(PENDING_SITE);
    }
  });
}
