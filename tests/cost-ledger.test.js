// ============================================================
// tests/cost-ledger.test.js
// Tests for Sub-Task 4 — cost ledger infrastructure:
//   computeAnthropicCost (cost-rates.js)
//   recordAnthropicCost  (anthropic-cost.js)
//   recordApiCall        (api-cost.js)
//   computeMonthlyRollup (cost-rollup.js)
//   GET /api/cost-rollup
//   GET /api/cost-subscriptions + POST
//   GET /api/cost-hours       + POST
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Queue-based Supabase mock ─────────────────────────────────────────────────
// Each supabase.from(table) call pops the next response from queues[table].
// Falls back to overrides['table.op'] then to a sensible default.
// Captures all inserts (insertsByTable) and upserts (upsertsByTable).

const insertsByTable = {};
const upsertsByTable = {};
const overrides      = {};
const queues         = {};

function enqueue(table, ...responses) {
  if (!queues[table]) queues[table] = [];
  queues[table].push(...responses);
}

function clearQueues() {
  Object.keys(queues).forEach(k => delete queues[k]);
}

function makeChain(table) {
  let primaryOp = null;
  const chain = {
    select: ()         => { if (!primaryOp) primaryOp = 'select'; return chain; },
    eq:     ()         => chain,
    is:     ()         => chain,
    gte:    ()         => chain,
    lt:     ()         => chain,
    lte:    ()         => chain,
    or:     ()         => chain,
    order:  ()         => chain,
    limit:  ()         => chain,
    insert: (row)      => {
      if (!primaryOp) primaryOp = 'insert';
      (insertsByTable[table] = insertsByTable[table] || []).push(row);
      return chain;
    },
    upsert: (row, opts) => {
      if (!primaryOp) primaryOp = 'upsert';
      (upsertsByTable[table] = upsertsByTable[table] || []).push({ row, opts });
      return chain;
    },
    single: async () => {
      const q = queues[`${table}:single`];
      if (q?.length) return q.shift();
      const key = `${table}.${primaryOp}.single`;
      return overrides[key] ?? { data: null, error: null };
    },
    then: (resolve) => {
      const q = queues[table];
      if (q?.length) return resolve(q.shift());
      const key = `${table}.${primaryOp}`;
      const fallback = primaryOp === 'select'
        ? { data: [], error: null }
        : { data: null, error: null };
      return resolve(overrides[key] ?? fallback);
    },
  };
  return chain;
}

vi.mock('../api/lib/supabase.js', () => ({
  default: { from: (table) => makeChain(table) },
}));

const FPB_ID = 'fpb-uuid-001';
const FPB = { id: FPB_ID, slug: 'fpb', status: 'active' };

vi.mock('../api/lib/accounts.js', () => ({
  resolveForRead:   async (req, res) => { if (req._fail) { res.status(403).json({}); return null; } return FPB; },
  resolveForWrite:  async (req, res) => { if (req._fail) { res.status(403).json({}); return null; } return FPB; },
  FPB_DEFAULT_SLUG: 'fpb',
}));

