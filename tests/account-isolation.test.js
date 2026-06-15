// ============================================================
// tests/account-isolation.test.js
// Cross-route account isolation tests (Stage B1).
//
// The bedrock invariant: a caller authenticated as account X cannot read,
// modify, approve, or otherwise affect resources belonging to account Y.
// These tests exercise that invariant across the approve-action surface
// where the consequence of a leak would be most damaging (mutating ad
// campaign state belonging to a different tenant).
//
// Scope:
//   • approve-action: caller (Weld) tries to approve an action owned by
//     FPB. Expected: 403 ACCOUNT_MISMATCH, no acquireLockAndExecute call,
//     no DB mutation, no external API call.
//   • approve-action: caller (FPB) approves an action owned by FPB.
//     Expected: delegates to acquireLockAndExecute with the right context.
//
// Cross-cutting isolation tests for leads (GET filter, dedup_key prefix)
// already live in tests/leads-webhook.test.js and tests/lead-ingest.test.js.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Account fixtures ─────────────────────────────────────────────────────────
const FPB  = { id: 'fpb-uuid',  slug: 'fpb',  status: 'active' };
const WELD = { id: 'weld-uuid', slug: 'weld', status: 'active' };

const VALID_GOOGLE_CONN = {
  resolved_account_id_external: '123',
  resolved_manager_account_id:  '456',
  resolved_refresh_token:       'g-refresh',
};
const VALID_META_CONN = {
  resolved_access_token:        'm-token',
  resolved_account_id_external: '789',
};

let mockAccount = FPB; // resolveAccountFromRequest returns this

// Overridable connection resolver — defaults to valid connections per platform.
// Individual tests can replace this to simulate missing or incomplete connections.
let mockConnectionResolver = async (_accountId, platform) => {
  if (platform === 'google_ads') return VALID_GOOGLE_CONN;
  if (platform === 'meta_ads')   return VALID_META_CONN;
  return null;
};

// ── Accounts module mock ─────────────────────────────────────────────────────
// Tests can set `mockResolveError` to make resolveAccountFromRequest throw
// (used for archived/inactive scenarios).
let mockResolveError = null;

vi.mock('../api/lib/accounts.js', () => {
  const getAccountSlugFromRequest = (req) =>
    req?.query?.account || req?.headers?.['x-account-slug'] || 'fpb';
  const getAccountBySlug = async (slug) => {
    if (slug === 'fpb')  return FPB;
    if (slug === 'weld') return WELD;
    return null;
  };
  const resolveAccountFromRequest = async () => {
    if (mockResolveError) throw mockResolveError;
    return mockAccount;
  };
  return {
    FPB_DEFAULT_SLUG: 'fpb',
    resolveAccountFromRequest,
    getAccountSlugFromRequest,
    getAccountBySlug,
    getConnectionForAccount: (...args) => mockConnectionResolver(...args),
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
    resolveForWrite: async (req, res) => {
      let account;
      try {
        account = await resolveAccountFromRequest(req);
      } catch (err) {
        const code = err.statusCode === 400 ? 'INVALID_ACCOUNT' : 'ACCOUNT_ARCHIVED';
        res.status(err.statusCode || 500).json({
          success: false,
          error:   err.message,
          code,
        });
        return null;
      }
      if (account.status === 'inactive') {
        res.status(403).json({
          success: false,
          error:   `Account is inactive: ${account.slug}`,
          code:    'ACCOUNT_INACTIVE',
        });
        return null;
      }
      return account;
    },
    checkConnectionFields: (connection, platform) => {
      if (!connection) return 'no connection row';
      if (platform === 'google_ads') {
        if (!connection.resolved_account_id_external) return 'missing customer ID';
        if (!connection.resolved_refresh_token)       return 'missing refresh token';
      } else if (platform === 'meta_ads') {
        if (!connection.resolved_access_token)        return 'missing access token';
        if (!connection.resolved_account_id_external) return 'missing ad account ID';
      }
      return null;
    },
  };
});

// ── execute-action-logic mock ────────────────────────────────────────────────
// We mock the shared logic so we can assert it was NOT called when ownership
// fails. If approve-action delegates to acquireLockAndExecute despite a
// mismatch, that's a security bug.
//
// vi.hoisted is required here because vi.mock factories are hoisted above
// const declarations — defining mockAcquire as a plain const would hit a TDZ
// error when the mock factory tries to reference it.
const { mockAcquire } = vi.hoisted(() => ({
  mockAcquire: vi.fn(async () => ({
    httpStatus: 200,
    body: { success: true, executed: true, campaign_id: 'camp-mock' },
  })),
}));

