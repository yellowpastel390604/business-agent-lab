/**
 * Dwell detection: when a post stays mostly on screen for `dwellMs`, its text is traced.
 *
 * Classic script (content scripts cannot import modules); needs overlay.js loaded first (window.__prov).
 * Which elements count as "a post" and how their text is read is decided by a site reader:
 *   - dedicated readers for X and Reddit (several posts per page)
 *   - the generic article reader everywhere else (one article per page)
 * To support a new site, add an entry to SITE_READERS.
 */
(() => {
  if (window.__provContent) return;   // injected twice (e.g. right after turning a site on)
  window.__provContent = true;

  const MIN_TEXT_CHARS = 40;        // shorter posts are not worth a trace
  const SCAN_DEBOUNCE_MS = 500;     // the page changes constantly on X/Reddit; rescan at most this often

  // ---------- site readers ----------

  /**
   * @typedef {{ hosts: RegExp, selector: string, text: (el: Element) => string }} SiteReader
   *   hosts: where it applies; selector: one post; text: the post's text
   */
  /** @type {SiteReader[]} */
  const SITE_READERS = [
    {
      hosts: /(^|\.)(x|twitter)\.com$/,
      selector: 'article[data-testid="tweet"]',
      text: el => [...el.querySelectorAll('[data-testid="tweetText"]')].map(n => n.innerText).join('\n')
    },
    {
      hosts: /(^|\.)reddit\.com$/,
      selector: 'shreddit-post',
      text: el => [
        el.getAttribute('post-title'),
        el.querySelector('[slot="text-body"]')?.innerText,
        el.getAttribute('content-href')
      ].filter(Boolean).join('\n')
    }
  ];

  // Generic article reader: a page counts as an article when it has a headline and at least
  // ARTICLE_MIN_PARAGRAPHS real paragraphs. The text is the headline plus the first paragraphs.
  const ARTICLE_MIN_PARAGRAPHS = 3;
  const ARTICLE_PARAGRAPHS_READ = 5;
  const ARTICLE_MAX_CHARS = 1800;
  /** The most specific container that looks like the article wins. */
  const ARTICLE_ROOTS = ['article', '[itemprop="articleBody"]', 'main', '[role="main"]', 'body'];

  const headlineOf = root =>
    (root.querySelector('h1') || document.querySelector('h1'))?.innerText?.trim() ||
    document.querySelector('meta[property="og:title"]')?.content?.trim() || '';

  /** The article text of `root`, or '' when it does not look like an article. */
  function articleText(root) {
    const paragraphs = [...root.querySelectorAll('p')].map(p => p.innerText.trim()).filter(p => p.length >= MIN_TEXT_CHARS);
    const headline = headlineOf(root);
    if (!headline || paragraphs.length < ARTICLE_MIN_PARAGRAPHS) return '';
    return [headline, ...paragraphs.slice(0, ARTICLE_PARAGRAPHS_READ)].join('\n').slice(0, ARTICLE_MAX_CHARS);
  }

  function findArticleRoot() {
    for (const sel of ARTICLE_ROOTS) {
      for (const el of document.querySelectorAll(sel)) if (articleText(el)) return el;
    }
    return null;
  }

  const siteReader = SITE_READERS.find(r => r.hosts.test(location.hostname));
  const generic = !siteReader;

  // ---------- settings ----------

  let settings = { enabled: true, dwellMs: 3000 };   // same as DEFAULTS in src/shared/config.js
  async function loadSettings() {
    try {
      settings = { ...settings, ...(await chrome.storage.local.get(['enabled', 'dwellMs'])) };
    } catch {
      // The extension was reloaded or updated; this orphaned script keeps its last settings.
    }
  }
  loadSettings();
  chrome.storage.onChanged.addListener(loadSettings);

  // ---------- dwell timers ----------

  const observed = new WeakSet();   // elements being watched
  const traced = new WeakSet();     // elements already traced
  const timers = new Map();         // element → dwell timeout
  const readers = new Map();        // element → function returning its text
  let busy = false;                 // one trace at a time per page
  let articleTracedFor = '';        // generic reader: URL already traced (single-page apps change URL, not page)

  function disarm(el) {
    clearTimeout(timers.get(el));
    timers.delete(el);
  }

  function arm(el) {
    if (!settings.enabled || traced.has(el) || timers.has(el)) return;
    if (generic && articleTracedFor === location.href) return;
    timers.set(el, setTimeout(() => fire(el), settings.dwellMs));
  }

  async function fire(el) {
    timers.delete(el);
    if (busy || traced.has(el)) return;
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return arm(el);   // user is elsewhere: wait again
    const text = readers.get(el)(el).trim();
    if (text.length < MIN_TEXT_CHARS) return;
    traced.add(el);
    if (generic) articleTracedFor = location.href;
    busy = true;
    try {
      await window.__prov.trace(text);
    } catch {
      window.__prov.render('error');
    } finally {
      busy = false;
    }
  }

  // "Dwelling" = at least half the post is visible, or it fills at least half the screen.
  const visibility = new IntersectionObserver(entries => {
    for (const e of entries) {
      const mostlyVisible = e.isIntersecting &&
        (e.intersectionRatio >= 0.5 || e.intersectionRect.height >= innerHeight * 0.5);
      if (mostlyVisible) arm(e.target); else disarm(e.target);
    }
  }, { threshold: [0, 0.25, 0.5, 0.75, 1] });

  function watch(el, read) {
    if (observed.has(el)) return;
    observed.add(el);
    readers.set(el, read);
    visibility.observe(el);
  }

  function scan() {
    if (siteReader) {
      for (const el of document.querySelectorAll(siteReader.selector)) watch(el, siteReader.text);
    } else {
      const root = findArticleRoot();
      if (root) watch(root, articleText);
    }
  }

  // Feeds and single-page apps add posts as you scroll: rescan after changes.
  let scanTimer;
  new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, SCAN_DEBOUNCE_MS);
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
