// ============================================================
// tests/account-budget.test.js
// Tests for /api/account-budget — Stage B2's per-account MTD spend
// rollup endpoint.
//
// Scope:
//   • Default-FPB resolution when no account header / param
//   • Explicit ?account=fpb scopes the campaign_daily_stats SELECT
//   • Unknown slug → 400 INVALID_ACCOUNT (via resolveForRead)
//   • Archived account → still readable (reads allowed per B1 policy)
//   • POST → 405 METHOD_NOT_ALLOWED (no DB call attempted)
//   • Aggregation correctness — 5 rows across 2 platforms produce the
//     right per-platform sums and grand total
//
// Supabase and accounts.js are mocked. No real network.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Per-(table, op) response overrides ───────────────────────────────────────
const responses = {};
function setResponse(key, value) { responses[key] = value; }

// ── Capture buckets so tests can assert what was queried ─────────────────────
const eqCallsByTable  = {};
const gteCallsByTable = {};
const lteCallsByTable = {};

function makeChain(table) {
  let primaryOp = null;
  function setOnce(op) { if (primaryOp === null) primaryOp = op; }

  const chain = {
    select: () => { setOnce('select'); return chain; },
    eq:     (col, val) => {
      (eqCallsByTable[table] = eqCallsByTable[table] || []).push([col, val]);
      return chain;
    },
    gte:    (col, val) => {
      (gteCallsByTable[table] = gteCallsByTable[table] || []).push([col, val]);
      return chain;
    },
    lte:    (col, val) => {
      (lteCallsByTable[table] = lteCallsByTable[table] || []).push([col, val]);
      return chain;
    },
    lt:     () => chain,
    order:  () => chain,
    limit:  () => chain,
    single: async () => responses[`${table}.${primaryOp}.single`] ?? { data: null, error: null },
    then:   (resolve) => {
      const key = `${table}.${primaryOp}`;
      const fallback = primaryOp === 'select' ? { data: [], error: null } : { data: null, error: null };
      return resolve(responses[key] ?? fallback);
    },
  };
  return chain;
}

vi.mock('../api/lib/supabase.js', () => ({
  default: { from: (table) => makeChain(table) },
}));

// ── Accounts mock — uses mockAccount per test, mirrors resolveForRead body ───
let mockAccount = null;

vi.mock('../api/lib/accounts.js', () => {
  const getAccountSlugFromRequest = (req) =>
    req?.query?.account || req?.headers?.['x-account-slug'] || 'fpb';
  const getAccountBySlug = async (slug) =>
    (mockAccount?.slug === slug ? mockAccount : null);
  return {
    FPB_DEFAULT_SLUG: 'fpb',
    getAccountSlugFromRequest,
    getAccountBySlug,
    resolveForRead: async (req, res) => {
      const slug = getAccountSlugFromRequest(req);
      const account = await getAccountBySlug(slug);
      if (!account) {
        res.status(400).json({
          success: false,
          error:   `Account slug not found: ${slug}`,
          code:    'INVALID_ACCOUNT',
        });
        return null;
      }
      return account;
    },
  };
});

// Import AFTER mocks
import handler from '../api/account-budget.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const FPB_ACCOUNT = {
  id: 'fpb-uuid',
  slug: 'fpb',
  status: 'active',
  name: 'Florida Pole Barn',
  monthly_budget: 4000,
  monthly_spend_cap: 5000,
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeReq(overrides = {}) {
  return {
    method:  'GET',
    url:     '/api/account-budget',
    headers: {},
    query:   {},
    body:    {},
    ...overrides,
  };
}

function makeRes() {
  return {
    _statusCode: 200,
    _body:       null,
    status:    function(code) { this._statusCode = code; return this; },
    json:      function(body) { this._body = body; return this; },
    setHeader: () => {},
    end:       () => {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(responses))      delete responses[k];
  for (const k of Object.keys(eqCallsByTable)) delete eqCallsByTable[k];
  for (const k of Object.keys(gteCallsByTable)) delete gteCallsByTable[k];
  for (const k of Object.keys(lteCallsByTable)) delete lteCallsByTable[k];
  mockAccount = FPB_ACCOUNT;
});

// ============================================================================
// Account resolution
// ============================================================================

