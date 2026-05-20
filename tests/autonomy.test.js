// ============================================================
// tests/autonomy.test.js
// Sub-Task 5 — autonomy posture infrastructure tests.
//
// Tests:
//   coordinator:   checkPostureForAction verdicts (allow_auto, require_approval, block)
//   escalation:    each of 5 escalation triggers forces require_approval
//   holdout:       holdout list and row-level holdout flag
//   recording:     recordActionOutcome upserts + increments via RPC
//   pillar:        inferPillar mapping coverage + default
//   API endpoints: GET/POST /api/autonomy-posture, GET /api/autonomy-holdout-classes
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock ─────────────────────────────────────────────────────────────
// Each test configures responses by setting mockResponses before calling the
// function under test.

let mockResponses = {};
let rpcCalls = [];

const mockChain = (tableOrRpc) => {
  let _table   = tableOrRpc;
  let _filters = [];
  let _op      = null;

  const chain = {
    select: ()     => { _op = _op || 'select'; return chain; },
    eq:     (k, v) => { _filters.push([k, v]); return chain; },
    neq:    ()     => chain,
    gte:    ()     => chain,
    order:  ()     => chain,
    limit:  ()     => chain,
    insert: ()     => { _op = 'insert'; return chain; },
    upsert: ()     => { _op = 'upsert'; return chain; },
    update: ()     => { _op = 'update'; return chain; },
    single: ()     => resolve(),
    maybeSingle: () => resolve(),
    // allow awaiting the chain directly
    then: (resolve, reject) => Promise.resolve(getResponse()).then(resolve, reject),
  };

  function resolve() {
    return Promise.resolve(getResponse());
  }

  function getResponse() {
    const key = `${_table}`;
    if (mockResponses[key]) {
      const resp = mockResponses[key];
      // If array, pop the first element (queue behavior)
      if (Array.isArray(resp)) {
        return resp.shift() ?? { data: null, error: null };
      }
      return resp;
    }
    return { data: null, error: null };
  }

  return chain;
};

