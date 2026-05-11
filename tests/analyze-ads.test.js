// ============================================================
// tests/analyze-ads.test.js
// Tests for runAnalysisForAccount — the shared core used by both the
// HTTP handler and the cron loop. Supabase, accounts.js, and fetch
// are all mocked.
//
// Mock design:
//   • Supabase chain identifies a "primary operation" per chain
//     (insert/update/upsert/select) so per-(table, op) response overrides
//     can simulate failures without affecting other operations.
//   • insertsByTable / updatesByTable arrays capture what was written so
//     tests can verify content (e.g. account_id appears on every insert).
//   • fetch is URL-routed by default (Google → Meta → Anthropic) but
//     individual tests can override with mockFetch.mockImplementation.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Per-(table, op) response overrides ───────────────────────────────────────
const responses = {};
function setResponse(key, response) { responses[key] = response; }

// ── Insert / update / upsert capture buckets ─────────────────────────────────
const insertsByTable = {};
const updatesByTable = {};
const upsertsByTable = {};

function makeChain(table) {
  let primaryOp = null;
  function setOnce(op) { if (primaryOp === null) primaryOp = op; }

  const chain = {
    select: () => { setOnce('select'); return chain; },
    eq:     () => chain,
    in:     () => chain,
    is:     () => chain,
    gte:    () => chain,
    lt:     () => chain,
    insert: (row) => {
      setOnce('insert');
      (insertsByTable[table] = insertsByTable[table] || []).push(row);
      return chain;
    },
    update: (patch) => {
      setOnce('update');
      (updatesByTable[table] = updatesByTable[table] || []).push(patch);
      return chain;
    },
    upsert: (rows, opts) => {
      setOnce('upsert');
      (upsertsByTable[table] = upsertsByTable[table] || []).push({ rows, opts });
      return chain;
    },
    single: async () => {
      const key = `${table}.${primaryOp}.single`;
      return responses[key] ?? { data: null, error: null };
    },
    then: (resolve) => {
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

// ── Accounts module mock ─────────────────────────────────────────────────────
const FPB = { id: 'fpb-uuid', slug: 'fpb', status: 'active' };

const VALID_GOOGLE_CONN = {
  resolved_account_id_external: '8325311811',
  resolved_manager_account_id:  '5435219372',
  resolved_refresh_token:       'g-refresh',
};
const VALID_META_CONN = {
  resolved_access_token:        'm-token',
  resolved_account_id_external: '123456789',
};

let mockAccount        = FPB;
let mockResolveError   = null;
let mockConnectionResolver = async (_id, platform) => {
  if (platform === 'google_ads') return VALID_GOOGLE_CONN;
  if (platform === 'meta_ads')   return VALID_META_CONN;
  return null;
};

vi.mock('../api/lib/accounts.js', () => {
  const resolveAccountFromRequest = async () => {
    if (mockResolveError) throw mockResolveError;
    return mockAccount;
  };
  return {
    FPB_DEFAULT_SLUG: 'fpb',
    resolveAccountFromRequest,
    getAccountSlugFromRequest: (req) =>
      req?.query?.account || req?.headers?.['x-account-slug'] || 'fpb',
    getAccountBySlug: async (slug) => (mockAccount?.slug === slug ? mockAccount : null),
    getConnectionForAccount: (...args) => mockConnectionResolver(...args),
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
  };
});

// ── fetch mock ───────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function defaultFetchHandler(url) {
  if (typeof url === 'string') {
    if (url.includes('/api/google-ads')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true,
          summary: { totalSpend: '500', totalConversions: '5' },
          campaigns: [{ id: 'g-camp-1', name: 'Google Test', spend: '500' }],
        }),
      });
    }
    if (url.includes('/api/facebook-ads')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true,
          summary: { totalSpend: '300', totalConversions: 3 },
          campaigns: [{ id: 'm-camp-1', name: 'Meta Test', spend: '300' }],
        }),
      });
    }
    if (url.includes('api.anthropic.com')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          content: [{
            text: '[{"channel":"google_ads","action_type":"pause_campaign","title":"Pause underperformer","execution_data":{"campaign_id":"g-camp-1"}}]',
          }],
        }),
      });
    }
  }
  return Promise.resolve({ ok: true, json: async () => ({}) });
}

// Import AFTER all mocks
import { runAnalysisForAccount } from '../api/analyze-ads.js';
import handler from '../api/analyze-ads.js';

// ── Test helpers ─────────────────────────────────────────────────────────────
function makeReq(overrides = {}) {
  return {
    method:  'POST',
    url:     '/api/analyze-ads',
    headers: { 'x-forwarded-proto': 'https', host: 'test.local' },
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
  for (const k of Object.keys(responses)) delete responses[k];
  for (const k of Object.keys(insertsByTable)) delete insertsByTable[k];
  for (const k of Object.keys(updatesByTable)) delete updatesByTable[k];
  for (const k of Object.keys(upsertsByTable)) delete upsertsByTable[k];

  mockAccount      = FPB;
  mockResolveError = null;
  mockConnectionResolver = async (_id, platform) => {
    if (platform === 'google_ads') return VALID_GOOGLE_CONN;
    if (platform === 'meta_ads')   return VALID_META_CONN;
    return null;
  };
  mockFetch.mockImplementation(defaultFetchHandler);
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
});

