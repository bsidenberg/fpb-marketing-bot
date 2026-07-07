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

// ── Named-export mocks for google-ads.js and facebook-ads.js ─────────────────
const { mockFetchGoogleAds, mockFetchMetaAds, mockFetchSearchTerms } = vi.hoisted(() => ({
  mockFetchGoogleAds:   vi.fn(),
  mockFetchMetaAds:     vi.fn(),
  mockFetchSearchTerms: vi.fn(),
}));

vi.mock('../api/google-ads.js', () => ({
  fetchGoogleAdsData: mockFetchGoogleAds,
  fetchSearchTerms:   mockFetchSearchTerms,
  default: vi.fn(),
}));

vi.mock('../api/facebook-ads.js', () => ({
  fetchMetaAdsData: mockFetchMetaAds,
  default: vi.fn(),
}));

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

const VALID_GOOGLE_CONN = {
  resolved_account_id_external: '8325311811',
  resolved_manager_account_id:  '5435219372',
  resolved_refresh_token:       'g-refresh',
};
const VALID_META_CONN = {
  resolved_access_token:        'm-token',
  resolved_account_id_external: '123456789',
};

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
    getConnectionForAccount: async (_id, platform) => {
      if (platform === 'google_ads') return VALID_GOOGLE_CONN;
      if (platform === 'meta_ads')   return VALID_META_CONN;
      return null;
    },
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

// ── Autonomy mocks — allow all actions through so step 6.5 can reach the insert ─
vi.mock('../api/lib/autonomy-coordinator.js', () => ({
  checkPostureForAction: vi.fn(async () => ({ verdict: 'require_approval', reason: 'recommend tier' })),
  recordActionOutcome:   vi.fn(),
  getActiveCount:        vi.fn(async () => 0),
}));

vi.mock('../api/lib/autonomy-escalation.js', () => ({
  detectNovelty:      vi.fn(async () => false),
  detectConflict:     vi.fn(async () => false),
  detectExternalFlag: vi.fn(() => false),
  detectAnomaly:      vi.fn(() => false),
}));

// ── fetch mock ───────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import AFTER all mocks
import handler, { verifyAndEnrichAction } from '../api/chat.js';
import { getFpbChatSystemPrompt } from '../api/lib/prompts/fpb.js';
import { checkPostureForAction } from '../api/lib/autonomy-coordinator.js';
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

  mockFetchGoogleAds.mockResolvedValue({
    success: true,
    summary: { totalSpend: '500', totalConversions: '5' },
    campaigns: [{ id: 'g-camp-1', budget_id: 'bgt-001', daily_budget: '50.00', name: 'Google Test' }],
  });
  mockFetchMetaAds.mockResolvedValue({
    success: true,
    summary: { totalSpend: '300', totalConversions: 3 },
    campaigns: [{ id: 'm-camp-1', name: 'Meta Test' }],
  });
  mockFetchSearchTerms.mockResolvedValue({
    success: true,
    searchTerms: [{ searchTerm: 'free shed plans', campaignId: 'g-camp-1', campaignName: 'Google Test', clicks: 5, cost: 12.5, conversions: 0 }],
    wasteSummary: { totalWastedSpend: '12.50', topWaste: [{ searchTerm: 'free shed plans', cost: 12.5 }] },
  });

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
    expect(row.model_name).toBe('claude-sonnet-4-6');
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

// ============================================================================
// Chat — ACTION block emission → pending action row creation (Step 6.5)
// ============================================================================

function makeActionFetch(actionText) {
  return mockFetch
    .mockResolvedValueOnce({ // intent detection call
      ok: true,
      json: async () => ({ content: [{ text: 'ACTION_REQUEST' }] }),
    })
    .mockResolvedValueOnce({ // main Claude call
      ok: true,
      json: async () => ({
        content: [{ text: actionText }],
        usage: { input_tokens: 500, output_tokens: 100 },
      }),
    });
}

describe('chat — ACTION block emission creates pending action row', () => {

  it('inserts a pending action row and returns actionId when Claude emits an ACTION block', async () => {
    setResponse('actions.insert.single', { data: { id: 'action-uuid-123' }, error: null });
    // Use campaign_id that matches the mock (g-camp-1 / "Google Test") so verification
    // succeeds and status stays 'pending' (not 'requires_review').
    makeActionFetch(
      'I recommend pausing this campaign.\nACTION:{"action_type":"pause_campaign","channel":"google_ads","campaign_id":"g-camp-1","campaign_name":"Google Test","description":"CPL over $150","current_value":"$160","recommended_value":"paused"}'
    );

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.actionId).toBe('action-uuid-123');
    expect(res._body.messageType).toBe('action_request');

    const inserted = (insertsByTable['actions'] || [])[0];
    expect(inserted).toBeDefined();
    expect(inserted.action_type).toBe('pause_campaign');
    expect(inserted.channel).toBe('google_ads');
    expect(inserted.status).toBe('pending'); // verified → pending
    expect(inserted.account_id).toBe('fpb-uuid');
    expect(inserted.execution_data.campaign_id).toBe('g-camp-1');
    expect(inserted.execution_data.current_value).toBe('$160'); // LLM value preserved
  });

  it('passes ACTION-block magnitude fields to the coordinator as context.execution_data (SESSION-05)', async () => {
    setResponse('actions.insert.single', { data: { id: 'action-uuid-456' }, error: null });
    makeActionFetch(
      'Raise the budget.\nACTION:{"action_type":"adjust_budget","channel":"google_ads","campaign_id":"g-camp-1","campaign_name":"Google Test","description":"Scale winner","current_value":"$100","recommended_value":"$118"}'
    );

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(checkPostureForAction).toHaveBeenCalled();
    const context = checkPostureForAction.mock.calls[0][3];
    expect(context.execution_data).toEqual({
      campaign_id:       'g-camp-1',
      current_value:     '$100',
      recommended_value: '$118',
    });
  });

  it('returns actionId: null when coordinator returns block verdict — chat response still 200', async () => {
    checkPostureForAction.mockResolvedValueOnce({ verdict: 'block', reason: 'cap exceeded' });
    makeActionFetch(
      'Pause this campaign.\nACTION:{"action_type":"pause_campaign","channel":"google_ads","campaign_id":"camp-123"}'
    );

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.actionId).toBeNull();
    // No actions row should have been inserted
    expect(insertsByTable['actions']).toBeUndefined();
  });

  it('returns actionId: null when action row insert fails — chat response still 200', async () => {
    setResponse('actions.insert.single', { data: null, error: { message: 'constraint violation' } });
    makeActionFetch(
      'Pause this.\nACTION:{"action_type":"pause_campaign","channel":"google_ads"}'
    );

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.actionId).toBeNull();
  });

  it('skips DB creation for process_image action type and returns actionId: null', async () => {
    makeActionFetch(
      'Processing image.\nACTION:{"action_type":"process_image","platform":"meta","format":"feed"}'
    );

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.actionId).toBeNull();
    expect(insertsByTable['actions']).toBeUndefined();
  });

});

