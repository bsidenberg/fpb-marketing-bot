// ============================================================
// tests/daily-stats.test.js
// Tests for api/lib/daily-stats.js (pure helpers + Google fetch/upsert)
// and api/cron-daily-stats.js (the nightly cron handler).
//
// Mock design mirrors tests/cron-analyze.test.js / tests/analyze-ads.test.js:
//   • supabase.js mocked with a table-aware chain that captures upsert/insert
//     calls so assertions can inspect exact args (incl. onConflict).
//   • accounts.js mocked via `let` variables the factory closes over.
//   • api-cost.js's recordApiCall mocked directly (fire-and-forget contract).
//   • fetch stubbed globally, URL-routed (OAuth token vs googleAds:search).
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── recordApiCall mock (vi.hoisted so the mock ref exists before import) ─────
const { mockRecordApiCall } = vi.hoisted(() => ({
  mockRecordApiCall: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../api/lib/api-cost.js', () => ({
  recordApiCall: mockRecordApiCall,
}));

// ── Accounts mock — controlled by `let` variables the factory closes over ───
let mockAccountsList = [];
let mockBySlug      = {};
let mockConnections = {};

vi.mock('../api/lib/accounts.js', () => ({
  FPB_DEFAULT_SLUG: 'fpb',
  listActiveAccounts:      async () => mockAccountsList,
  getAccountBySlug:        async (slug) => mockBySlug[slug] ?? null,
  getConnectionForAccount: async (accountId, platform) =>
    mockConnections[`${accountId}::${platform}`] ?? null,
}));

// ── Supabase mock — captures upsert(campaign_daily_stats) and
//    insert(automation_log) calls; configurable upsert response per test ────
let upsertResponse = { error: null };
const upsertCalls  = [];
const insertsByTable = {};

function makeChain(table) {
  return {
    upsert: (rows, opts) => {
      if (table === 'campaign_daily_stats') {
        upsertCalls.push({ table, rows, opts });
        return Promise.resolve(upsertResponse);
      }
      return Promise.resolve({ data: null, error: null });
    },
    insert: (row) => {
      (insertsByTable[table] = insertsByTable[table] || []).push(row);
      return Promise.resolve({ data: null, error: null });
    },
    select: () => makeChain(table),
    eq:     () => makeChain(table),
  };
}

vi.mock('../api/lib/supabase.js', () => ({
  default: { from: (table) => makeChain(table) },
}));

// Import AFTER all mocks
import {
  computeDateRange,
  mapRowsToDailyStats,
  upsertDailyStats,
  fetchGoogleDailyStats,
} from '../api/lib/daily-stats.js';
import handler from '../api/cron-daily-stats.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const FPB  = { id: 'fpb-uuid',  slug: 'fpb',  status: 'active' };
const WELD = { id: 'weld-uuid', slug: 'weld', status: 'active' };

const GOOGLE_CONN_FPB = {
  resolved_account_id_external: '111-111-1111',
  resolved_refresh_token:       'fpb-refresh',
};
const GOOGLE_CONN_WELD = {
  resolved_account_id_external: '222-222-2222',
  resolved_refresh_token:       'weld-refresh',
};

// 2 campaigns x 3 dates = 6 rows, realistic camelCase googleAds:search shape
function fixtureResults() {
  const campaigns = [
    { id: '111', name: 'Campaign A' },
    { id: '222', name: 'Campaign B' },
  ];
  const dates = ['2026-06-29', '2026-06-30', '2026-07-01'];
  const rows = [];
  for (const c of campaigns) {
    for (const d of dates) {
      rows.push({
        campaign:  { id: c.id, name: c.name, status: 'ENABLED' },
        segments:  { date: d },
        metrics: {
          costMicros:  12345678,
          impressions: 1000,
          clicks:      50,
          conversions: 2.5,
          ctr:         0.05,
          averageCpc:  246913,
        },
      });
    }
  }
  return rows;
}

function defaultFetchHandler(url, options) {
  if (typeof url === 'string' && url.includes('oauth2.googleapis.com/token')) {
    const params = options?.body;
    const refreshToken = params?.get ? params.get('refresh_token') : null;
    if (refreshToken === 'fpb-refresh-broken') {
      return Promise.resolve({ ok: true, json: async () => ({ error: 'invalid_grant' }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ access_token: 'test-access-token' }) });
  }
  if (typeof url === 'string' && url.includes('googleAds:search')) {
    return Promise.resolve({ ok: true, text: async () => JSON.stringify({ results: fixtureResults() }) });
  }
  return Promise.resolve({ ok: true, json: async () => ({}) });
}

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeReq(overrides = {}) {
  return {
    method:  'GET',
    url:     '/api/cron-daily-stats',
    headers: { 'x-vercel-cron': '1', host: 'test.local' },
    query:   {},
    body:    {},
    ...overrides,
  };
}

