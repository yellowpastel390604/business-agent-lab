/**
 * User settings and their defaults.
 *
 * Everything in DEFAULTS is stored in chrome.storage.local and editable from the options page or the
 * toolbar popup. `chrome.storage.local.get(DEFAULTS)` returns the saved values with these as fallbacks.
 * Fixed internal limits (timeouts, batch sizes, cache sizes) live next to the code that uses them.
 */

/** @typedef {'extract' | 'crawl' | 'confirm' | 'translate'} Stage  One model per pipeline stage. */

export const DEFAULTS = {
  // ---- behaviour
  enabled: true,           // automatic tracing when the reader dwells on a post
  dwellMs: 3000,           // how long a post must stay on screen before it is traced
  maxClaims: 2,            // claims extracted (and traced) per post
  outputLang: 'ko',        // language of summaries: 'ko' | 'en' | 'auto' (same as the post)
  openSearch: true,        // last resort: search outlets that are on none of the lists (labelled as such)
  sites: [],               // extra sites (hostnames) where the user turned on automatic tracing

  // ---- models (free OpenRouter models; ids end in ":free")
  provider: 'openrouter',
  apiKey: '',
  models: {
    extract: 'google/gemma-4-31b-it:free',     // finds the claims in the post
    crawl: 'google/gemma-4-31b-it:free',       // writes search queries, compares perspectives
    confirm: 'google/gemma-4-31b-it:free',     // reads the source pages and gives the verdict
    translate: 'google/gemma-4-31b-it:free'    // writes the Korean text (Google's models are the cleanest in Korean)
  },
  // Tried in order when a stage's model is busy, missing or answers nothing
  // (free models share upstream rate limits and come and go).
  fallbackModels: [
    'google/gemma-4-26b-a4b-it:free',
    'nvidia/nemotron-3.5-super-vl:free'
  ],

  // ---- sources
  // Bumped whenever the default lists below change; the background migrates saved lists once.
  domainsVersion: 4,
  // Primary sources, in groups of 8 (one search request covers one group).
  trustedDomains: [
    // general news
    'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'npr.org', 'pbs.org', 'theguardian.com', 'aljazeera.com',
    // science, health, institutions
    'nasa.gov', 'nature.com', 'science.org', 'who.int', 'cdc.gov', 'nih.gov', 'europa.eu', 'un.org',
    // games and tech (official sites + press)
    'footballmanager.com', 'sega.com', 'store.steampowered.com', 'eurogamer.net',
    'pcgamer.com', 'gamesindustry.biz', 'videogameschronicle.com', 'theverge.com',
    // sport, business, world
    'espn.com', 'skysports.com', 'bloomberg.com', 'ft.com', 'dw.com', 'france24.com', 'cnbc.com', 'apple.com'
  ],
  // Searched first when the post is in Korean.
  koreanDomains: [
    'yna.co.kr', 'chosun.com', 'hani.co.kr', 'joongang.co.kr', 'donga.com', 'khan.co.kr',
    'kbs.co.kr', 'sbs.co.kr', 'imbc.com', 'ytn.co.kr', 'mk.co.kr', 'hankyung.com',
    'newsis.com', 'news1.kr', 'hankookilbo.com', 'segye.com', 'munhwa.com', 'kmib.co.kr',
    'ohmynews.com', 'mt.co.kr', 'edaily.co.kr', 'etnews.com', 'fnnews.com', 'naver.com'
  ],
  // Extra outlets, used to show how others covered the same story.
  perspectiveDomains: [
    'cnn.com', 'foxnews.com', 'nytimes.com', 'washingtonpost.com',
    'economist.com', 'scmp.com', 'wsj.com', 'ign.com',
    'gamespot.com', 'rockpapershotgun.com', 'arstechnica.com', 'wired.com'
  ]
};

/** Free model variants OpenRouter has retired; saved settings that still name them are migrated. */
export const RETIRED_MODELS = ['minimax/minimax-m3.1-flash:free'];

/** Chrome match patterns that cover each domain and all of its subdomains. */
export const originsFor = domains => domains.map(d => `https://*.${d}/*`);
