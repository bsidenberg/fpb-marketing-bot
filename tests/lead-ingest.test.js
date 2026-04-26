// ============================================================
// tests/lead-ingest.test.js
// Tests for api/lib/lead-ingest.js — pure functions only.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  mapSourcePlatform,
  parseUtmFromUrl,
  normalizeGravityForms,
  normalizeCallRail,
  normalizeGeneric,
  detectSource,
  normalizePayload,
  buildDedupKey,
} from '../api/lib/lead-ingest.js';

// ── mapSourcePlatform ────────────────────────────────────────────────────────

describe('mapSourcePlatform', () => {
  it('maps google variants to google', () => {
    expect(mapSourcePlatform('google')).toBe('google');
    expect(mapSourcePlatform('google_ads')).toBe('google');
    expect(mapSourcePlatform('Google Ads')).toBe('google');
    expect(mapSourcePlatform('cpc')).toBe('google');
    expect(mapSourcePlatform('adwords')).toBe('google');
  });

  it('maps meta variants to meta', () => {
    expect(mapSourcePlatform('facebook')).toBe('meta');
    expect(mapSourcePlatform('instagram')).toBe('meta');
    expect(mapSourcePlatform('meta')).toBe('meta');
    expect(mapSourcePlatform('fb')).toBe('meta');
    expect(mapSourcePlatform('Meta Ads')).toBe('meta');
  });

  it('maps organic variants to organic', () => {
    expect(mapSourcePlatform('organic')).toBe('organic');
    expect(mapSourcePlatform('(none)')).toBe('organic');
  });

  it('returns unknown for unrecognized values', () => {
    expect(mapSourcePlatform('bing')).toBe('unknown');
    expect(mapSourcePlatform('')).toBe('unknown');
    expect(mapSourcePlatform(null)).toBe('unknown');
  });
});

// ── parseUtmFromUrl ──────────────────────────────────────────────────────────

describe('parseUtmFromUrl', () => {
  it('parses UTM params from a full URL', () => {
    const url = 'https://floridapolebarn.com/pole-barn-kits?utm_source=google&utm_medium=cpc&utm_campaign=kits&utm_content=ad1&utm_term=pole+barn+kits+florida';
    const utms = parseUtmFromUrl(url);
    expect(utms.utm_source).toBe('google');
    expect(utms.utm_medium).toBe('cpc');
    expect(utms.utm_campaign).toBe('kits');
    expect(utms.utm_content).toBe('ad1');
    expect(utms.utm_term).toBe('pole barn kits florida');
  });

  it('returns nulls for URL with no UTM params', () => {
    const utms = parseUtmFromUrl('https://floridapolebarn.com/');
    expect(utms.utm_source).toBeNull();
    expect(utms.utm_medium).toBeNull();
  });

  it('handles null/empty URL gracefully', () => {
    const utms = parseUtmFromUrl(null);
    expect(utms.utm_source).toBeNull();
  });

  it('handles partial/relative URLs', () => {
    const url = '/?utm_source=facebook&utm_medium=paid_social';
    const utms = parseUtmFromUrl(url);
    expect(utms.utm_source).toBe('facebook');
    expect(utms.utm_medium).toBe('paid_social');
  });

  it('parses gclid from URL', () => {
    const url = 'https://floridapolebarn.com/?utm_source=google&gclid=abc123XYZ';
    const utms = parseUtmFromUrl(url);
    expect(utms.gclid).toBe('abc123XYZ');
    expect(utms.utm_source).toBe('google');
  });

  it('parses fbclid from URL', () => {
    const url = 'https://floridapolebarn.com/?utm_source=facebook&fbclid=fb456';
    const utms = parseUtmFromUrl(url);
    expect(utms.fbclid).toBe('fb456');
  });

  it('returns null gclid and fbclid when absent', () => {
    const utms = parseUtmFromUrl('https://floridapolebarn.com/?utm_source=google');
    expect(utms.gclid).toBeNull();
    expect(utms.fbclid).toBeNull();
  });
});

// ── detectSource ────────────────────────────────────────────────────────────

describe('detectSource', () => {
  it('detects callrail from caller_number', () => {
    expect(detectSource({ caller_number: '+1-555-0100' })).toBe('callrail');
  });
  it('detects callrail from tracking_source', () => {
    expect(detectSource({ tracking_source: 'Google Ads' })).toBe('callrail');
  });
  it('detects gravity_forms from form_id', () => {
    expect(detectSource({ form_id: '5', entry_id: '42' })).toBe('gravity_forms');
  });
  it('detects generic by default', () => {
    expect(detectSource({ contact_name: 'John', email: 'j@example.com' })).toBe('generic');
  });
});

// ── normalizeGravityForms ─────────────────────────────────────────────────────