function makeRes() {
  return {
    _statusCode: 200,
    _body:       null,
    status:    function(c) { this._statusCode = c; return this; },
    json:      function(b) { this._body = b; return this; },
    setHeader: () => {},
    end:       () => {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  upsertResponse = { error: null };
  upsertCalls.length = 0;
  for (const k of Object.keys(insertsByTable)) delete insertsByTable[k];

  mockAccountsList = [];
  mockBySlug      = { fpb: FPB, weld: WELD };
  mockConnections = {
    [`${FPB.id}::google_ads`]:  GOOGLE_CONN_FPB,
    [`${WELD.id}::google_ads`]: GOOGLE_CONN_WELD,
  };

  mockFetch.mockImplementation(defaultFetchHandler);
  mockRecordApiCall.mockResolvedValue(undefined);

  delete process.env.ENABLE_MULTI_ACCOUNT_CRON;
  delete process.env.CRON_SECRET;
});

// ============================================================================
// computeDateRange
// ============================================================================

describe('computeDateRange', () => {
  it('returns startDate = now-3d, endDate = now-1d as YYYY-MM-DD UTC strings', () => {
    const now = new Date('2026-07-02T11:45:00Z');
    const { startDate, endDate } = computeDateRange(now);
    expect(startDate).toBe('2026-06-29');
    expect(endDate).toBe('2026-07-01');
  });

  it('handles a month/year boundary correctly', () => {
    const now = new Date('2026-01-01T11:45:00Z');
    const { startDate, endDate } = computeDateRange(now);
    expect(startDate).toBe('2025-12-29');
    expect(endDate).toBe('2025-12-31');
  });
});

// ============================================================================
// mapRowsToDailyStats
// ============================================================================

describe('mapRowsToDailyStats', () => {
  it('maps micros to dollars, ctr ratio to percent, cpc conversion, and cpl', () => {
    const rows = mapRowsToDailyStats(fixtureResults(), FPB);
    expect(rows).toHaveLength(6);

    const row = rows[0];
    expect(row.account_id).toBe(FPB.id);
    expect(row.client_key).toBe(FPB.slug);
    expect(row.platform).toBe('google_ads');
    expect(row.campaign_id).toBe('111');
    expect(row.campaign_name).toBe('Campaign A');
    expect(row.date).toBe('2026-06-29');
    expect(row.spend).toBe(12.35);        // 12345678 / 1e6 rounded 2dp
    expect(row.impressions).toBe(1000);
    expect(row.clicks).toBe(50);
    expect(row.conversions).toBe(2.5);
    expect(row.ctr).toBe(5);              // 0.05 * 100
    expect(row.cpc).toBe(0.25);           // 246913 / 1e6 rounded 2dp
    expect(row.cpl).toBe(4.94);           // round2(12.35 / 2.5)
    expect(row.frequency).toBeNull();
    expect(row.raw_payload).toEqual(fixtureResults()[0]);
  });

  it('sets cpl to null when conversions is 0', () => {
    const result = {
      campaign: { id: '999', name: 'Zero Conv' },
      segments: { date: '2026-06-30' },
      metrics: { costMicros: 5000000, impressions: 10, clicks: 1, conversions: 0, ctr: 0.01, averageCpc: 500000 },
    };
    const [row] = mapRowsToDailyStats([result], FPB);
    expect(row.conversions).toBe(0);
    expect(row.cpl).toBeNull();
  });

  it('stringifies campaign_id even when numeric', () => {
    const result = {
      campaign: { id: 42, name: 'Numeric ID' },
      segments: { date: '2026-06-30' },
      metrics: {},
    };
    const [row] = mapRowsToDailyStats([result], FPB);
    expect(row.campaign_id).toBe('42');
    expect(typeof row.campaign_id).toBe('string');
  });

  it('filters out rows missing campaign id', () => {
    const noId = { campaign: { id: '' }, segments: { date: '2026-06-30' }, metrics: {} };
    const rows = mapRowsToDailyStats([noId], FPB);
    expect(rows).toHaveLength(0);
  });

  it('filters out rows missing date', () => {
    const noDate = { campaign: { id: '111' }, segments: {}, metrics: {} };
    const rows = mapRowsToDailyStats([noDate], FPB);
    expect(rows).toHaveLength(0);
  });
});

// ============================================================================
// upsertDailyStats
// ============================================================================

describe('upsertDailyStats', () => {
  it('calls supabase upsert with the exact onConflict key from sql/008', async () => {
    const rows = mapRowsToDailyStats(fixtureResults(), FPB);
    await upsertDailyStats(rows);

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].opts).toEqual({
      onConflict:       'account_id,platform,campaign_id,date',
      ignoreDuplicates: false,
    });
    expect(upsertCalls[0].rows).toEqual(rows);
  });

  it('short-circuits on empty rows without calling supabase', async () => {
    const result = await upsertDailyStats([]);
    expect(result).toEqual({ written: 0, errors: [] });
    expect(upsertCalls).toHaveLength(0);
  });

  it('returns { written: 0, errors: [msg] } on supabase error', async () => {
    upsertResponse = { error: { message: 'constraint violation' } };
    const rows = mapRowsToDailyStats(fixtureResults(), FPB);
    const result = await upsertDailyStats(rows);
    expect(result).toEqual({ written: 0, errors: ['constraint violation'] });
  });

  it('returns { written: rows.length, errors: [] } on success', async () => {
    const rows = mapRowsToDailyStats(fixtureResults(), FPB);
    const result = await upsertDailyStats(rows);
    expect(result).toEqual({ written: rows.length, errors: [] });
  });
});

