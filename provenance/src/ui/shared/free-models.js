/** Live list of free OpenRouter models for the popup's model pickers, cached for an hour. */
const TTL_MS = 3600 * 1000;

/** @returns {Promise<{ id: string, name: string, ctx: number }[]>} */
export async function freeModels() {
  const { freeModelsCache } = await chrome.storage.local.get('freeModelsCache');
  if (freeModelsCache && Date.now() - freeModelsCache.t < TTL_MS) return freeModelsCache.list;
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const { data } = await res.json();
  const list = data
    .filter(m => m.id.endsWith(':free') && Number(m.pricing?.prompt) === 0 &&
      Number(m.pricing?.completion) === 0 && !/safety|guard/i.test(m.id))
    .map(m => ({ id: m.id, name: m.name || m.id, ctx: m.context_length }));
  await chrome.storage.local.set({ freeModelsCache: { t: Date.now(), list } });
  return list;
}
