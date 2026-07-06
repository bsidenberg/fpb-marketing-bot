// ============================================================
// tests/google-ads.test.js — SESSION-07a
// Unit tests for fetchGoogleAdsData (api/google-ads.js): the roster query
// added alongside the existing metrics query, cap-sum consistency with the
// budget guard (ENABLED-only totalDailyBudget), and fail-closed behavior on
// roster failure/parse errors.
//
// Mock design mirrors tests/daily-stats.test.js:
//   • api-cost.js's recordApiCall mocked via vi.hoisted spy.
//   • fetch stubbed globally; happy-path tests queue three sequential
//     responses in call order: OAuth token -> metrics GAQL -> roster GAQL.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── recordApiCall mock (vi.hoisted so the mock ref exists before import) ─────
const { mockRecordApiCall } = vi.hoisted(() => ({
  mockRecordApiCall: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../api/lib/api-cost.js', () => ({
  recordApiCall: mockRecordApiCall,
}));

// api/google-ads.js pulls in ./lib/accounts.js (for the HTTP handler, unused
// by fetchGoogleAdsData itself), which imports ./lib/supabase.js — a
// module-level createClient() call that throws without env vars. Stub it out
// so importing the module under test doesn't require Supabase credentials.
vi.mock('../api/lib/supabase.js', () => ({
  default: { from: () => ({}) },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { fetchGoogleAdsData, fetchSearchTerms } from '../api/google-ads.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const ACCOUNT = { id: 'acct-uuid', slug: 'fpb' };
const CONNECTION = {
  resolved_account_id_external: '123-456-7890',
  resolved_refresh_token:       'r',
  resolved_manager_account_id:  null,
};

function metricsRow(id, name, budgetMicros, costMicros) {
  return {
    campaign: {
      id,
      name,
      status:         'ENABLED',
      campaignBudget: `customers/1/campaignBudgets/${id}`,
    },
    campaignBudget: { amountMicros: String(budgetMicros) },
    metrics: {
      impressions: '1000',
      clicks:      '50',
      costMicros:  String(costMicros),
      conversions: 2,
      ctr:         0.05,
      averageCpc:  '400000',
    },
  };
}

function rosterRow(id, name, status, budgetMicros) {
  return {
    campaign: {
      id,
      name,
      status,
      campaignBudget: `customers/1/campaignBudgets/${id}`,
    },
    campaignBudget: { amountMicros: String(budgetMicros) },
  };
}

// Metrics query only returns campaigns with recent traffic.
const METRICS_RESULTS = [
  metricsRow('111', 'Location', 30_000_000, 20_000_000),
  metricsRow('222', 'Kits', 22_000_000, 15_000_000),
  metricsRow('21613067518', 'Branded', 15_000_000, 5_000_000),
];

// Roster query returns every non-removed campaign, including the
// zero-traffic '333' (load-bearing) and the PAUSED '555'; '666' is REMOVED
// and must never surface.
const ROSTER_RESULTS = [
  rosterRow('111', 'Location', 'ENABLED', 30_000_000),
  rosterRow('222', 'Kits', 'ENABLED', 22_000_000),
  rosterRow('21613067518', 'Branded', 'ENABLED', 15_000_000),
  rosterRow('333', 'Pole Barns', 'ENABLED', 6_000_000),
  rosterRow('555', 'SaleTest', 'PAUSED', 12_000_000),
  rosterRow('666', 'Old', 'REMOVED', 9_000_000),
];

function queueHappyPath({ metrics = METRICS_RESULTS, roster = ROSTER_RESULTS } = {}) {
  mockFetch
    .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) })
    .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ results: metrics }) })
    .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ results: roster }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_ADS_CLIENT_ID       = 'test-client-id';
  process.env.GOOGLE_ADS_CLIENT_SECRET   = 'test-secret';
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
});

