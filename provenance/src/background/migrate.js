/**
 * Settings migrations, run when the extension updates. Each one is idempotent.
 */
import { DEFAULTS, RETIRED_MODELS } from '../shared/config.js';

/** The default outlet lists were widened: replace lists saved by older versions, once. */
async function upgradeDomainLists() {
  const { domainsVersion = 1 } = await chrome.storage.local.get('domainsVersion');
  if (domainsVersion >= DEFAULTS.domainsVersion) return;
  await chrome.storage.local.set({
    trustedDomains: DEFAULTS.trustedDomains,
    koreanDomains: DEFAULTS.koreanDomains,
    perspectiveDomains: DEFAULTS.perspectiveDomains,
    domainsVersion: DEFAULTS.domainsVersion
  });
}

/** Retired free models: replace them with the defaults so no stage starts on a dead model. */
async function replaceRetiredModels() {
  const { models, fallbackModels } = await chrome.storage.local.get(['models', 'fallbackModels']);
  const retired = m => RETIRED_MODELS.includes(m);
  if (models && Object.values(models).some(retired)) {
    await chrome.storage.local.set({
      models: Object.fromEntries(Object.entries(models).map(([stage, m]) => [stage, retired(m) ? DEFAULTS.models[stage] : m]))
    });
  }
  if (fallbackModels?.some(retired)) await chrome.storage.local.set({ fallbackModels: fallbackModels.filter(m => !retired(m)) });
}

export async function migrateSettings() {
  await upgradeDomainLists();
  await replaceRetiredModels();
}