// ── Helper to set a successful run row return ────────────────────────────────
function queueAiRunInsertSuccess(runId = 'test-run-uuid') {
  setResponse('ai_analysis_runs.insert.single', { data: { id: runId }, error: null });
}

// ============================================================================
// Tests
// ============================================================================

describe('runAnalysisForAccount — happy path', () => {

  it('inserts a pending ai_analysis_runs row BEFORE calling Anthropic', async () => {
    queueAiRunInsertSuccess();

    // Track when Anthropic is called relative to the pending insert
    const callOrder = [];
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('api.anthropic.com')) {
        callOrder.push('anthropic');
      }
      return defaultFetchHandler(url);
    });

    // Wrap insertsByTable to detect when ai_analysis_runs insert lands
    const originalAnthropic = mockFetch.getMockImplementation();
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('api.anthropic.com')) {
        // by the time Anthropic is called, the pending row must already exist
        callOrder.push({ event: 'anthropic_called', pending_inserted: !!insertsByTable['ai_analysis_runs']?.length });
      }
      return defaultFetchHandler(url);
    });

    await runAnalysisForAccount(FPB, { baseUrl: 'https://test.local', triggeredBy: 'manual' });

    expect(insertsByTable['ai_analysis_runs']).toHaveLength(1);
    expect(insertsByTable['ai_analysis_runs'][0]).toMatchObject({
      account_id:     'fpb-uuid',
      status:         'pending',
      model_provider: 'anthropic',
      prompt_version: 'fpb-v1',
    });
    expect(insertsByTable['ai_analysis_runs'][0].input_summary_json).toMatchObject({
      campaign_count_google: 1,
      campaign_count_meta:   1,
      date_window:           'last_30d',
    });

    // Ordering invariant: pending row was already in the bucket when Anthropic fired
    const anthropicEvent = callOrder.find(c => typeof c === 'object' && c.event === 'anthropic_called');
    expect(anthropicEvent?.pending_inserted).toBe(true);
  });

  it('transitions ai_analysis_runs status: pending → running → succeeded', async () => {
    queueAiRunInsertSuccess();

    const result = await runAnalysisForAccount(FPB, { baseUrl: 'https://test.local' });
    expect(result.success).toBe(true);

    const updates = updatesByTable['ai_analysis_runs'] || [];
    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual({ status: 'running' });
    expect(updates[1].status).toBe('succeeded');
    expect(updates[1].output_json).toEqual(expect.any(Array));
    expect(typeof updates[1].latency_ms).toBe('number');
    expect(updates[1].latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('inserts every action row with account_id', async () => {
    queueAiRunInsertSuccess();

    await runAnalysisForAccount(FPB, { baseUrl: 'https://test.local' });

    expect(insertsByTable['actions']).toHaveLength(1);
    const insertedActionRows = insertsByTable['actions'][0]; // array of action rows from the bulk insert
    expect(Array.isArray(insertedActionRows)).toBe(true);
    expect(insertedActionRows.length).toBeGreaterThan(0);
    for (const row of insertedActionRows) {
      expect(row.account_id).toBe('fpb-uuid');
    }
  });

  it('tags automation_log + performance_snapshots inserts with account_id', async () => {
    queueAiRunInsertSuccess();

    await runAnalysisForAccount(FPB, { baseUrl: 'https://test.local' });

    expect(insertsByTable['automation_log']).toHaveLength(1);
    expect(insertsByTable['automation_log'][0].account_id).toBe('fpb-uuid');

    expect(insertsByTable['performance_snapshots']).toHaveLength(1);
    expect(insertsByTable['performance_snapshots'][0].account_id).toBe('fpb-uuid');
  });

  it('passes ?account=<slug> on internal /api/google-ads and /api/facebook-ads fetches', async () => {
    queueAiRunInsertSuccess();

    await runAnalysisForAccount({ id: 'weld-uuid', slug: 'weld', status: 'active' }, { baseUrl: 'https://test.local' });

    const googleCall = mockFetch.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('/api/google-ads'));
    const metaCall   = mockFetch.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('/api/facebook-ads'));
    expect(googleCall[0]).toContain('account=weld');
    expect(metaCall[0]).toContain('account=weld');
  });

});

