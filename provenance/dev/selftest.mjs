// Offline self-test: fake OpenRouter / Bing / article pages. No network, no key.
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/shared/config.js';
import { runPipeline } from '../src/core/pipeline.js';
import { tuning, dateFromUrl, canonicalUrl } from '../src/core/search/http.js';
import { parseBingRss } from '../src/core/search/bing.js';
import { parseDdgHtml } from '../src/core/search/duckduckgo.js';
import { parseNaverNews } from '../src/core/search/naver.js';
import { searchListed } from '../src/core/search/index.js';
import { extractArticle, fetchPage } from '../src/core/reader.js';
import { detectLang, keyTokens, overlapScore } from '../src/core/text.js';
import { rankCandidates } from '../src/core/ranking.js';
import { searchBackoff, findCandidates } from '../src/core/discovery.js';
tuning.paceMs = 0; tuning.retryMs = 0; tuning.naverPaceMs = 0;

const article = `<html><head><title>BoE holds rates at 5% - Reuters</title>
<meta property="article:published_time" content="2026-03-20T10:00:00Z"></head><body>
<nav><p>menu menu menu menu menu menu menu menu menu menu menu menu</p></nav>
<p>The Bank of England held its main interest rate at 5% on Thursday, voting 7-2 to keep borrowing costs unchanged.</p>
<p>Governor said inflation remains above target and policymakers would stay cautious about cutting rates too soon.</p>
<p>${'Economists had expected a hold after the previous meeting showed a split committee. '.repeat(6)}</p></body></html>`;

const rss = items => `<?xml version="1.0"?><rss><channel>${items.map(i =>
  `<item><title>${i.t}</title><link>${i.u}</link><description>${i.d}</description><pubDate>${i.p}</pubDate></item>`).join('')}</channel></rss>`;

let calls = [], first429 = true;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const res = (body, status = 200, headers = {}) => new Response(body, { status, headers });
  if (url.includes('openrouter.ai')) {
    const body = JSON.parse(opts.body);
    const sys = body.messages[0].content;
    calls.push(sys.slice(0, 30));
    if (first429 && sys.startsWith('You extract')) { first429 = false; return res('{}', 429, { 'retry-after': '0' }); }
    let content;
    if (sys.startsWith('You extract')) content = '```json\n{"topic":"BoE rate decision","claims":["BoE raised its rate to 6%","Moon is made of cheese"]}\n```';
    else if (sys.startsWith('You write news')) content = body.messages[1].content.includes('cheese')
      ? '{"queries":["moon cheese"]}' : '{"queries":["Bank of England interest rate decision","BoE raised rate 6%"]}';
    else if (sys.startsWith('You are a provenance')) content = '<think>hmm</think>{"best":1,"verdict":"distorted","quote":"held its main interest rate at 5% on Thursday","summary":"The BoE held rates at 5%."}';
    else content = '{"perspectives":[{"n":1,"angle":"mortgages","summary":"s1"},{"n":99,"angle":"ghost","summary":"hallucinated index"}]}';
    return res(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  }
  if (url.includes('bing.com/news')) {
    if (decodeURIComponent(url).includes('moon cheese')) return res(rss([]));
    const wide = decodeURIComponent(url).includes('cnn.com');
    return res(rss(wide
      ? [{ t: 'CNN: BoE rate decision explained', u: 'https://www.cnn.com/business/boe', d: 'Bank of England interest rate decision mortgages', p: 'Thu, 20 Mar 2026 12:00:00 GMT' },
         { t: 'Offsite', u: 'https://evil.example/x', d: 'Bank of England interest rate', p: 'Thu, 20 Mar 2026 12:00:00 GMT' }]
      : [{ t: 'BoE holds rates at 5%', u: 'https://www.reuters.com/markets/boe-holds', d: 'Bank of England interest rate decision held at 5%', p: 'Thu, 20 Mar 2026 10:00:00 GMT' },
         { t: 'Unrelated sports', u: 'https://www.bbc.com/sport/x', d: 'football results', p: 'Fri, 21 Mar 2026 10:00:00 GMT' },
         { t: 'Offsite BoE', u: 'https://evil.example/boe', d: 'Bank of England interest rate decision', p: 'Thu, 20 Mar 2026 09:00:00 GMT' }]));
  }
  if (url.includes('reuters.com/markets')) return res(article, 200, { 'content-type': 'text/html' });
  return res('nope', 404);
};

