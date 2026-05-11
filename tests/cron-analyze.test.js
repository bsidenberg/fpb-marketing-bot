// ============================================================
// tests/cron-analyze.test.js
// Tests for the cron-analyze handler under both single-account and
// multi-account modes. runAnalysisForAccount is mocked so we can
// observe which accounts the cron called it for.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted because vi.mock factory inserts mockRunAnalysis directly
const { mockRunAnalysis } = vi.hoisted(() => ({
  mockRunAnalysis: vi.fn(),
}));

vi.mock('../api/analyze-ads.js', () => ({
  runAnalysisForAccount: mockRunAnalysis,
}));

// Accounts mock — controlled by `let` variables that the factory closes over
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

// Supabase chain mock — captures inserts to automation_log
const insertsByTable = {};
function makeChain(table) {
  return {
    insert: (row) => {
      (insertsByTable[table] = insertsByTable[table] || []).push(row);
      return makeChain(table);
    },
    select: () => makeChain(table),
    eq:     () => makeChain(table),
    update: () => makeChain(table),
    upsert: () => makeChain(table),
    single: async () => ({ data: null, error: null }),
    then:   (resolve) => resolve({ data: null, error: null }),
  };
}

vi.mock('../api/lib/supabase.js', () => ({
  default: { from: (table) => makeChain(table) },
}));

import handler from '../api/cron-analyze.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const FPB  = { id: 'fpb-uuid',  slug: 'fpb',  status: 'active' };
const WELD = { id: 'weld-uuid', slug: 'weld', status: 'active' };
const VALID_GOOGLE = { resolved_account_id_external: '123', resolved_refresh_token: 'g' };
const VALID_META   = { resolved_access_token: 'm', resolved_account_id_external: '789' };

function makeReq(overrides = {}) {
  return {
    method:  'GET',
    url:     '/api/cron-analyze',
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
  for (const k of Object.keys(insertsByTable)) delete insertsByTable[k];

  mockAccountsList = [];
  mockBySlug      = { fpb: FPB, weld: WELD };
  mockConnections = {
    [`${FPB.id}::google_ads`]:  VALID_GOOGLE,
    [`${FPB.id}::meta_ads`]:    VALID_META,
    [`${WELD.id}::google_ads`]: VALID_GOOGLE,
    [`${WELD.id}::meta_ads`]:   VALID_META,
  };
  mockRunAnalysis.mockResolvedValue({
    success:         true,
    analyzed:        ['google_ads', 'meta_ads'],
    actions_created: 5,
  });

  delete process.env.ENABLE_MULTI_ACCOUNT_CRON;
});

// ── Auth ─────────────────────────────────────────────────────────────────────

describe('cron-analyze — auth', () => {
  it('returns 401 without x-vercel-cron header and without CRON_SECRET match', async () => {
    const req = makeReq({ headers: {} });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(401);
    expect(mockRunAnalysis).not.toHaveBeenCalled();
  });

  it('accepts Authorization: Bearer CRON_SECRET as alternate auth', async () => {
    process.env.CRON_SECRET = 'topsecret';
    const req = makeReq({ headers: { authorization: 'Bearer topsecret', host: 'test.local' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    delete process.env.CRON_SECRET;
  });
});

// ── Feature flag gating ──────────────────────────────────────────────────────

describe('cron-analyze — ENABLE_MULTI_ACCOUNT_CRON feature flag', () => {
  it('with flag unset (default), processes only FPB even when other accounts are active', async () => {
    mockAccountsList = [FPB, WELD]; // listActiveAccounts would return both
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.multi_account).toBe(false);
    expect(mockRunAnalysis).toHaveBeenCalledTimes(1);
    expect(mockRunAnalysis).toHaveBeenCalledWith(FPB, expect.objectContaining({ triggeredBy: 'cron' }));
  });

  it('with flag = true, loops over every active account', async () => {
    process.env.ENABLE_MULTI_ACCOUNT_CRON = 'true';
    mockAccountsList = [FPB, WELD];

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._body.multi_account).toBe(true);
    expect(mockRunAnalysis).toHaveBeenCalledTimes(2);
    expect(mockRunAnalysis).toHaveBeenCalledWith(FPB,  expect.objectContaining({ triggeredBy: 'cron' }));
    expect(mockRunAnalysis).toHaveBeenCalledWith(WELD, expect.objectContaining({ triggeredBy: 'cron' }));
  });
});

// ── Connection skip ──────────────────────────────────────────────────────────

describe('cron-analyze — connection skip', () => {
  it('skips an account missing google_ads connection (warn, no analysis call)', async () => {
    process.env.ENABLE_MULTI_ACCOUNT_CRON = 'true';
    mockAccountsList = [FPB, WELD];
    delete mockConnections[`${WELD.id}::google_ads`];

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(mockRunAnalysis).toHaveBeenCalledTimes(1);
    expect(mockRunAnalysis).toHaveBeenCalledWith(FPB, expect.any(Object));

    const weldResult = res._body.results.find(r => r.account === 'weld');
    expect(weldResult).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/google_ads/) });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/account=weld skipped/));
    warnSpy.mockRestore();
  });

  it('skips an account missing meta_ads connection (warn, no analysis call)', async () => {
    process.env.ENABLE_MULTI_ACCOUNT_CRON = 'true';
    mockAccountsList = [FPB, WELD];
    delete mockConnections[`${WELD.id}::meta_ads`];

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(mockRunAnalysis).toHaveBeenCalledTimes(1);
    const weldResult = res._body.results.find(r => r.account === 'weld');
    expect(weldResult).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/meta_ads/) });
  });
});

// ── Per-account error isolation ──────────────────────────────────────────────

describe('cron-analyze — per-account error isolation', () => {
  it('one account failing does not prevent others from being processed', async () => {
    process.env.ENABLE_MULTI_ACCOUNT_CRON = 'true';
    mockAccountsList = [FPB, WELD];

    mockRunAnalysis.mockImplementation(async (account) => {
      if (account.slug === 'fpb') throw new Error('FPB analysis blew up');
      return { success: true, analyzed: ['google_ads', 'meta_ads'], actions_created: 1 };
    });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    // Both accounts were attempted
    expect(mockRunAnalysis).toHaveBeenCalledTimes(2);

    const fpbResult  = res._body.results.find(r => r.account === 'fpb');
    const weldResult = res._body.results.find(r => r.account === 'weld');

    expect(fpbResult).toMatchObject({ status: 'failed', error: 'FPB analysis blew up' });
    expect(weldResult.success).toBe(true);
    expect(weldResult.actions_created).toBe(1);

    // Aggregate automation_log row reflects both
    expect(insertsByTable['automation_log']).toHaveLength(1);
    expect(insertsByTable['automation_log'][0].status).toBe('error');
    expect(insertsByTable['automation_log'][0].account_id).toBeUndefined(); // cron-level row spans accounts
  });
});
