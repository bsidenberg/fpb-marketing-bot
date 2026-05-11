// ============================================================
// tests/evaluate-outcomes.test.js
// Tests for the evaluate-outcomes handler:
//   • feature-flag gating of the per-account loop
//   • Sub-Task 7 deferred hole: performance_snapshots fallback now
//     filters by account_id (regression)
//   • Sub-Task 7 deferred hole: countLeads now filters by account_id,
//     not the legacy client_key='fpb' literal (regression)
//   • action_outcomes upsert includes account_id + slug-based client_key
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock ────────────────────────────────────────────────────────────
// Tracks .eq calls per table so tests can verify scoping. Tracks upserts
// per table so tests can verify row content. Returns mockable per-table
// data on bare `await` (terminal then).

let mockActionsList   = [];
let mockLeadsList     = [];
let mockSnapshotsList = [];

const eqCallsByTable  = {};
const upsertsByTable  = {};
const insertsByTable  = {};

function makeChain(table) {
  const chain = {
    select: () => chain,
    eq: (col, val) => {
      (eqCallsByTable[table] = eqCallsByTable[table] || []).push([col, val]);
      return chain;
    },
    gte:    () => chain,
    lt:     () => chain,
    order:  () => chain,
    limit:  () => chain,
    insert: (row) => {
      (insertsByTable[table] = insertsByTable[table] || []).push(row);
      return chain;
    },
    update: () => chain,
    upsert: (row, opts) => {
      (upsertsByTable[table] = upsertsByTable[table] || []).push({ row, opts });
      return chain;
    },
    single: async () => ({ data: null, error: null }),
    then: (resolve) => {
      if (table === 'actions')                return resolve({ data: mockActionsList,   error: null });
      if (table === 'leads')                  return resolve({ data: mockLeadsList,     error: null });
      if (table === 'performance_snapshots')  return resolve({ data: mockSnapshotsList, error: null });
      return resolve({ data: null, error: null });
    },
  };
  return chain;
}

vi.mock('../api/lib/supabase.js', () => ({
  default: { from: (table) => makeChain(table) },
}));

// ── Accounts mock ────────────────────────────────────────────────────────────
const FPB  = { id: 'fpb-uuid',  slug: 'fpb',  status: 'active' };
const WELD = { id: 'weld-uuid', slug: 'weld', status: 'active' };

let mockAccountsList = [];
let mockBySlug      = {};

vi.mock('../api/lib/accounts.js', () => ({
  FPB_DEFAULT_SLUG: 'fpb',
  listActiveAccounts: async () => mockAccountsList,
  getAccountBySlug:   async (slug) => mockBySlug[slug] ?? null,
}));

// ── campaign-stats mock — control whether daily_stats fallback fires ─────────
const { mockGetCampaignSpend } = vi.hoisted(() => ({
  mockGetCampaignSpend: vi.fn(),
}));

vi.mock('../api/lib/campaign-stats.js', () => ({
  getCampaignSpend: mockGetCampaignSpend,
}));

import handler from '../api/evaluate-outcomes.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeReq(overrides = {}) {
  return {
    method:  'GET',
    url:     '/api/evaluate-outcomes',
    headers: { 'x-vercel-cron': '1' },
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

// Build an action old enough to clear the WINDOW_DAYS cutoff
function makeAction(account, overrides = {}) {
  return {
    id:               `action-${account.slug}-1`,
    account_id:       account.id,
    action_type:      'pause_campaign',
    channel:          'google_ads',
    execution_data:   { campaign_id: 'camp-1' },
    executed_at:      '2025-01-01T00:00:00Z', // very old, passes any cutoff
    reviewed_at:      '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(eqCallsByTable))  delete eqCallsByTable[k];
  for (const k of Object.keys(upsertsByTable))  delete upsertsByTable[k];
  for (const k of Object.keys(insertsByTable))  delete insertsByTable[k];

  mockActionsList   = [];
  mockLeadsList     = [];
  mockSnapshotsList = [];
  mockAccountsList  = [];
  mockBySlug        = { fpb: FPB, weld: WELD };
  mockGetCampaignSpend.mockResolvedValue(null); // default: force fallback

  delete process.env.ENABLE_MULTI_ACCOUNT_CRON;
});

// ── Feature flag gating ──────────────────────────────────────────────────────

describe('evaluate-outcomes — ENABLE_MULTI_ACCOUNT_CRON feature flag', () => {
  it('with flag unset (default), queries actions filtered by FPB account_id only', async () => {
    mockAccountsList = [FPB, WELD]; // would return both if flag were on
    mockActionsList  = [];          // no actions to evaluate, still verifies the SELECT scope

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.multi_account).toBe(false);

    // The actions SELECT must have filtered by FPB.id and only FPB.id
    const actionsAccountEqs = (eqCallsByTable['actions'] || [])
      .filter(([col]) => col === 'account_id')
      .map(([_, val]) => val);
    expect(actionsAccountEqs).toEqual([FPB.id]);
  });

  it('with flag = true, loops over every active account and filters per-account', async () => {
    process.env.ENABLE_MULTI_ACCOUNT_CRON = 'true';
    mockAccountsList = [FPB, WELD];

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._body.multi_account).toBe(true);

    // Both account ids should appear in the .eq('account_id', ...) filters
    const actionsAccountEqs = (eqCallsByTable['actions'] || [])
      .filter(([col]) => col === 'account_id')
      .map(([_, val]) => val);
    expect(actionsAccountEqs).toEqual(expect.arrayContaining([FPB.id, WELD.id]));
    expect(actionsAccountEqs).toHaveLength(2);
  });
});