describe('account-budget — account resolution', () => {

  it('GET with no account header defaults to FPB and returns budget data', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.data.account_slug).toBe('fpb');
    expect(res._body.data.account_name).toBe('Florida Pole Barn');
    expect(res._body.data.monthly_budget).toBe(4000);
    expect(res._body.data.monthly_spend_cap).toBe(5000);
    // SELECT was scoped to FPB.id
    expect(eqCallsByTable['campaign_daily_stats']).toContainEqual(['account_id', 'fpb-uuid']);
  });

  it('GET ?account=fpb scopes the campaign_daily_stats SELECT to FPB.id', async () => {
    const req = makeReq({ query: { account: 'fpb' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(eqCallsByTable['campaign_daily_stats']).toContainEqual(['account_id', 'fpb-uuid']);
  });

  it('GET ?account=nonexistent returns 400 INVALID_ACCOUNT and does NOT query campaign_daily_stats', async () => {
    mockAccount = null; // any slug → not found
    const req = makeReq({ query: { account: 'nonexistent' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(400);
    expect(res._body.code).toBe('INVALID_ACCOUNT');
    expect(eqCallsByTable['campaign_daily_stats']).toBeUndefined();
  });

  it('GET for an archived account still returns budget data (reads allowed)', async () => {
    mockAccount = { ...FPB_ACCOUNT, slug: 'oldco', id: 'oldco-uuid', status: 'archived', name: 'Old Co' };
    const req = makeReq({ query: { account: 'oldco' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.data.account_slug).toBe('oldco');
    expect(eqCallsByTable['campaign_daily_stats']).toContainEqual(['account_id', 'oldco-uuid']);
  });

});

// ============================================================================
// Method gating
// ============================================================================

describe('account-budget — method gating', () => {

  it('POST returns 405 METHOD_NOT_ALLOWED and does NOT query the DB', async () => {
    const req = makeReq({ method: 'POST' });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(405);
    expect(res._body.code).toBe('METHOD_NOT_ALLOWED');
    expect(eqCallsByTable['campaign_daily_stats']).toBeUndefined();
  });

});

// ============================================================================
// MTD aggregation
// ============================================================================

describe('account-budget — MTD aggregation', () => {

  it('aggregates 5 rows across 2 platforms into per-platform sums and grand total', async () => {
    // Mock 5 daily-stats rows: 3 google, 2 meta. Mix of clean numbers and a
    // null-spend row that must contribute 0.
    setResponse('campaign_daily_stats.select', {
      data: [
        { platform: 'google_ads', spend: '100.50' },
        { platform: 'google_ads', spend: 75 },
        { platform: 'google_ads', spend: null },     // skipped (null → not finite)
        { platform: 'meta_ads',   spend: '200.25' },
        { platform: 'meta_ads',   spend: '50' },
      ],
      error: null,
    });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);

    // Per-platform sums: google = 100.50 + 75 = 175.50; meta = 200.25 + 50 = 250.25
    expect(res._body.data.mtd_spend_by_platform).toEqual({
      google_ads: 175.50,
      meta_ads:   250.25,
    });

    // Grand total: 175.50 + 250.25 = 425.75
    expect(res._body.data.mtd_spend_total).toBeCloseTo(425.75, 2);

    // Date window: first of current month (UTC) to today (UTC)
    const now = new Date();
    const expectedStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      .toISOString().slice(0, 10);
    const expectedEnd = now.toISOString().slice(0, 10);
    expect(res._body.data.period_start).toBe(expectedStart);
    expect(res._body.data.period_end).toBe(expectedEnd);

    // Sanity check: query also constrained the date range on the DB side
    expect(gteCallsByTable['campaign_daily_stats']).toContainEqual(['date', expectedStart]);
    expect(lteCallsByTable['campaign_daily_stats']).toContainEqual(['date', expectedEnd]);
  });

  it('returns zero total and empty by_platform when no rows exist for the month', async () => {
    setResponse('campaign_daily_stats.select', { data: [], error: null });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.data.mtd_spend_total).toBe(0);
    expect(res._body.data.mtd_spend_by_platform).toEqual({});
  });

  it('returns 500 BUDGET_FETCH_FAILED when supabase returns an error', async () => {
    setResponse('campaign_daily_stats.select', {
      data: null,
      error: { message: 'connection terminated' },
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(500);
    expect(res._body.code).toBe('BUDGET_FETCH_FAILED');
    expect(res._body.error).toMatch(/connection terminated/);
    errSpy.mockRestore();
  });

});