vi.mock('../api/lib/execute-action-logic.js', async () => {
  const actual = await vi.importActual('../api/lib/execute-action-logic.js');
  return {
    ...actual,
    acquireLockAndExecute: mockAcquire,
  };
});

// ── Supabase mock ────────────────────────────────────────────────────────────
const singleQueue    = [];
let lastUpdatePatch  = null;
let lastInsertRow    = null;
const eqCallsByTable = {};
const insertsByTable = {};

function makeChain(table) {
  const chain = {
    select: () => chain,
    eq:     (col, val) => {
      (eqCallsByTable[table] = eqCallsByTable[table] || []).push([col, val]);
      return chain;
    },
    in:     () => chain,
    is:     () => chain,
    order:  () => chain,
    limit:  () => chain,
    update: (patch) => { lastUpdatePatch = patch; return chain; },
    insert: (row)   => {
      lastInsertRow = row;
      (insertsByTable[table] = insertsByTable[table] || []).push(row);
      return chain;
    },
    single:      async () => singleQueue.shift() ?? { data: null, error: null },
    maybeSingle: async () => singleQueue.shift() ?? { data: null, error: null },
    then:        (resolve) => resolve({ data: [], error: null }),
  };
  return chain;
}

vi.mock('../api/lib/supabase.js', () => ({
  default: { from: (table) => makeChain(table) },
}));

function eqCallsFor(table) {
  return eqCallsByTable[table] || [];
}

