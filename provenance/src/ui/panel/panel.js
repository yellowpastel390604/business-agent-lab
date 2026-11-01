/**
 * Side panel: the live trace of the active tab (결과 = result) and past traces (기록 = history).
 * Reads everything from storage (tab state from the service worker, history), so it simply re-renders
 * whenever storage or the active tab changes.
 */
import { ko } from '../../shared/i18n.js';
import { STEPS, tabStateKey } from '../../shared/messages.js';
import { $, el } from '../shared/dom.js';

// A tab closing or being replaced mid-call is normal; Chrome reports it as "No tab with id".
// It is harmless here, so it must not show up as an unhandled error.
window.addEventListener('unhandledrejection', e => {
  if (/No tab with id/.test(e.reason?.message || '')) e.preventDefault();
});

const GLYPH = { match: '✓', distorted: '!', not_found: '–', unclear: '?' };

let view = 'result';          // 'result' | 'history'
let pinned = null;            // a history entry opened from the 기록 tab, or null for the live trace

function link(url, label, cls) {
  let ok = false;
  try { ok = /^https?:$/.test(new URL(url).protocol); } catch {}
  if (!ok) return document.createTextNode(label);
  return el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', textContent: label, class: cls || '' });
}

// A colored letter badge for an outlet (stable color per site, no network request).
function mono(outlet) {
  const name = (outlet || '?').replace(/^www\./, '');
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const m = el('span', { class: 'mono', textContent: name[0].toUpperCase() });
  m.style.setProperty('--h', h);
  return m;
}

const stagger = nodes => nodes.filter(Boolean).map((n, i) => { n.style.setProperty('--i', i); return n; });

const hero = (glyph, title, text, cls = '') =>
  el('div', { class: 'hero ' + cls }, el('div', { class: 'glyph', textContent: glyph }),
    el('strong', { textContent: title }), text);

// ---------- result ----------

/** Plain-text summary for the clipboard (요약 복사). */
export function summaryText(data) {
  const out = [`Provenance — ${data.topic || '추적 결과'}`, ''];
  for (const c of data.claims) {
    out.push(`• ${c.claim} — ${ko.verdict[c.verdict] || ko.verdict.unclear}${c.external ? ' (목록 밖 출처)' : ''}`);
    if (c.url) out.push(`  출처: ${[c.outlet, c.date].filter(Boolean).join(', ')} — ${c.url}`);
    if (c.quote) out.push(`  “${c.quote}”`);
    if (c.summary) out.push(`  ${c.summary}`);
    out.push('');
  }
  if (data.perspectives?.length) {
    out.push('다른 시각:');
    for (const p of data.perspectives) out.push(`• ${p.outlet}${p.angle ? ' — ' + p.angle : ''}: ${p.url}`);
  }
  return out.join('\n').trim();
}

function claimCard(c) {
  const src = [c.date, c.title].filter(Boolean).join(' · ');
  return el('section', { class: 'card claim-card ' + c.verdict },
    el('div', { class: 'chips' },
      el('span', { class: 'chip ' + c.verdict, textContent: `${GLYPH[c.verdict] || '?'}  ${ko.verdict[c.verdict] || ko.verdict.unclear}` }),
      c.external ? el('span', { class: 'tag warn', textContent: '목록 밖 출처', title: '내 출처 목록에 없는 매체예요. 링크를 직접 확인해 보세요.' }) : null),
    el('p', { class: 'claim', textContent: c.claim }),
    c.url ? el('div', { class: 'src' }, mono(c.outlet),
      el('div', { class: 't' }, el('b', { textContent: c.outlet.replace(/^www\./, '') }), el('span', { class: 'meta', textContent: src }))) : null,
    c.quote ? el('blockquote', { textContent: c.quote }) : null,
    el('p', { textContent: c.summary }),
    c.url ? link(c.url, '원문 보기 ↗', 'open-link') : null);
}

function perspectiveCard(p) {
  return el('section', { class: 'card persp' },
    el('div', { class: 'top' }, mono(p.outlet),
      el('b', { textContent: p.outlet.replace(/^www\./, '') }),
      p.angle ? el('span', { class: 'tag', textContent: p.angle }) : null),
    el('p', { textContent: p.summary }),
    link(p.url, '기사 보기 ↗', 'open-link'));
}

function bannerFor(data) {
  const n = k => data.claims.filter(c => c.verdict === k).length;
  const parts = [`일치 ${n('match')}`, `왜곡 ${n('distorted')}`, `출처 없음·판단 불가 ${n('not_found') + n('unclear')}`];
  return el('div', { class: 'banner' }, el('strong', { textContent: '추적 완료' }),
    el('span', { textContent: `주장 ${data.claims.length}건 · ${parts.join(' · ')}` }));
}

