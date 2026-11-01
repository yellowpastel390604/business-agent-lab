# Provenance

A Chrome extension that restores the provenance of short-form content. When a reader lingers on a short post, such as a tweet, a Reddit thread or a news snippet, Provenance pulls out the factual claims in it and traces each claim back to the original reporting by a trustworthy outlet. It then gives a short, neutral summary of what that source actually says and a verdict on whether the post represents it faithfully. It also shows how other outlets framed the same story.

Provenance runs entirely inside the browser. It has no server, uses free AI models and free search engines, and the user's API key never leaves their own machine except to call the model provider. The user interface is in Korean, and the extension handles both Korean and English posts.

---

## Table of contents

1. [The problem](#1-the-problem)
2. [What it does](#2-what-it-does)
3. [Installation](#3-installation)
4. [Using the extension](#4-using-the-extension)
5. [How it works: the big picture](#5-how-it-works-the-big-picture)
6. [The tracing pipeline, step by step](#6-the-tracing-pipeline-step-by-step)
7. [Project structure](#7-project-structure)
8. [Module reference](#8-module-reference)
9. [Data model](#9-data-model)
10. [Configuration](#10-configuration)
11. [Design decisions](#11-design-decisions)
12. [Security and privacy](#12-security-and-privacy)
13. [Extending the project](#13-extending-the-project)
14. [Development and testing](#14-development-and-testing)
15. [Packaging](#15-packaging)
16. [Limitations](#16-limitations)
17. [Troubleshooting](#17-troubleshooting)
18. [Future work](#18-future-work)
19. [Glossary](#19-glossary)

---

## 1. The problem

Short-form content travels far from its source. A claim is reported by a news agency, summarized by a newspaper, screenshotted, paraphrased in a tweet and reposted on Reddit. With every hop, details are lost: a number changes, a "may" becomes a "will", or the context that made the claim true disappears. Readers rarely trace a claim back themselves, because doing so means searching several outlets, opening articles and comparing them line by line.

Provenance does this tracing automatically, while the reader is looking at the post, and presents the result in a side panel next to the page.

## 2. What it does

| Feature | Description |
|---|---|
| **Dwell tracing** | When a post stays mostly on screen for a set time (3 seconds by default), it is traced automatically. Works out of the box on X (Twitter) and Reddit. |
| **Any site, opt-in** | On any other site (for example a Korean newspaper) the user can turn automatic tracing on from the toolbar popup. Article pages are then traced the same way. |
| **Right-click tracing** | Select any text on any page, right-click and choose **이 주장 추적하기** ("trace this claim"). |
| **Claim extraction** | Pulls out at most 1–3 checkable factual claims and skips opinions and jokes. |
| **Source tracing** | Searches trusted outlets (Reuters, AP, BBC, Yonhap, KBS and so on), picks the most likely original report, reads it and compares it with the claim. |
| **Verdicts** | Each claim is rated **원문과 일치** (matches the source), **왜곡됨** (distorted), **출처 없음** (no source found) or **판단 불가** (cannot tell). |
| **Verified quotes** | A quote is shown only if code confirms that it really appears on the source page. |
| **Other perspectives** | 2–3 differently framed headlines on the same story from other outlets. |
| **Side panel** | Results appear in Chrome's native side panel, with a step-by-step progress view while a trace is running. |
| **Status pill and badge** | A small notice on the page and a badge on the toolbar icon (… running, ✓ done, ! problem). |
| **History and copy** | The last 50 traces are kept in a history view, and any result can be copied as plain text. |
| **Model choice** | The user picks a free model for each of the four pipeline stages from the toolbar popup. |
| **Korean and English** | Korean posts are searched in Korean outlets and in international outlets (in English). Summaries are written in clean Korean. |

## 3. Installation

**Requirements:** Chrome 123 or newer, and a free [OpenRouter](https://openrouter.ai) account and API key.

1. Download or clone this folder.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `provenance` folder (the one containing `manifest.json`).
4. The options page opens automatically on first install. Paste your OpenRouter API key, then click **저장** (save).
5. Chrome asks for permission to read the listed news sites. Allow it, because without it articles cannot be opened and verdicts are based on search snippets only.
6. Pin the extension (puzzle icon → pin) so you can see its toolbar badge.

## 4. Using the extension

### Automatic tracing (dwell)

Open x.com or reddit.com and scroll normally. When a post stays at least half visible for the dwell time, a pill reading **원출처 추적 중…** ("tracing the origin…") appears in the bottom-right corner. When the trace finishes, the pill turns green. Click it to open the side panel.

### Other sites

Open the site, for example `chosun.com`, click the toolbar icon, then click **켜기** ("turn on") next to the site name. Chrome asks once for access to that site. From then on, article pages on that site are traced automatically. Opted-in sites are listed on the options page, where each can be turned off again.

### Right-click

Select text anywhere → right-click → **이 주장 추적하기**. The side panel opens immediately and shows the progress.

### Reading a result

The side panel shows:

- **A summary banner:** how many claims matched, were distorted or could not be confirmed.
- **원출처 (original source):** one card per claim, with its verdict, the outlet and date, a verified quote, a neutral summary of what the source says and a link to the article. Sources from outlets that are not on the user's lists carry a **목록 밖 출처** ("outside your lists") tag.
- **다른 시각 (other perspectives):** how other outlets framed the story.
- **요약 복사:** copies the whole result as plain text.

The **기록** ("history") tab lists past traces. A trace of the same text within a week is served from the cache instantly.

## 5. How it works: the big picture

A Chrome extension is made of several separate programs, called *contexts*, that run in different places and talk to each other through messages and shared storage.

```
 ┌──────────────────────────── web page (x.com, reddit.com, opted-in site) ───────────────────────────┐
 │  content.js   watches posts; when the reader dwells on one, reads its text                          │
 │  overlay.js   the status pill; opens a port to the service worker and sends { text }                │
 └───────────────────────────────┬────────────────────────────────────────────────────────────────────┘
                                 │  port "prov-trace"  (keeps the service worker alive)
                                 ▼
 ┌──────────────────────────── service worker (src/background) ───────────────────────────────────────┐
 │  trace.js  → cache hit? → else run the pipeline (src/core) → write tab state, history, cache        │
 │  tab-state.js → chrome.storage.session  "state:<tabId>"  + toolbar badge                            │
 └───────────────┬───────────────────────────────────────────────────────┬────────────────────────────┘
                 │ fetch                                                  │ chrome.storage
                 ▼                                                        ▼
   OpenRouter (free models)   Bing News · Naver News ·         side panel (src/ui/panel)
   extract · crawl ·          DuckDuckGo · article pages        re-renders on every storage change
   confirm · translate                                          popup / options (src/ui/popup, options)
```

The key ideas:

- **The page scripts only detect and display.** They never call a model or a search engine.
- **The service worker coordinates.** It receives the text, checks the cache, runs the pipeline and stores the progress and result.
- **The pipeline (`src/core`) is plain JavaScript that depends only on `fetch`.** It has no Chrome APIs, so exactly the same code runs in the extension and in Node.js for testing (`dev/run.mjs`).
- **The side panel reads from storage.** It does not talk to the pipeline directly: whenever the tab state in `chrome.storage.session` changes, it re-renders. This keeps the panel simple, and it survives being closed and reopened mid-trace.

## 6. The tracing pipeline, step by step

Entry point: `runPipeline(text, settings, onStep)` in `src/core/pipeline.js`. The side panel shows the three progress steps: **글 읽기** (read), **원출처 찾기** (find) and **확인·요약** (check).

### Step 1: Read (extract the claims)
*Model stage `extract` · `src/core/claims.js`*

1. Code detects the post's language. It counts as Korean when more than a fifth of its letters are Hangul (`detectLang` in `text.js`).
2. The model returns a short topic, the same topic as an English search phrase, and up to `maxClaims` self-contained claims, all as JSON.
3. Every claim is checked with `isCleanText` (`langcheck.js`). If the model slipped into another language (free models sometimes insert Chinese words into Korean text), the step is repeated once on a different model.

### Step 2: Find (search for the original report)
*Model stage `crawl` for the queries; everything else is code · `claims.js`, `discovery.js`, `ranking.js`*

1. **Queries.** The model writes two short search queries in the claim's language. For a Korean claim it also writes one English query, because international stories are reported in English by Reuters, BBC and others, and Korean queries never reach them.
2. **Widening search.** `findCandidates` searches step by step and stops as soon as a strong match appears, because fewer requests mean less throttling by the search engines:
   1. **Listed outlets, likeliest first.** English claims start with general news and science outlets, then the rest of the list, then the perspective outlets. Korean claims start with Korean outlets in Korean, then international outlets in English. The English step is *required*, because Korean results about a foreign event are usually recent follow-ups, not the original.
   2. **Open search** over every outlet (Bing News, plus Naver News for Korean). Results from outlets on none of the lists are labelled *external*.
   3. **Month by month (Korean only).** News search lists recent stories first, so an event from last year never surfaces. Naver is therefore searched one calendar month at a time, going back up to 18 months. When a match turns up, one more month back is checked for the original report.
   4. **Backoff.** If nothing relevant was found at all, the query is cut to its first 3 words, then 2, and searched again.
3. **Ranking.** `rankCandidates` scores every result by keyword overlap with the claim and queries. Korean words are reduced to stems, because particles like 은/는/이/가 attach to words. A headline that lacks one of the claim's numbers ("4차" against "5차", "2.5%") loses points and cannot count as a strong match, because it is about a different event. Three candidates are kept, chosen to mix the evidence: the strongest match, the *earliest* report (closest to the origin), the *latest* report (the earliest alone tends to be a preview written before the event) and the best undated page (official pages carry no date).
4. **Reading.** Each candidate page is fetched and its article text extracted (`reader.js`). If a Korean publisher blocks automated requests, Naver's copy of the article is read instead.

### Step 3: Check (judge, verify, translate)
*Model stages `confirm` and `translate` · `verify.js`, `perspectives.js`, `localize.js`*

1. **Confirm.** The model reads the candidates and returns which one is the original report, a verdict, a verbatim quote and a neutral two-to-three-sentence English summary.
2. **Code checks the answer:**
   - the chosen candidate must exist (a made-up number means "no source");
   - the quote must really appear in the fetched page text, otherwise it is dropped;
   - an unreadable page can never produce **match**, which is downgraded to **판단 불가** (cannot tell).
3. **Perspectives.** This runs in parallel with the claim traces. Headlines on the topic are gathered from other outlets, one per outlet, and the model picks 2–3 that are framed differently. Picks that point at no real headline are dropped.
4. **Translate.** All English summaries go to the model in a single batch for translation into Korean. Each translated sentence must pass `isCleanText`. Failures are retried on another model, and if they still fail they are kept in clean English rather than shown with mixed languages.

A typical two-claim trace makes about 6–10 model calls and 10–40 search requests. The search requests are free and need no key.

## 7. Project structure

```
provenance/
├── manifest.json              Chrome extension manifest (MV3): permissions, entry points
├── assets/icons/              toolbar and store icons (16, 48, 128 px)
├── src/
│   ├── shared/                used by every context
│   │   ├── config.js          user settings and their defaults (DEFAULTS), retired models
│   │   ├── messages.js        names shared across contexts: port, message types, storage keys, steps
│   │   └── i18n.js            all user-visible text (Korean), plus the English result notes
│   ├── core/                  the tracing pipeline: browser-independent, also runs in Node
│   │   ├── pipeline.js        orchestration: read → find → check
│   │   ├── claims.js          claim extraction and query writing
│   │   ├── discovery.js       the widening search (plan, open search, month walk, backoff)
│   │   ├── ranking.js         scores results against a claim, picks the candidates
│   │   ├── reader.js          fetches a page, decodes its charset, extracts the article
│   │   ├── verify.js          reads candidates, asks the confirm model, checks its answer
│   │   ├── perspectives.js    other outlets' framing of the story
│   │   ├── localize.js        batched translation into Korean, language check
│   │   ├── prompts.js         every instruction sent to a model
│   │   ├── outlets.js         which outlet lists apply to a post
│   │   ├── text.js            tokens, overlap, language detection, quote matching
│   │   ├── langcheck.js       isCleanText: catches mixed-language model output
│   │   ├── llm/
│   │   │   ├── client.js      chat(): model chain, fallback, usage stats, JSON parsing
│   │   │   ├── openrouter.js  the OpenRouter provider
│   │   │   └── errors.js      LlmError
│   │   └── search/
│   │       ├── index.js       searchListed / searchOpen over the providers
│   │       ├── bing.js        Bing News RSS provider
│   │       ├── naver.js       Naver News provider (with date windows)
│   │       ├── duckduckgo.js  DuckDuckGo web provider (official pages)
│   │       └── http.js        pacing, timeouts, HTML/URL helpers, SearchResult type
│   ├── background/            the service worker
│   │   ├── index.js           entry point: wires Chrome events to the modules below
│   │   ├── trace.js           handles trace requests from pages
│   │   ├── store.js           settings, result cache, history
│   │   ├── tab-state.js       live per-tab state and the toolbar badge
│   │   ├── sites.js           per-site opt-in (dynamic content scripts)
│   │   └── migrate.js         settings migrations on update
│   ├── content/               scripts that run inside web pages (classic scripts)
│   │   ├── content.js         dwell detection and site readers
│   │   └── overlay.js         the on-page status pill
│   └── ui/                    extension pages
│       ├── panel/             side panel (result, history)
│       ├── popup/             toolbar popup (switches, models, quota, site opt-in)
│       ├── options/           settings page
│       └── shared/            DOM helpers, OpenRouter account check, free-model list
├── dev/                       developer tools (not shipped)
│   ├── selftest.mjs           offline tests with simulated model and search responses
│   ├── run.mjs                real end-to-end run from the command line
│   └── env.mjs                reads the API key from provenance/.env
└── test/index.html            a test page with sample posts for right-click tracing
```

The dependency direction is strict: `ui` and `background` depend on `core` and `shared`; `core` depends only on `shared`; nothing depends on `ui` or `background`. Inside `core`, `pipeline.js` is the only module that knows the overall order. Each other module does one job and can be tested alone.

## 8. Module reference

### shared

| Module | Purpose | Main exports |
|---|---|---|
| `config.js` | Every user setting with its default; the single source of truth for defaults. | `DEFAULTS`, `RETIRED_MODELS`, `originsFor(domains)` |
| `messages.js` | Names two contexts must agree on. | `TRACE_PORT`, `OPEN_PANEL`, `MENU_TRACE`, `PAGE_SCRIPTS`, `STEPS`, `tabStateKey()`, `siteScriptId()`, `PENDING_SITE` |
| `i18n.js` | User-visible strings. | `ko` |

### core

| Module | Purpose | Main exports |
|---|---|---|
| `pipeline.js` | Runs the three steps and assembles the result. | `runPipeline(text, settings, onStep)` |
| `claims.js` | Model steps before searching. | `extractClaims()`, `writeQueries()` |
| `discovery.js` | Finds candidate articles for a claim. | `findCandidates()`, `searchPlan()`, `searchBackoff()` |
| `ranking.js` | Scores and selects candidates. | `rankCandidates()`, `strongScore()`, `CANDIDATES_PER_CLAIM` |
| `reader.js` | Reads one article page. | `fetchPage(url, domains, {any})`, `extractArticle(html)` |
| `verify.js` | Confirms a source and checks the model's answer. | `readCandidates()`, `confirm()`, `VERDICTS` |
| `perspectives.js` | Other outlets' coverage. | `findPerspectives()` |
| `localize.js` | Output language. | `localize()` |
| `prompts.js` | Model instructions. | one function per prompt |
| `outlets.js` | Outlet lists per language. | `trustedFor()`, `knownFor()`, `perspectivesFor()`, `englishTiers()`, `outputLangFor()` |
| `text.js` | Matching without a model. | `detectLang()`, `keyTokens()`, `overlapScore()`, `numberTokens()`, `quoteInText()` |
| `langcheck.js` | Output language gate. | `isCleanText(text, lang)` |
| `llm/client.js` | Model access with fallback. | `chat()`, `parseJson()`, `newStats()`, `LlmError` |
| `search/index.js` | The two search modes. | `searchListed()`, `searchOpen()` |
| `search/http.js` | Shared plumbing. | `tuning`, `pace`, `makePacer()`, `fetchWithTimeout()`, `inDomains()`, `hostOf()` |

### background

| Module | Purpose |
|---|---|
| `index.js` | Registers every Chrome event listener and hands each event to a module. Also installs the read-permission check (`tuning.canRead`) and the context menu. |
| `trace.js` | Listens on the trace port; uses the cache, runs the pipeline, writes state, history and cache, and answers the page. |
| `store.js` | `getSettings()`, a 7-day result cache keyed by the SHA-256 of the post text (max 200 entries), and history (max 50). |
| `tab-state.js` | `setTabState()` writes the live state and updates the badge. It ignores tabs that closed mid-trace. |
| `sites.js` | Completes a site opt-in after Chrome grants access, and re-registers saved sites on update. |
| `migrate.js` | Upgrades outlet lists saved by older versions and replaces retired models. |

### content and ui

| Module | Purpose |
|---|---|
| `content/content.js` | Finds posts with a site reader, watches them with an `IntersectionObserver`, and traces one after `dwellMs` of visibility. |
| `content/overlay.js` | The pill (shadow DOM + popover API). `window.__prov.trace(text)` runs a trace over the port. |
| `ui/panel/panel.js` | Renders the empty, tracing, result, error and history views from storage. |
| `ui/popup/popup.js` | Auto-trace switch, site opt-in, model per stage (live free-model list), quota bar, access prompts. |
| `ui/options/options.js` | Key check, switches, dwell time, number of claims, output language, outlet lists, opted-in sites. |

## 9. Data model

**Search result** (from any provider, `search/http.js`):
```js
{ url, title, snippet, date /* YYYY-MM-DD or '' */, outlet /* hostname */, mirror? /* Naver copy */, external? }
```

**Claim result** (`verify.js`):
```js
{ claim, verdict /* match | distorted | not_found | unclear */, outlet, title, url, date,
  quote /* verified on the page, or '' */, summary, external /* outlet on no list */,
  pages: [{ url, readable, status, error }] /* every page that was read, for transparency */ }
```

**Trace result** (`pipeline.js`):
```js
{ topic, lang, claims: ClaimResult[], perspectives: [{ outlet, url, angle, summary }],
  stats /* model calls, tokens, models used (dev only) */, note? /* when there was nothing to check */ }
```

**Storage keys**

| Area | Key | Content |
|---|---|---|
| `local` | settings (see `DEFAULTS`) | user settings |
| `local` | `cache:<sha256>` | `{ t, data }` trace result, kept 7 days |
| `local` | `history` | last 50 `{ id, t, snippet, pageUrl, data }` |
| `local` | `freeModelsCache` | free model list, kept 1 hour |
| `session` | `state:<tabId>` | `{ status, step, snippet, data / error }` for the side panel |
| `session` | `pendingSite` | a site opt-in waiting for Chrome's permission dialog |

## 10. Configuration

All settings live in `src/shared/config.js` (`DEFAULTS`) and can be changed by the user.

| Setting | Default | Where | Meaning |
|---|---|---|---|
| `enabled` | `true` | popup, options | automatic tracing on dwell |
| `dwellMs` | `3000` | options (1–10 s) | how long a post must stay on screen |
| `maxClaims` | `2` | options (1/2/3) | claims traced per post |
| `outputLang` | `'ko'` | options | summary language: Korean, English, or same as the post |
| `openSearch` | `true` | options | also search outlets that are on no list (labelled) |
| `apiKey` | `''` | options | the user's OpenRouter key |
| `models.extract/crawl/confirm/translate` | `google/gemma-4-31b-it:free` | popup | model per stage |
| `fallbackModels` | Gemma 4 26B, Nemotron 3.5 | — | tried when a model is busy |
| `trustedDomains` | 32 outlets | options | primary sources |
| `koreanDomains` | 24 outlets | options | searched first for Korean posts |
| `perspectiveDomains` | 12 outlets | options | used for other perspectives |
| `sites` | `[]` | popup, options | extra sites with automatic tracing |

Internal limits (timeouts, batch sizes, cache sizes, number of candidates) are named constants at the top of the module that uses them, for example `CANDIDATES_PER_CLAIM` in `ranking.js` and `MONTHS_BACK` in `discovery.js`.

## 11. Design decisions

**No backend.** Everything runs in the user's browser with the user's own key. There is no server to host, pay for or secure, and no third party sees what the user reads.

**Free models only.** The four stages use free OpenRouter models. Free models are slower, often busy (shared rate limits of 20 requests per minute and 50 per day) and come and go, so the client keeps a *chain* of models per stage. A busy or missing model is skipped, the chain is tried twice, and a retired model is dropped for the rest of the session.

**Code searches, models judge.** The models never browse. All searching, fetching and parsing is done by deterministic code, and the models only receive the fetched text and answer questions about it. This makes the system cheaper and testable, and more importantly it means every link and quote in a result can be checked: a model cannot invent a source, because it can only choose among pages the code actually fetched.

**Untrusted input is fenced.** Text from posts and web pages is wrapped in tags and declared untrusted in every prompt, so a page cannot instruct the model (prompt injection).

**Analyse in English, translate once.** Free models write noticeably worse and mix in other languages when they reason directly in Korean. The analysis is therefore written in English, and all Korean text comes from one batched translation call that is checked sentence by sentence.

**Mixed evidence instead of "earliest wins".** Choosing only the earliest article favoured previews ("the launch is set for…") over reports that the event happened. The ranking now mixes the strongest, earliest and latest matches, and the confirm prompt treats pre-event articles as inconclusive, not as disproof.

**Numbers identify events.** Recurring events (the 4th and 5th launch of the same rocket, successive rate decisions) share almost all their words. Requiring the claim's numbers in the headline separates them cheaply.

**Paced, tiered searching.** Bing and Naver silently return empty pages when hit with bursts. Requests are therefore spaced out (250 ms in general, 1.5 s for Naver), at most two run at once, and the search stops at the first strong match.

**Free, key-less search.** Bing News RSS, Naver News and DuckDuckGo HTML need no API key or payment. The cost is that their HTML can change, so each parser is isolated in its own provider module.

**The side panel reads storage.** The panel never receives results by message. It re-renders from `chrome.storage.session`, so it can be opened, closed or reopened at any moment during a trace.

**Permissions on demand.** The extension asks for broad access only when it needs it: listed outlets on saving settings, one site when the user opts it in, and all sites only if the user wants external sources to be readable.

## 12. Security and privacy

- **The API key** is stored only in `chrome.storage.local` on the user's machine and is sent only to `openrouter.ai`. For development it lives in `provenance/.env`, which is git-ignored and must never be shipped.
- **What leaves the browser:** the post text and fetched article text go to OpenRouter (the model provider), and search queries go to Bing, Naver and DuckDuckGo. Nothing is sent anywhere else, and nothing is stored outside the browser.
- **Permissions:**
  - `storage`, `contextMenus`, `sidePanel`: basic features.
  - `scripting` + `activeTab`: inject the pill on right-click, and on opted-in sites.
  - Host access to OpenRouter and the three search engines: the core features.
  - **Optional** host access (`https://*/*`): requested per site or per outlet list, only when the user agrees. Before fetching an article, the service worker checks `chrome.permissions.contains`.
- **Prompt injection:** web text is fenced as untrusted data in every prompt, models cannot browse, and their output is validated by code (indices, quotes, verdict values).
- **Rendering:** the UI builds DOM nodes with `textContent` (never `innerHTML` for data), and links are shown only for `http(s)` URLs with `rel="noopener noreferrer"`.
- **Page isolation:** the pill lives in a shadow DOM, so the host page's styles and scripts cannot reach into it.

## 13. Extending the project

**Add a search engine.** Create `src/core/search/<name>.js` exporting `{ id, search(query, { sites, lang, when }) }` that returns `SearchResult[]` (and `[]` on failure; see `bing.js`). Add it to `LISTED_NEWS`, `LISTED_WEB` or `OPEN` in `search/index.js`, and add its host to `host_permissions` in `manifest.json`.

**Add a model provider.** Create `src/core/llm/<name>.js` exporting `{ complete({ apiKey, model, system, user, onAttempt }) }` that returns `{ text, usage }` and throws `LlmError` with an HTTP-like status (see `openrouter.js`). Register it in `PROVIDERS` in `llm/client.js` and select it with the `provider` setting.

**Support a new site for dwell tracing.** Add an entry to `SITE_READERS` in `src/content/content.js`: a hostname pattern, a CSS selector matching one post, and a function returning the post's text. Add the site to `content_scripts.matches` in the manifest if it should work without opt-in.

**Add an output language.** Add its strings to `i18n.js`, a translation prompt in `prompts.js`, and a branch in `localize.js`. `isCleanText` already accepts a language code.

**Change a prompt.** Every model instruction is in `prompts.js`. Keep the "Return ONLY JSON" line and the field names, which the calling module reads.

**Add a setting.** Add it with its default to `DEFAULTS` in `config.js`, add a control in `ui/options`, and read it from `settings` where it is needed. If an old saved value must change, add a step to `background/migrate.js`.

## 14. Development and testing

The pipeline needs only `fetch`, so it can be tested with Node.js 18 or newer, without Chrome.

```sh
# Offline self-test: simulated OpenRouter, Bing, Naver and article pages. No network, no key.
node dev/selftest.mjs

# Real end-to-end run (real models, real searches, real pages).
# Put OPENROUTER_API_KEY=... in provenance/.env first.
node dev/run.mjs --text "누리호 4차 발사가 성공했다."
node dev/run.mjs --file post.txt --claims 1
node dev/run.mjs --reddit https://www.reddit.com/r/.../comments/...
node dev/run.mjs --text "..." --confirm google/gemma-4-26b-a4b-it:free     # override a stage's model
```

The self-test covers:
- RSS, Naver and DuckDuckGo parsing; article extraction; EUC-KR decoding.
- Korean stemming and language detection.
- Ranking; batched site searches; open search and its labelling; the read-permission hook.
- The Korean-claim/foreign-event regression (the English step must run).
- Query backoff.
- The full pipeline: verdicts, quote verification, unreadable pages, hallucinated indices.
- The language-leak handling (retry on another model, English fallback).

Tests of the extension pages and the service worker start-up can be run in a DOM emulator such as jsdom, with a small stub of the `chrome` API. In Chrome itself, open `test/index.html` and use right-click tracing on its sample posts.

To debug the extension in Chrome: `chrome://extensions` → Provenance → **service worker** (opens the console of the background), or right-click inside the side panel → **Inspect**.

## 15. Packaging

To publish on the Chrome Web Store, zip the folder **without** the files that are for development only:

```sh
zip -r provenance.zip manifest.json assets src
```

Never include `.env` (the API key), `dev/`, `test/` or this README.

## 16. Limitations

- **Free model capacity.** Free models allow about 50 requests a day and are often busy, so a trace can take one to two minutes and fails when the quota is exhausted. (Buying a small amount of OpenRouter credit raises the limit to 1,000 a day.)
- **Blocked publishers.** Some outlets (for example Reuters and AP) refuse automated page requests. They can still be found and shown, but because their text cannot be read, they cannot be rated **match**.
- **Search coverage.** Bing News covers about the last month. Older events are found through Naver's month-by-month search (Korean) or the outlets' own pages; older English-only stories may be missed.
- **Scraped HTML.** Naver and DuckDuckGo results are parsed from HTML that can change without notice; a change breaks that provider until its parser is updated.
- **AI judgement.** The verdict and the summary are written by a model. Quotes and links are verified, but the reader should still open the source for anything important.
- **Images and video.** Only text is traced. Claims inside images, screenshots or videos are not read. Instagram is not supported.

## 17. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| "OpenRouter API 키가 없어요" | No key saved: toolbar icon → settings → paste the key → save. |
| "무료 모델 사용 한도에 도달했어요" | The daily free quota is used up; it resets at midnight UTC. The options page shows today's usage. |
| "무료 모델이 모두 혼잡하거나 사용할 수 없어요" | All free models are busy; try again in a minute, or pick other models in the popup. |
| Results are always "판단 불가" with "기사를 열 수 없어" | Chrome access to the news sites was not granted. Click **사이트 접근 허용** in the popup. |
| Nothing happens on a news site | The site is not opted in. Toolbar icon → **켜기**. Also check that the page is an article (headline plus several paragraphs). |
| The pill shows an error right after an update | Pages opened before the update still run the old scripts. Reload the page. |
| The same old result keeps appearing | Results are cached for 7 days per post text. Delete the entry from **기록** (history) to trace it again. |

## 18. Future work

- Read claims from images (OCR) and video captions.
- Prefer the English edition of an international article when one exists.
- Show "how this was checked" (queries, outlets searched, pages read) for full transparency.
- A small optional backend for shared caching, so the same viral post is traced once for everyone.
- More site readers (Threads, Bluesky, YouTube descriptions) and more output languages.

## 19. Glossary

| Term | Meaning |
|---|---|
| **Provenance** | The origin of a piece of information, and the chain by which it reached you. |
| **Claim** | A single checkable factual statement, for example "the 4th Nuri launch succeeded". |
| **Dwell** | Keeping a post mostly visible on screen for a set time. |
| **Candidate** | A search result chosen as a possible original source for a claim. |
| **Verdict** | The outcome per claim: match, distorted, not found, or cannot tell. |
| **External outlet** | A source that is on none of the user's outlet lists; labelled in the result. |
| **Mirror** | Naver's own copy of a Korean news article, read when the publisher blocks requests. |
| **MV3 (Manifest V3)** | The current Chrome extension platform: a service worker instead of a background page, stricter permissions. |
| **Service worker** | The extension's background program. It starts on demand and stops when idle. |
| **Content script** | A script the extension runs inside a web page. |
| **Side panel** | Chrome's built-in panel beside the page, used here for results. |
| **OpenRouter** | A service that gives one API to many AI models, including free ones. |
| **Fallback chain** | The ordered list of models tried when the chosen one cannot answer. |
| **Prompt injection** | Text in a web page that tries to give instructions to an AI model. |
| **Stem** | The part of a Korean word without its particle (삼성전자 in 삼성전자가). |
