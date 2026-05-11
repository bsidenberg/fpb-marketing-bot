// ============================================================
// tests/campaign-stats.test.js
// Tests for api/lib/campaign-stats.js upsert behavior and
// account-scoped spend reads.
// Supabase is mocked.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const mockUpsertFn = vi.fn();

let mockSelectData  = [];
let mockSelectError = null;
let eqCalls         = []; // track .eq(col, val) calls so tests can verify scoping

// Chainable select mock
function makeSelectChain(data, error) {
  const chain = {
    eq:  (col, val) => { eqCalls.push([col, val]); return chain; },
    gte: () => chain,
    lt:  () => chain,
    then: (resolve) => resolve({ data, error }),
  };
  return chain;
}

vi.mock('../api/lib/supabase.js', () => ({
  default: {
    from: (_table) => ({
      select: (_cols) => makeSelectChain(mockSelectData, mockSelectError),
      upsert: (rows, opts) => {
        mockUpsertFn(rows, opts);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

import { writeCampaignDailyStats, getCampaignSpend } from '../api/lib/campaign-stats.js';

// ── Account fixture ──────────────────────────────────────────────────────────
const FPB_ACCOUNT = { id: 'fpb-uuid', slug: 'fpb', status: 'active' };

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectData  = [];
  mockSelectError = null;
  eqCalls         = [];
});

// ── writeCampaignDailyStats ───────────────────────────────────────────────────

describe('writeCampaignDailyStats', () => {
  it('writes one row per campaign with correct platform', async () => {
    const campaigns = [
      { id: 'camp-1', name: 'FPB Search', spend: '120.50', clicks: 45, impressions: 1200, conversions: 3, ctr: '3.75', cpl: '40.17' },
      { id: 'camp-2', name: 'FPB Display', spend: '55.20', clicks: 22, impressions: 800 },
    ];

    const result = await writeCampaignDailyStats(campaigns, 'google_ads', '2026-04-25', FPB_ACCOUNT);
    expect(result.written).toBe(2);
    expect(result.errors).toHaveLength(0);

    const upsertArgs = mockUpsertFn.mock.calls[0];
    expect(upsertArgs[0]).toHaveLength(2);
    expect(upsertArgs[0][0].platform).toBe('google_ads');
    expect(upsertArgs[0][0].campaign_id).toBe('camp-1');
    expect(upsertArgs[0][0].date).toBe('2026-04-25');
    expect(upsertArgs[0][0].spend).toBe(120.5);
  });

  it('tags every row with account_id and client_key from the account argument', async () => {
    const campaigns = [{ id: 'c1', name: 'Test', spend: 50 }];
    await writeCampaignDailyStats(campaigns, 'google_ads', '2026-04-25', FPB_ACCOUNT);

    const row = mockUpsertFn.mock.calls[0][0][0];
    expect(row.account_id).toBe('fpb-uuid');
    expect(row.client_key).toBe('fpb');
  });

  it('uses upsert with correct conflict target', async () => {
    await writeCampaignDailyStats([{ id: 'c1', name: 'Test', spend: 50 }], 'meta_ads', '2026-04-25', FPB_ACCOUNT);
    const opts = mockUpsertFn.mock.calls[0][1];
    expect(opts.onConflict).toBe('platform,campaign_id,date');
    expect(opts.ignoreDuplicates).toBe(false); // last-write-wins
  });

  it('skips campaigns with no id', async () => {
    const campaigns = [
      { name: 'No ID Campaign', spend: 100 },
      { id: 'valid-1', name: 'Valid', spend: 50 },
    ];
    const result = await writeCampaignDailyStats(campaigns, 'meta_ads', '2026-04-25', FPB_ACCOUNT);
    // The row with no id gets campaign_id = '' which is filtered
    expect(result.written).toBe(1);
  });

  it('returns zero written and no errors for empty campaigns array', async () => {
    const result = await writeCampaignDailyStats([], 'google_ads', '2026-04-25', FPB_ACCOUNT);
    expect(result.written).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(mockUpsertFn).not.toHaveBeenCalled();
  });

  it('handles null campaigns gracefully', async () => {
    const result = await writeCampaignDailyStats(null, 'google_ads', '2026-04-25', FPB_ACCOUNT);
    expect(result.written).toBe(0);
  });

  it('uses avgCpc if cpc not present (Google Ads field)', async () => {
    const campaigns = [{ id: 'c1', name: 'Test', spend: '80', avgCpc: '1.20' }];
    await writeCampaignDailyStats(campaigns, 'google_ads', '2026-04-25', FPB_ACCOUNT);
    const row = mockUpsertFn.mock.calls[0][0][0];
    expect(row.cpc).toBe(1.2);
  });

  it('throws when account is missing or incomplete', async () => {
    await expect(
      writeCampaignDailyStats([{ id: 'c1' }], 'google_ads', '2026-04-25')
    ).rejects.toThrow(/account/);
    await expect(
      writeCampaignDailyStats([{ id: 'c1' }], 'google_ads', '2026-04-25', null)
    ).rejects.toThrow(/account/);
    await expect(
      writeCampaignDailyStats([{ id: 'c1' }], 'google_ads', '2026-04-25', {})
    ).rejects.toThrow(/account/);
    await expect(
      writeCampaignDailyStats([{ id: 'c1' }], 'google_ads', '2026-04-25', { id: 'x' }) // missing slug
    ).rejects.toThrow(/account/);
    expect(mockUpsertFn).not.toHaveBeenCalled();
  });
});

// ── getCampaignSpend ──────────────────────────────────────────────────────────

describe('getCampaignSpend', () => {
  it('returns summed spend from daily stats rows', async () => {
    mockSelectData = [{ spend: '120.00', conversions: 3 }, { spend: '85.50', conversions: 2 }];
    const spend = await getCampaignSpend('camp-1', 'fpb-uuid', 'google_ads', '2026-04-18', '2026-04-25');
    expect(spend).toBeCloseTo(205.5);
  });

  it('returns null when no rows found', async () => {
    mockSelectData = [];
    const spend = await getCampaignSpend('camp-1', 'fpb-uuid', 'google_ads', '2026-04-18', '2026-04-25');
    expect(spend).toBeNull();
  });

  it('returns null for null campaignId without requiring accountId', async () => {
    // campaignId guard should fire first — accountId may be missing
    const spend = await getCampaignSpend(null, null, 'google_ads', '2026-04-18', '2026-04-25');
    expect(spend).toBeNull();
  });

  it('handles zero-spend rows (zero-spend edge case)', async () => {
    mockSelectData = [{ spend: '0.00', conversions: 0 }, { spend: '0', conversions: 0 }];
    const spend = await getCampaignSpend('camp-1', 'fpb-uuid', 'meta_ads', '2026-04-18', '2026-04-25');
    expect(spend).toBe(0);
  });

  it('returns null on Supabase error', async () => {
    mockSelectError = { message: 'connection error' };
    mockSelectData  = null;
    const spend = await getCampaignSpend('camp-1', 'fpb-uuid', 'google_ads', '2026-04-18', '2026-04-25');
    expect(spend).toBeNull();
  });

  it('filters by account_id when querying daily stats', async () => {
    mockSelectData = [{ spend: '50' }];
    await getCampaignSpend('camp-1', 'weld-uuid', 'google_ads', '2026-04-18', '2026-04-25');
    expect(eqCalls).toContainEqual(['account_id', 'weld-uuid']);
    expect(eqCalls).toContainEqual(['campaign_id', 'camp-1']);
    expect(eqCalls).toContainEqual(['platform', 'google_ads']);
  });

  it('throws when accountId is missing and campaignId is provided', async () => {
    await expect(
      getCampaignSpend('camp-1', null, 'google_ads', '2026-04-18', '2026-04-25')
    ).rejects.toThrow(/accountId/);
    await expect(
      getCampaignSpend('camp-1', undefined, 'google_ads', '2026-04-18', '2026-04-25')
    ).rejects.toThrow(/accountId/);
  });
});
