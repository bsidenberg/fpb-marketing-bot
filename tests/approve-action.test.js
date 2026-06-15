// ============================================================
// tests/approve-action.test.js
// Tests for POST /api/approve-action.
//
// Coverage:
//   • Missing actionId → 400
//   • Action not found (no DB row) → 404 "Action not found"
//   • Supabase fetch error → 404 "Action not found"
//   • Cross-account action → 403 ACCOUNT_MISMATCH
//   • Action already executed → 409
//   • Executable action (pause_campaign) → delegates to acquireLockAndExecute
//   • Manual action type (adjust_budget) → 200 requires_manual
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const FPB  = { id: 'fpb-uuid',  slug: 'fpb',  status: 'active' };
const WELD = { id: 'weld-uuid', slug: 'weld', status: 'active' };

const VALID_GOOGLE_CONN = {
  resolved_account_id_external: '123',
  resolved_manager_account_id:  '456',
  resolved_refresh_token:       'g-refresh',
};

// ── Supabase mock ─────────────────────────────────────────────────────────────
const singleQueue = [];

function makeChain() {
  const chain = {
    select:      () => chain,
    eq:          () => chain,
    in:          () => chain,
    is:          () => chain,
    update:      () => chain,
    insert:      () => chain,
    single:      async () => singleQueue.shift() ?? { data: null, error: null },
    maybeSingle: async () => singleQueue.shift() ?? { data: null, error: null },
    then:        (resolve) => resolve({ data: [], error: null }),
  };
  return chain;
}

vi.mock('../api/lib/supabase.js', () => ({
  default: { from: () => makeChain() },
}));

// ── Accounts mock ─────────────────────────────────────────────────────────────
let mockAccount = FPB;

vi.mock('../api/lib/accounts.js', () => ({
  FPB_DEFAULT_SLUG: 'fpb',
  getConnectionForAccount: async (_accountId, platform) => {
    if (platform === 'google_ads') return VALID_GOOGLE_CONN;
    return null;
  },
  checkConnectionFields: () => null,
  resolveForWrite: async (req, res) => {
    if (!mockAccount) {
      res.status(403).json({ success: false, error: 'no account', code: 'INVALID_ACCOUNT' });
      return null;
    }
    return mockAccount;
  },
}));

// ── execute-action-logic mock ─────────────────────────────────────────────────
const { mockAcquire } = vi.hoisted(() => ({
  mockAcquire: vi.fn(async () => ({
    httpStatus: 200,
    body: { success: true, executed: true },
  })),
}));

vi.mock('../api/lib/execute-action-logic.js', async () => {
  const actual = await vi.importActual('../api/lib/execute-action-logic.js');
  return { ...actual, acquireLockAndExecute: mockAcquire };
});

import handler from '../api/approve-action.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeReq(body = {}) {
  return {
    method: 'POST',
    url:    '/api/approve-action',
    headers: {},
    query:  {},
    body,
  };
}

function makeRes() {
  return {
    _statusCode: 200,
    _body:       null,
    status: function(c) { this._statusCode = c; return this; },
    json:   function(b) { this._body = b;       return this; },
    setHeader: () => {},
    end:       () => {},
  };
}

function makeActionRow(overrides = {}) {
  return {
    id:               'action-123',
    account_id:       FPB.id,
    status:           'pending',
    execution_result: null,
    action_type:      'pause_campaign',
    channel:          'google_ads',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  singleQueue.length = 0;
  mockAccount = FPB;
  mockAcquire.mockResolvedValue({ httpStatus: 200, body: { success: true, executed: true } });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('approve-action — input validation', () => {

  it('returns 400 when actionId is missing from request body', async () => {
    const res = makeRes();
    await handler(makeReq({}), res);

    expect(res._statusCode).toBe(400);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/Missing actionId/i);
  });

});

describe('approve-action — action lookup', () => {

  it('returns 404 "Action not found" when row does not exist in DB', async () => {
    singleQueue.push({ data: null, error: null });

    const res = makeRes();
    await handler(makeReq({ actionId: 'nonexistent-uuid' }), res);

    expect(res._statusCode).toBe(404);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toBe('Action not found');
  });

  it('returns 500 when Supabase returns a real database error (not a row-not-found)', async () => {
    singleQueue.push({ data: null, error: { code: '42501', message: 'permission denied for table actions', details: null, hint: null } });

    const res = makeRes();
    await handler(makeReq({ actionId: 'action-123' }), res);

    expect(res._statusCode).toBe(500);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toBe('Failed to retrieve action');
  });

});

describe('approve-action — account isolation', () => {

  it('returns 403 ACCOUNT_MISMATCH when actionId belongs to a different account', async () => {
    singleQueue.push({ data: makeActionRow({ account_id: WELD.id }), error: null });

    const res = makeRes();
    await handler(makeReq({ actionId: 'action-123' }), res);

    expect(res._statusCode).toBe(403);
    expect(res._body.code).toBe('ACCOUNT_MISMATCH');
    expect(mockAcquire).not.toHaveBeenCalled();
  });

});

describe('approve-action — state validation', () => {

  it('returns 409 when action is already in a final execution state', async () => {
    singleQueue.push({ data: makeActionRow({ execution_result: 'success' }), error: null });

    const res = makeRes();
    await handler(makeReq({ actionId: 'action-123' }), res);

    expect(res._statusCode).toBe(409);
    expect(res._body.success).toBe(false);
    expect(mockAcquire).not.toHaveBeenCalled();
  });

});

describe('approve-action — successful execution', () => {

  it('delegates to acquireLockAndExecute for an executable action type (pause_campaign)', async () => {
    singleQueue.push({ data: makeActionRow({ action_type: 'pause_campaign', channel: 'google_ads' }), error: null });
    mockAcquire.mockResolvedValueOnce({
      httpStatus: 200,
      body: { success: true, executed: true, campaign_id: 'camp-123' },
    });

    const res = makeRes();
    await handler(makeReq({ actionId: 'action-123' }), res);

    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.executed).toBe(true);
    expect(mockAcquire).toHaveBeenCalledWith('action-123', expect.objectContaining({
      account:    FPB,
      connection: VALID_GOOGLE_CONN,
    }));
  });

  it('returns 200 requires_manual for a manual action type (adjust_budget)', async () => {
    singleQueue.push({ data: makeActionRow({ action_type: 'adjust_budget', channel: 'google_ads' }), error: null });
    mockAcquire.mockResolvedValueOnce({
      httpStatus: 200,
      body: { success: true, executed: false, requires_manual: true, message: 'Apply manually.' },
    });

    const res = makeRes();
    await handler(makeReq({ actionId: 'action-123' }), res);

    expect(res._statusCode).toBe(200);
    expect(res._body.requires_manual).toBe(true);
    expect(res._body.executed).toBe(false);
  });

});
