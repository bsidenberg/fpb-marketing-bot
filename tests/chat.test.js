// ============================================================
// tests/chat.test.js
// Tests for /api/chat under Stage B1 multi-account retrofit.
//
// Scope:
//   • chat_messages preflight: when the table is missing, the route
//     returns 503 FEATURE_NOT_CONFIGURED, logs a failed
//     ai_analysis_runs row, and does NOT call Anthropic.
//   • Account scoping: archived → 403 ACCOUNT_ARCHIVED, inactive →
//     403 ACCOUNT_INACTIVE. Neither path calls Anthropic or writes
//     to chat_messages.
//
// Supabase, accounts.js, and fetch are all mocked.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Per-(table, op) response overrides ───────────────────────────────────────
const responses = {};
function setResponse(key, response) { responses[key] = response; }

// ── Insert / update capture buckets ──────────────────────────────────────────
const insertsByTable = {};
const updatesByTable = {};

function makeChain(table) {
  let primaryOp = null;
  function setOnce(op) { if (primaryOp === null) primaryOp = op; }

  const chain = {
    select: () => { setOnce('select'); return chain; },
    eq:     () => chain,
    order:  () => chain,
    limit:  () => chain,
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

let mockAccount      = FPB;
let mockResolveError = null;

vi.mock('../api/lib/accounts.js', () => {
  const getAccountSlugFromRequest = (req) =>
    req?.query?.account || req?.headers?.['x-account-slug'] || 'fpb';
  const getAccountBySlug = async (slug) =>
    (mockAccount?.slug === slug ? mockAccount : null);
  const resolveAccountFromRequest = async () => {
    if (mockResolveError) throw mockResolveError;
    return mockAccount;
  };
  return {
    FPB_DEFAULT_SLUG: 'fpb',
    resolveAccountFromRequest,
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

// Import AFTER all mocks
import handler from '../api/chat.js';
// rate-limit.js is intentionally NOT mocked — the chat handler exercises
// the real limiter; clearRateLimits() resets its state between tests.
import { clearRateLimits } from '../api/lib/rate-limit.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeReq(overrides = {}) {
  return {
    method:  'POST',
    url:     '/api/chat',
    headers: { 'x-forwarded-proto': 'https', host: 'test.local' },
    query:   {},
    body:    { message: 'Hello there', sessionId: 'session-123' },
    ...overrides,
  };
}

function makeRes() {
  return {
    _statusCode: 200,
    _body:       null,
    _headers:    {},
    status:    function(code) { this._statusCode = code; return this; },
    json:      function(body) { this._body = body; return this; },
    setHeader: function(k, v) { this._headers[k] = v; },
    end:       () => {},
  };
}

function anthropicCalls() {
  return mockFetch.mock.calls.filter(c =>
    typeof c[0] === 'string' && c[0].includes('api.anthropic.com')
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearRateLimits();
  for (const k of Object.keys(responses))      delete responses[k];
  for (const k of Object.keys(insertsByTable)) delete insertsByTable[k];
  for (const k of Object.keys(updatesByTable)) delete updatesByTable[k];

  mockAccount      = FPB;
  mockResolveError = null;

  // Default fetch implementation — never reached in these tests if preflight
  // or account checks fail correctly. If a test does reach it, return a
  // generic OK response so the test fails for the right reason (assertion,
  // not network).
  mockFetch.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ content: [{ text: 'STRATEGY' }] }),
  }));

  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
});

// ============================================================================
// chat_messages preflight — missing table behavior
// ============================================================================