// ============================================================================
// Chat — DATA_QUESTION path: fetchAdData uses direct imports, not HTTP
// ============================================================================

describe('chat — DATA_QUESTION ad data via direct import (seam test)', () => {

  it('calls fetchGoogleAdsData and fetchMetaAdsData directly when includeAdData is true', async () => {
    // The chat flow is two-pass: first request returns { type: 'fetching' },
    // then the client sends a second request with includeAdData: true in the body.
    // This test simulates the second pass directly (includeAdData: true) which is
    // the pass that calls fetchAdData → fetchGoogleAdsData / fetchMetaAdsData.
    mockFetch.mockResolvedValueOnce({ // main Claude call (no intent detection call when includeAdData:true)
      ok: true,
      json: async () => ({
        content: [{ text: 'Here is your ad performance summary.' }],
        usage: { input_tokens: 300, output_tokens: 80 },
      }),
    });

    const req = makeReq({
      body: { message: 'How are my ads performing?', sessionId: 'sess-data', includeAdData: true },
    });
    const res = makeRes();
    await handler(req, res);

    // Both named exports must have been called with the account and its connections
    expect(mockFetchGoogleAds).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fpb-uuid', slug: 'fpb' }),
      VALID_GOOGLE_CONN
    );
    expect(mockFetchMetaAds).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fpb-uuid', slug: 'fpb' }),
      VALID_META_CONN
    );
    // No internal HTTP fetch to /api/google-ads or /api/facebook-ads
    const internalGoogleCall = mockFetch.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('/api/google-ads')
    );
    const internalMetaCall = mockFetch.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('/api/facebook-ads')
    );
    expect(internalGoogleCall).toBeUndefined();
    expect(internalMetaCall).toBeUndefined();
  });

});

// ============================================================================
// Session-02: affirmative follow-up triggers data fetch
// ============================================================================

describe('chat — affirmative follow-up triggers data fetch', () => {

  it('returns fetching signal when intent resolves DATA_QUESTION for short affirmative with prior data history', async () => {
    // Simulate the Haiku intent detector correctly classifying "yes do it" as
    // DATA_QUESTION after seeing the prior assistant message context.
    mockFetch.mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ content: [{ text: 'DATA_QUESTION' }] }),
    });

    const req = makeReq({
      body: {
        message:             'yes do it',
        sessionId:           'sess-affirmative',
        conversationHistory: [
          { role: 'user',      content: 'How are my campaigns performing?' },
          { role: 'assistant', content: 'LP Search - Location is at $45 CPL — below the $50 target. Budget of $2500 is fully utilized.' },
        ],
        includeAdData: false,
      },
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.type).toBe('fetching');
  });

});

// ============================================================================
// Session-02: prompt honesty — no CSV export instructions
// ============================================================================

describe('chat — prompt honesty (Session-02)', () => {

  it('chat system prompt does not contain CSV export or manual upload instructions', () => {
    const prompt = getFpbChatSystemPrompt();
    expect(prompt.toLowerCase()).not.toMatch(/export.*csv/);
    expect(prompt.toLowerCase()).not.toMatch(/csv.*export/);
    expect(prompt.toLowerCase()).not.toMatch(/upload.*file/);
    // Fetch-first instruction is present
    expect(prompt).toMatch(/never ask.*export|never.*upload|automatically fetch|fetches it automatically/i);
  });

  it('chat system prompt does not claim adjust_bid or bid strategy actions', () => {
    const prompt = getFpbChatSystemPrompt();
    // adjust_bid must not appear as an available action type
    expect(prompt).not.toMatch(/^- adjust_bid:/m);
  });

});

// ============================================================================
// Session-06: verifyAndEnrichAction — pure unit tests
// ============================================================================