describe('fetchGoogleAdsData — roster merge (SESSION-07a)', () => {
  it('G1: includes every enabled campaign, including the zero-impression one', async () => {
    queueHappyPath();
    const result = await fetchGoogleAdsData(ACCOUNT, CONNECTION);

    const ids = result.campaigns.map((c) => String(c.id));
    expect(ids).toEqual(expect.arrayContaining(['111', '222', '21613067518', '333']));

    const poleBarns = result.campaigns.find((c) => String(c.id) === '333');
    expect(poleBarns).toMatchObject({
      spend:        '0.00',
      clicks:       0,
      daily_budget: '6.00',
      status:       'ENABLED',
    });
    expect(poleBarns.budget_id).toBeTruthy();
  });

  it('G2: PAUSED campaigns stay visible; REMOVED campaigns never surface', async () => {
    queueHappyPath();
    const result = await fetchGoogleAdsData(ACCOUNT, CONNECTION);

    const paused = result.campaigns.find((c) => String(c.id) === '555');
    expect(paused).toMatchObject({ status: 'PAUSED', daily_budget: '12.00' });

    expect(result.campaigns.some((c) => String(c.id) === '666')).toBe(false);
  });

  it('G3: no duplicates — campaigns present in both queries appear exactly once', async () => {
    queueHappyPath();
    const result = await fetchGoogleAdsData(ACCOUNT, CONNECTION);
    expect(result.campaigns).toHaveLength(5);
  });

  it('G4: totalDailyBudget sums ENABLED campaigns only — $73 (30+22+15+6), excluding paused $12 and removed $9', async () => {
    queueHappyPath();
    const result = await fetchGoogleAdsData(ACCOUNT, CONNECTION);
    expect(result.summary.totalDailyBudget).toBe('73.00');
  });

  it('G5: metrics are preserved (not zeroed) for campaigns merged from the metrics query', async () => {
    queueHappyPath();
    const result = await fetchGoogleAdsData(ACCOUNT, CONNECTION);
    const location = result.campaigns.find((c) => String(c.id) === '111');
    expect(location.spend).toBe('20.00');
  });

  it('G6: query text pins — metrics query is date-segmented and LIMIT-bounded; roster query is neither', async () => {
    queueHappyPath();
    await fetchGoogleAdsData(ACCOUNT, CONNECTION);

    const metricsBody = mockFetch.mock.calls[1][1].body;
    expect(metricsBody).toContain('LIMIT 100');
    expect(metricsBody).toContain("campaign.status != 'REMOVED'");

    const rosterBody = mockFetch.mock.calls[2][1].body;
    expect(rosterBody).toContain("campaign.status != 'REMOVED'");
    expect(rosterBody).not.toContain('segments.date');
    expect(rosterBody).not.toContain('LIMIT');
  });

  it('G7: roster failure fails closed — success:false, campaigns []', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ results: METRICS_RESULTS }) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'INTERNAL' });

    const result = await fetchGoogleAdsData(ACCOUNT, CONNECTION);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/roster/i);
    expect(result.campaigns).toEqual([]);
  });

  it('G8: roster JSON parse failure fails closed — success:false', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ results: METRICS_RESULTS }) })
      .mockResolvedValueOnce({ ok: true, text: async () => 'not valid json{' });

    const result = await fetchGoogleAdsData(ACCOUNT, CONNECTION);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/roster/i);
    expect(result.campaigns).toEqual([]);
  });

  it('G9: token failure fails closed (existing behavior, pinned)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await fetchGoogleAdsData(ACCOUNT, CONNECTION);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/access token/i);
    expect(result.campaigns).toEqual([]);
  });

  it('G10: records both API calls — campaigns_search and campaigns_roster', async () => {
    queueHappyPath();
    await fetchGoogleAdsData(ACCOUNT, CONNECTION);

    expect(mockRecordApiCall).toHaveBeenCalledWith('google_ads', 'campaigns_search', ACCOUNT.id);
    expect(mockRecordApiCall).toHaveBeenCalledWith('google_ads', 'campaigns_roster', ACCOUNT.id);
  });
});

// ============================================================================
// fetchSearchTerms — SESSION-07b
// ============================================================================

function searchTermRow(searchTerm, campaignId, campaignName, clicks, costMicros, conversions) {
  return {
    searchTermView: { searchTerm },
    campaign: { id: campaignId, name: campaignName },
    metrics: {
      clicks:      String(clicks),
      costMicros:  String(costMicros),
      conversions,
    },
  };
}

function queueSearchTermsHappyPath(results) {
  mockFetch
    .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) })
    .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ results }) });
}

describe('fetchSearchTerms (SESSION-07b)', () => {
  it('ST1: query text pins — FROM search_term_view and segments.date BETWEEN', async () => {
    queueSearchTermsHappyPath([
      searchTermRow('shed builder', '111', 'Location', 5, 10_000_000, 0),
    ]);
    await fetchSearchTerms(ACCOUNT, CONNECTION);

    const body = mockFetch.mock.calls[1][1].body;
    expect(body).toContain('FROM search_term_view');
    expect(body).toContain('segments.date BETWEEN');
  });

  it('ST2: waste ranking — topWaste contains only zero-conversion rows, sorted by cost descending', async () => {
    queueSearchTermsHappyPath([
      searchTermRow('pole barn kits florida', '111', 'Location', 20, 5_000_000, 3),   // converted, excluded
      searchTermRow('free shed plans', '111', 'Location', 15, 30_000_000, 0),         // waste, $30
      searchTermRow('metal building contractor', '111', 'Location', 10, 45_000_000, 0), // waste, $45 — highest
      searchTermRow('storage building', '111', 'Location', 8, 12_000_000, 0),         // waste, $12
    ]);
    const result = await fetchSearchTerms(ACCOUNT, CONNECTION);

    expect(result.success).toBe(true);
    expect(result.wasteSummary.topWaste).toHaveLength(3);
    expect(result.wasteSummary.topWaste.map(r => r.searchTerm)).toEqual([
      'metal building contractor',
      'free shed plans',
      'storage building',
    ]);
    expect(result.wasteSummary.totalWastedSpend).toBe('87.00'); // 45 + 30 + 12
  });

  it('ST3: campaignId filter — query text includes campaign.id = <id> when passed', async () => {
    queueSearchTermsHappyPath([
      searchTermRow('shed builder', '111', 'Location', 5, 10_000_000, 0),
    ]);
    await fetchSearchTerms(ACCOUNT, CONNECTION, { campaignId: '111' });

    const body = mockFetch.mock.calls[1][1].body;
    expect(body).toContain('campaign.id = 111');
  });

  it('ST4: records cost ledger call with search_terms', async () => {
    queueSearchTermsHappyPath([
      searchTermRow('shed builder', '111', 'Location', 5, 10_000_000, 0),
    ]);
    await fetchSearchTerms(ACCOUNT, CONNECTION);

    expect(mockRecordApiCall).toHaveBeenCalledWith('google_ads', 'search_terms', ACCOUNT.id);
  });

  it('ST5: non-ok API response fails closed — success:false, searchTerms: []', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'INTERNAL' });

    const result = await fetchSearchTerms(ACCOUNT, CONNECTION);
    expect(result.success).toBe(false);
    expect(result.searchTerms).toEqual([]);
  });
});
