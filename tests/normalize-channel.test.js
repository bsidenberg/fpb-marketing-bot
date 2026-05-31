// ============================================================
// tests/normalize-channel.test.js
// Unit tests for api/lib/normalize-channel.js
//
// Production constraint (confirmed):
//   CHECK (channel = ANY (ARRAY['google_ads','meta_ads','seo','content','gbp']))
//
// Covers:
//   • Valid enum values pass through unchanged
//   • Null / undefined / empty → 'content' (fallback)
//   • Markdown asterisk stripping (the production bug: "**LP Search - Kits")
//   • Fuzzy keyword mapping for partial matches
//   • Unknown values → 'content'
// ============================================================

import { describe, it, expect } from 'vitest';
import { normalizeChannel } from '../api/lib/normalize-channel.js';

describe('normalizeChannel — valid enum values pass through unchanged', () => {
  const VALID = ['google_ads', 'meta_ads', 'seo', 'content', 'gbp'];
  it.each(VALID)('passes through "%s" unchanged', (v) => {
    expect(normalizeChannel(v)).toBe(v);
  });
});

describe('normalizeChannel — null / undefined / empty → "content"', () => {
  it('returns "content" for null',      () => expect(normalizeChannel(null)).toBe('content'));
  it('returns "content" for undefined', () => expect(normalizeChannel(undefined)).toBe('content'));
  it('returns "content" for empty string', () => expect(normalizeChannel('')).toBe('content'));
});

describe('normalizeChannel — markdown stripping (production bug path)', () => {
  // "LP Search - Kits" contains "search" → maps to 'seo' after stripping markdown
  it('strips ** from "**LP Search - Kits" and maps via "search" keyword to "seo"', () => {
    expect(normalizeChannel('**LP Search - Kits')).toBe('seo');
  });
  it('strips ** from "**LP Search - Kits**" and maps via "search" keyword to "seo"', () => {
    expect(normalizeChannel('**LP Search - Kits**')).toBe('seo');
  });
  it('strips ** from "**google_ads**" and exact-matches to "google_ads"', () => {
    expect(normalizeChannel('**google_ads**')).toBe('google_ads');
  });
  it('strips * from "*meta_ads*" and exact-matches to "meta_ads"', () => {
    expect(normalizeChannel('*meta_ads*')).toBe('meta_ads');
  });
  it('strips backticks from "`seo_blog`" and maps via "seo" keyword to "seo"', () => {
    // seo_blog is not a valid value; after stripping it includes 'seo' → 'seo'
    expect(normalizeChannel('`seo_blog`')).toBe('seo');
  });
});

describe('normalizeChannel — GBP (checked before generic google)', () => {
  it('maps "gbp" to "gbp" via exact match', () => {
    expect(normalizeChannel('gbp')).toBe('gbp');
  });
  it('maps "gmb" to "gbp"', () => {
    expect(normalizeChannel('gmb')).toBe('gbp');
  });
  it('maps "google business" to "gbp" (not "google_ads")', () => {
    expect(normalizeChannel('google business')).toBe('gbp');
  });
  it('maps "google_business" to "gbp" (not "google_ads")', () => {
    expect(normalizeChannel('google_business')).toBe('gbp');
  });
});

describe('normalizeChannel — google_ads fuzzy mapping', () => {
  it('maps "google" to "google_ads"', () => {
    expect(normalizeChannel('google')).toBe('google_ads');
  });
  it('maps "Google Ads" to "google_ads"', () => {
    expect(normalizeChannel('Google Ads')).toBe('google_ads');
  });
  it('maps "adwords" to "google_ads"', () => {
    expect(normalizeChannel('adwords')).toBe('google_ads');
  });
});

describe('normalizeChannel — meta_ads fuzzy mapping', () => {
  it('maps "meta" to "meta_ads"', () => {
    expect(normalizeChannel('meta')).toBe('meta_ads');
  });
  it('maps "facebook" to "meta_ads"', () => {
    expect(normalizeChannel('facebook')).toBe('meta_ads');
  });
  it('maps "Facebook Ads" to "meta_ads"', () => {
    expect(normalizeChannel('Facebook Ads')).toBe('meta_ads');
  });
  it('maps "fb" to "meta_ads"', () => {
    expect(normalizeChannel('fb')).toBe('meta_ads');
  });
  it('maps "instagram" to "meta_ads"', () => {
    expect(normalizeChannel('instagram')).toBe('meta_ads');
  });
});

describe('normalizeChannel — seo fuzzy mapping', () => {
  it('maps "blog" to "seo"', () => {
    expect(normalizeChannel('blog')).toBe('seo');
  });
  it('maps "organic" to "seo"', () => {
    expect(normalizeChannel('organic')).toBe('seo');
  });
  it('maps "search" to "seo"', () => {
    expect(normalizeChannel('search')).toBe('seo');
  });
  // seo check fires before content check, so 'organic social' → 'seo'
  it('maps "organic social" to "seo" (organic keyword wins over social keyword)', () => {
    expect(normalizeChannel('organic social')).toBe('seo');
  });
});

describe('normalizeChannel — content fuzzy mapping', () => {
  it('maps "social" to "content"', () => {
    expect(normalizeChannel('social')).toBe('content');
  });
  it('maps "post" to "content"', () => {
    expect(normalizeChannel('post')).toBe('content');
  });
  it('maps "article" to "content"', () => {
    expect(normalizeChannel('article')).toBe('content');
  });
});

describe('normalizeChannel — unknown values fall back to "content"', () => {
  it('returns "content" for completely unrecognised value', () => {
    expect(normalizeChannel('xyz_channel')).toBe('content');
  });
  it('returns "content" for numeric string', () => {
    expect(normalizeChannel('123')).toBe('content');
  });
  // "LP Search - Kits" (no markdown) contains "search" → maps to 'seo', not 'content'
  it('maps "LP Search - Kits" to "seo" via "search" keyword', () => {
    expect(normalizeChannel('LP Search - Kits')).toBe('seo');
  });
});