// unit: RSS + article extraction
const items = parseBingRss(rss([{ t: 'A &amp; B', u: 'https://www.bing.com/news/apiclick.aspx?x=1&amp;url=https%3A%2F%2Fwww.bbc.com%2Fnews%2Fa1', d: 'snip', p: 'Thu, 20 Mar 2026 10:00:00 GMT' }]));
assert.equal(items[0].url, 'https://www.bbc.com/news/a1'); assert.equal(items[0].title, 'A & B'); assert.equal(items[0].date, '2026-03-20');
const art = extractArticle(article);
assert.ok(art.text.includes('held its main interest rate') && !art.text.includes('menu menu')); assert.equal(art.date, '2026-03-20');

// unit: Korean language detection + stem matching (particles like 은/는/이/가 must not break overlap)
assert.equal(detectLang('삼성전자는 오늘 새로운 반도체 공장 건설을 발표했다'), 'ko'); assert.equal(detectLang('Samsung announced a new fab today'), 'en');
assert.equal(detectLang('FM27 출시일은 11월 10일이다'), 'ko');
{
  const want = keyTokens('삼성전자 반도체 공장 건설 발표');
  assert.ok(overlapScore(want, '삼성전자가 평택에 반도체 공장을 짓는다고 발표했다') >= 3, 'particles tolerated');
  assert.equal(overlapScore(want, 'Completely unrelated English headline about football'), 0);
  const ranked = rankCandidates([
    { url: 'https://a/2', title: '삼성전자, 평택 반도체 공장 착공 소식 전해져', snippet: '', date: '2026-05-02', outlet: 'a' },
    { url: 'https://a/1', title: '삼성전자 반도체 공장 건설 발표', snippet: '', date: '2026-05-01', outlet: 'a' },
    { url: 'https://a/3', title: '프로야구 순위', snippet: '', date: '2026-04-01', outlet: 'a' }
  ], '삼성전자가 반도체 공장 건설을 발표했다', ['삼성전자 반도체 공장']);
  assert.deepEqual(ranked.map(r => r.url).sort(), ['https://a/1', 'https://a/2'], 'earliest and latest kept; unrelated dropped');
}
// unit: Naver News result parsing (original publisher URL, headline, snippet, relative date, mirror)
{
  const html = `<a nocr="1" href="https://www.etnews.com/20261022000225" target="_blank"><span class="x">삼성전자 평택 공장 착공 발표</span><span>새 창 열림</span></a>
    <a href="#"><span class="y">삼성전자가 평택에 새로운 반도체 공장을 착공한다고 22일 밝혔다.</span></a> <span>3시간 전</span>
    <a href="https://n.news.naver.com/mnews/article/030/0003477836?sid=105">네이버뉴스</a>
    <button data-url="https://www.etnews.com/20261022000225" aria-label="x"></button>`;
  const [n] = parseNaverNews(html);
  assert.equal(n.url, 'https://www.etnews.com/20261022000225'); assert.equal(n.title, '삼성전자 평택 공장 착공 발표');
  assert.match(n.snippet, /착공한다고/); assert.match(n.mirror, /n\.news\.naver\.com\/mnews\/article\/030\/0003477836/);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(n.date), 'relative date turned into a date');
  assert.equal(parseNaverNews('<p>nothing</p>').length, 0);
}