// ── Mock fetch (so any rogue external API call would be observable) ──────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import approveHandler          from '../api/approve-action.js';
import googleAdsHandler        from '../api/google-ads.js';
import facebookAdsHandler      from '../api/facebook-ads.js';
import automationLogHandler    from '../api/automation-log.js';
import performanceSnapshotsHandler from '../api/performance-snapshots.js';
import actionOutcomesHandler   from '../api/action-outcomes.js';
import metaCreativeHandler     from '../api/meta-creative.js';
import createFbCampaignHandler from '../api/create-facebook-campaign.js';
import createGoogleCampaignHandler from '../api/create-google-campaign.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeReq(overrides = {}) {
  return {
    method:  'POST',
    url:     '/api/approve-action',
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

function queueResults(...results) {
  singleQueue.length = 0;
  singleQueue.push(...results);
}

beforeEach(() => {
  vi.clearAllMocks();
  singleQueue.length = 0;
  lastUpdatePatch    = null;
  lastInsertRow      = null;
  for (const k of Object.keys(eqCallsByTable)) delete eqCallsByTable[k];
  for (const k of Object.keys(insertsByTable)) delete insertsByTable[k];
  mockAccount        = FPB;
  mockResolveError   = null;
  mockConnectionResolver = async (_accountId, platform) => {
    if (platform === 'google_ads') return VALID_GOOGLE_CONN;
    if (platform === 'meta_ads')   return VALID_META_CONN;
    return null;
  };

  // Globals used by google-ads OAuth path (kept in env per Sub-Task 7 design)
  process.env.GOOGLE_ADS_CLIENT_ID       = 'test-client-id';
  process.env.GOOGLE_ADS_CLIENT_SECRET   = 'test-secret';
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
  process.env.META_PAGE_ID               = 'page-id-123';
  delete process.env.EXECUTE_SECRET;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('approve-action — account isolation', () => {

  it('cross-route lifecycle: action with account_id=fpb cannot be approved when caller is Weld', async () => {
    // Caller is Weld; action belongs to FPB.
    mockAccount = WELD;
    queueResults({
      data: {
        id:               'fpb-action-1',
        account_id:       FPB.id,
        status:           'pending',
        execution_result: null,
        action_type:      'pause_campaign',
        channel:          'google',
      },
      error: null,
    });

    const req = makeReq({
      headers: { 'x-account-slug': 'weld' },
      body:    { actionId: 'fpb-action-1' },
    });
    const res = makeRes();
    await approveHandler(req, res);

    // 1. Returns 403 ACCOUNT_MISMATCH
    expect(res._statusCode).toBe(403);
    expect(res._body.code).toBe('ACCOUNT_MISMATCH');

    // 2. Did NOT delegate to acquireLockAndExecute
    expect(mockAcquire).not.toHaveBeenCalled();

    // 3. Did NOT mutate the action (no .update() calls reached the supabase chain)
    expect(lastUpdatePatch).toBeNull();

    // 4. Did NOT call any external ad-platform API
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('action owned by FPB approved by FPB caller delegates to acquireLockAndExecute with proper context', async () => {
    mockAccount = FPB;
    queueResults({
      data: {
        id:               'fpb-action-2',
        account_id:       FPB.id,
        status:           'pending',
        execution_result: null,
        action_type:      'pause_campaign',
        channel:          'google',
      },
      error: null,
    });

    const req = makeReq({
      headers: { 'x-account-slug': 'fpb' },
      body:    { actionId: 'fpb-action-2' },
    });
    const res = makeRes();
    await approveHandler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
    expect(mockAcquire).toHaveBeenCalledTimes(1);
    expect(mockAcquire).toHaveBeenCalledWith(
      'fpb-action-2',
      expect.objectContaining({
        account:    expect.objectContaining({ id: FPB.id, slug: 'fpb' }),
        connection: expect.objectContaining({ resolved_refresh_token: 'g-refresh' }),
      }),
    );
  });

  it('manual action types skip connection resolution but still verify ownership', async () => {
    mockAccount = WELD;
    queueResults({
      data: {
        id:               'fpb-manual',
        account_id:       FPB.id,            // owned by FPB
        status:           'pending',
        execution_result: null,
        action_type:      'adjust_budget',   // manual type — would skip connection if owned
        channel:          'google',
      },
      error: null,
    });

    const req = makeReq({
      headers: { 'x-account-slug': 'weld' },
      body:    { actionId: 'fpb-manual' },
    });
    const res = makeRes();
    await approveHandler(req, res);

    // Ownership check still wins over the manual-type fast path
    expect(res._statusCode).toBe(403);
    expect(res._body.code).toBe('ACCOUNT_MISMATCH');
    expect(mockAcquire).not.toHaveBeenCalled();
  });

});

// ── google-ads handler — account scoping ────────────────────────────────────

describe('google-ads handler — account scoping', () => {

  it('GET with no account header defaults to FPB and uses the FPB google_ads connection', async () => {
    mockAccount = FPB;
    // 1st fetch: OAuth token exchange. 2nd fetch: Google Ads search.
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'oauth-token' }) })
      .mockResolvedValueOnce({ ok: true, text: async () => '{"results":[]}' });

    const req = { method: 'GET', headers: {}, query: {}, url: '/api/google-ads' };
    const res = makeRes();
    await googleAdsHandler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain('oauth2.googleapis.com');
    expect(mockFetch.mock.calls[1][0]).toContain('googleads.googleapis.com');
    // OAuth body uses the connection's resolved refresh token, not env
    const oauthBody = mockFetch.mock.calls[0][1].body.toString();
    expect(oauthBody).toContain('refresh_token=g-refresh');
  });

  it('GET ?account=weld with no Weld google_ads connection returns 404 CONNECTION_NOT_FOUND', async () => {
    mockAccount = WELD;
    mockConnectionResolver = async () => null; // simulate row missing for this account+platform

    const req = { method: 'GET', headers: { 'x-account-slug': 'weld' }, query: {}, url: '/api/google-ads' };
    const res = makeRes();
    await googleAdsHandler(req, res);

    expect(res._statusCode).toBe(404);
    expect(res._body.code).toBe('CONNECTION_NOT_FOUND');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('GET with connection missing resolved_refresh_token returns 503 CONNECTION_INCOMPLETE', async () => {
    mockAccount = FPB;
    mockConnectionResolver = async (_id, platform) =>
      platform === 'google_ads'
        ? { resolved_account_id_external: '123', resolved_manager_account_id: '456', resolved_refresh_token: null }
        : null;

    const req = { method: 'GET', headers: {}, query: {}, url: '/api/google-ads' };
    const res = makeRes();
    await googleAdsHandler(req, res);

    expect(res._statusCode).toBe(503);
    expect(res._body.code).toBe('CONNECTION_INCOMPLETE');
    expect(res._body.error).toMatch(/refresh token/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

});

// ── facebook-ads handler — account scoping ──────────────────────────────────

describe('facebook-ads handler — account scoping', () => {

  it('GET with no account header defaults to FPB and uses the FPB meta_ads connection', async () => {
    mockAccount = FPB;
    // 1st fetch: insights. 2nd fetch: campaigns.
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ spend: '0', clicks: 0, impressions: 0 }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });

    const req = { method: 'GET', headers: {}, query: {}, url: '/api/facebook-ads' };
    const res = makeRes();
    await facebookAdsHandler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Both URLs use the connection's resolved access token + ad account ID
    expect(mockFetch.mock.calls[0][0]).toContain('access_token=m-token');
    expect(mockFetch.mock.calls[0][0]).toContain('act_789/insights');
    expect(mockFetch.mock.calls[1][0]).toContain('act_789/campaigns');
  });

  it('GET ?account=weld with no Weld meta_ads connection returns 404 CONNECTION_NOT_FOUND', async () => {
    mockAccount = WELD;
    mockConnectionResolver = async () => null;

    const req = { method: 'GET', headers: { 'x-account-slug': 'weld' }, query: {}, url: '/api/facebook-ads' };
    const res = makeRes();
    await facebookAdsHandler(req, res);

    expect(res._statusCode).toBe(404);
    expect(res._body.code).toBe('CONNECTION_NOT_FOUND');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('GET with connection missing resolved_access_token returns 503 CONNECTION_INCOMPLETE', async () => {
    mockAccount = FPB;
    mockConnectionResolver = async (_id, platform) =>
      platform === 'meta_ads'
        ? { resolved_access_token: null, resolved_account_id_external: '789' }
        : null;

    const req = { method: 'GET', headers: {}, query: {}, url: '/api/facebook-ads' };
    const res = makeRes();
    await facebookAdsHandler(req, res);

    expect(res._statusCode).toBe(503);
    expect(res._body.code).toBe('CONNECTION_INCOMPLETE');
    expect(res._body.error).toMatch(/access token/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

});

// ============================================================================
// Read-only routes: automation-log, performance-snapshots, action-outcomes
// ----------------------------------------------------------------------------
// All three filter their SELECT by account_id. Tests verify that:
//   1) no account header defaults to FPB and scopes the SELECT to FPB.id
//   2) ?account=weld scopes the SELECT to Weld.id
// Tests use eqCallsFor(table) to inspect the .eq(col, val) chain calls.
// ============================================================================

describe('automation-log handler — account scoping', () => {

  it('GET with no account header scopes SELECT to FPB.id', async () => {
    mockAccount = FPB;
    const req = { method: 'GET', headers: {}, query: {}, url: '/api/automation-log' };
    const res = makeRes();
    await automationLogHandler(req, res);

    expect(res._statusCode).toBe(200);
    expect(eqCallsFor('automation_log')).toContainEqual(['account_id', FPB.id]);
  });

  it('GET ?account=weld scopes SELECT to Weld.id', async () => {
    mockAccount = WELD;
    const req = { method: 'GET', headers: { 'x-account-slug': 'weld' }, query: {}, url: '/api/automation-log' };
    const res = makeRes();
    await automationLogHandler(req, res);

    expect(res._statusCode).toBe(200);
    const calls = eqCallsFor('automation_log');
    expect(calls).toContainEqual(['account_id', WELD.id]);
    expect(calls).not.toContainEqual(['account_id', FPB.id]);
  });

  it('GET with unknown slug returns 400 INVALID_ACCOUNT', async () => {
    const req = { method: 'GET', headers: { 'x-account-slug': 'nonexistent' }, query: {}, url: '/api/automation-log' };
    const res = makeRes();
    await automationLogHandler(req, res);

    expect(res._statusCode).toBe(400);
    expect(res._body.code).toBe('INVALID_ACCOUNT');
    expect(eqCallsFor('automation_log')).toHaveLength(0);
  });

});

describe('performance-snapshots handler — account scoping', () => {

  it('GET with no account header scopes SELECT to FPB.id', async () => {
    mockAccount = FPB;
    // Simulate "no rows yet" — supabase returns PGRST116 from .single().
    // Route handles this as 200 with data: null. We only care that the
    // SELECT was scoped to FPB.id.
    queueResults({ data: null, error: { code: 'PGRST116', message: 'no rows' } });

    const req = { method: 'GET', headers: {}, query: {}, url: '/api/performance-snapshots' };
    const res = makeRes();
    await performanceSnapshotsHandler(req, res);

    expect(res._statusCode).toBe(200);
    expect(eqCallsFor('performance_snapshots')).toContainEqual(['account_id', FPB.id]);
  });

  it('GET ?account=weld&history=true scopes SELECT to Weld.id', async () => {
    mockAccount = WELD;
    const req = {
      method:  'GET',
      headers: { 'x-account-slug': 'weld' },
      query:   { history: 'true' },
      url:     '/api/performance-snapshots',
    };
    const res = makeRes();
    await performanceSnapshotsHandler(req, res);

    expect(res._statusCode).toBe(200);
    const calls = eqCallsFor('performance_snapshots');
    expect(calls).toContainEqual(['account_id', WELD.id]);
    expect(calls).not.toContainEqual(['account_id', FPB.id]);
  });

});

describe('action-outcomes handler — account scoping', () => {

  it('GET with no account header scopes SELECT to FPB.id', async () => {
    mockAccount = FPB;
    const req = { method: 'GET', headers: {}, query: {}, url: '/api/action-outcomes' };
    const res = makeRes();
    await actionOutcomesHandler(req, res);

    expect(res._statusCode).toBe(200);
    expect(eqCallsFor('action_outcomes')).toContainEqual(['account_id', FPB.id]);
  });

  it('GET ?account=weld scopes SELECT to Weld.id', async () => {
    mockAccount = WELD;
    const req = { method: 'GET', headers: { 'x-account-slug': 'weld' }, query: {}, url: '/api/action-outcomes' };
    const res = makeRes();
    await actionOutcomesHandler(req, res);

    expect(res._statusCode).toBe(200);
    const calls = eqCallsFor('action_outcomes');
    expect(calls).toContainEqual(['account_id', WELD.id]);
    expect(calls).not.toContainEqual(['account_id', FPB.id]);
  });

});

// ============================================================================
// Write routes: meta-creative, create-facebook-campaign, create-google-campaign
// ----------------------------------------------------------------------------
// All three rely on a per-account ad_platform_connections row. Tests verify:
//   1) Missing connection row → 404 CONNECTION_NOT_FOUND, no external API call
//   2) Connection missing a resolved_* field → 503 CONNECTION_INCOMPLETE
//   3) Inactive/archived account → 403 (handled by resolveForWrite)
// EXECUTE_SECRET is unset in beforeEach, so the auth gate passes through.
// ============================================================================

describe('meta-creative handler — account scoping', () => {

  function makeMetaReq(overrides = {}) {
    return {
      method:  'POST',
      url:     '/api/meta-creative',
      headers: {},
      query:   {},
      body:    { imageBase64: 'base64-image-data' },
      ...overrides,
    };
  }

  it('POST with no meta_ads connection returns 404 CONNECTION_NOT_FOUND', async () => {
    mockAccount = FPB;
    mockConnectionResolver = async () => null;

    const req = makeMetaReq();
    const res = makeRes();
    await metaCreativeHandler(req, res);

    expect(res._statusCode).toBe(404);
    expect(res._body.code).toBe('CONNECTION_NOT_FOUND');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('POST with meta_ads connection missing resolved_access_token returns 503 CONNECTION_INCOMPLETE', async () => {
    mockAccount = FPB;
    mockConnectionResolver = async (_id, platform) =>
      platform === 'meta_ads'
        ? { resolved_access_token: null, resolved_account_id_external: '789' }
        : null;

    const req = makeMetaReq();
    const res = makeRes();
    await metaCreativeHandler(req, res);

    expect(res._statusCode).toBe(503);
    expect(res._body.code).toBe('CONNECTION_INCOMPLETE');
    expect(res._body.error).toMatch(/access token/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('POST when account is inactive returns 403 ACCOUNT_INACTIVE (no Meta API call)', async () => {
    mockAccount = { id: 'inactive-uuid', slug: 'inactive', status: 'inactive' };

    const req = makeMetaReq({ headers: { 'x-account-slug': 'inactive' } });
    const res = makeRes();
    await metaCreativeHandler(req, res);

    expect(res._statusCode).toBe(403);
    expect(res._body.code).toBe('ACCOUNT_INACTIVE');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('POST when account is archived returns 403 ACCOUNT_ARCHIVED (no Meta API call)', async () => {
    const err = new Error('Account is archived: oldco');
    err.statusCode = 403;
    mockResolveError = err;

    const req = makeMetaReq();
    const res = makeRes();
    await metaCreativeHandler(req, res);

    expect(res._statusCode).toBe(403);
    expect(res._body.code).toBe('ACCOUNT_ARCHIVED');
    expect(mockFetch).not.toHaveBeenCalled();
  });

});

describe('create-facebook-campaign handler — account scoping', () => {

  function makeFbReq(overrides = {}) {
    return {
      method:  'POST',
      url:     '/api/create-facebook-campaign',
      headers: {},
      query:   {},
      body:    { campaignName: 'Test', dailyBudget: 20 },
      ...overrides,
    };
  }

  it('POST with no meta_ads connection returns 404 CONNECTION_NOT_FOUND', async () => {
    mockAccount = FPB;
    mockConnectionResolver = async () => null;

    const req = makeFbReq();
    const res = makeRes();
    await createFbCampaignHandler(req, res);

    expect(res._statusCode).toBe(404);
    expect(res._body.code).toBe('CONNECTION_NOT_FOUND');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('POST with meta_ads connection missing resolved_account_id_external returns 503 CONNECTION_INCOMPLETE', async () => {
    mockAccount = FPB;
    mockConnectionResolver = async (_id, platform) =>
      platform === 'meta_ads'
        ? { resolved_access_token: 'm-token', resolved_account_id_external: null }
        : null;

    const req = makeFbReq();
    const res = makeRes();
    await createFbCampaignHandler(req, res);

    expect(res._statusCode).toBe(503);
    expect(res._body.code).toBe('CONNECTION_INCOMPLETE');
    expect(res._body.error).toMatch(/ad account ID/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('POST when account is inactive returns 403 ACCOUNT_INACTIVE', async () => {
    mockAccount = { id: 'inactive-uuid', slug: 'inactive', status: 'inactive' };

    const req = makeFbReq({ headers: { 'x-account-slug': 'inactive' } });
    const res = makeRes();
    await createFbCampaignHandler(req, res);

    expect(res._statusCode).toBe(403);
    expect(res._body.code).toBe('ACCOUNT_INACTIVE');
    expect(mockFetch).not.toHaveBeenCalled();
  });

});

describe('create-google-campaign handler — account scoping', () => {

  function makeGReq(overrides = {}) {
    return {
      method:  'POST',
      url:     '/api/create-google-campaign',
      headers: {},
      query:   {},
      body:    { campaignName: 'Test', dailyBudget: 20 },
      ...overrides,
    };
  }

  it('POST with no google_ads connection returns 404 CONNECTION_NOT_FOUND', async () => {
    mockAccount = FPB;
    mockConnectionResolver = async () => null;

    const req = makeGReq();
    const res = makeRes();
    await createGoogleCampaignHandler(req, res);

    expect(res._statusCode).toBe(404);
    expect(res._body.code).toBe('CONNECTION_NOT_FOUND');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('POST with google_ads connection missing resolved_refresh_token returns 503 CONNECTION_INCOMPLETE', async () => {
    mockAccount = FPB;
    mockConnectionResolver = async (_id, platform) =>
      platform === 'google_ads'
        ? { resolved_account_id_external: '123', resolved_manager_account_id: '456', resolved_refresh_token: null }
        : null;

    const req = makeGReq();
    const res = makeRes();
    await createGoogleCampaignHandler(req, res);

    expect(res._statusCode).toBe(503);
    expect(res._body.code).toBe('CONNECTION_INCOMPLETE');
    expect(res._body.error).toMatch(/refresh token/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('POST when account is archived returns 403 ACCOUNT_ARCHIVED', async () => {
    const err = new Error('Account is archived: oldco');
    err.statusCode = 403;
    mockResolveError = err;

    const req = makeGReq();
    const res = makeRes();
    await createGoogleCampaignHandler(req, res);

    expect(res._statusCode).toBe(403);
    expect(res._body.code).toBe('ACCOUNT_ARCHIVED');
    expect(mockFetch).not.toHaveBeenCalled();
  });

});