describe('verifyAndEnrichAction — server-side campaign verification', () => {

  const LIVE_CAMPAIGNS = [
    { id: '21541565583', budget_id: 'bgt-111', daily_budget: '50.00', name: 'LP Search - Location' },
    { id: '99999999999', budget_id: 'bgt-222', daily_budget: '75.00', name: 'Kit Campaign' },
  ];

  it('passes non-google_ads actions through unchanged with status passthrough', () => {
    const payload = { action_type: 'pause_campaign', channel: 'meta_ads', campaign_id: 'meta-123' };
    const { payload: result, status } = verifyAndEnrichAction(payload, LIVE_CAMPAIGNS);
    expect(result).toBe(payload); // exact same reference — no copy
    expect(status).toBe('passthrough');
  });

  it('injects budget_id and fills current_value from daily_budget on ID match', () => {
    const payload = {
      action_type: 'adjust_budget',
      channel:     'google_ads',
      campaign_id: '21541565583',
      campaign_name: 'LP Search - Location',
      description: 'Increase budget',
    };
    const { payload: result, status } = verifyAndEnrichAction(payload, LIVE_CAMPAIGNS);
    expect(status).toBe('id_match');
    expect(result.budget_id).toBe('bgt-111');
    expect(result.current_value).toBe('50.00');
    expect(result.campaign_id).toBe('21541565583'); // unchanged
  });

  it('preserves LLM current_value on ID match when it was already provided', () => {
    const payload = {
      action_type:   'adjust_budget',
      channel:       'google_ads',
      campaign_id:   '21541565583',
      current_value: '$45.00', // LLM supplied this
    };
    const { payload: result, status } = verifyAndEnrichAction(payload, LIVE_CAMPAIGNS);
    expect(status).toBe('id_match');
    expect(result.current_value).toBe('$45.00'); // LLM value kept, not overwritten
    expect(result.budget_id).toBe('bgt-111');
  });

  it('does NOT fall back to LLM-supplied budget_id when live campaign budget_id is missing', () => {
    // Safety invariant: unverified LLM budget_id must never reach execution_data.
    // If the live campaign has no budget_id, execution_data.budget_id must be null so
    // execute-action-logic falls back to deriving it from the verified campaign_id.
    const campaignsNoBudget = [
      { id: '21541565583', budget_id: null, daily_budget: '50.00', name: 'LP Search - Location' },
    ];
    const payload = {
      action_type: 'adjust_budget',
      channel:     'google_ads',
      campaign_id: '21541565583',
      budget_id:   'llm-supplied-budget-id', // LLM hallucinated this
    };
    const { payload: result, status } = verifyAndEnrichAction(payload, campaignsNoBudget);
    expect(status).toBe('id_match');
    expect(result.budget_id).toBeNull(); // live value (null) wins; LLM value discarded
  });

  it('corrects campaign_id and injects budget_id on exact name match (wrong ID in payload)', () => {
    const payload = {
      action_type:   'adjust_budget',
      channel:       'google_ads',
      campaign_id:   '21541565583_HALLUCINATED',
      campaign_name: 'LP Search - Location',
      description:   'Increase budget',
    };
    const { payload: result, status } = verifyAndEnrichAction(payload, LIVE_CAMPAIGNS);
    expect(status).toBe('name_match');
    expect(result.campaign_id).toBe('21541565583');
    expect(result.budget_id).toBe('bgt-111');
    expect(result.description).toMatch(/campaign_id corrected from model output by server verification/);
  });

  it('flags unverified when neither campaign_id nor campaign_name matches any live campaign', () => {
    const payload = {
      action_type:   'adjust_budget',
      channel:       'google_ads',
      campaign_id:   'ghost-id',
      campaign_name: 'Nonexistent Campaign',
      description:   'Increase budget',
    };
    const { payload: result, status } = verifyAndEnrichAction(payload, LIVE_CAMPAIGNS);
    expect(status).toBe('unverified');
    expect(result.description).toMatch(/^\[UNVERIFIED - campaign not found in live data\]/);
  });

  it('flags unverified when fetched campaigns list is empty', () => {
    const payload = {
      action_type: 'adjust_budget',
      channel:     'google_ads',
      campaign_id: '21541565583',
    };
    const { payload: result, status } = verifyAndEnrichAction(payload, []);
    expect(status).toBe('unverified');
    expect(result.description).toMatch(/\[UNVERIFIED - campaign not found in live data\]/);
  });

  it('flags unverified when fetched campaigns is null (no live data available)', () => {
    const payload = {
      action_type: 'adjust_budget',
      channel:     'google_ads',
      campaign_id: '21541565583',
    };
    const { payload: result, status } = verifyAndEnrichAction(payload, null);
    expect(status).toBe('unverified');
    expect(result.description).toMatch(/\[UNVERIFIED - campaign not found in live data\]/);
  });

  it('daily_budget from the google-ads fetch shape is used as current_value on ID match', () => {
    // Validates that verifyAndEnrichAction correctly reads the daily_budget field
    // that fetchGoogleAdsData now emits (Session-06 GAQL addition).
    const mockShapedCampaign = { id: 'g-camp-1', budget_id: 'bgt-001', daily_budget: '50.00', name: 'Google Test' };
    const { payload: result, status } = verifyAndEnrichAction(
      { action_type: 'adjust_budget', channel: 'google_ads', campaign_id: 'g-camp-1' },
      [mockShapedCampaign]
    );
    expect(status).toBe('id_match');
    expect(result.current_value).toBe('50.00');
    expect(result.budget_id).toBe('bgt-001');
  });

});

// ============================================================================
// Session-07b: verifyAndEnrichAction — add_negative_keyword match_type gate
// ============================================================================

describe('verifyAndEnrichAction — add_negative_keyword match_type gate (S07b)', () => {

  const LIVE_CAMPAIGNS = [
    { id: '21541565583', budget_id: 'bgt-111', daily_budget: '50.00', name: 'LP Search - Location' },
  ];

  it('valid match_type BROAD with matching campaign_id → id_match, keyword fields preserved', () => {
    const payload = {
      action_type:  'add_negative_keyword',
      channel:      'google_ads',
      campaign_id:  '21541565583',
      keyword_text: 'free shed plans',
      match_type:   'BROAD',
      evidence:     { search_term: 'free shed plans', spend: '12.50', conversions: 0 },
    };
    const { payload: result, status } = verifyAndEnrichAction(payload, LIVE_CAMPAIGNS);
    expect(status).toBe('id_match');
    expect(result.keyword_text).toBe('free shed plans');
    expect(result.match_type).toBe('BROAD');
    expect(result.evidence).toEqual({ search_term: 'free shed plans', spend: '12.50', conversions: 0 });
  });

  it('invalid match_type downgrades to unverified with prefixed description', () => {
    const payload = {
      action_type:  'add_negative_keyword',
      channel:      'google_ads',
      campaign_id:  '21541565583',
      keyword_text: 'free shed plans',
      match_type:   'garbage',
      description:  'Add negative keyword',
    };
    const { payload: result, status } = verifyAndEnrichAction(payload, LIVE_CAMPAIGNS);
    expect(status).toBe('unverified');
    expect(result.description).toMatch(/^\[UNVERIFIED - invalid match_type "garbage", expected BROAD\/PHRASE\/EXACT\]/);
  });

  it('absent match_type is NOT downgraded — still id_match, no invalid-match-type prefix', () => {
    const payload = {
      action_type:  'add_negative_keyword',
      channel:      'google_ads',
      campaign_id:  '21541565583',
      keyword_text: 'free shed plans',
      description:  'Add negative keyword',
    };
    const { payload: result, status } = verifyAndEnrichAction(payload, LIVE_CAMPAIGNS);
    expect(status).toBe('id_match');
    expect(result.description).not.toMatch(/UNVERIFIED - invalid match_type/);
  });

  it('lowercase match_type ("broad") is valid but normalized to canonical uppercase on the stored payload', () => {
    const payload = {
      action_type:  'add_negative_keyword',
      channel:      'google_ads',
      campaign_id:  '21541565583',
      keyword_text: 'free shed plans',
      match_type:   'broad',
    };
    const { payload: result, status } = verifyAndEnrichAction(payload, LIVE_CAMPAIGNS);
    expect(status).toBe('id_match');
    expect(result.match_type).toBe('BROAD');
  });

});