describe('normalizeGravityForms', () => {
  it('extracts contact fields from named keys', () => {
    const body = {
      form_id: '3',
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '(321) 555-1234',
      message: 'I want a 40x60 barn',
      source_url: 'https://floridapolebarn.com/quote?utm_source=google&utm_medium=cpc&utm_campaign=fpb-search',
    };
    const result = normalizeGravityForms(body);
    expect(result.contact_name).toBe('Jane Doe');
    expect(result.contact_email).toBe('jane@example.com');
    expect(result.contact_phone).toBe('(321) 555-1234');
    expect(result.utm_source).toBe('google');
    expect(result.utm_campaign).toBe('fpb-search');
    expect(result.source_platform).toBe('google');
    expect(result.lead_type).toBe('form');
  });

  it('extracts from numeric field keys', () => {
    const body = { field_1: 'Bob Smith', field_2: 'bob@test.com', field_3: '4075550100' };
    const result = normalizeGravityForms(body);
    expect(result.contact_name).toBe('Bob Smith');
    expect(result.contact_email).toBe('bob@test.com');
  });

  it('sets attribution_confidence medium when utm_source present', () => {
    const body = { name: 'Test', utm_source: 'facebook' };
    const result = normalizeGravityForms(body);
    expect(result.attribution_confidence).toBe('medium');
    expect(result.source_platform).toBe('meta');
  });

  it('sets attribution_confidence low when no UTMs', () => {
    const body = { name: 'Test' };
    const result = normalizeGravityForms(body);
    expect(result.attribution_confidence).toBe('low');
  });
});

// ── normalizeCallRail ─────────────────────────────────────────────────────────

describe('normalizeCallRail', () => {
  it('extracts caller info from CallRail payload', () => {
    const body = {
      id: 'cr-9876',
      caller_name: 'Mike Johnson',
      caller_number: '+13215551234',
      caller_city: 'Orlando',
      caller_state: 'FL',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'pole-barn-google',
    };
    const result = normalizeCallRail(body);
    expect(result.contact_name).toBe('Mike Johnson');
    expect(result.contact_phone).toBe('+13215551234');
    expect(result.contact_location).toBe('Orlando, FL');
    expect(result.utm_source).toBe('google');
    expect(result.source_platform).toBe('google');
    expect(result.lead_type).toBe('call');
    expect(result.external_id).toBe('cr-9876');
    expect(result.attribution_confidence).toBe('high');
  });

  it('maps Meta source correctly', () => {
    const body = { caller_number: '+1000', utm_source: 'facebook', utm_medium: 'paid_social' };
    const result = normalizeCallRail(body);
    expect(result.source_platform).toBe('meta');
  });
});

// ── normalizeGeneric ──────────────────────────────────────────────────────────

