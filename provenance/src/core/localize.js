/**
 * Output language. The analysis is written in English (more accurate, and free models drift into other
 * languages when they write Korean directly). Korean output comes from one batched translation; every
 * translated sentence must pass isCleanText, failures are retried on another model, then left in English.
 */
import { chat, parseJson } from './llm/client.js';
import * as prompts from './prompts.js';
import { isCleanText } from './langcheck.js';

const ATTEMPTS = 2;

/**
 * Translates the values of `items` ({ key: English text }) to Korean.
 * @returns {Promise<Record<string, string>>}  only the keys whose translation is clean
 */
async function translateToKorean(settings, items, stats) {
  const done = {};
  let todo = items;
  for (let attempt = 0; attempt < ATTEMPTS && Object.keys(todo).length; attempt++) {
    let out = {};
    try {
      out = parseJson(await chat(settings, 'translate', prompts.translateToKorean(), JSON.stringify(todo), stats,
        { avoid: attempt ? [stats.lastModel] : [] }));
    } catch { /* every model failed: the English text is kept */ }
    const failed = {};
    for (const [k, v] of Object.entries(todo)) {
      const t = typeof out[k] === 'string' ? out[k].trim() : '';
      if (t && isCleanText(t, 'ko')) done[k] = t; else failed[k] = v;
    }
    todo = failed;
  }
  return done;
}

/**
 * Puts claim summaries and perspectives into `outLang` (in place) and appends the fixed notes.
 * @param {import('./verify.js').ClaimResult[]} claims
 * @param {import('./perspectives.js').Perspective[]} perspectives
 * @param {{ unreadable: string }} notes  fixed notes in the output language
 */
export async function localize(settings, outLang, claims, perspectives, notes, stats) {
  if (outLang === 'ko') {
    // One batch, one call: c<i> = claim summary, p<i>.summary / p<i>.angle = perspective fields.
    const items = {};
    claims.forEach((c, i) => { if (c.needsTranslation && c.summary) items[`c${i}`] = c.summary; });
    perspectives.forEach((p, i) => {
      if (p.summary) items[`p${i}.summary`] = p.summary;
      if (p.angle) items[`p${i}.angle`] = p.angle;
    });
    const t = Object.keys(items).length ? await translateToKorean(settings, items, stats) : {};
    claims.forEach((c, i) => { if (t[`c${i}`]) c.summary = t[`c${i}`]; });
    perspectives.forEach((p, i) => {
      if (t[`p${i}.summary`]) p.summary = t[`p${i}.summary`];
      if (t[`p${i}.angle`]) p.angle = t[`p${i}.angle`];
    });
  }
  for (const c of claims) {
    if (c.unreadable) c.summary += notes.unreadable;
    delete c.unreadable;
    delete c.needsTranslation;
  }
}