// unit: open search finds outlets that are on no list, labels them, and respects the read-permission hook
{
  const real = globalThis.fetch;
  globalThis.fetch = async url => {
    const u = decodeURIComponent(String(url));
    if (u.includes('bing.com/news')) {
      return new Response(rss(u.includes('site:') ? [] : [{ t: 'Samsung builds new chip plant in Pyeongtaek', u: 'https://www.unlisted-news.example/a1', d: 'Samsung Pyeongtaek chip plant construction announced', p: 'Thu, 20 Mar 2026 10:00:00 GMT' }]));
    }
    if (u.includes('unlisted-news.example')) return new Response(article, { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response('', { status: 404 });
  };
  const settings = { ...DEFAULTS, apiKey: 'k' };
  const claim = 'Samsung builds a new chip plant in Pyeongtaek';
  const top = await findCandidates(settings, claim, ['Samsung Pyeongtaek chip plant'], 'en');
  assert.equal(top.length, 1); assert.equal(top[0].external, true); assert.equal(top[0].outlet, 'unlisted-news.example');
  const off = await findCandidates({ ...settings, openSearch: false }, claim, ['Samsung Pyeongtaek chip plant'], 'en');
  assert.equal(off.length, 0, 'open search can be switched off');
  tuning.canRead = async () => false;
  assert.match((await fetchPage('https://www.unlisted-news.example/a1', [], { any: true })).error, /no access/);
  tuning.canRead = async () => true;
  assert.equal((await fetchPage('https://www.unlisted-news.example/a1', [], { any: true })).ok, true);
  assert.equal((await fetchPage('https://www.unlisted-news.example/a1', [])).error, 'domain not allowed', 'unlisted domains stay blocked unless open search asks');
  tuning.canRead = null; globalThis.fetch = real;
}

// regression: a Korean claim about a foreign event. Korean outlets only have recent follow-ups; the original
// report is in English on an international outlet. The English step must run even though Korean results look strong.
{
  const real = globalThis.fetch, seen = [];
  globalThis.fetch = async url => {
    const u = decodeURIComponent(String(url)); seen.push(u);
    if (u.includes('bing.com/news') && u.includes('setmkt=ko-KR')) {
      return new Response(rss([{ t: '삼형제동맹 1027작전 이후 미얀마 민간인 사망', u: 'https://www.yna.co.kr/view/AKR1', d: '삼형제동맹 1027작전 미얀마 군부 공습 민간인 사망 보도', p: 'Sun, 18 Oct 2026 09:00:00 GMT' }]));
    }
    if (u.includes('bing.com/news') && u.includes('setmkt=en-US') && u.includes('site:reuters.com')) {
      return new Response(rss([{ t: 'Myanmar army seeks to restore order as rebel alliance launches Operation 1027', u: 'https://www.reuters.com/world/asia-pacific/myanmar-1027', d: 'Operation 1027 Three Brotherhood Alliance Myanmar rebel offensive', p: 'Fri, 27 Oct 2023 10:00:00 GMT' }]));
    }
    return new Response(rss([]));
  };
  const st = { ...DEFAULTS, openSearch: false };
  const top = await findCandidates(st, '삼형제동맹이 1027작전 시작을 선언했다.', ['삼형제동맹 1027작전'], 'ko', 'Operation 1027 Three Brotherhood Alliance Myanmar');
  assert.equal(top[0].outlet, 'reuters.com', 'earliest relevant report (the 2023 original) wins');
  assert.ok(top.some(c => c.outlet === 'yna.co.kr'));
  assert.ok(seen.some(u => u.includes('setmkt=en-US') && u.includes('Operation 1027')), 'English query was sent');
  seen.length = 0;
  const noEn = await findCandidates(st, '삼형제동맹이 1027작전 시작을 선언했다.', ['삼형제동맹 1027작전'], 'ko', '');
  assert.equal(noEn[0].outlet, 'yna.co.kr', 'without an English query only Korean results exist');
  globalThis.fetch = real;
}

// unit: a too-specific query that finds nothing is retried with fewer words
{
  const real = globalThis.fetch, qs = [];
  globalThis.fetch = async url => {
    const q = decodeURIComponent(String(url)).match(/q=([^(&]*)/)[1].trim(); qs.push(q);
    return new Response(rss(q.split(' ').length <= 3 ? [{ t: 'Hit', u: 'https://www.bbc.com/x', d: 'd', p: 'Thu, 20 Mar 2026 10:00:00 GMT' }] : []));
  };
  const hits = await searchBackoff(['one two three four five'], ['bbc.com'], {});
  assert.equal(hits.length, 1); assert.deepEqual(qs.map(q => q.split(' ').length), [5, 3]);
  globalThis.fetch = real;
}
// unit: EUC-KR pages are decoded with their declared charset
{
  const real = globalThis.fetch;
  const bytes = Buffer.concat([Buffer.from('<html><head><meta charset="euc-kr"><title>'), Buffer.from([0xc7, 0xd1, 0xb1, 0xdb]), Buffer.from('</title></head><body>'),
    Buffer.from('<p>' + 'a'.repeat(500) + '</p></body></html>')]);
  globalThis.fetch = async () => new Response(bytes, { status: 200, headers: { 'content-type': 'text/html' } });
  const page = await fetchPage('https://www.chosun.com/x', ['chosun.com']);
  assert.equal(page.title, '한글'); globalThis.fetch = real;
}

// unit: DuckDuckGo parsing
const ddg = parseDdgHtml(`<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.sega.com%2Ffootball-manager%2Ffm27&rut=x">FM27 &amp; SEGA</a>
  <a class="result__snippet" href="#">Out <b>November</b></a>`);
assert.equal(ddg[0].url, 'https://www.sega.com/football-manager/fm27'); assert.equal(ddg[0].title, 'FM27 & SEGA'); assert.equal(ddg[0].snippet, 'Out November');

// unit: lists longer than 8 sites are searched in batches, web results are added, off-list URLs dropped
{
  const real = globalThis.fetch, seen = [];
  globalThis.fetch = async url => {
    url = decodeURIComponent(String(url)); seen.push(url);
    if (url.includes('bing.com/news')) return new Response(rss([{ t: 'News hit', u: 'https://www.pcgamer.com/fm27-news', d: 'x', p: 'Thu, 20 Mar 2026 10:00:00 GMT' }]));
    return new Response('<a class="result__a" href="https://www.sega.com/fm27">Official</a><a class="result__snippet">s</a><a class="result__a" href="https://evil.example/z">Bad</a><a class="result__snippet">s</a>');
  };
  const sites = ['a.com','b.com','c.com','d.com','e.com','f.com','g.com','h.com','pcgamer.com','sega.com'];
  const hits = await searchListed('fm27', sites, { web: true });
  assert.equal(seen.filter(u => u.includes('bing.com/news')).length, 2, '10 sites -> 2 batches');
  assert.deepEqual(hits.map(h => h.url).sort(), ['https://www.pcgamer.com/fm27-news', 'https://www.sega.com/fm27']);
  assert.ok(seen.some(u => u.includes('site:pcgamer.com OR site:sega.com')), 'second batch holds sites 9-10');
  globalThis.fetch = real;
}

// pipeline
const out = await runPipeline('Viral: BoE raised its rate to 6% today! Also the moon is cheese.', { ...DEFAULTS, apiKey: 'k', maxClaims: 2 });
const c0 = out.claims[0], c1 = out.claims[1];
assert.equal(out.stats.retries, 1, '429 retried');
assert.equal(c0.verdict, 'distorted'); assert.equal(c0.url, 'https://www.reuters.com/markets/boe-holds');
assert.equal(c0.quote, 'held its main interest rate at 5% on Thursday', 'real quote kept');
assert.deepEqual(c0.pages.map(p => p.url), ['https://www.reuters.com/markets/boe-holds'], 'offsite + unrelated candidates excluded');
assert.equal(c1.verdict, 'not_found'); assert.equal(c1.url, '');
assert.equal(out.perspectives.length, 1, 'hallucinated index dropped');
assert.equal(out.perspectives[0].url, 'https://www.cnn.com/business/boe');
console.log('calls:', calls.length, JSON.stringify(out.stats.byStage));

// quote that is NOT on the page must be dropped; unreadable page must not give "match"
const real = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('openrouter.ai')) {
    const sys = JSON.parse(opts.body).messages[0].content;
    if (sys.startsWith('You are a provenance')) return new Response(JSON.stringify({ choices: [{ message: { content: '{"best":1,"verdict":"match","quote":"this sentence is invented by the model","summary":"s"}' } }] }));
  }
  if (String(url).includes('reuters.com/markets')) return new Response('blocked', { status: 401 });
  return real(url, opts);
};
const out2 = await runPipeline('BoE raised its rate to 6% today per a viral post, big news', { ...DEFAULTS, apiKey: 'k', maxClaims: 1 });
assert.equal(out2.claims[0].quote, ''); assert.equal(out2.claims[0].verdict, 'unclear');
assert.match(out2.claims[0].summary, /열 수 없어/); assert.equal(out2.claims[0].pages[0].status, 401);
globalThis.fetch = real;

// a claim that drops the source's conditions is "distorted" even when the model says "match"
{
  const confirmWith = answer => async (url, opts) => {
    if (String(url).includes('openrouter.ai') && JSON.parse(opts.body).messages[0].content.startsWith('You are a provenance')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }));
    }
    return real(url, opts);
  };
  const trace = async answer => {
    globalThis.fetch = confirmWith(answer);
    return (await runPipeline('BoE raised its rate to 6% today per a viral post, big news', { ...DEFAULTS, apiKey: 'k', maxClaims: 1, outputLang: 'en' })).claims[0];
  };
  const conditions = '"conditions":["only for patients with a prior visit."]';
  const dropped = await trace(`{"best":1,"verdict":"match","quote":"","summary":"s.",${conditions},"claim_keeps_conditions":false,"misleading_without":true}`);
  assert.equal(dropped.verdict, 'distorted'); assert.match(dropped.summary, /leaves out these limits: only for patients with a prior visit\.$/);
  const kept = await trace(`{"best":1,"verdict":"match","quote":"","summary":"s.",${conditions},"claim_keeps_conditions":true,"misleading_without":true}`);
  assert.equal(kept.verdict, 'match', 'conditions kept: no downgrade');
  // a true claim that only leaves out details (the OpenAI valuation case) stays a match
  const details = await trace('{"best":1,"verdict":"match","quote":"","summary":"s.","conditions":["per Financial Times sources","valuation cut from $1.4tn to $1.25tn"],"claim_keeps_conditions":false,"misleading_without":false}');
  assert.equal(details.verdict, 'match', 'details left out: no downgrade');
  globalThis.fetch = real;
}