// ============================================================================
// Session-07c: fail-early keyword_text staging guard
// ============================================================================

describe('verifyAndEnrichAction — missing keyword_text staging guard (S07c)', () => {

  const LIVE_CAMPAIGNS = [
    { id: '21541565583', budget_id: 'bgt-111', daily_budget: '50.00', name: 'LP Search - Location' },
  ];

  it('missing keyword_text on add_negative_keyword -> unverified with clear reason', () => {
    const payload = {
      action_type: 'add_negative_keyword',
      channel:     'google_ads',
      campaign_id: '21541565583',
      match_type:  'BROAD',
      description: 'Zero conversions',
    };
    const { payload: result, status } = verifyAndEnrichAction(payload, LIVE_CAMPAIGNS);
    expect(status).toBe('unverified');
    expect(result.description).toMatch(/^\[UNVERIFIED - negative keyword action missing keyword_text\]/);
  });

  it('whitespace-only keyword_text on add_negative_keyword -> unverified with clear reason', () => {
    const payload = {
      action_type:  'add_negative_keyword',
      channel:      'google_ads',
      campaign_id:  '21541565583',
      keyword_text: '   ',
      match_type:   'BROAD',
    };
    const { payload: result, status } = verifyAndEnrichAction(payload, LIVE_CAMPAIGNS);
    expect(status).toBe('unverified');
    expect(result.description).toMatch(/^\[UNVERIFIED - negative keyword action missing keyword_text\]/);
  });

  it('populated keyword_text still reaches id_match, unaffected by the new guard', () => {
    const payload = {
      action_type:  'add_negative_keyword',
      channel:      'google_ads',
      campaign_id:  '21541565583',
      keyword_text: 'free shed plans',
      match_type:   'BROAD',
    };
    const { payload: result, status } = verifyAndEnrichAction(payload, LIVE_CAMPAIGNS);
    expect(status).toBe('id_match');
    expect(result.keyword_text).toBe('free shed plans');
  });

});

// ============================================================================
// Session-06: handler integration — verify-and-enrich wired into action save
// ============================================================================

