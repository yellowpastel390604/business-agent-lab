# Provenance

A Chrome extension that traces a short post back to the news report it came from, and tells you whether the post still says what the source said.

Technical documentation: [docs/TECHNICAL.md](docs/TECHNICAL.md).

## Purpose and intended user

A claim changes every time it is reposted: numbers drift and conditions disappear. Checking the source by hand means searching several sites and comparing articles, so almost nobody does it.

Provenance is for **everyday readers of Korean and English social media and news**. When you stay on a post for about three seconds (or select text and choose **이 주장 추적하기**), it:

1. extracts the post's factual claims,
2. searches trusted outlets for the original report and reads it,
3. answers **원문과 일치** (match), **왜곡됨** (distorted), **출처 없음** (no source) or **판단 불가** (cannot tell), with a quote that code has checked against the page and a short Korean summary,
4. shows how other outlets framed the story.

It runs entirely in the browser: no server, free AI models through OpenRouter, free search engines (Bing News, Naver News, DuckDuckGo). The interface is Korean.

## How to run it

Requirements: Chrome 123+, and a free [OpenRouter](https://openrouter.ai) API key.

1. Download the repository (**Code → Download ZIP**) or clone it, and unzip it. The extension is in the `provenance` folder.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select the `provenance` folder.
3. On the options page that opens, paste your OpenRouter key and click **저장**. Allow access to the listed news sites when Chrome asks.
4. Open x.com or reddit.com and stay on a post, or select any text on any page → right-click → **이 주장 추적하기**. Results appear in the side panel.

**Why there is no install link:** Chrome blocks extensions installed from outside the Chrome Web Store (a `.crx` file from a link is rejected on Windows and macOS). Provenance is not on the Web Store, so it is installed as an unpacked extension, as above. There is no deployed URL.

Developer checks (Node 18+):

```bash
node dev/selftest.mjs                     # offline: simulated models, search and pages; no key needed
node dev/run.mjs --text "누리호 4차 발사가 성공했다."   # live run; needs OPENROUTER_API_KEY in .env (git-ignored)
```

## Work process

I built the project with Claude Code over several sessions. A fixed rule in my instructions made the agent restate each task, propose a plan, wait for approval, execute, and report the result. Main steps:

1. **MVP:** dwell detection on X and Reddit, the three-step pipeline (read → find → check), side panel.
2. **Design decision: code searches, models judge.** Code runs every search and fetches every page; the model only chooses among pages actually read, and code checks that its quote appears on the page. A model cannot invent a source.
3. **Korean support:** Naver search, a month-by-month search for older events, reading `<div>`-based Korean article pages, and a language gate that catches Chinese characters free models leak into Korean.
4. **Debugging wrong verdicts** (below), each time by diagnosing with logged runs before changing code.
5. **Refactor for readability:** split into `core` (browser-independent pipeline), `background`, `content`, `ui`, with registries for search providers and site readers.

## Claude Code evidence and verification

**Excerpt 1 — diagnosis before fixing.** A distorted headline ("집에서 처방 받고 약은 택배로 배달…12월 시행") was rated *match* against the very reprint being read. The agent first logged the search results:

```
  3 - ---------- yna.co.kr | 정부, 모든 비대면진료 환자 대상 '약 배송' 논의 착수
* 8 E ---------- newsis.com | 집에서 처방 받고 약은 택배로 배달…12월 시행
```
The original report *was* found, but every Korean result was undated (so it could never win the "earliest report" slot) and it scored below the relevance floor. The cause was ranking, not search.

**Excerpt 2 — before and after the fixes** (same headline):

| | Before | After |
|---|---|---|
| Verdict | 원문과 일치 | **왜곡됨** |
| Source | fnnews.com (the page being read) | newsis.com, the article fnnews reprinted |
| Summary | English | Korean |

Fixes: the current page is never its own source; copies of one headline count once; dates are read from article URLs; code (not only the prompt) downgrades *match* when the claim drops conditions the source attaches; a rejected model is retried last instead of never.

**Excerpt 3 — offline self-test** (simulated OpenRouter, Bing, Naver and pages; covers parsing, ranking, fallbacks, quote checking, unreadable pages, language leaks and each fix above):

```
leak handling OK
selftest OK
```

**Representative live cases**

| Case | Result |
|---|---|
| "누리호 4차 발사가 성공했다." | 원문과 일치 — SBS, 2025-11-27, verified quote about 13 satellites (before: 출처 없음, because search only covered the 5th launch) |
| "NASA's Artemis II crew flew around the Moon in April 2026" | match — nasa.gov (before: no source, only pre-launch previews were ranked) |
| "출생아 26개월 연속 증가" (traced in Chrome on a KBC article) | 원문과 일치 — verified quote |
| **Failure:** "오픈AI가 기업 가치를 낮췄다" | **왜곡됨, wrongly**: the claim is true; the model listed mere details as "conditions". Fixed: the downgrade now also needs a "misleading" flag (tested offline only) |

## Three effective practices

1. **A gated workflow in the agent's instructions.** An approved plan before any change stopped the agent from "fixing" the wrong thing and let me redirect early.
2. **Diagnose with logged runs first.** Every wrong verdict was traced to its real cause before code changed: retired model, previews ranked first, undated Korean results. Fixes stayed general.
3. **A fast offline self-test plus strict secret handling.** The pipeline uses only `fetch`, so the same code runs in Node against simulated services in seconds, without spending quota. The API key never appears in chat or Git; it lives only in a git-ignored `.env`.

## Three difficulties

1. **Free model limits.** A model was retired mid-project, models are often busy, and the free tier allows 50 requests a day (a trace uses 6–18). *Response:* a fallback chain of models with retries. *Remaining:* traces take 1–2 minutes, and when the quota runs out summaries fall back to English.
2. **Korean news search.** Bing and Naver list only about the last month, Naver blocks fast requests, and Korean sites hide articles in `<div>`s. *Response:* month-by-month Naver search, 1.5-second pacing, `<div>` article extraction. *Remaining:* results vary with the model's search words.
3. **Judging "the original" and "distorted".** Reprints looked like the origin, and the model said *match* despite its own summary. *Response:* the fixes in Excerpt 2. *Remaining:* the government announcement behind the demo case is not reached reliably, and the narrower condition rule (after the OpenAI failure) still needs live re-testing.

## Known limitations

- The verdict is an AI judgement. Links and quotes are verified by code; the reader should still check.
- Reuters and AP block automated reading, so they can be shown as sources but never rated *match*.
- Text only: no images, video or screenshots (no OCR). Instagram is not supported.
- Not published on the Chrome Web Store; loaded unpacked.

## Key source files for grading

1. [`src/core/pipeline.js`](src/core/pipeline.js) — the pipeline: read → find → check → translate.
2. [`src/core/discovery.js`](src/core/discovery.js) — tiered search that widens until a strong match appears.
3. [`src/core/ranking.js`](src/core/ranking.js) — scoring and choosing candidates (strongest, earliest, latest; headline-copy merging).
4. [`src/core/verify.js`](src/core/verify.js) — the model's verdict, checked in code (quote on page, unreadable pages, dropped conditions).
5. [`src/background/trace.js`](src/background/trace.js) — the Chrome side: cache, running a trace, tab state and history.