describe('chat — chat_messages table preflight', () => {

  it('returns 503 FEATURE_NOT_CONFIGURED when chat_messages select fails with PGRST205', async () => {
    setResponse('chat_messages.select', {
      data: null,
      error: { code: 'PGRST205', message: "Could not find the table 'public.chat_messages' in the schema cache" },
    });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(503);
    expect(res._body.success).toBe(false);
    expect(res._body.code).toBe('FEATURE_NOT_CONFIGURED');
    expect(res._body.error).toMatch(/chat_messages table has not been created/i);
  });

  it('returns 503 FEATURE_NOT_CONFIGURED when chat_messages select fails with relation-does-not-exist', async () => {
    setResponse('chat_messages.select', {
      data: null,
      error: { code: '42P01', message: 'relation "public.chat_messages" does not exist' },
    });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(503);
    expect(res._body.code).toBe('FEATURE_NOT_CONFIGURED');
  });

  it('does NOT call Anthropic when chat_messages table is missing', async () => {
    setResponse('chat_messages.select', {
      data: null,
      error: { code: 'PGRST205', message: "Could not find the table 'public.chat_messages'" },
    });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(anthropicCalls()).toHaveLength(0);
  });

  it('logs a failed ai_analysis_runs row with account_id and FEATURE_NOT_CONFIGURED error', async () => {
    setResponse('chat_messages.select', {
      data: null,
      error: { code: 'PGRST205', message: "Could not find the table 'public.chat_messages'" },
    });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(insertsByTable['ai_analysis_runs']).toHaveLength(1);
    const row = insertsByTable['ai_analysis_runs'][0];
    expect(row.account_id).toBe('fpb-uuid');
    expect(row.status).toBe('failed');
    expect(row.model_provider).toBe('anthropic');
    expect(row.model_name).toBe('claude-sonnet-4-20250514');
    expect(row.prompt_version).toBe('fpb-v1');
    expect(row.error).toMatch(/FEATURE_NOT_CONFIGURED/);
    expect(row.error).toMatch(/chat_messages table does not exist/);
    expect(row.input_summary_json).toMatchObject({
      triggered_by: 'chat',
      session_id:   'session-123',
    });
    // Critically: no chat_messages writes attempted on the missing-table path
    expect(insertsByTable['chat_messages']).toBeUndefined();
  });

});

// ============================================================================
// Account scoping — archived/inactive accounts blocked at the door
// ============================================================================

describe('chat — account scoping', () => {

  it('returns 403 ACCOUNT_ARCHIVED when caller account is archived (no Anthropic, no chat_messages)', async () => {
    const err = new Error('Account is archived and cannot be used: oldco');
    err.statusCode = 403;
    mockResolveError = err;

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(403);
    expect(res._body.success).toBe(false);
    expect(res._body.code).toBe('ACCOUNT_ARCHIVED');

    // No Anthropic call, no chat_messages writes, no ai_analysis_runs row
    expect(anthropicCalls()).toHaveLength(0);
    expect(insertsByTable['chat_messages']).toBeUndefined();
    expect(insertsByTable['ai_analysis_runs']).toBeUndefined();
  });

  it('returns 403 ACCOUNT_INACTIVE when caller account is inactive (no Anthropic, no chat_messages)', async () => {
    mockAccount = { id: 'inactive-uuid', slug: 'inactive', status: 'inactive' };

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(403);
    expect(res._body.success).toBe(false);
    expect(res._body.code).toBe('ACCOUNT_INACTIVE');

    // No Anthropic call, no chat_messages writes, no ai_analysis_runs row
    expect(anthropicCalls()).toHaveLength(0);
    expect(insertsByTable['chat_messages']).toBeUndefined();
    expect(insertsByTable['ai_analysis_runs']).toBeUndefined();
  });

});

// ============================================================================
// Rate limiting (Sub-Task 6.4) — per-account guard on Anthropic spend
// ============================================================================

describe('chat — rate limiting', () => {

  it('allows a request that is under the per-account limit', async () => {
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._statusCode).toBe(200);
  });

  it('returns 429 with a Retry-After header once an account exceeds 30 requests/min', async () => {
    // 30 requests inside the window are allowed.
    for (let i = 0; i < 30; i++) {
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._statusCode).toBe(200);
    }
    // The 31st is blocked.
    const blocked = makeRes();
    await handler(makeReq(), blocked);
    expect(blocked._statusCode).toBe(429);
    expect(blocked._body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(blocked._headers['Retry-After']).toBeTruthy();
  });

  it('does not call Anthropic once the rate limit is exceeded', async () => {
    for (let i = 0; i < 30; i++) await handler(makeReq(), makeRes());
    mockFetch.mockClear();
    const blocked = makeRes();
    await handler(makeReq(), blocked);
    expect(blocked._statusCode).toBe(429);
    expect(anthropicCalls()).toHaveLength(0);
  });

  it('keeps rate-limit counters independent per account', async () => {
    // Exhaust FPB's budget.
    for (let i = 0; i < 30; i++) await handler(makeReq(), makeRes());
    const fpbBlocked = makeRes();
    await handler(makeReq(), fpbBlocked);
    expect(fpbBlocked._statusCode).toBe(429);

    // Weld is a different account — it still has a full budget.
    mockAccount = { id: 'weld-uuid', slug: 'weld', status: 'active' };
    const weldRes = makeRes();
    await handler(makeReq(), weldRes);
    expect(weldRes._statusCode).toBe(200);
  });

});