describe('chat — verifyAndEnrichAction wired into action save (Session-06)', () => {

  it('saves budget_id in execution_data when action is verified against turn-fetched campaigns', async () => {
    setResponse('actions.insert.single', { data: { id: 'action-enrich-uuid' }, error: null });
    // includeAdData: true → turn data is fetched; mockFetchGoogleAds returns campaign with budget_id
    mockFetch.mockResolvedValueOnce({ // main Claude call (no intent detection when includeAdData)
      ok: true,
      json: async () => ({
        content: [{ text: 'Adjust budget.\nACTION:{"action_type":"adjust_budget","channel":"google_ads","campaign_id":"g-camp-1","campaign_name":"Google Test","description":"Increase budget"}' }],
        usage: { input_tokens: 500, output_tokens: 100 },
      }),
    });

    const req = makeReq({
      body: { message: 'Increase the Google campaign budget', sessionId: 'sess-enrich', includeAdData: true },
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    const inserted = (insertsByTable['actions'] || [])[0];
    expect(inserted.execution_data.budget_id).toBe('bgt-001');
    expect(inserted.execution_data.current_value).toBe('50.00');
    expect(inserted.status).toBe('pending'); // verified → stays pending
  });

  it('fetches google-ads server-side for verification when no ad data was included in the turn', async () => {
    setResponse('actions.insert.single', { data: { id: 'action-server-fetch-uuid' }, error: null });
    makeActionFetch(
      'Adjust budget.\nACTION:{"action_type":"adjust_budget","channel":"google_ads","campaign_id":"g-camp-1","campaign_name":"Google Test","description":"Increase budget"}'
    );

    const req = makeReq({
      body: { message: 'Adjust the campaign budget', sessionId: 'sess-server-fetch', includeAdData: false },
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    // fetchGoogleAdsData called for server-side verification
    expect(mockFetchGoogleAds).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fpb-uuid' }),
      VALID_GOOGLE_CONN
    );
    const inserted = (insertsByTable['actions'] || [])[0];
    expect(inserted.execution_data.budget_id).toBe('bgt-001');
    expect(inserted.status).toBe('pending');
  });

  it('saves requires_review status when google_ads campaign cannot be verified against live data', async () => {
    setResponse('actions.insert.single', { data: { id: 'action-unverified-uuid' }, error: null });
    // Override mock to return a campaign that does NOT match the ACTION block's IDs
    mockFetchGoogleAds.mockResolvedValue({
      success:   true,
      campaigns: [{ id: 'other-campaign', budget_id: 'bgt-999', daily_budget: '30.00', name: 'Other Campaign' }],
    });
    makeActionFetch(
      'I recommend adjusting budget.\nACTION:{"action_type":"adjust_budget","channel":"google_ads","campaign_id":"ghost-id","campaign_name":"Ghost Campaign","description":"Increase budget"}'
    );

    const req = makeReq({
      body: { message: 'Adjust campaign budget', sessionId: 'sess-unverified', includeAdData: false },
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    const inserted = (insertsByTable['actions'] || [])[0];
    expect(inserted.status).toBe('requires_review');
    expect(inserted.description).toMatch(/^\[UNVERIFIED - campaign not found in live data\]/);
  });

});

// ============================================================================
// Session-07b: whitelist fix — keyword_text/match_type/evidence survive the
// actions.insert execution_data allow-list (previously silently dropped).
// ============================================================================

describe('chat — add_negative_keyword execution_data whitelist fix (S07b)', () => {

  it('preserves keyword_text, match_type, and evidence in execution_data on insert', async () => {
    setResponse('actions.insert.single', { data: { id: 'action-negkw-uuid' }, error: null });
    makeActionFetch(
      'Add this as a negative keyword.\nACTION:{"action_type":"add_negative_keyword","channel":"google_ads","campaign_id":"g-camp-1","campaign_name":"Google Test","keyword_text":"free shed plans","match_type":"BROAD","description":"Zero conversions, $12.50 spend","evidence":{"search_term":"free shed plans","spend":"12.50","conversions":0}}'
    );

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    const inserted = (insertsByTable['actions'] || [])[0];
    expect(inserted).toBeDefined();
    expect(inserted.execution_data.keyword_text).toBe('free shed plans');
    expect(inserted.execution_data.match_type).toBe('BROAD');
    expect(inserted.execution_data.evidence).toEqual({ search_term: 'free shed plans', spend: '12.50', conversions: 0 });
    // Existing fields still present, unaffected
    expect(inserted.execution_data.campaign_id).toBe('g-camp-1');
  });

});

// ============================================================================
// Session-07c: missing keyword_text is caught at staging, not the executor
// ============================================================================

describe('chat — missing keyword_text downgrades action to requires_review at staging (S07c)', () => {

  it('add_negative_keyword ACTION block with no keyword_text is inserted as requires_review, never pending', async () => {
    setResponse('actions.insert.single', { data: { id: 'action-negkw-missing-uuid' }, error: null });
    makeActionFetch(
      'I recommend negating this term.\nACTION:{"action_type":"add_negative_keyword","channel":"google_ads","campaign_id":"g-camp-1","campaign_name":"Google Test","match_type":"BROAD","description":"Zero conversions, $12.50 spend"}'
    );

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    const inserted = (insertsByTable['actions'] || [])[0];
    expect(inserted).toBeDefined();
    expect(inserted.status).toBe('requires_review');
    expect(inserted.description).toMatch(/negative keyword action missing keyword_text/);
    expect(inserted.execution_data.keyword_text).toBeNull();
  });

});

// ============================================================================
// Session-07e: channel-gate bypass closed — add_negative_keyword is ALWAYS
// verified/guarded, even with a missing or wrong channel value.
// ============================================================================

describe('chat — add_negative_keyword channel-gate bypass closed (S07e)', () => {

  it('add_negative_keyword with channel missing entirely AND missing keyword_text still lands requires_review', async () => {
    setResponse('actions.insert.single', { data: { id: 'action-no-channel-uuid' }, error: null });
    makeActionFetch(
      'I recommend negating this term.\nACTION:{"action_type":"add_negative_keyword","campaign_id":"g-camp-1","campaign_name":"Google Test","match_type":"BROAD","description":"Zero conversions"}'
    );

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    const inserted = (insertsByTable['actions'] || [])[0];
    expect(inserted).toBeDefined();
    expect(inserted.status).toBe('requires_review');
    expect(inserted.execution_data.keyword_text).toBeNull();
  });

  it('add_negative_keyword with channel "other" AND missing keyword_text still lands requires_review', async () => {
    setResponse('actions.insert.single', { data: { id: 'action-other-channel-uuid' }, error: null });
    makeActionFetch(
      'I recommend negating this term.\nACTION:{"action_type":"add_negative_keyword","channel":"other","campaign_id":"g-camp-1","campaign_name":"Google Test","match_type":"BROAD","description":"Zero conversions"}'
    );

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    const inserted = (insertsByTable['actions'] || [])[0];
    expect(inserted).toBeDefined();
    expect(inserted.status).toBe('requires_review');
    expect(inserted.execution_data.keyword_text).toBeNull();
  });

});

// ============================================================================
// Session-07e: add_negative_keyword_batch — server-side batch expansion
// ============================================================================

describe('chat — add_negative_keyword_batch expands into N action rows (S07e)', () => {

  function makeBatchAction(overrides = {}) {
    return {
      action_type:   'add_negative_keyword_batch',
      channel:       'google_ads',
      campaign_name: 'Google Test',
      match_type:    'BROAD',
      terms: [
        { keyword_text: 'carport',          evidence: { search_term: 'carport',          spend: '19.84', conversions: 0 } },
        { keyword_text: 'shed plans',        evidence: { search_term: 'free shed plans',  spend: '12.10', conversions: 0 } },
        { keyword_text: 'used pole barns',   evidence: { search_term: 'used pole barns',   spend: '8.00',  conversions: 0 } },
      ],
      ...overrides,
    };
  }

  it('inserts one action row per term, each with populated keyword_text and the real campaign_id resolved from fetched data', async () => {
    setResponse('actions.insert.single', { data: { id: 'action-batch-uuid' }, error: null });
    mockFetchSearchTerms.mockResolvedValueOnce({
      success: true,
      searchTerms: [
        { searchTerm: 'carport',         campaignId: 'g-camp-1', campaignName: 'Google Test', clicks: 3, cost: 19.84, conversions: 0 },
        { searchTerm: 'shed plans',      campaignId: 'g-camp-1', campaignName: 'Google Test', clicks: 2, cost: 12.10, conversions: 0 },
        { searchTerm: 'used pole barns', campaignId: 'g-camp-1', campaignName: 'Google Test', clicks: 1, cost: 8.00,  conversions: 0 },
      ],
      wasteSummary: { totalWastedSpend: '39.94', topWaste: [] },
    });
    const batchAction = makeBatchAction();
    mockFetch.mockResolvedValueOnce({ // main Claude call only — includeAdData:true skips intent detection
      ok: true,
      json: async () => ({
        content: [{ text: `Here are the terms to negate.\nACTION:${JSON.stringify(batchAction)}` }],
        usage: { input_tokens: 500, output_tokens: 100 },
      }),
    });

    const req = makeReq({ body: { message: 'Negate all the waste', sessionId: 'session-batch', includeAdData: true } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    const inserted = insertsByTable['actions'] || [];
    expect(inserted.length).toBe(3);
    for (const row of inserted) {
      expect(row.action_type).toBe('add_negative_keyword');
      expect(row.execution_data.keyword_text).toBeTruthy();
      expect(row.execution_data.campaign_id).toBe('g-camp-1');
      expect(row.status).toBe('pending');
    }
  });

  it('lands every expanded item as requires_review when campaign_name matches no fetched campaign', async () => {
    setResponse('actions.insert.single', { data: { id: 'action-batch-unverified-uuid' }, error: null });
    const batchAction = makeBatchAction({ campaign_name: 'Nonexistent Campaign', terms: [
      { keyword_text: 'carport' },
      { keyword_text: 'shed plans' },
    ] });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: `Here are the terms to negate.\nACTION:${JSON.stringify(batchAction)}` }],
        usage: { input_tokens: 500, output_tokens: 100 },
      }),
    });

    const req = makeReq({ body: { message: 'Negate carport and shed plans from Nonexistent Campaign', sessionId: 'session-batch-unverified', includeAdData: true } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    const inserted = insertsByTable['actions'] || [];
    expect(inserted.length).toBe(2);
    for (const row of inserted) {
      expect(row.status).toBe('requires_review');
    }
  });

  it('caps a batch at 25 terms and mentions the dropped count in the reply', async () => {
    setResponse('actions.insert.single', { data: { id: 'action-batch-cap-uuid' }, error: null });
    const terms = Array.from({ length: 30 }, (_, i) => ({ keyword_text: `junkterm${i}` }));
    const batchAction = makeBatchAction({ terms });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: `Here are the terms to negate.\nACTION:${JSON.stringify(batchAction)}` }],
        usage: { input_tokens: 500, output_tokens: 100 },
      }),
    });

    const message = `Negate these: ${terms.map(t => t.keyword_text).join(', ')}`;
    const req = makeReq({ body: { message, sessionId: 'session-batch-cap', includeAdData: true } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    const inserted = insertsByTable['actions'] || [];
    expect(inserted.length).toBe(25);
    expect(res._body.reply).toMatch(/5 term\(s\) beyond the 25-term cap were not staged/);
  });

  it('returns actionPayload: null and actionId: null for a batch turn, with a summary sentence in the reply', async () => {
    setResponse('actions.insert.single', { data: { id: 'action-batch-summary-uuid' }, error: null });
    const batchAction = makeBatchAction({ terms: [
      { keyword_text: 'carport' },
      { keyword_text: 'shed plans' },
    ] });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: `Here are the terms to negate.\nACTION:${JSON.stringify(batchAction)}` }],
        usage: { input_tokens: 500, output_tokens: 100 },
      }),
    });

    const req = makeReq({ body: { message: 'Negate carport and shed plans', sessionId: 'session-batch-summary', includeAdData: true } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.actionPayload).toBeNull();
    expect(res._body.actionId).toBeNull();
    expect(res._body.messageType).toBe('text');
    expect(res._body.reply).toMatch(/Batch negative-keyword request processed/);
  });

});

