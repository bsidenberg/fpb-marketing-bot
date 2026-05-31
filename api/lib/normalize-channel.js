// Valid values enforced by actions_channel_check in production:
// CHECK (channel = ANY (ARRAY['google_ads','meta_ads','seo','content','gbp']))
const VALID_CHANNELS = new Set(['google_ads', 'meta_ads', 'seo', 'content', 'gbp']);

/**
 * Normalize a raw channel value to a valid actions_channel_check enum.
 * Strips markdown formatting (*_`~), trims whitespace, lowercases, then
 * checks the exact set first, then fuzzy-maps partial matches.
 * GBP keywords are checked before the generic 'google' check so that
 * "google business" routes to 'gbp' rather than 'google_ads'.
 * Falls back to 'content' (most generic valid value) for unknowns.
 */
export function normalizeChannel(raw) {
  if (raw == null) return 'content';
  const stripped = String(raw).replace(/[*`~]/g, '').trim().toLowerCase();
  if (VALID_CHANNELS.has(stripped)) return stripped;
  if (stripped.includes('gbp') || stripped.includes('gmb') || stripped.includes('google business') || stripped.includes('google_business')) return 'gbp';
  if (stripped.includes('google') || stripped.includes('adwords')) return 'google_ads';
  if (stripped.includes('meta') || stripped.includes('facebook') || stripped.includes('fb') || stripped.includes('instagram') || stripped.includes('ig')) return 'meta_ads';
  if (stripped.includes('seo') || stripped.includes('blog') || stripped.includes('organic') || stripped.includes('search')) return 'seo';
  if (stripped.includes('post') || stripped.includes('social') || stripped.includes('article')) return 'content';
  return 'content';
}
