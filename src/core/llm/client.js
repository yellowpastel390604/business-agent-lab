/**
 * The one entry point the pipeline uses to talk to a model: `chat(settings, stage, system, user, stats)`.
 *
 * It picks the stage's model, falls back through the other free models when one is busy or gone, and
 * records usage in `stats`. Providers are pluggable: add one to PROVIDERS and select it with
 * `settings.provider`.
 */
import { DEFAULTS, RETIRED_MODELS } from '../../shared/config.js';
import { ko } from '../../shared/i18n.js';
import { LlmError } from './errors.js';
import { openrouter } from './openrouter.js';

export { LlmError };

const PROVIDERS = { openrouter };

/** Statuses that mean "this model can't answer right now, another one might". Anything else is fatal. */
const TRY_NEXT = [404, 408, 429, 500, 502, 503, 504];
/** Of those, the ones that mean "busy" (worth a second pass after a pause), as opposed to "gone". */
const BUSY = [429, 502, 503, 504];
const SECOND_PASS_DELAY_MS = 6000;

/** Models that answered 404 (retired or renamed); skipped for the rest of this worker's life. */
const gone = new Set();

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Usage counters for one trace.
 * @returns {{ calls: number, retries: number, promptTokens: number, completionTokens: number,
 *   byStage: Record<string, number>, modelsUsed?: Record<string, number>, skipped?: string[], lastModel?: string }}
 */
export const newStats = () => ({ calls: 0, retries: 0, promptTokens: 0, completionTokens: 0, byStage: {} });

/** The models to try for a stage, in order: the stage's own model, then the fallbacks. */
function modelChain(settings, stage, avoid) {
  const all = [
    settings.models?.[stage] || DEFAULTS.models[stage],
    ...(settings.fallbackModels || []),
    ...DEFAULTS.fallbackModels
  ];
  const usable = [...new Set(all)].filter(m => !RETIRED_MODELS.includes(m) && !gone.has(m));
  if (!usable.length) return DEFAULTS.fallbackModels;
  // Avoided models go last, not away: when every other model is busy, they are still worth asking.
  return [...usable.filter(m => !avoid.includes(m)), ...usable.filter(m => avoid.includes(m))];
}

/**
 * Sends one system + user message and returns the model's text answer.
 * @param {object} settings  saved settings (provider, apiKey, models, fallbackModels)
 * @param {import('../../shared/config.js').Stage} stage
 * @param {string} system
 * @param {string} user
 * @param {ReturnType<typeof newStats>} stats
 * @param {{ avoid?: string[] }} [opts]  models to try last (e.g. the one whose answer was just rejected)
 */
export async function chat(settings, stage, system, user, stats, { avoid = [] } = {}) {
  const provider = PROVIDERS[settings.provider];
  if (!provider) throw new LlmError(ko.err.unknownProvider(settings.provider));
  const chain = modelChain(settings, stage, avoid);

  // Two passes over the chain: free models are often busy for only a few seconds.
  let lastErr;
  for (let pass = 0; pass < 2; pass++) {
    if (pass) await sleep(SECOND_PASS_DELAY_MS);
    let allBusy = true;
    for (const model of chain) {
      try {
        const { text, usage } = await provider.complete({
          apiKey: settings.apiKey, model, system, user,
          onAttempt: retry => {
            stats.calls++;
            stats.byStage[stage] = (stats.byStage[stage] || 0) + 1;
            if (retry) stats.retries++;
          }
        });
        stats.promptTokens += usage.prompt_tokens || 0;
        stats.completionTokens += usage.completion_tokens || 0;
        (stats.modelsUsed ||= {})[model] = (stats.modelsUsed[model] || 0) + 1;
        stats.lastModel = model;
        return text;
      } catch (e) {
        if (!TRY_NEXT.includes(e.status)) throw e;     // bad key, bad request: another model won't help
        lastErr = e;
        if (e.status === 404) gone.add(model);
        if (!BUSY.includes(e.status)) allBusy = false;
        (stats.skipped ||= []).push(`${model}: ${e.message}`);
      }
    }
    if (pass && !allBusy) break;
  }
  throw new LlmError(ko.err.allBusy(lastErr.message), lastErr.status);
}

/** Pulls the first JSON object out of a model answer (tolerates ``` fences and chatter around it). */
export function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new LlmError(ko.err.noJson);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new LlmError(ko.err.badJson);
  }
}
