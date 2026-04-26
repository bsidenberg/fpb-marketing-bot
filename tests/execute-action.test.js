// ============================================================
// tests/execute-action.test.js
// Behavioral tests for execute-action-logic.js.
// Supabase and fetch are mocked — no network, no DB.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STATUS, EXEC_RESULT } from '../api/lib/action-states.js';

// ── Queue-based Supabase mock ─────────────────────────────────────────────────
// Each .single() call pops the next result off the queue.
// Non-.single() terminal calls (update without select) resolve silently.

const singleQueue = [];

function makeChain() {
  const chain = {
    select:  () => makeChain(),
    eq:      () => makeChain(),
    in:      () => makeChain(),
    is:      () => makeChain(),
    update:  () => makeChain(),
    insert:  () => makeChain(),
    single:  async () => singleQueue.shift() ?? { data: null, error: null },
    // Awaiting the chain directly (no .single()) — resolves silently
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return chain;
}

vi.mock('../api/lib/supabase.js', () => ({
  default: { from: () => makeChain() },
}));

// ── Mock fetch ────────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import AFTER mocks are registered
import { acquireLockAndExecute } from '../api/lib/execute-action-logic.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAction(overrides = {}) {
  return {
    id:               'action-123',
    status:           STATUS.PENDING,
    action_type:      'pause_campaign',
    execution_result: null,
    execution_data:   {},
    ...overrides,
  };
}

/** Push results for .single() calls in order they'll be consumed */
function queueResults(...results) {
  singleQueue.length = 0;
  singleQueue.push(...results);
}

beforeEach(() => {
  vi.clearAllMocks();
  singleQueue.length = 0;
  process.env.META_ACCESS_TOKEN     = 'test-meta-token';
  process.env.META_AD_ACCOUNT_ID    = '123456789';
  process.env.META_PAGE_ID          = '987654321';
  process.env.GOOGLE_ADS_CLIENT_ID  = 'test-client-id';
  process.env.GOOGLE_ADS_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_ADS_REFRESH_TOKEN = 'test-refresh';
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
  process.env.GOOGLE_ADS_CUSTOMER_ID = '8325311811';
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('acquireLockAndExecute', () => {

  it('returns 409 when action is in a final state (canExecute = false)', async () => {
    const finalAction = makeAction({ execution_result: EXEC_RESULT.SUCCESS });
    queueResults({ data: finalAction, error: null }); // preflight

    const { httpStatus, body } = await acquireLockAndExecute('action-123');
    expect(httpStatus).toBe(409);
    expect(body.success).toBe(false);
  });

  it('returns 404 when action is not found', async () => {
    queueResults({ data: null, error: { message: 'no rows' } }); // preflight miss

    const { httpStatus, body } = await acquireLockAndExecute('action-123');
    expect(httpStatus).toBe(404);
    expect(body.success).toBe(false);
  });

  it('returns 200 requires_manual for adjust_budget', async () => {
    const action = makeAction({ action_type: 'adjust_budget' });
    queueResults({ data: action, error: null }); // preflight

    const { httpStatus, body } = await acquireLockAndExecute('action-123');
    expect(httpStatus).toBe(200);
    expect(body.requires_manual).toBe(true);
    expect(body.executed).toBe(false);
  });

  it('returns 200 requires_manual for adjust_bid', async () => {
    const action = makeAction({ action_type: 'adjust_bid' });
    queueResults({ data: action, error: null }); // preflight

    const { httpStatus, body } = await acquireLockAndExecute('action-123');
    expect(httpStatus).toBe(200);
    expect(body.requires_manual).toBe(true);
  });

  it('returns 409 when lock acquisition fails (row already claimed)', async () => {
    const action = makeAction();
    queueResults(
      { data: action, error: null },                          // preflight: action found
      { data: null, error: { code: 'PGRST116', message: 'no rows' } }, // lock: already claimed
    );

    const { httpStatus, body } = await acquireLockAndExecute('action-123');
    expect(httpStatus).toBe(409);
    expect(body.success).toBe(false);
  });

  it('calls Meta API and returns success for pause_campaign on meta platform', async () => {
    const action = makeAction({
      action_type:    'pause_campaign',
      execution_data: { platform: 'meta', campaign_id: 'camp-456' },
    });
    const lockedRow = {
      action_type:    'pause_campaign',
      channel:        'meta',
      execution_data: { platform: 'meta', campaign_id: 'camp-456' },
    };

    queueResults(
      { data: action,     error: null },  // preflight
      { data: lockedRow,  error: null },  // lock acquired
    );

    // Meta campaign status API
    mockFetch.mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ success: true }),
    });

    const { httpStatus, body } = await acquireLockAndExecute('action-123');
    expect(httpStatus).toBe(200);
    expect(body.success).toBe(true);
    expect(body.executed).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('graph.facebook.com'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

});
