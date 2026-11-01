/**
 * OpenRouter provider: one chat completion against one model, with retries for OpenRouter's own rate limit.
 *
 * A provider is an object `{ complete(request) → Promise<{ text, usage }> }` that throws LlmError with an
 * HTTP-like `status` on failure. client.js decides what a status means (switch model, give up, ...).
 */
import { LlmError } from './errors.js';
import { ko } from '../../shared/i18n.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_RETRIES = 3;          // retries of OpenRouter's own (not upstream) 429
const MAX_BACKOFF_MS = 30_000;
const MAX_TOKENS = 3000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * @param {{ apiKey: string, model: string, system: string, user: string, onAttempt?: (retry: boolean) => void }} req
 * @returns {Promise<{ text: string, usage: { prompt_tokens?: number, completion_tokens?: number } }>}
 */
async function complete({ apiKey, model, system, user, onAttempt = () => {} }) {
  const body = JSON.stringify({
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0,
    max_tokens: MAX_TOKENS
  });
  for (let attempt = 0; ; attempt++) {
    onAttempt(attempt > 0);
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, 'x-title': 'Provenance' },
      body
    });
    const json = await res.json().catch(() => ({}));

    if (res.status === 429) {
      // "Upstream" means the model's host is saturated: that rarely clears in seconds, so the caller
      // should switch models at once. OpenRouter's own limit does clear: wait and retry.
      const upstream = json.error?.metadata?.limit_source?.startsWith('upstream');
      if (!upstream && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after')) * 1000;
        await sleep(Math.min(MAX_BACKOFF_MS, retryAfter || 4000 * 2 ** attempt));
        continue;
      }
      throw new LlmError(upstream ? ko.err.modelBusy(model) : ko.err.freeLimit, 429);
    }
    if (!res.ok || json.error) {
      if (res.status === 401) throw new LlmError(ko.err.badKey, 401);
      const detail = [json.error?.message || `OpenRouter error ${res.status}`, json.error?.metadata?.raw];
      throw new LlmError(detail.filter(Boolean).join(': ').slice(0, 300), res.status);
    }

    // Reasoning models may wrap their thinking in <think> tags; only the answer matters.
    const text = (json.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!text) throw new LlmError(ko.err.empty(model), 502);   // treated like a busy model: try the next one
    return { text, usage: json.usage || {} };
  }
}

export const openrouter = { complete };