vi.mock('../api/lib/cors.js', () => ({
  setCorsHeaders: () => {},
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(o = {}) {
  return { method: 'GET', url: '/', headers: {}, query: {}, body: {}, ...o };
}
function makeRes() {
  const r = { _status: null, _json: null };
  r.status = (c) => { r._status = c; return r; };
  r.json   = (d) => { r._json   = d; return r; };
  r.end    = ()  => r;
  return r;
}

beforeEach(() => {
  Object.keys(insertsByTable).forEach(k => delete insertsByTable[k]);
  Object.keys(upsertsByTable).forEach(k => delete upsertsByTable[k]);
  Object.keys(overrides).forEach(k => delete overrides[k]);
  clearQueues();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. computeAnthropicCost
// ─────────────────────────────────────────────────────────────────────────────

describe('computeAnthropicCost', () => {
  let fn;
  beforeEach(async () => {
    ({ computeAnthropicCost: fn } = await import('../api/lib/cost-rates.js'));
  });

  it('Sonnet 4 — 10K in + 5K out = $0.105', () => {
    // 10000 * $3/M + 5000 * $15/M = $0.030 + $0.075 = $0.105
    expect(fn('claude-sonnet-4-20250514', 10_000, 5_000)).toBeCloseTo(0.105, 6);
  });

  it('Haiku 4.5 — 1K in + 100 out = $0.0015', () => {
    // 1000 * $1.00/M + 100 * $5.00/M = $0.0010 + $0.0005 = $0.0015
    expect(fn('claude-haiku-4-5-20251001', 1_000, 100)).toBeCloseTo(0.0015, 6);
  });

  it('returns null for unknown model', () => {
    expect(fn('unknown-model-xyz', 1000, 1000)).toBeNull();
  });

  it('handles zero tokens → $0', () => {
    expect(fn('claude-sonnet-4-20250514', 0, 0)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. recordAnthropicCost
// ─────────────────────────────────────────────────────────────────────────────

describe('recordAnthropicCost', () => {
  let recordAnthropicCost;
  beforeEach(async () => {
    ({ recordAnthropicCost } = await import('../api/lib/anthropic-cost.js'));
  });

  it('inserts a cost_api_events row with computed cost', async () => {
    const response = {
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 10_000, output_tokens: 5_000 },
    };
    await recordAnthropicCost(response, FPB_ID, 'analyze_ads', 'run-uuid-1');
    const rows = insertsByTable['cost_api_events'];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      vendor:        'anthropic',
      event_type:    'analyze_ads',
      account_id:    FPB_ID,
      tokens_in:     10_000,
      tokens_out:    5_000,
      source_run_id: 'run-uuid-1',
    });
    expect(rows[0].cost_usd).toBeCloseTo(0.105, 5);
  });

  it('handles null usage — no insert', async () => {
    await recordAnthropicCost({ model: 'claude-sonnet-4-20250514', usage: null }, FPB_ID, 'test');
    expect(insertsByTable['cost_api_events']).toBeUndefined();
  });

  it('swallows DB error without throwing', async () => {
    overrides['cost_api_events.insert'] = { data: null, error: { message: 'DB down' } };
    const res = { model: 'claude-sonnet-4-20250514', usage: { input_tokens: 100, output_tokens: 50 } };
    await expect(recordAnthropicCost(res, FPB_ID, 'chat')).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. recordApiCall
// ─────────────────────────────────────────────────────────────────────────────

describe('recordApiCall', () => {
  let recordApiCall;
  beforeEach(async () => {
    ({ recordApiCall } = await import('../api/lib/api-cost.js'));
  });

  it('inserts a cost_api_events row with units=1', async () => {
    await recordApiCall('google_ads', 'campaigns_search', FPB_ID);
    const rows = insertsByTable['cost_api_events'];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      vendor:     'google_ads',
      event_type: 'campaigns_search',
      account_id: FPB_ID,
      units:      1,
    });
  });

  it('includes metadata when provided', async () => {
    await recordApiCall('meta_ads', 'creative_upload', FPB_ID, { format: 'feed' });
    expect(insertsByTable['cost_api_events'][0].metadata).toEqual({ format: 'feed' });
  });

  it('swallows DB error without throwing', async () => {
    overrides['cost_api_events.insert'] = { data: null, error: { message: 'timeout' } };
    await expect(recordApiCall('meta_ads', 'campaigns_read', FPB_ID)).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. computeMonthlyRollup
// ─────────────────────────────────────────────────────────────────────────────
//
// Each test enqueues responses in the exact order computeMonthlyRollup
// queries them:
//   1. cost_api_events  (select)
//   2. accounts         (select — active tenant count)
//   3. cost_subscriptions (select — shared subs)
//   4. cost_subscriptions (select — account-specific subs)
//   5. accounts:single  (select+single — account slug)
//   6. cost_hours       (select — hours for this account)
//   7. cost_rollups_monthly (upsert — write result)

describe('computeMonthlyRollup', () => {
  let computeMonthlyRollup;
  beforeEach(async () => {
    ({ computeMonthlyRollup } = await import('../api/lib/cost-rollup.js'));
  });

  function baseSetup(eventsRows = [], activeAccounts = [{ id: FPB_ID }], sharedSubs = [], acctSubs = [], hoursRows = [], accountSlug = 'fpb') {
    enqueue('cost_api_events', { data: eventsRows, error: null });
    enqueue('accounts',        { data: activeAccounts, error: null });
    enqueue('cost_subscriptions', { data: sharedSubs, error: null });
    enqueue('cost_subscriptions', { data: acctSubs,   error: null });
    enqueue('accounts:single', { data: { slug: accountSlug }, error: null });
    enqueue('cost_hours',      { data: hoursRows, error: null });
  }

  it('aggregates Anthropic tokens and costs', async () => {
    baseSetup([
      { vendor: 'anthropic', tokens_in: 10_000, tokens_out: 5_000, units: null, cost_usd: 0.105 },
      { vendor: 'anthropic', tokens_in:  2_000, tokens_out: 1_000, units: null, cost_usd: 0.021 },
    ]);
    const rollup = await computeMonthlyRollup(FPB_ID, '2026-05');
    expect(rollup.anthropic_input_tokens).toBe(12_000);
    expect(rollup.anthropic_output_tokens).toBe(6_000);
    expect(rollup.anthropic_total_usd).toBeCloseTo(0.126, 5);
  });

  it('counts Google Ads and Meta Ads API calls', async () => {
    baseSetup([
      { vendor: 'google_ads', tokens_in: null, tokens_out: null, units: 1, cost_usd: null },
      { vendor: 'google_ads', tokens_in: null, tokens_out: null, units: 1, cost_usd: null },
      { vendor: 'meta_ads',   tokens_in: null, tokens_out: null, units: 1, cost_usd: null },
    ]);
    const rollup = await computeMonthlyRollup(FPB_ID, '2026-05');
    expect(rollup.google_ads_calls).toBe(2);
    expect(rollup.meta_ads_calls).toBe(1);
  });

  it('splits shared subscription evenly by active tenant count', async () => {
    // $30 shared across 3 tenants = $10 per tenant
    baseSetup(
      [],
      [{ id: FPB_ID }, { id: 'weld-uuid' }, { id: 'fsc-uuid' }],
      [{ monthly_amount_usd: 30 }],
      [],   // no account-specific subs
    );
    const rollup = await computeMonthlyRollup(FPB_ID, '2026-05');
    expect(rollup.subscription_share_usd).toBeCloseTo(10, 4);
  });

  it('adds account-specific subscription at full amount', async () => {
    // $20 account-specific (not shared)
    baseSetup(
      [],
      [{ id: FPB_ID }],
      [],                             // no shared subs
      [{ monthly_amount_usd: 20 }],   // account-specific
    );
    const rollup = await computeMonthlyRollup(FPB_ID, '2026-05');
    expect(rollup.subscription_share_usd).toBeCloseTo(20, 4);
  });

  it('aggregates hours by focus_area = account slug', async () => {
    baseSetup([], [{ id: FPB_ID }], [], [], [{ hours: 2.5 }, { hours: 1.0 }]);
    const rollup = await computeMonthlyRollup(FPB_ID, '2026-05');
    expect(rollup.hours_total).toBeCloseTo(3.5, 2);
  });

  it('upserts the rollup row into cost_rollups_monthly', async () => {
    baseSetup();
    await computeMonthlyRollup(FPB_ID, '2026-05');
    const upserted = upsertsByTable['cost_rollups_monthly'];
    expect(upserted).toHaveLength(1);
    expect(upserted[0].row).toMatchObject({ account_id: FPB_ID, year_month: '2026-05' });
  });

  it('throws when the cost_api_events query returns an error', async () => {
    enqueue('cost_api_events', { data: null, error: { message: 'DB error' } });
    await expect(computeMonthlyRollup(FPB_ID, '2026-05')).rejects.toThrow('cost_api_events');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. GET /api/cost-rollup
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/cost-rollup', () => {
  let handler;

  beforeEach(async () => {
    handler = (await import('../api/cost-rollup.js')).default;
  });

  function setupRollupQueues() {
    enqueue('cost_api_events', { data: [], error: null });
    enqueue('accounts',        { data: [{ id: FPB_ID }], error: null });
    enqueue('cost_subscriptions', { data: [], error: null });
    enqueue('cost_subscriptions', { data: [], error: null });
    enqueue('accounts:single', { data: { slug: 'fpb' }, error: null });
    enqueue('cost_hours',      { data: [], error: null });
  }

  it('returns success with a rollup for valid month', async () => {
    setupRollupQueues();
    const req = makeReq({ query: { month: '2026-05' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
    expect(res._json.rollup).toBeDefined();
    expect(res._json.rollup.year_month).toBe('2026-05');
  });

  it('defaults month to current YYYY-MM when not provided', async () => {
    setupRollupQueues();
    const req = makeReq({ query: {} });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._json.rollup.year_month).toMatch(/^\d{4}-\d{2}$/);
  });

  it('returns 400 for invalid month format', async () => {
    const req = makeReq({ query: { month: '2026/05' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/YYYY-MM/);
  });

  it('returns 405 for POST', async () => {
    const req = makeReq({ method: 'POST' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(405);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. GET + POST /api/cost-subscriptions
// ─────────────────────────────────────────────────────────────────────────────

describe('/api/cost-subscriptions', () => {
  let handler;
  beforeEach(async () => {
    ({ default: handler } = await import('../api/cost-subscriptions.js'));
  });

  it('GET returns subscription list', async () => {
    overrides['cost_subscriptions.select'] = {
      data: [{ id: 'sub-1', vendor: 'anthropic', plan: 'pro', monthly_amount_usd: 20 }],
      error: null,
    };
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
    expect(Array.isArray(res._json.data)).toBe(true);
  });

  it('POST creates a subscription row', async () => {
    overrides['cost_subscriptions.insert.single'] = {
      data: { id: 'sub-new', vendor: 'vercel', plan: 'pro', monthly_amount_usd: 20 },
      error: null,
    };
    const req = makeReq({
      method: 'POST',
      body: { vendor: 'vercel', plan: 'pro', monthly_amount_usd: 20, started_at: '2026-01-01T00:00:00Z' },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(201);
    expect(res._json.success).toBe(true);
    const inserted = insertsByTable['cost_subscriptions'];
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ vendor: 'vercel', plan: 'pro', monthly_amount_usd: 20 });
  });

  it('POST returns 400 when vendor is missing', async () => {
    const req = makeReq({
      method: 'POST',
      body: { plan: 'pro', monthly_amount_usd: 20, started_at: '2026-01-01T00:00:00Z' },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/vendor/i);
  });

  it('POST returns 400 for negative monthly_amount_usd', async () => {
    const req = makeReq({
      method: 'POST',
      body: { vendor: 'vercel', plan: 'pro', monthly_amount_usd: -5, started_at: '2026-01-01T00:00:00Z' },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. GET + POST /api/cost-hours
// ─────────────────────────────────────────────────────────────────────────────

describe('/api/cost-hours', () => {
  let handler;
  beforeEach(async () => {
    ({ default: handler } = await import('../api/cost-hours.js'));
  });

  it('GET returns hours list', async () => {
    overrides['cost_hours.select'] = {
      data: [{ id: 'h-1', hours: 2.5, focus_area: 'fpb', category: 'build', log_date: '2026-05-19' }],
      error: null,
    };
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
    expect(Array.isArray(res._json.data)).toBe(true);
  });

  it('POST creates a hours entry', async () => {
    overrides['cost_hours.insert.single'] = {
      data: { id: 'h-new', hours: 3.5, focus_area: 'fpb', category: 'build' },
      error: null,
    };
    const req = makeReq({
      method: 'POST',
      body: { hours: 3.5, focus_area: 'fpb', category: 'build', notes: 'Cost ledger work' },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(201);
    expect(res._json.success).toBe(true);
    const inserted = insertsByTable['cost_hours'];
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ hours: 3.5, focus_area: 'fpb', category: 'build' });
  });

  it('POST returns 400 for invalid category', async () => {
    const req = makeReq({
      method: 'POST',
      body: { hours: 2, focus_area: 'fpb', category: 'invalid_category' },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/category/i);
  });

  it('POST returns 400 when hours is missing', async () => {
    const req = makeReq({ method: 'POST', body: { focus_area: 'fpb', category: 'build' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/hours/i);
  });

  it('POST returns 400 for negative hours', async () => {
    const req = makeReq({ method: 'POST', body: { hours: -1, focus_area: 'fpb', category: 'build' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
  });
});