// the page the post was read on is never its own source (nor a perspective)
{
  const onPage = await runPipeline('BoE raised its rate to 6% today per a viral post, big news',
    { ...DEFAULTS, apiKey: 'k', maxClaims: 1 }, undefined, { pageUrl: 'https://reuters.com/markets/boe-holds/?utm=x' });
  assert.ok(onPage.claims[0].pages.every(p => !p.url.includes('reuters.com/markets/boe-holds')), 'current page skipped');
}

// unit: dates in article URLs; canonical URLs
{
  assert.equal(dateFromUrl('https://www.yna.co.kr/view/AKR20260820166200530'), '2026-08-20');
  assert.equal(dateFromUrl('https://www.chosun.com/national/2026/09/09/XMTM/'), '2026-09-09');
  assert.equal(dateFromUrl('https://www.joongang.co.kr/article/25470764'), '');
  assert.equal(dateFromUrl('https://x.com/20991231'), '', 'no future dates');
  assert.equal(canonicalUrl('https://m.newsis.com/view/A1/?x=1#y'), canonicalUrl('http://www.newsis.com/view/A1'));
}

// unit: copies of one headline count once (earliest copy kept); a differently worded first report takes the earliest slot
{
  const claim = '집에서 처방을 받고 약을 택배로 배달받는 서비스가 12월에 시행된다.';
  const qs = ['비대면진료 약 택배 배달 12월 시행'];
  const ranked = rankCandidates([
    { url: 'https://www.newsis.com/view/NISX20261016_1', title: '집에서 처방 받고 약은 택배로 배달…12월 시행 - 뉴시스', snippet: '', date: '', outlet: 'newsis.com' },
    { url: 'https://www.fnnews.com/news/202610171002313331', title: '집에서 처방 받고 약은 택배로 배달…12월 시행', snippet: '', date: '', outlet: 'fnnews.com' },
    { url: 'https://www.mt.co.kr/x', title: '집에서 처방 받고 약은 택배로 배달…12월 시행 | 머니투데이', snippet: '', date: '2026-10-18', outlet: 'mt.co.kr' },
    { url: 'https://www.yna.co.kr/view/AKR20260820166200530', title: '정부, 모든 비대면진료 환자 대상 약 배송 논의 착수', snippet: '12월 비대면진료 시행…약 택배 배달은 일부만, 전면 확대는 논의', date: '', outlet: 'yna.co.kr' },
    { url: 'https://www.joongang.co.kr/article/1', title: '비대면진료 12월 시행 앞두고 약 배달 택배 논란 커져', snippet: '', date: '', outlet: 'joongang.co.kr' }
  ], claim, qs);
  const urls = ranked.map(r => r.url);
  assert.equal(urls.filter(u => /newsis|fnnews|mt\.co/.test(u)).length, 1, 'one copy of the copied headline');
  assert.ok(urls.includes('https://www.newsis.com/view/NISX20261016_1'), 'the earliest copy (dated from its URL) is kept');
  assert.ok(urls.includes('https://www.yna.co.kr/view/AKR20260820166200530'), 'the earlier, differently worded report gets a slot');
}

