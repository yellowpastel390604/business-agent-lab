/**
 * Options page: API key, behaviour switches, outlet lists, opted-in sites. Saved with one button;
 * saving also asks Chrome for access to every listed outlet (needed to read their articles).
 */
import { DEFAULTS, originsFor } from '../../shared/config.js';
import { siteScriptId } from '../../shared/messages.js';
import { checkKey, showQuota } from '../shared/openrouter-account.js';
import { $ } from '../shared/dom.js';

/** Textarea → list of bare hostnames (scheme and path dropped). */
const lines = s => s.split('\n')
  .map(x => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
/** Outlet lists: [setting name, id of its counter]. The textarea's id is the setting name. */
const LISTS = [
  ['trustedDomains', 'c-trusted'], ['koreanDomains', 'c-korean'], ['perspectiveDomains', 'c-persp']
];

function paintCounts() {
  for (const [id, out] of LISTS) $(out).textContent = `${lines($(id).value).length}곳`;
}

function paintDwell() { $('dwellOut').textContent = `${$('dwellSec').value}초`; }

function paintSites(sites) {
  const ul = $('sites');
  ul.replaceChildren();
  if (!sites.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '아직 추가한 사이트가 없어요';
    ul.append(li);
    return;
  }
  for (const host of sites) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = host;
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '끄기';
    del.addEventListener('click', async () => {
      await chrome.scripting.unregisterContentScripts({ ids: [siteScriptId(host)] }).catch(() => {});
      await chrome.permissions.remove({ origins: [`https://${host}/*`] }).catch(() => {});
      const { sites: cur } = await chrome.storage.local.get({ sites: [] });
      const next = cur.filter(h => h !== host);
      await chrome.storage.local.set({ sites: next });
      paintSites(next);
    });
    li.append(name, del);
    ul.append(li);
  }
}

async function load() {
  const s = await chrome.storage.local.get(DEFAULTS);
  $('enabled').checked = s.enabled;
  $('openSearch').checked = s.openSearch;
  $('apiKey').value = s.apiKey;
  $('dwellSec').value = s.dwellMs / 1000;
  document.querySelector(`input[name=maxClaims][value="${s.maxClaims}"]`).checked = true;
  $('outputLang').value = s.outputLang;
  for (const [id] of LISTS) $(id).value = s[id].join('\n');
  paintDwell();
  paintCounts();
  paintSites(s.sites);
  if (s.apiKey) verifyKey(false);
}

// Asks OpenRouter about the key and shows today's free-request usage.
async function verifyKey(announce = true) {
  const key = $('apiKey').value.trim();
  const status = $('key-status');
  if (!key) { status.textContent = '키를 먼저 입력해 주세요.'; status.className = 'hint bad'; return; }
  if (announce) { status.textContent = '확인하는 중…'; status.className = 'hint'; }
  try {
    const account = await checkKey(key);
    if (!account.ok) throw new Error(account.status === 401 ? '키가 올바르지 않아요.' : `확인하지 못했어요 (HTTP ${account.status})`);
    status.textContent = '키가 올바르게 연결됐어요.';
    status.className = 'hint ok';
    showQuota(account.quota);
  } catch (e) {
    status.textContent = e.message;
    status.className = 'hint bad';
  }
}

let toastTimer;
function toast(text, bad) {
  const st = $('status');
  st.textContent = text;
  st.className = bad ? 'bad' : '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { st.textContent = ''; }, 5000);
}

async function save(event) {
  event.preventDefault();
  const lists = Object.fromEntries(LISTS.map(([id]) => [id, lines($(id).value)]));
  // Must be the first async call in this click handler (it needs the user gesture).
  const granting = chrome.permissions.request({
    origins: originsFor([...new Set(Object.values(lists).flat())])
  });
  try {
    const granted = await granting;
    await chrome.storage.local.set({
      enabled: $('enabled').checked,
      openSearch: $('openSearch').checked,
      apiKey: $('apiKey').value.trim(),
      maxClaims: Number(document.querySelector('input[name=maxClaims]:checked')?.value) || DEFAULTS.maxClaims,
      dwellMs: Math.max(1000, Number($('dwellSec').value) * 1000 || DEFAULTS.dwellMs),
      outputLang: $('outputLang').value,
      ...lists,
      domainsVersion: DEFAULTS.domainsVersion
    });
    toast(granted ? '저장했어요' : '저장했어요. 다만 사이트 접근을 허용하지 않아 기사를 열 수 없고, 검색 결과 요약만으로 판단해요.', !granted);
  } catch (e) {
    toast('저장하지 못했어요: ' + e.message, true);
  }
}

$('form').addEventListener('submit', save);
$('test').addEventListener('click', () => verifyKey());
$('reveal').addEventListener('click', () => {
  const show = $('apiKey').type === 'password';
  $('apiKey').type = show ? 'text' : 'password';
  $('reveal').textContent = show ? '숨기기' : '보기';
});
$('dwellSec').addEventListener('input', paintDwell);
for (const [id] of LISTS) $(id).addEventListener('input', paintCounts);
$('resetDomains').addEventListener('click', () => {
  for (const [id] of LISTS) $(id).value = DEFAULTS[id].join('\n');
  paintCounts();
});
load();
