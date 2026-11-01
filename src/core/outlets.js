/**
 * Which outlet lists apply to a post, by language. All derived from the user's settings.
 */

/** Outlets whose pages may be read and trusted as a source: Korean outlets first for Korean posts. */
export const trustedFor = (s, lang) =>
  [...new Set(lang === 'ko' ? [...(s.koreanDomains || []), ...s.trustedDomains] : s.trustedDomains)];

/** Every outlet the user has listed anywhere (results from any other outlet are labelled external). */
export const knownFor = (s, lang) => [...new Set([...trustedFor(s, lang), ...s.perspectiveDomains])];

/** Outlets searched for other perspectives on the story. */
export const perspectivesFor = (s, lang) => [...new Set(lang === 'ko'
  ? [...(s.koreanDomains || []), ...s.perspectiveDomains]
  : [...s.perspectiveDomains, ...s.trustedDomains.slice(0, 8)])];

/** International outlets (English) that cover a foreign story for a Korean post. */
export const internationalFor = s => [...s.perspectiveDomains, ...s.trustedDomains.slice(0, 8)];

/**
 * Outlet tiers for an English post: likeliest first (general news + science), then the rest of the
 * trusted list, then the perspective outlets. Later tiers are searched only when earlier ones find nothing.
 */
export const englishTiers = s => {
  const first = s.trustedDomains.slice(0, 16);
  const rest = s.trustedDomains.slice(16);
  const extra = s.perspectiveDomains.filter(d => !s.trustedDomains.includes(d));
  return [first, rest, extra].filter(t => t.length);
};

/** The language summaries are written in for a post in `lang`. */
export const outputLangFor = (s, lang) => (!s.outputLang || s.outputLang === 'auto' ? lang : s.outputLang);