// a model whose answer was rejected is asked last, not never: here it is the only one not busy
{
  const answers = ['not json at all', '{"c0":"이스라엘의 공습으로 교수가 숨졌다."}'];
  let ai = 0;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('openrouter.ai')) {
      const body = JSON.parse(opts.body);
      const sys = body.messages[0].content;
      if (sys.startsWith('You translate')) {
        if (body.model !== DEFAULTS.models.translate) return new Response('{}', { status: 503 });
        return new Response(JSON.stringify({ choices: [{ message: { content: answers[ai++] } }] }));
      }
    }
    return real(url, opts);
  };
  const { localize } = await import('../src/core/localize.js');
  const { newStats } = await import('../src/core/llm/client.js');
  const claims = [{ summary: 'A professor was killed.', needsTranslation: true }];
  await localize({ ...DEFAULTS, apiKey: 'k' }, 'ko', claims, [], { unreadable: '' }, newStats());
  assert.equal(claims[0].summary, '이스라엘의 공습으로 교수가 숨졌다.');
  globalThis.fetch = real;
}

// regression: models leak Chinese / English / junk into Korean text. Checked, retried on another model, else kept in English.
{
  const LEAK = "NN은 가자大学教授이자 작가 리파트 알라레르가 family's ‘nowhere else to go’这句话을 남긴 뒤的空袭으로 숨졌다고 전한다.";
  const CLEAN = '이스라엘의 공습으로 가자지구의 교수이자 작가가 숨졌다고 전했다.';
  const run = async (translateAnswers, extractAnswers, outputLang = 'ko') => {
    const real = globalThis.fetch, models = { translate: [], extract: [] };
    let ti = 0, ei = 0;
    globalThis.fetch = async (url, opts = {}) => {
      url = String(url);
      if (url.includes('openrouter.ai')) {
        const body = JSON.parse(opts.body), sys = body.messages[0].content;
        const reply = c => new Response(JSON.stringify({ choices: [{ message: { content: c } }], usage: {} }));
        if (sys.startsWith('You translate')) {
          models.translate.push(body.model);
          const keys = Object.keys(JSON.parse(body.messages[1].content));
          const text = translateAnswers[Math.min(ti++, translateAnswers.length - 1)];
          return reply(JSON.stringify(Object.fromEntries(keys.map(k => [k, text]))));
        }
        if (sys.startsWith('You extract')) { models.extract.push(body.model); return reply(extractAnswers[Math.min(ei++, extractAnswers.length - 1)]); }
        if (sys.startsWith('You write news')) return reply('{"queries":["gaza professor killed"],"english":"Gaza professor killed airstrike"}');
        if (sys.startsWith('You are a provenance')) return reply('{"best":1,"verdict":"match","quote":"","summary":"A Gaza professor and writer was killed in an airstrike."}');
        return reply('{"perspectives":[{"n":1,"angle":"ceasefire collapse","summary":"The ceasefire collapsed amid deadly attacks."}]}');
      }
      if (url.includes('bing.com/news')) return new Response(rss([
        { t: 'Gaza professor killed in airstrike', u: 'https://www.bbc.com/news/gaza1', d: 'Gaza professor writer killed airstrike family nowhere else to go', p: 'Tue, 21 Oct 2025 10:00:00 GMT' },
        { t: 'Ceasefire collapses as Gaza strikes continue', u: 'https://www.cnn.com/world/gaza2', d: 'Gaza ceasefire collapse airstrike professor killed', p: 'Wed, 22 Oct 2025 10:00:00 GMT' }]));
      return new Response('blocked', { status: 403 });          // the article page cannot be read
    };
    const out = await runPipeline('가자 교수이자 작가가 공습으로 숨졌다는 소식이다. 가족은 갈 곳이 없다고 했다.', { ...DEFAULTS, apiKey: 'k', maxClaims: 1, openSearch: false, outputLang }).finally(() => { globalThis.fetch = real; });
    return { out, models };
  };
  const GOOD_EXTRACT = '{"topic":"가자 공습","topic_en":"Gaza airstrike","claims":["가자 교수가 공습으로 숨졌다."]}';
  // 1. first translation leaks, the retry (on a different model) is clean
  const a = await run([LEAK, CLEAN], [GOOD_EXTRACT]);
  assert.ok(a.out.claims[0].summary.startsWith(CLEAN), 'clean retry used');
  assert.equal(a.out.perspectives[0].summary, CLEAN);
  assert.notEqual(a.models.translate[0], a.models.translate[1], 'retry used a different model');
  assert.match(a.out.claims[0].summary, /열 수 없어/, 'Korean "page unreadable" note appended after translation');
  // 2. every translation leaks: the clean English text is kept, never the leaked text
  const b = await run([LEAK], [GOOD_EXTRACT]);
  assert.match(b.out.claims[0].summary, /^A Gaza professor and writer was killed/);
  for (const c of b.out.claims) assert.ok(!/[㐀-鿿]/.test(c.summary), 'no Chinese characters reach the result');
  assert.ok(b.out.perspectives.every(p => !/[㐀-鿿]/.test(p.summary + p.angle)));
  // 3. extraction leaks on the first model: asked again on another model
  const c = await run([CLEAN], ['{"topic":"가자 공습","claims":["가자大学教授가 空袭으로 숨졌다."]}', GOOD_EXTRACT]);
  assert.equal(c.out.claims[0].claim, '가자 교수가 공습으로 숨졌다.'); assert.equal(c.models.extract.length, 2);
  // 4. English output needs no translation at all
  const d = await run([CLEAN], [GOOD_EXTRACT], 'en');
  assert.equal(d.models.translate.length, 0); assert.match(d.out.claims[0].summary, /^A Gaza professor/);
  console.log('leak handling OK');
}

console.log('selftest OK');