describe('normalizeGeneric', () => {
  it('passes through standard fields', () => {
    const body = {
      source_platform: 'google',
      lead_type: 'form',
      contact_name: 'Sue',
      campaign_id: 'camp-123',
      campaign_name: 'FPB Summer',
    };
    const result = normalizeGeneric(body);
    expect(result.source_platform).toBe('google');
    expect(result.campaign_id).toBe('camp-123');
    expect(result.contact_name).toBe('Sue');
  });

  it('maps source_platform from landing_page_url UTMs', () => {
    const body = {
      landing_page_url: 'https://floridapolebarn.com/?utm_source=facebook',
      contact_name: 'Fred',
    };
    const result = normalizeGeneric(body);
    expect(result.source_platform).toBe('meta');
  });

  it('parses UTMs from source_url (primary FPB/Gravity Forms field)', () => {
    const body = {
      name: 'Test Lead',
      email: 'test@example.com',
      source_url: 'https://floridapolebarn.com/contact/?utm_source=google&utm_medium=cpc&utm_campaign=test_campaign&utm_content=test_ad',
    };
    const result = normalizeGeneric(body);
    expect(result.utm_source).toBe('google');
    expect(result.utm_medium).toBe('cpc');
    expect(result.utm_campaign).toBe('test_campaign');
    expect(result.utm_content).toBe('test_ad');
    expect(result.source_platform).toBe('google');
    expect(result.attribution_confidence).toBe('medium');
  });

  it('exact FPB test payload — full UTM + gclid flow', () => {
    const body = {
      name: 'Test Lead',
      email: 'test@example.com',
      phone: '555-555-5555',
      message: 'Testing FPB lead ingestion',
      source_url: 'https://floridapolebarns.com/contact/?utm_source=google&utm_medium=cpc&utm_campaign=test_campaign&utm_content=test_ad&gclid=test-gclid-123',
      campaign_name: 'Test Campaign',
      lead_type: 'form',
    };
    const result = normalizeGeneric(body);
    expect(result.source_platform).toBe('google');
    expect(result.utm_source).toBe('google');
    expect(result.utm_medium).toBe('cpc');
    expect(result.utm_campaign).toBe('test_campaign');
    expect(result.utm_content).toBe('test_ad');
    expect(result.gclid).toBe('test-gclid-123');
    expect(result.attribution_confidence).toBe('medium');
    expect(result.contact_name).toBe('Test Lead');
    expect(result.contact_email).toBe('test@example.com');
    expect(result.notes).toBe('Testing FPB lead ingestion');
  });

  it('maps source_platform to google from gclid alone (no utm_source)', () => {
    const body = {
      source_url: 'https://floridapolebarn.com/?gclid=abc123',
      contact_name: 'NoUtm',
    };
    const result = normalizeGeneric(body);
    expect(result.source_platform).toBe('google');
    expect(result.gclid).toBe('abc123');
    expect(result.attribution_confidence).toBe('medium');
  });

  it('maps source_platform to meta from fbclid alone (no utm_source)', () => {
    const body = {
      source_url: 'https://floridapolebarn.com/?fbclid=fb789',
      contact_name: 'FbOnly',
    };
    const result = normalizeGeneric(body);
    expect(result.source_platform).toBe('meta');
    expect(result.fbclid).toBe('fb789');
    expect(result.attribution_confidence).toBe('medium');
  });

  it('parses UTMs from page_url when source_url absent', () => {
    const body = {
      page_url: 'https://floridapolebarn.com/?utm_source=google&utm_medium=cpc',
      contact_name: 'PageUrl',
    };
    const result = normalizeGeneric(body);
    expect(result.utm_source).toBe('google');
    expect(result.source_platform).toBe('google');
  });

  it('parses UTMs from referrer_url when other URL fields absent', () => {
    const body = {
      referrer_url: 'https://floridapolebarn.com/?utm_source=meta',
      contact_name: 'Referrer',
    };
    const result = normalizeGeneric(body);
    expect(result.utm_source).toBe('meta');
    expect(result.source_platform).toBe('meta');
  });

  it('sets attribution_confidence low when no UTMs and no click IDs', () => {
    const body = { contact_name: 'No Attribution' };
    const result = normalizeGeneric(body);
    expect(result.attribution_confidence).toBe('low');
    expect(result.source_platform).toBe('unknown');
  });

  it('prefers flat body utm_source over URL-parsed utm_source', () => {
    const body = {
      utm_source: 'meta',
      source_url: 'https://floridapolebarn.com/?utm_source=google',
    };
    const result = normalizeGeneric(body);
    expect(result.utm_source).toBe('meta');
    expect(result.source_platform).toBe('meta');
  });
});

// ── normalizePayload ──────────────────────────────────────────────────────────

describe('normalizePayload', () => {
  it('returns source_type callrail for CallRail body', () => {
    const { source_type } = normalizePayload({ caller_number: '555-0100', id: '1' });
    expect(source_type).toBe('callrail');
  });

  it('returns source_type gravity_forms for form body', () => {
    const { source_type } = normalizePayload({ form_id: '1', name: 'Jane' });
    expect(source_type).toBe('gravity_forms');
  });

  it('returns source_type generic for plain JSON', () => {
    const { source_type } = normalizePayload({ contact_name: 'Mark', lead_type: 'form' });
    expect(source_type).toBe('generic');
  });
});

// ── buildDedupKey ─────────────────────────────────────────────────────────────

describe('buildDedupKey', () => {
  const day = '2026-04-25';

  it('uses external_id when present', () => {
    const key = buildDedupKey({ external_id: 'cr-123' }, 'callrail', day);
    expect(key).toBe('callrail::cr-123');
  });

  it('uses email+date when no external_id', () => {
    const key = buildDedupKey({ contact_email: 'Bob@Example.COM' }, 'generic', day);
    expect(key).toBe(`email::bob@example.com::${day}`);
  });

  it('uses phone+date when no email', () => {
    const key = buildDedupKey({ contact_phone: '(321) 555-1234' }, 'callrail', day);
    expect(key).toBe(`phone::3215551234::${day}`);
  });

  it('returns null when no dedup signal', () => {
    const key = buildDedupKey({ contact_name: 'Anonymous' }, 'generic', day);
    expect(key).toBeNull();
  });

  it('ignores phone with fewer than 7 digits', () => {
    const key = buildDedupKey({ contact_phone: '555' }, 'generic', day);
    expect(key).toBeNull();
  });

  it('prefers external_id over email', () => {
    const key = buildDedupKey({ external_id: 'gf-42', contact_email: 'x@y.com' }, 'gravity_forms', day);
    expect(key).toBe('gravity_forms::gf-42');
  });
});
