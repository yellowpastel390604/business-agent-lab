/**
 * Toolbar popup: auto-trace switch, per-site opt-in, model per stage, free quota, access prompts,
 * and shortcuts to the side panel and the options page.
 */
import { DEFAULTS, originsFor } from '../../shared/config.js';
import { PENDING_SITE, siteScriptId } from '../../shared/messages.js';
import { freeModels } from '../shared/free-models.js';
import { checkKey, showQuota } from '../shared/openrouter-account.js';
import { $ } from '../shared/dom.js';

const STAGES = Object.keys(DEFAULTS.models);
const short = id => id.replace(/:free$/, '');
const BUILT_IN = /(^|\.)(x|twitter|reddit)\.com$/;   // sites the manifest already covers

let current = DEFAULTS;   // saved settings, kept so click handlers can call permissions.request synchronously
let site = null;          // { host, origin, tabId } of the active tab when it is a normal web page

const siteOrigins = s => originsFor([...new Set([...s.trustedDomains, ...s.koreanDomains, ...s.perspectiveDomains])]);

function fill(select, list, value) {
  const ids = list.map(m => m.id);
  if (value && !ids.includes(value)) ids.unshift(value); // keep a saved choice even if it left the list
  select.replaceChildren(...ids.map(id => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = short(id);
    return o;
  }));
  select.value = value;
}

async function checkAccess(s) {
  current = s;
  $('access').hidden = await chrome.permissions.contains({ origins: siteOrigins(s) });
  $('all-access').hidden = !s.openSearch || await chrome.permissions.contains({ origins: ['https://*/*'] });
}

// ---- per-site opt-in (needed for automatic tracing outside X and Reddit)

function paintSite() {
  if (!site) { $('site').hidden = true; return; }
  $('site').hidden = false;
  $('site-host').textContent = site.host;
  if (BUILT_IN.test(site.host)) {
    $('site-note').textContent = '기본으로 지원하는 사이트예요';
    $('site-btn').hidden = true;
    return;
  }
  const on = current.sites.includes(site.host);
  $('site-btn').hidden = false;
  $('site-btn').textContent = on ? '켜짐' : '켜기';
  $('site-btn').classList.toggle('on', on);
  $('site-note').textContent = on ? '이 사이트에서 자동으로 추적해요 (눌러서 끄기)' : '이 사이트에서도 자동 추적하기';
}

async function disableSite() {
  await chrome.scripting.unregisterContentScripts({ ids: [siteScriptId(site.host)] }).catch(() => {});
  await chrome.permissions.remove({ origins: [site.origin] }).catch(() => {});
  const sites = current.sites.filter(h => h !== site.host);
  await chrome.storage.local.set({ sites });
  current = { ...current, sites };
}

$('site-btn').addEventListener('click', async () => {
  if (!site) return;
  if (current.sites.includes(site.host)) {
    await disableSite();
    paintSite();
    return;
  }
  // Enabling: the permission request must come first (it needs the click gesture) and Chrome's dialog may
  // close this popup, so the background finishes the job (registers the scripts) when the grant arrives.
  chrome.storage.session.set({ [PENDING_SITE]: site });   // completed by src/background/sites.js
  await chrome.permissions.request({ origins: [site.origin] });
});

chrome.storage.onChanged.addListener(changes => {
  if (changes.sites) { current = { ...current, sites: changes.sites.newValue || [] }; paintSite(); }
});

// ---- free quota

async function loadQuota(key) {
  if (!key) return;
  try {
    const account = await checkKey(key);
    if (account.ok) showQuota(account.quota);
  } catch { /* offline: just don't show the meter */ }
}

async function init() {
  const s = await chrome.storage.local.get(DEFAULTS);
  current = s;
  $('enabled').checked = s.enabled;
  checkAccess(s);
  loadQuota(s.apiKey);
  for (const st of STAGES) fill($('m-' + st), [], s.models[st] || DEFAULTS.models[st]);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const u = new URL(tab?.url);
    if (/^https?:$/.test(u.protocol)) site = { host: u.hostname, origin: `https://${u.hostname}/*`, tabId: tab.id };
  } catch { /* chrome:// pages and the like: no site row */ }
  paintSite();

  try {
    const list = await freeModels();
    for (const st of STAGES) fill($('m-' + st), list, s.models[st] || DEFAULTS.models[st]);
    $('note').textContent = `지금 무료 모델 ${list.length}개를 쓸 수 있어요. 혼잡하면 다음 무료 모델로 자동 전환돼요.`;
  } catch {
    $('note').textContent = '모델 목록을 불러오지 못했어요. 지금 고른 모델은 그대로 쓸 수 있어요.';
  }
}

for (const st of STAGES) {
  $('m-' + st).addEventListener('change', async e => {
    const { models } = await chrome.storage.local.get({ models: DEFAULTS.models });
    await chrome.storage.local.set({ models: { ...DEFAULTS.models, ...models, [st]: e.target.value } });
  });
}
$('enabled').addEventListener('change', e => chrome.storage.local.set({ enabled: e.target.checked }));
$('allow').addEventListener('click', async () => {
  // First call in the click handler: the permission prompt needs the user gesture.
  const granting = chrome.permissions.request({ origins: siteOrigins(current) });
  await granting;
  checkAccess(current);
});
$('allow-all').addEventListener('click', async () => {
  const granting = chrome.permissions.request({ origins: ['https://*/*'] });   // first call: needs the click gesture
  await granting;
  checkAccess(current);
});
$('settings').addEventListener('click', async () => {
  await chrome.runtime.openOptionsPage();
  window.close();
});
$('panel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) await chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  window.close();
});

init();
