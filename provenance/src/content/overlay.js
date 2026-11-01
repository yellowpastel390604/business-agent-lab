/**
 * The on-page status pill: shows that a trace is running and, when it is done, opens the side panel on
 * click. Shadow DOM (page styles can't leak in) + native popover (top layer, no z-index fights).
 *
 * Classic script (content scripts cannot import modules). Exposes window.__prov = { trace, render, hide },
 * used by content.js and by the context-menu handler in the service worker.
 * Injected by the manifest on X/Reddit, by the service worker on opted-in sites and on right-click.
 */
(() => {
  if (window.__prov) return;   // injected twice

  // Keep in sync with src/shared/messages.js.
  const TRACE_PORT = 'prov-trace';
  const OPEN_PANEL = 'prov:open-panel';

  const CSS = `
    :host {
      all: initial;
      color-scheme: light dark;
      --bg: light-dark(rgb(255 255 255 / .82), rgb(44 44 46 / .82));
      --fg: light-dark(#1d1d1f, #f5f5f7);
      --muted: light-dark(#6e6e73, #a1a1a6);
      --line: light-dark(rgb(0 0 0 / .1), rgb(255 255 255 / .14));
      --blue: light-dark(#0071e3, #2997ff);
      --green: light-dark(#248a3d, #30d158);
      --red: light-dark(#d70015, #ff453a);
    }
    .pill {
      inset: auto 20px 20px auto; margin: 0; padding: 0; border: 1px solid var(--line);
      border-radius: 999px; overflow: visible; display: flex; align-items: center;
      background: var(--bg); color: var(--fg);
      -webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px);
      box-shadow: 0 6px 24px rgb(0 0 0 / .18);
      font: 500 13px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Pretendard", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif;
      letter-spacing: -.01em;
    }
    button { all: unset; box-sizing: border-box; cursor: pointer; }
    button:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
    .main { display: flex; align-items: center; gap: 9px; padding: 11px 6px 11px 16px; border-radius: 999px 0 0 999px; }
    .main:hover { background: var(--line); }
    .x { padding: 11px 14px 11px 8px; color: var(--muted); border-radius: 0 999px 999px 0; }
    .x:hover { color: var(--fg); }
    .dot { position: relative; width: 9px; height: 9px; border-radius: 50%; background: var(--blue); box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 22%, transparent); }
    .done .dot { box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 24%, transparent); }
    .error .dot { box-shadow: 0 0 0 3px color-mix(in srgb, var(--red) 24%, transparent); }
    .pill { animation: enter .35s cubic-bezier(.2, .8, .2, 1); }
    @keyframes enter { from { opacity: 0; transform: translateY(10px) scale(.96); } }
    .tracing .dot { animation: pulse 1.4s ease-in-out infinite; }
    .done .dot { background: var(--green); }
    .error .dot { background: var(--red); }
    .go { color: var(--muted); }
    @keyframes pulse { 0%, 100% { opacity: .35; transform: scale(.85); } 50% { opacity: 1; transform: scale(1.15); } }
    @media (prefers-reduced-motion: reduce) { .tracing .dot, .pill { animation: none; } }
  `;
  const LABELS = {
    tracing: '원출처 추적 중…',
    done: '원출처를 찾았어요',
    empty: '확인할 내용이 없어요',
    error: '추적하지 못했어요'
  };

  let host = null, root = null;

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v; else n[k] = v;
    }
    for (const k of kids) if (k != null) n.append(k);
    return n;
  }

  function onKey(e) { if (e.key === 'Escape') hide(); }

  function hide() {
    document.removeEventListener('keydown', onKey, true);
    host?.remove();
    host = null; root = null;
  }

  /** @param {'tracing' | 'done' | 'empty' | 'error'} state */
  function setPill(state) {
    if (!host || !host.isConnected) {
      host = el('div');
      root = host.attachShadow({ mode: 'open' });
      root.append(el('style', { textContent: CSS }));
      document.documentElement.append(host);
      document.addEventListener('keydown', onKey, true);
    }
    root.querySelector('.pill')?.remove();
    const main = el('button', {
      type: 'button',
      class: 'main',
      onclick: () => chrome.runtime.sendMessage({ type: OPEN_PANEL })
    }, el('span', { class: 'dot' }), el('span', { textContent: LABELS[state] }),
       el('span', { class: 'go', textContent: '›' }));
    main.title = 'Provenance 사이드 패널 열기';
    const close = el('button', { type: 'button', class: 'x', textContent: '✕', onclick: hide });
    close.setAttribute('aria-label', '닫기');
    const pill = el('div', { class: 'pill ' + (state === 'empty' ? 'done' : state) }, main, close);
    pill.setAttribute('popover', 'manual');
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');
    root.append(pill);
    pill.showPopover();
  }

  /** Shows a state without running a trace (content.js uses it to report unexpected failures). */
  function render(state) { setPill(state); }

  /**
   * Runs one trace over a port (an open port keeps the service worker alive). The service worker writes
   * progress and results for the side panel; this only drives the pill. Always resolves.
   */
  function trace(text) {
    setPill('tracing');
    return new Promise(resolve => {
      let settled = false;
      const port = chrome.runtime.connect({ name: TRACE_PORT });
      port.onMessage.addListener(msg => {
        settled = true;
        setPill(!msg.ok ? 'error' : msg.claims ? 'done' : 'empty');
        port.disconnect();
        resolve();
      });
      port.onDisconnect.addListener(() => {
        if (!settled) setPill('error');
        resolve();
      });
      port.postMessage({ text });
    });
  }

  window.__prov = { render, hide, trace };
})();