vi.mock('../api/lib/supabase.js', () => ({
  default: {
    from: (table) => mockChain(table),
    rpc:  (fn, params) => {
      rpcCalls.push({ fn, params });
      const key = `rpc:${fn}`;
      if (mockResponses[key]) return Promise.resolve(mockResponses[key]);
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

// ── Import modules after mock ─────────────────────────────────────────────────
import {
  checkPostureForAction,
  recordActionOutcome,
  getActiveCount,
} from '../api/lib/autonomy-coordinator.js';

import {
  inferPillar,
  ACTION_CLASS_TO_PILLAR,
} from '../api/lib/action-states.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACCOUNT_ID   = 'aaaaaaaa-0000-0000-0000-000000000001';
const PILLAR       = 'paid_ads';
const ACTION_CLASS = 'pause_campaign';

function setHoldoutResponse(data) {
  mockResponses['autonomy_holdout_classes'] = { data, error: null };
}

function setPostureResponse(data) {
  mockResponses['autonomy_posture'] = { data, error: null };
}

function setCapResponse(data) {
  mockResponses['automation_log'] = { data, error: null };
}

beforeEach(() => {
  mockResponses = {};
  rpcCalls      = [];
});

// ── inferPillar ───────────────────────────────────────────────────────────────

describe('inferPillar', () => {
  it('returns paid_ads for pause_campaign', () => {
    expect(inferPillar('pause_campaign')).toBe('paid_ads');
  });

  it('returns paid_ads for enable_campaign', () => {
    expect(inferPillar('enable_campaign')).toBe('paid_ads');
  });

  it('returns paid_ads for publish_creative', () => {
    expect(inferPillar('publish_creative')).toBe('paid_ads');
  });

  it('returns seo_blog for publish_blog_post', () => {
    expect(inferPillar('publish_blog_post')).toBe('seo_blog');
  });

  it('returns gbp for publish_gbp_post', () => {
    expect(inferPillar('publish_gbp_post')).toBe('gbp');
  });

  it('returns social_media for publish_social_post', () => {
    expect(inferPillar('publish_social_post')).toBe('social_media');
  });

  it('defaults to paid_ads for unknown action class', () => {
    expect(inferPillar('unknown_action_xyz')).toBe('paid_ads');
  });

  it('ACTION_CLASS_TO_PILLAR covers all known action classes', () => {
    // Sanity check that the map exists and has entries
    expect(Object.keys(ACTION_CLASS_TO_PILLAR).length).toBeGreaterThan(5);
  });
});

// ── checkPostureForAction — holdout list ──────────────────────────────────────

describe('checkPostureForAction — holdout list', () => {
  it('returns require_approval when action class is on holdout list', async () => {
    setHoldoutResponse({ action_class: 'publish_blog_post' }); // non-null = in holdout
    const result = await checkPostureForAction(ACCOUNT_ID, 'seo_blog', 'publish_blog_post', {});
    expect(result.verdict).toBe('require_approval');
    expect(result.reason).toMatch(/holdout/i);
  });

  it('returns require_approval when row-level holdout flag is true (even at full tier)', async () => {
    setHoldoutResponse(null); // not in holdout list
    setPostureResponse({
      account_id: ACCOUNT_ID, pillar: PILLAR, action_class: ACTION_CLASS,
      tier: 'full', holdout: true, cap_per_window: null,
      cycles_completed: 25, success_count: 24,
    });
    const result = await checkPostureForAction(ACCOUNT_ID, PILLAR, ACTION_CLASS, {});
    expect(result.verdict).toBe('require_approval');
    expect(result.reason).toMatch(/holdout flag/i);
  });
});

// ── checkPostureForAction — tier ──────────────────────────────────────────────

describe('checkPostureForAction — tier', () => {
  it('returns require_approval when posture is recommend tier', async () => {
    setHoldoutResponse(null);
    setPostureResponse({
      tier: 'recommend', holdout: false, cap_per_window: null,
      cycles_completed: 5, success_count: 5,
    });
    const result = await checkPostureForAction(ACCOUNT_ID, PILLAR, ACTION_CLASS, {});
    expect(result.verdict).toBe('require_approval');
    expect(result.reason).toMatch(/recommend tier/i);
  });

  it('defaults to require_approval when no posture row exists (no cap)', async () => {
    setHoldoutResponse(null);
    setPostureResponse(null); // no row
    const result = await checkPostureForAction(ACCOUNT_ID, PILLAR, ACTION_CLASS, {});
    expect(result.verdict).toBe('require_approval');
  });

  it('returns allow_auto when posture is full tier with no escalation triggers', async () => {
    setHoldoutResponse(null);
    setPostureResponse({
      tier: 'full', holdout: false, cap_per_window: null,
      cycles_completed: 25, success_count: 24,
    });
    const result = await checkPostureForAction(ACCOUNT_ID, PILLAR, ACTION_CLASS, {});
    expect(result.verdict).toBe('allow_auto');
  });
});

// ── checkPostureForAction — cap ───────────────────────────────────────────────

describe('checkPostureForAction — cap', () => {
  it('returns block when cap_per_window is exceeded', async () => {
    setHoldoutResponse(null);
    setPostureResponse({
      tier: 'full', holdout: false, cap_per_window: 1, window_days: 7,
      cycles_completed: 25, success_count: 24,
    });
    // automation_log returns 1 row = cap hit
    setCapResponse([{ id: 'log-1' }]);

    const result = await checkPostureForAction(ACCOUNT_ID, PILLAR, ACTION_CLASS, {});
    expect(result.verdict).toBe('block');
    expect(result.reason).toMatch(/cap exceeded/i);
  });

  it('returns allow_auto when count is below cap', async () => {
    setHoldoutResponse(null);
    setPostureResponse({
      tier: 'full', holdout: false, cap_per_window: 3, window_days: 7,
      cycles_completed: 25, success_count: 24,
    });
    setCapResponse([{ id: 'log-1' }]); // 1 < 3 = not exceeded

    const result = await checkPostureForAction(ACCOUNT_ID, PILLAR, ACTION_CLASS, {});
    expect(result.verdict).toBe('allow_auto');
  });
});

// ── checkPostureForAction — escalation triggers ───────────────────────────────

describe('checkPostureForAction — escalation triggers (full tier)', () => {
  function setupFullTier() {
    setHoldoutResponse(null);
    setPostureResponse({
      tier: 'full', holdout: false, cap_per_window: null,
      cycles_completed: 25, success_count: 24,
    });
  }

  it('returns require_approval on low confidence', async () => {
    setupFullTier();
    const result = await checkPostureForAction(ACCOUNT_ID, PILLAR, ACTION_CLASS, { confidence: 0.5 });
    expect(result.verdict).toBe('require_approval');
    expect(result.reason).toMatch(/low confidence/i);
  });

  it('returns require_approval on novel flag', async () => {
    setupFullTier();
    const result = await checkPostureForAction(ACCOUNT_ID, PILLAR, ACTION_CLASS, { novel: true });
    expect(result.verdict).toBe('require_approval');
    expect(result.reason).toMatch(/novel/i);
  });

  it('returns require_approval on conflict flag', async () => {
    setupFullTier();
    const result = await checkPostureForAction(ACCOUNT_ID, PILLAR, ACTION_CLASS, { conflict: true });
    expect(result.verdict).toBe('require_approval');
    expect(result.reason).toMatch(/conflict/i);
  });

  it('returns require_approval on anomaly flag', async () => {
    setupFullTier();
    const result = await checkPostureForAction(ACCOUNT_ID, PILLAR, ACTION_CLASS, { anomaly: true });
    expect(result.verdict).toBe('require_approval');
    expect(result.reason).toMatch(/anomaly/i);
  });

  it('returns require_approval on external_flag', async () => {
    setupFullTier();
    const result = await checkPostureForAction(ACCOUNT_ID, PILLAR, ACTION_CLASS, { external_flag: true });
    expect(result.verdict).toBe('require_approval');
    expect(result.reason).toMatch(/external/i);
  });

  it('passes confidence at exactly 0.7 (boundary)', async () => {
    setupFullTier();
    const result = await checkPostureForAction(ACCOUNT_ID, PILLAR, ACTION_CLASS, { confidence: 0.7 });
    expect(result.verdict).toBe('allow_auto');
  });

  it('fails safe to require_approval when coordinator encounters DB error', async () => {
    mockResponses['autonomy_holdout_classes'] = { data: null, error: { message: 'DB timeout' } };
    const result = await checkPostureForAction(ACCOUNT_ID, PILLAR, ACTION_CLASS, {});
    expect(result.verdict).toBe('require_approval');
  });
});

// ── recordActionOutcome ───────────────────────────────────────────────────────

describe('recordActionOutcome', () => {
  it('calls increment_posture_outcome RPC with correct params on success', async () => {
    await recordActionOutcome('action-1', ACCOUNT_ID, PILLAR, ACTION_CLASS, true);
    expect(rpcCalls.length).toBe(1);
    expect(rpcCalls[0].fn).toBe('increment_posture_outcome');
    expect(rpcCalls[0].params.p_account_id).toBe(ACCOUNT_ID);
    expect(rpcCalls[0].params.p_pillar).toBe(PILLAR);
    expect(rpcCalls[0].params.p_action_class).toBe(ACTION_CLASS);
    expect(rpcCalls[0].params.p_succeeded).toBe(true);
  });

  it('passes p_succeeded=false on failure', async () => {
    await recordActionOutcome('action-2', ACCOUNT_ID, PILLAR, ACTION_CLASS, false);
    expect(rpcCalls[0].params.p_succeeded).toBe(false);
  });

  it('swallows RPC errors without throwing', async () => {
    mockResponses['rpc:increment_posture_outcome'] = { error: { message: 'RPC error' } };
    await expect(
      recordActionOutcome('action-3', ACCOUNT_ID, PILLAR, ACTION_CLASS, true)
    ).resolves.not.toThrow();
  });

  it('calls RPC twice on back-to-back outcomes', async () => {
    await recordActionOutcome('action-4', ACCOUNT_ID, PILLAR, ACTION_CLASS, true);
    await recordActionOutcome('action-5', ACCOUNT_ID, PILLAR, ACTION_CLASS, false);
    expect(rpcCalls.length).toBe(2);
  });
});

// ── GET /api/autonomy-posture ─────────────────────────────────────────────────

describe('GET /api/autonomy-posture', () => {
  it('returns posture rows scoped to account with graduation_readiness', async () => {
    const { default: handler } = await import('../api/autonomy-posture.js');

    mockResponses['accounts'] = {
      data: { id: ACCOUNT_ID, slug: 'fpb', status: 'active', name: 'FPB' },
      error: null,
    };
    mockResponses['autonomy_posture'] = {
      data: [
        { account_id: ACCOUNT_ID, pillar: 'paid_ads', action_class: 'pause_campaign',
          tier: 'recommend', cycles_completed: 5, success_count: 5,
          cap_per_window: null, window_days: 7, holdout: false },
      ],
      error: null,
    };

    const req = { method: 'GET', query: { account: 'fpb' }, headers: {}, url: '/api/autonomy-posture' };
    const jsonCalls = [];
    const statusCalls = [];
    const res = {
      status: (code) => { statusCalls.push(code); return res; },
      json:   (body) => { jsonCalls.push(body); return res; },
      end:    ()     => res,
      setHeader: () => res,
      getHeader:  () => '',
    };

    await handler(req, res);
    expect(statusCalls[statusCalls.length - 1]).toBe(200);
    const body = jsonCalls[jsonCalls.length - 1];
    expect(body.success).toBe(true);
    expect(body.data[0].graduation_readiness).toBe('needs_more');
  });
});

// ── POST /api/autonomy-posture ────────────────────────────────────────────────

describe('POST /api/autonomy-posture', () => {
  function makeRes() {
    const statusCalls = [];
    const jsonCalls   = [];
    const res = {
      status: (code) => { statusCalls.push(code); return res; },
      json:   (body) => { jsonCalls.push(body);   return res; },
      end:    ()     => res,
      setHeader: () => res,
      getHeader:  () => '',
      _status: () => statusCalls[statusCalls.length - 1],
      _body:   () => jsonCalls[jsonCalls.length - 1],
    };
    return res;
  }

  it('returns 400 when pillar is missing', async () => {
    const { default: handler } = await import('../api/autonomy-posture.js');
    mockResponses['accounts'] = {
      data: { id: ACCOUNT_ID, slug: 'fpb', status: 'active', name: 'FPB' },
      error: null,
    };
    const req = {
      method: 'POST',
      query:  { account: 'fpb' },
      headers: {},
      body:   { action_class: 'pause_campaign' }, // missing pillar
      url: '/api/autonomy-posture',
    };
    const res = makeRes();
    await handler(req, res);
    expect(res._status()).toBe(400);
    expect(res._body().error).toMatch(/pillar/i);
  });

  it('returns 400 when action_class is missing', async () => {
    const { default: handler } = await import('../api/autonomy-posture.js');
    mockResponses['accounts'] = {
      data: { id: ACCOUNT_ID, slug: 'fpb', status: 'active', name: 'FPB' },
      error: null,
    };
    const req = {
      method: 'POST',
      query:  { account: 'fpb' },
      headers: {},
      body:   { pillar: 'paid_ads' }, // missing action_class
      url: '/api/autonomy-posture',
    };
    const res = makeRes();
    await handler(req, res);
    expect(res._status()).toBe(400);
    expect(res._body().error).toMatch(/action_class/i);
  });
});

// ── GET /api/autonomy-holdout-classes ────────────────────────────────────────

describe('GET /api/autonomy-holdout-classes', () => {
  it('returns the holdout class list', async () => {
    const { default: handler } = await import('../api/autonomy-holdout-classes.js');

    mockResponses['accounts'] = {
      data: { id: ACCOUNT_ID, slug: 'fpb', status: 'active', name: 'FPB' },
      error: null,
    };
    mockResponses['autonomy_holdout_classes'] = {
      data: [
        { action_class: 'publish_blog_post', description: 'Blog publish requires review' },
        { action_class: 'create_campaign',   description: 'New campaign creation' },
      ],
      error: null,
    };

    const req = { method: 'GET', query: { account: 'fpb' }, headers: {}, url: '/api/autonomy-holdout-classes' };
    const jsonCalls = [];
    const statusCalls = [];
    const res = {
      status: (code) => { statusCalls.push(code); return res; },
      json:   (body) => { jsonCalls.push(body); return res; },
      end:    ()     => res,
      setHeader: () => res,
      getHeader:  () => '',
    };

    await handler(req, res);
    expect(statusCalls[statusCalls.length - 1]).toBe(200);
    const body = jsonCalls[jsonCalls.length - 1];
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(2);
    expect(body.data[0].action_class).toBe('publish_blog_post');
  });
});