function resultView(data) {
  if (!data.claims.length) {
    return stagger([hero('✓', '확인할 내용이 없어요', data.note || ko.pipeline.noClaims)]);
  }
  const nodes = [bannerFor(data), el('h2', { textContent: '원출처' }), ...data.claims.map(claimCard)];
  if (data.perspectives?.length) {
    nodes.push(el('h2', { textContent: '다른 시각' }), ...data.perspectives.map(perspectiveCard));
  }
  const copy = el('button', { type: 'button', class: 'btn', textContent: '요약 복사' });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(summaryText(data));
      copy.textContent = '복사됨 ✓';
    } catch {
      copy.textContent = '복사하지 못했어요';
    }
    setTimeout(() => { copy.textContent = '요약 복사'; }, 1800);
  });
  nodes.push(el('div', { class: 'actions' }, copy),
    el('p', { class: 'foot', textContent: 'AI가 위 출처를 바탕으로 만든 요약이에요' + (data.cached ? ' (저장된 결과)' : '') + '. 링크로 직접 확인해 보세요.' }));
  return stagger(nodes);
}

function tracingView(state) {
  const current = Math.max(0, STEPS.indexOf(state.step));
  const steps = ko.stepNames.map((name, i) => el('div', { class: 'step ' + (i < current ? 'done' : i === current ? 'active' : '') },
    el('span', { class: 'n', textContent: i < current ? '✓' : String(i + 1) }), name));
  return stagger([
    el('section', { class: 'card' }, el('div', { class: 'stepper' }, ...steps),
      state.snippet ? el('p', { class: 'snippet', textContent: '“' + state.snippet + '”' }) : null),
    el('section', { class: 'card skeleton' }, el('i'), el('i'), el('i')),
    el('section', { class: 'card skeleton' }, el('i'), el('i'), el('i'))
  ]);
}

function liveView(state) {
  if (!state) {
    return stagger([hero('◎', '준비됐어요', '게시글을 몇 초간 보고 있거나, 글을 선택한 뒤 오른쪽 클릭 → “이 주장 추적하기”를 눌러 보세요.')]);
  }
  if (state.status === 'tracing') return tracingView(state);
  if (state.status === 'error') return stagger([hero('!', '추적하지 못했어요', state.error, 'err')]);
  return resultView(state.data);
}

// ---------- history ----------

const ago = t => {
  const s = Math.round((t - Date.now()) / 1000);
  const f = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' });
  if (Math.abs(s) < 3600) return f.format(Math.round(s / 60), 'minute');
  if (Math.abs(s) < 86400) return f.format(Math.round(s / 3600), 'hour');
  return f.format(Math.round(s / 86400), 'day');
};

function historyView(history) {
  if (!history.length) return stagger([hero('🕘', '아직 기록이 없어요', '추적한 내용이 여기에 쌓여요.')]);
  const list = el('div', { class: 'card list' });
  for (const h of history) {
    const open = el('button', { type: 'button', class: 'open' },
      el('span', { class: 'txt' },
        el('span', { class: 'snip', textContent: h.snippet || h.data.topic || '추적 결과' }),
        el('span', { class: 'meta', textContent: ago(h.t) })),
      el('span', { class: 'dots' }, ...h.data.claims.map(c => el('i', { class: c.verdict, title: ko.verdict[c.verdict] }))));
    open.addEventListener('click', () => { pinned = h; setView('result'); });
    const del = el('button', { type: 'button', class: 'del', textContent: '✕', title: '삭제' });
    del.setAttribute('aria-label', '기록에서 삭제');
    del.addEventListener('click', async () => {
      const { history: cur = [] } = await chrome.storage.local.get('history');
      await chrome.storage.local.set({ history: cur.filter(x => x.id !== h.id) });
    });
    list.append(el('div', { class: 'item' }, open, del));
  }
  const clear = el('button', { type: 'button', class: 'btn plain', textContent: '기록 모두 지우기' });
  clear.addEventListener('click', () => chrome.storage.local.set({ history: [] }));
  return stagger([list, el('div', { class: 'actions' }, clear)]);
}

// ---------- wiring ----------

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function setView(v) {
  view = v;
  if (v === 'history') pinned = null;
  $('tab-result').setAttribute('aria-selected', String(v === 'result'));
  $('tab-history').setAttribute('aria-selected', String(v === 'history'));
  refresh();
}

async function refresh() {
  let nodes;
  if (view === 'history') {
    const { history = [] } = await chrome.storage.local.get('history');
    nodes = historyView(history);
  } else if (pinned) {
    const back = el('button', { type: 'button', class: 'back', textContent: '‹ 기록' });
    back.addEventListener('click', () => setView('history'));
    nodes = stagger([back, ...resultView(pinned.data)]);
  } else {
    const tabId = await activeTabId();
    const key = tabStateKey(tabId);
    const state = tabId == null ? null : (await chrome.storage.session.get(key))[key];
    if (state && state.status !== 'tracing') chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}); // tab may be gone
    nodes = liveView(state);
  }
  $('view').replaceChildren(...nodes);
}

$('tab-result').addEventListener('click', () => { pinned = null; setView('result'); });
$('tab-history').addEventListener('click', () => setView('history'));
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
chrome.storage.onChanged.addListener(refresh);
chrome.tabs.onActivated.addListener(refresh);
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete') refresh(); });
refresh();
