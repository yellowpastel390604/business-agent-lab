/**
 * OpenRouter account info for the popup and options page: key check and today's free-request usage.
 */
import { $ } from './dom.js';
import { ko } from '../../shared/i18n.js';

const KEY_ENDPOINT = 'https://openrouter.ai/api/v1/key';
const QUOTA_WARN_SHARE = 0.8;

/**
 * Asks OpenRouter about a key.
 * @returns {Promise<{ ok: true, quota?: { used: number, limit: number } } | { ok: false, status: number }>}
 */
export async function checkKey(key) {
  const res = await fetch(KEY_ENDPOINT, { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, quota: (await res.json()).data?.free_model_daily_requests };
}

/** Fills the quota meter (#quota, #quota-text, #quota-bar) that both pages share. */
export function showQuota(quota) {
  if (!quota) return;
  $('quota').hidden = false;
  $('quota-text').textContent = ko.quota(quota);
  const share = quota.used / quota.limit;
  const bar = $('quota-bar');
  bar.style.width = Math.min(100, share * 100) + '%';
  bar.classList.toggle('warn', share > QUOTA_WARN_SHARE);
}