// ── Sub-Task 7 deferred hole: countLeads now filters by account_id ───────────

describe('evaluate-outcomes — countLeads is account-scoped (Sub-Task 7 deferred fix)', () => {
  it('uses .eq("account_id", accountId) and never .eq("client_key", "fpb")', async () => {
    mockActionsList = [makeAction(FPB)];
    mockGetCampaignSpend.mockResolvedValue(50); // skip the snapshots fallback path

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);

    const leadsEqs = eqCallsByTable['leads'] || [];

    // Filtered by account_id
    const accountEqs = leadsEqs.filter(([col]) => col === 'account_id');
    expect(accountEqs.map(([_, val]) => val)).toContain(FPB.id);

    // Legacy filter is gone
    const clientKeyEqs = leadsEqs.filter(([col]) => col === 'client_key');
    expect(clientKeyEqs).toHaveLength(0);
  });
});

// ── Sub-Task 7 deferred hole: performance_snapshots fallback is account-scoped ─

describe('evaluate-outcomes — performance_snapshots fallback is account-scoped (Sub-Task 7 deferred fix)', () => {
  it('queries performance_snapshots with .eq("account_id", accountId) when daily_stats has no data', async () => {
    mockActionsList = [makeAction(FPB)];
    mockGetCampaignSpend.mockResolvedValue(null); // force fallback into performance_snapshots

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);

    const snapshotsEqs = eqCallsByTable['performance_snapshots'] || [];
    expect(snapshotsEqs.length).toBeGreaterThan(0);

    const accountEqs = snapshotsEqs.filter(([col]) => col === 'account_id');
    expect(accountEqs.map(([_, val]) => val)).toContain(FPB.id);
  });

  it('queries performance_snapshots with the right account_id per-account in multi-account mode', async () => {
    process.env.ENABLE_MULTI_ACCOUNT_CRON = 'true';
    mockAccountsList = [FPB, WELD];
    mockActionsList  = [makeAction(FPB), makeAction(WELD)];
    mockGetCampaignSpend.mockResolvedValue(null);

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const snapshotsAccountEqs = (eqCallsByTable['performance_snapshots'] || [])
      .filter(([col]) => col === 'account_id')
      .map(([_, val]) => val);

    // Each account's snapshot fallback uses its own account_id
    expect(snapshotsAccountEqs).toEqual(expect.arrayContaining([FPB.id, WELD.id]));
  });
});

// ── action_outcomes upsert includes account_id and slug-based client_key ─────

describe('evaluate-outcomes — action_outcomes upsert', () => {
  it('upsert row includes account_id and client_key matching account.slug', async () => {
    mockActionsList = [makeAction(FPB)];
    mockGetCampaignSpend.mockResolvedValue(50);

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(upsertsByTable['action_outcomes']).toHaveLength(1);
    const upserted = upsertsByTable['action_outcomes'][0].row;
    expect(upserted.account_id).toBe(FPB.id);
    expect(upserted.client_key).toBe('fpb'); // slug-based, not hardcoded
    expect(upserted.action_id).toBe('action-fpb-1');
  });

  it('does NOT upsert when dry_run=true', async () => {
    mockActionsList = [makeAction(FPB)];
    mockGetCampaignSpend.mockResolvedValue(50);

    const req = makeReq({ query: { dry_run: 'true' } });
    const res = makeRes();
    await handler(req, res);

    expect(upsertsByTable['action_outcomes']).toBeUndefined();
    expect(res._body.dry_run).toBe(true);
  });
});