// ============================================================================
// fetchGoogleDailyStats
// ============================================================================

describe('fetchGoogleDailyStats', () => {
  it('records the api call and returns results on success', async () => {
    const results = await fetchGoogleDailyStats(FPB, GOOGLE_CONN_FPB, {
      startDate: '2026-06-29',
      endDate:   '2026-07-01',
    });
    expect(results).toHaveLength(6);
    expect(mockRecordApiCall).toHaveBeenCalledWith('google_ads', 'daily_stats_search', FPB.id);
  });

  it('throws when OAuth token exchange fails', async () => {
    const brokenConn = { ...GOOGLE_CONN_FPB, resolved_refresh_token: 'fpb-refresh-broken' };
    await expect(
      fetchGoogleDailyStats(FPB, brokenConn, { startDate: '2026-06-29', endDate: '2026-07-01' })
    ).rejects.toThrow(/Failed to get access token/);
  });

  it('throws on a non-ok Google Ads API response', async () => {
    mockFetch.mockImplementation((url, options) => {
      if (typeof url === 'string' && url.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve({ ok: true, json: async () => ({ access_token: 'tok' }) });
      }
      if (typeof url === 'string' && url.includes('googleAds:search')) {
        return Promise.resolve({ ok: false, status: 500, text: async () => 'internal error' });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    await expect(
      fetchGoogleDailyStats(FPB, GOOGLE_CONN_FPB, { startDate: '2026-06-29', endDate: '2026-07-01' })
    ).rejects.toThrow(/Google Ads API error: 500/);
  });
});

// ============================================================================
// cron-daily-stats handler — auth
// ============================================================================

describe('cron-daily-stats — auth', () => {
  it('returns 401 without x-vercel-cron header and without a matching CRON_SECRET', async () => {
    const req = makeReq({ headers: {} });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(401);
    expect(res._body).toEqual({ success: false, error: 'Unauthorized' });
  });

  it('returns 200 with x-vercel-cron: 1', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(200);
  });

  it('returns 200 with Authorization: Bearer matching CRON_SECRET', async () => {
    process.env.CRON_SECRET = 'topsecret';
    const req = makeReq({ headers: { authorization: 'Bearer topsecret', host: 'test.local' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(200);
  });

  it('returns 405 for a non-GET request (e.g. POST) even with valid auth', async () => {
    const req = makeReq({ method: 'POST' });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(405);
    expect(res._body).toEqual({ success: false, error: 'Method not allowed' });
  });
});

// ============================================================================
// cron-daily-stats handler — behavior
// ============================================================================

describe('cron-daily-stats — behavior', () => {
  it('skips an account missing a google_ads connection but still returns 200', async () => {
    delete mockConnections[`${FPB.id}::google_ads`];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    const fpbResult = res._body.results.find(r => r.account === 'fpb');
    expect(fpbResult).toMatchObject({ status: 'skipped', reason: 'no google_ads connection' });
    warnSpy.mockRestore();
  });

  it('successful run upserts mapped rows and includes written count in the result', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    const fpbResult = res._body.results.find(r => r.account === 'fpb');
    expect(fpbResult.status).toBe('ok');
    expect(fpbResult.written).toBe(6);
    expect(upsertCalls).toHaveLength(1);
    expect(mockRecordApiCall).toHaveBeenCalledWith('google_ads', 'daily_stats_search', FPB.id);
  });

  it('isolates per-account failures: first account fails, second still succeeds', async () => {
    process.env.ENABLE_MULTI_ACCOUNT_CRON = 'true';
    mockAccountsList = [FPB, WELD];
    mockConnections = {
      [`${FPB.id}::google_ads`]:  { ...GOOGLE_CONN_FPB, resolved_refresh_token: 'fpb-refresh-broken' },
      [`${WELD.id}::google_ads`]: GOOGLE_CONN_WELD,
    };

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    const fpbResult  = res._body.results.find(r => r.account === 'fpb');
    const weldResult = res._body.results.find(r => r.account === 'weld');

    expect(fpbResult).toMatchObject({ status: 'failed' });
    expect(fpbResult.error).toMatch(/Failed to get access token/);
    expect(weldResult).toMatchObject({ status: 'ok', written: 6 });
  });

  it('logs an aggregate automation_log row with the run results', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(insertsByTable['automation_log']).toHaveLength(1);
    expect(insertsByTable['automation_log'][0]).toMatchObject({
      event_type: 'cron_daily_stats',
      status:     'complete',
    });
    expect(insertsByTable['automation_log'][0].metadata.results).toEqual(res._body.results);
  });
});