// ============================================================================
// Session-07c: multi-term negation stages one concrete term per turn, not
// batched into a single keyword_text or multiple ACTION blocks (fpb.js S07c)
// ============================================================================

describe('chat — multi-term negation stages one concrete term per turn (S07c)', () => {

  it('first turn: model lists several junk terms in prose but stages only the first as the ACTION, keyword_text populated', async () => {
    setResponse('actions.insert.single', { data: { id: 'action-negkw-1' }, error: null });
    mockFetch.mockResolvedValueOnce({ // main Claude call only — includeAdData:true skips intent detection
      ok: true,
      json: async () => ({
        content: [{ text:
          'These search terms are wasting spend: "free shed plans", "diy barn kits", "used pole barns". ' +
          'I\'ll stage the first one now — say "next" and I will stage the next term.\n' +
          'ACTION:{"action_type":"add_negative_keyword","channel":"google_ads","campaign_id":"g-camp-1","campaign_name":"Google Test","keyword_text":"free shed plans","match_type":"BROAD","description":"Zero conversions, $12.50 spend"}'
        }],
        usage: { input_tokens: 400, output_tokens: 90 },
      }),
    });

    const req = makeReq({ body: { message: 'Negate all the junk search terms', sessionId: 'session-multi', includeAdData: true } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect((insertsByTable['actions'] || []).length).toBe(1); // only one action row this turn
    const inserted = insertsByTable['actions'][0];
    expect(inserted.status).toBe('pending');
    expect(inserted.execution_data.keyword_text).toBe('free shed plans');
  });

  it('follow-up turn ("next"): model stages the second concrete term independently, keyword_text populated', async () => {
    setResponse('actions.insert.single', { data: { id: 'action-negkw-2' }, error: null });
    makeActionFetch(
      'Staging the next term now.\n' +
      'ACTION:{"action_type":"add_negative_keyword","channel":"google_ads","campaign_id":"g-camp-1","campaign_name":"Google Test","keyword_text":"diy barn kits","match_type":"BROAD","description":"Zero conversions"}'
    );

    const req = makeReq({ body: { message: 'next', sessionId: 'session-multi' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect((insertsByTable['actions'] || []).length).toBe(1);
    const inserted = insertsByTable['actions'][0];
    expect(inserted.status).toBe('pending');
    expect(inserted.execution_data.keyword_text).toBe('diy barn kits');
  });

});

// ============================================================================
// Session-07b: waste-question trigger — additive fetchSearchTerms call
// ============================================================================

describe('chat — waste-question trigger fetches search terms (S07b)', () => {

  it('calls fetchSearchTerms when the message matches WASTE_QUESTION_RE and a google connection exists', async () => {
    mockFetch.mockResolvedValueOnce({ // main Claude call (includeAdData:true skips intent detection)
      ok: true,
      json: async () => ({
        content: [{ text: 'Here is your wasted spend breakdown.' }],
        usage: { input_tokens: 300, output_tokens: 80 },
      }),
    });

    const req = makeReq({
      body: { message: 'What search terms are wasting spend?', sessionId: 'sess-waste', includeAdData: true },
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(mockFetchSearchTerms).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fpb-uuid' }),
      VALID_GOOGLE_CONN
    );
    // Additive — existing google/meta ad-data fetch still happens in the same request
    expect(mockFetchGoogleAds).toHaveBeenCalled();
    expect(mockFetchMetaAds).toHaveBeenCalled();
  });

  it('does NOT call fetchSearchTerms when the message does not match WASTE_QUESTION_RE', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: 'Here is your ad performance summary.' }],
        usage: { input_tokens: 300, output_tokens: 80 },
      }),
    });

    const req = makeReq({
      body: { message: 'How are my ads performing?', sessionId: 'sess-no-waste', includeAdData: true },
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(mockFetchSearchTerms).not.toHaveBeenCalled();
  });

});

// ============================================================================
// Session-07f: staging-turn auto-fetch + server-side trusted-input boundary
// ============================================================================

describe('chat — staging-turn auto-fetch and trusted-input boundary (S07f)', () => {

  it('a staging-intent message ("negate all") short-circuits straight to the fetching round-trip without calling the Haiku intent classifier', async () => {
    const req = makeReq({ body: { message: 'negate all', sessionId: 'session-stage-fetch' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.type).toBe('fetching');
    expect(anthropicCalls().length).toBe(0); // no Haiku intent-detection call — deterministic regex short-circuit
  });

  it('does NOT short-circuit the intent classifier for action requests unrelated to negatives (regression guard)', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: [{ text: 'ACTION_REQUEST' }] }) }) // intent detection call still happens
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: 'Pausing the campaign now.\nACTION:{"action_type":"pause_campaign","channel":"google_ads","campaign_id":"g-camp-1","campaign_name":"Google Test","description":"test"}' }],
          usage: { input_tokens: 200, output_tokens: 50 },
        }),
      });

    const req = makeReq({ body: { message: 'Pause the Google campaign', sessionId: 'session-regression' } });
    const res = makeRes();
    setResponse('actions.insert.single', { data: { id: 'action-regression' }, error: null });
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.type).not.toBe('fetching');
    expect((insertsByTable['actions'] || []).length).toBe(1);
  });

  it('two-turn flow: an analysis turn followed by "negate all" stages N clean actions without re-asking for data', async () => {
    // Turn 1 — analysis (simulates the client's second call after the 'fetching' signal).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ text: 'You are wasting $12.50 on "free shed plans".' }], usage: { input_tokens: 300, output_tokens: 60 } }),
    });
    await handler(makeReq({ body: { message: 'What search terms are wasting my spend?', sessionId: 'session-two-turn', includeAdData: true } }), makeRes());

    // Turn 2, first call — staging turn, includeAdData omitted, must short-circuit to fetching.
    const turn2First = makeRes();
    await handler(makeReq({ body: { message: 'negate all', sessionId: 'session-two-turn' } }), turn2First);
    expect(turn2First._body.type).toBe('fetching');

    // Turn 2, second call — client re-calls with includeAdData: true, as the frontend does on a 'fetching' signal.
    setResponse('actions.insert.single', { data: { id: 'action-two-turn' }, error: null });
    const batchAction = {
      action_type: 'add_negative_keyword_batch', channel: 'google_ads', campaign_name: 'Google Test', match_type: 'BROAD',
      terms: [{ keyword_text: 'free shed plans', evidence: { search_term: 'free shed plans', spend: '12.50', conversions: 0 } }],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ text: `Negating the waste term now.\nACTION:${JSON.stringify(batchAction)}` }], usage: { input_tokens: 400, output_tokens: 90 } }),
    });
    const turn2Second = makeRes();
    await handler(makeReq({ body: { message: 'negate all', sessionId: 'session-two-turn', includeAdData: true } }), turn2Second);

    expect(turn2Second._statusCode).toBe(200);
    const inserted = insertsByTable['actions'] || [];
    expect(inserted.length).toBe(1);
    expect(inserted[0].execution_data.keyword_text).toBe('free shed plans');
    expect(inserted[0].status).toBe('pending');
    expect(turn2Second._body.reply).toMatch(/1 staged for approval/);
  });

  it('user-explicit-list single turn: "negate <list> from <campaign>" stages clean without a prior analysis turn', async () => {
    const first = makeRes();
    await handler(makeReq({ body: { message: 'Negate carport and shed plans from Google Test', sessionId: 'session-explicit' } }), first);
    expect(first._body.type).toBe('fetching');

    setResponse('actions.insert.single', { data: { id: 'action-explicit' }, error: null });
    // The auto-fetch this turn returns real rows matching what the user named
    // (the realistic case — the user is naming terms they saw). "carport" is
    // a bare single word, so it can only land 'pending' via the fetched-data
    // path (the user-typed path is multi-word-only, per the tightened
    // trusted-input boundary); "shed plans" additionally qualifies as a
    // multi-word phrase the user typed verbatim.
    mockFetchSearchTerms.mockResolvedValueOnce({
      success: true,
      searchTerms: [
        { searchTerm: 'carport',    campaignId: 'g-camp-1', campaignName: 'Google Test', clicks: 4, cost: 15.00, conversions: 0 },
        { searchTerm: 'shed plans', campaignId: 'g-camp-1', campaignName: 'Google Test', clicks: 2, cost: 9.50,  conversions: 0 },
      ],
      wasteSummary: { totalWastedSpend: '24.50', topWaste: [] },
    });
    const batchAction = {
      action_type: 'add_negative_keyword_batch', channel: 'google_ads', campaign_name: 'Google Test', match_type: 'BROAD',
      terms: [{ keyword_text: 'carport' }, { keyword_text: 'shed plans' }],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ text: `Staging now.\nACTION:${JSON.stringify(batchAction)}` }], usage: { input_tokens: 300, output_tokens: 70 } }),
    });
    const second = makeRes();
    await handler(makeReq({ body: { message: 'Negate carport and shed plans from Google Test', sessionId: 'session-explicit', includeAdData: true } }), second);

    expect(second._statusCode).toBe(200);
    const inserted = insertsByTable['actions'] || [];
    expect(inserted.length).toBe(2);
    for (const row of inserted) {
      expect(row.status).toBe('pending');
      expect(row.execution_data.campaign_id).toBe('g-camp-1');
    }
  });

  it('a single-word term the user typed, not present in fetched search-term data, stages as requires_review — never auto-approved', async () => {
    // "carport" is typed verbatim by the user this turn, but the fetched
    // search-term data (mocked with only "free shed plans" via the default
    // beforeEach setup) doesn't contain it. It's not a stopword and it was
    // genuinely typed, so it's not fabricated — but it's also not confirmed
    // against anything real, so it must never reach 'pending'.
    setResponse('actions.insert.single', { data: { id: 'action-ambiguous' }, error: null });
    const batchAction = {
      action_type: 'add_negative_keyword_batch', channel: 'google_ads', campaign_name: 'Google Test', match_type: 'BROAD',
      terms: [{ keyword_text: 'carport' }],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ text: `Staging now.\nACTION:${JSON.stringify(batchAction)}` }], usage: { input_tokens: 300, output_tokens: 70 } }),
    });

    const req = makeReq({ body: { message: 'negate carport', sessionId: 'session-ambiguous', includeAdData: true } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    const inserted = insertsByTable['actions'] || [];
    expect(inserted.length).toBe(1);
    expect(inserted[0].status).toBe('requires_review');
    expect(inserted[0].execution_data.keyword_text).toBe('carport');
  });

  it('a bare stopword typed as part of the staging instruction ("all", "the") is never staged, even though it is a literal substring of the message', async () => {
    setResponse('actions.insert.single', { data: { id: 'action-stopword' }, error: null });
    const batchAction = {
      action_type: 'add_negative_keyword_batch', channel: 'google_ads', campaign_name: 'Google Test', match_type: 'BROAD',
      terms: [{ keyword_text: 'all' }, { keyword_text: 'the' }],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ text: `Staging now.\nACTION:${JSON.stringify(batchAction)}` }], usage: { input_tokens: 300, output_tokens: 70 } }),
    });

    const req = makeReq({ body: { message: 'negate all the waste', sessionId: 'session-stopword', includeAdData: true } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect((insertsByTable['actions'] || []).length).toBe(0);
    expect(res._body.reply).toMatch(/None of the proposed terms could be verified against fetched search-term data or your message/);
  });

  it('a multi-word phrase where every token is a stopword ("the all") is never staged, even though the user typed it verbatim', async () => {
    setResponse('actions.insert.single', { data: { id: 'action-stopword-phrase' }, error: null });
    const batchAction = {
      action_type: 'add_negative_keyword_batch', channel: 'google_ads', campaign_name: 'Google Test', match_type: 'BROAD',
      terms: [{ keyword_text: 'the all' }],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ text: `Staging now.\nACTION:${JSON.stringify(batchAction)}` }], usage: { input_tokens: 300, output_tokens: 70 } }),
    });

    const req = makeReq({ body: { message: 'negate the all of it', sessionId: 'session-stopword-phrase', includeAdData: true } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect((insertsByTable['actions'] || []).length).toBe(0);
  });

  it('a model-invented term (not in fetched search-term data, not typed by the user) is silently not staged', async () => {
    mockFetchSearchTerms.mockResolvedValueOnce({
      success: true,
      searchTerms: [{ searchTerm: 'free shed plans', campaignId: 'g-camp-1', campaignName: 'Google Test', clicks: 5, cost: 12.5, conversions: 0 }],
      wasteSummary: { totalWastedSpend: '12.50', topWaste: [] },
    });
    const batchAction = {
      action_type: 'add_negative_keyword_batch', channel: 'google_ads', campaign_name: 'Google Test', match_type: 'BROAD',
      terms: [
        { keyword_text: 'free shed plans' },        // trusted — from fetched data
        { keyword_text: 'competitor brand name' },  // untrusted — model invented, not fetched, not user-typed
      ],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ text: `Negating waste now.\nACTION:${JSON.stringify(batchAction)}` }], usage: { input_tokens: 300, output_tokens: 70 } }),
    });

    setResponse('actions.insert.single', { data: { id: 'action-invented' }, error: null });
    const req = makeReq({ body: { message: 'negate all the waste', sessionId: 'session-invented', includeAdData: true } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    const inserted = insertsByTable['actions'] || [];
    expect(inserted.length).toBe(1); // only the trusted term staged
    expect(inserted[0].execution_data.keyword_text).toBe('free shed plans');
    expect(res._body.reply).toMatch(/1 term\(s\) could not be verified against fetched search-term data or your message and were not staged/);
  });

});