describe('runAnalysisForAccount — Anthropic failure', () => {

  it('logs status=failed with error and latency_ms when Anthropic API errors', async () => {
    queueAiRunInsertSuccess();

    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('api.anthropic.com')) {
        return { ok: false, status: 503, text: async () => 'service unavailable' };
      }
      return defaultFetchHandler(url);
    });

    const result = await runAnalysisForAccount(FPB, { baseUrl: 'https://test.local' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Claude API error 503/);

    const updates = updatesByTable['ai_analysis_runs'] || [];
    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual({ status: 'running' });
    expect(updates[1].status).toBe('failed');
    expect(updates[1].error).toMatch(/Claude API error 503/);
    expect(typeof updates[1].latency_ms).toBe('number');

    // No actions inserted on failure
    expect(insertsByTable['actions']).toBeUndefined();
    // automation_log still records the failure
    expect(insertsByTable['automation_log']).toHaveLength(1);
    expect(insertsByTable['automation_log'][0].status).toBe('error');
  });

});

describe('runAnalysisForAccount — best-effort logging resilience', () => {

  it('continues the analysis when ai_analysis_runs insert fails', async () => {
    // Simulate insert failure
    setResponse('ai_analysis_runs.insert.single', {
      data: null,
      error: { message: 'simulated insert failure' },
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runAnalysisForAccount(FPB, { baseUrl: 'https://test.local' });

    expect(result.success).toBe(true);
    // No update operations because runId is null when insert fails
    expect(updatesByTable['ai_analysis_runs']).toBeUndefined();
    // Analysis still wrote the actions/automation_log/snapshot rows
    expect(insertsByTable['actions']).toHaveLength(1);
    expect(insertsByTable['automation_log']).toHaveLength(1);
    expect(insertsByTable['performance_snapshots']).toHaveLength(1);
    // Failure was logged (not silent)
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringMatching(/ai_analysis_runs insert failed/),
      expect.stringMatching(/simulated insert failure/),
    );
    errSpy.mockRestore();
  });

  it('continues the analysis when ai_analysis_runs update fails', async () => {
    queueAiRunInsertSuccess();
    // Simulate every update on ai_analysis_runs failing (both running and succeeded)
    setResponse('ai_analysis_runs.update', {
      data: null,
      error: { message: 'simulated update failure' },
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runAnalysisForAccount(FPB, { baseUrl: 'https://test.local' });

    expect(result.success).toBe(true);
    // Both updates were attempted (captured in updatesByTable)
    expect(updatesByTable['ai_analysis_runs']).toHaveLength(2);
    // Analysis still completed downstream writes
    expect(insertsByTable['actions']).toHaveLength(1);
    expect(insertsByTable['automation_log']).toHaveLength(1);
    expect(insertsByTable['performance_snapshots']).toHaveLength(1);
    // Failures were logged
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringMatching(/ai_analysis_runs update failed/),
      expect.stringMatching(/simulated update failure/),
    );
    errSpy.mockRestore();
  });

});

describe('runAnalysisForAccount — connection skips', () => {

  it('skips google_ads when its connection is missing and proceeds with meta only', async () => {
    queueAiRunInsertSuccess();
    mockConnectionResolver = async (_id, platform) =>
      platform === 'meta_ads' ? VALID_META_CONN : null;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runAnalysisForAccount(FPB, { baseUrl: 'https://test.local' });

    expect(result.success).toBe(true);
    expect(result.analyzed).toEqual(['meta_ads']);

    // Only the meta data fetch happened; google was skipped
    const googleCall = mockFetch.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('/api/google-ads'));
    const metaCall   = mockFetch.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('/api/facebook-ads'));
    expect(googleCall).toBeUndefined();
    expect(metaCall).toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/google_ads skipped/));
    warnSpy.mockRestore();
  });

  it('returns { success: false } when both connections are unusable', async () => {
    mockConnectionResolver = async () => null;

    const result = await runAnalysisForAccount(FPB, { baseUrl: 'https://test.local' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No ad data available/);
    // No AI run row created — we never got far enough
    expect(insertsByTable['ai_analysis_runs']).toBeUndefined();
  });

});

// ── HTTP handler ────────────────────────────────────────────────────────────

describe('analyze-ads HTTP handler — account scoping', () => {

  it('returns 403 ACCOUNT_ARCHIVED when caller account is archived', async () => {
    const err = new Error('Account is archived: oldco');
    err.statusCode = 403;
    mockResolveError = err;

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(403);
    expect(res._body.code).toBe('ACCOUNT_ARCHIVED');
    // No analysis happened
    expect(mockFetch).not.toHaveBeenCalled();
    expect(insertsByTable['ai_analysis_runs']).toBeUndefined();
  });

  it('returns 403 ACCOUNT_INACTIVE when caller account is inactive', async () => {
    mockAccount = { id: 'inactive-uuid', slug: 'inactive', status: 'inactive' };

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(403);
    expect(res._body.code).toBe('ACCOUNT_INACTIVE');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('happy path returns 200 with analyzed platforms and actions_created', async () => {
    queueAiRunInsertSuccess();

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.analyzed).toEqual(expect.arrayContaining(['google_ads', 'meta_ads']));
    expect(res._body.actions_created).toBeGreaterThanOrEqual(0);
  });

});
