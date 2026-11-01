// Test run of the real pipeline outside Chrome.
//   node dev/run.mjs --text "post text"
//   node dev/run.mjs --file post.txt
//   node dev/run.mjs --reddit https://www.reddit.com/r/.../comments/...
// Reads OPENROUTER_API_KEY from provenance/.env. Optional: --claims N, --extract/--crawl/--confirm/--translate <model>,
//   --page <url> (the page the post was read on; it is never offered as its own source)
import { readFileSync } from 'node:fs';
import { DEFAULTS } from '../src/shared/config.js';
import { runPipeline } from '../src/core/pipeline.js';
import { loadEnv } from './env.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));

const env = loadEnv();
if (!env.OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY is empty. Put it in provenance/.env');
  process.exit(1);
}

async function postText() {
  if (args.text) return String(args.text);
  if (args.file) return readFileSync(String(args.file), 'utf8');
  if (args.reddit) {
    const res = await fetch(String(args.reddit).replace(/\/?(\?.*)?$/, '.json'), {
      headers: { 'user-agent': 'provenance-dev/0.3 (test run)' }
    });
    if (!res.ok) throw new Error(`Reddit returned HTTP ${res.status}; paste the post with --text instead.`);
    const p = (await res.json())[0].data.children[0].data;
    return [p.title, p.selftext, p.url_overridden_by_dest].filter(Boolean).join('\n');
  }
  throw new Error('Give --text, --file or --reddit.');
}

const settings = {
  ...DEFAULTS,
  apiKey: env.OPENROUTER_API_KEY,
  maxClaims: Number(args.claims) || DEFAULTS.maxClaims,
  models: {
    extract: args.extract || DEFAULTS.models.extract,
    crawl: args.crawl || DEFAULTS.models.crawl,
    confirm: args.confirm || DEFAULTS.models.confirm,
    translate: args.translate || DEFAULTS.models.translate
  }
};

const text = await postText();
console.log('POST:\n' + text.slice(0, 600) + '\n');
const t0 = Date.now();
const out = await runPipeline(text, settings, undefined, { pageUrl: args.page ? String(args.page) : '' });
if (out.allFailed) console.log('ALL TRACES FAILED:', out.firstError?.message);
delete out.firstError;
console.log(JSON.stringify(out, null, 2));
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s | model calls: ${out.stats.calls} (retries ${out.stats.retries}) | tokens in/out: ${out.stats.promptTokens}/${out.stats.completionTokens}`);
