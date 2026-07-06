// ============================================================
// tests/execution-hardening.test.js — SESSION-06B
// Execution-integrity tests for execute-action-logic.js:
//   • before/after snapshots + rollback payload per action_type
//   • dry-run NEVER calls a platform mutate endpoint
//   • fail-closed: live mutation without a before-snapshot never fires
//     and never stores a rollback derived from missing data
//   • reviewed_by is set on the same update that finalizes the row
//     ('admin' / 'system:execute-secret' / 'system:auto' — never null)
//   • a SESSION-05 guard block precedes snapshot capture entirely
//
// Supabase mock here CAPTURES update payloads so tests can assert the
// exact columns written to the action row.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STATUS } from '../api/lib/action-states.js';

// ── Supabase mock: queue for reads, capture for updates ──────────────────────
const singleQueue = [];
const updateCalls = []; // { table, payload }

function makeChain(table) {
  const chain = {
    select:      () => chain,
    eq:          () => chain,
    in:          () => chain,
    is:          () => chain,
    update:      (payload) => { updateCalls.push({ table, payload }); return chain; },
    insert:      () => chain,
    single:      async () => singleQueue.shift() ?? { data: null, error: null },
    maybeSingle: async () => singleQueue.shift() ?? { data: null, error: null },
    then:        (resolve) => resolve({ data: null, error: null }),
  };
  return chain;
}

vi.mock('../api/lib/supabase.js', () => ({
  default: { from: (table) => makeChain(table) },
}));

// ── Mock fetch ────────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Mock budget guards / cost ledger / autonomy outcome recording ────────────
vi.mock('../api/lib/budget-guards.js', () => ({
  runBudgetGuardsForExecution: vi.fn(async () => ({ verdict: 'allow', reason: null, triggered: [] })),
}));
vi.mock('../api/lib/api-cost.js', () => ({
  recordApiCall: vi.fn(async () => {}),
}));
vi.mock('../api/lib/autonomy-coordinator.js', () => ({
  recordActionOutcome: vi.fn(() => {}),
}));

// ── Accounts mock (endpoint-level test only) ──────────────────────────────────
vi.mock('../api/lib/accounts.js', () => ({
  FPB_DEFAULT_SLUG: 'fpb',
  resolveForWrite:  async () => ({ id: 'fpb-uuid', slug: 'fpb', status: 'active' }),
  getConnectionForAccount: async () => null,
  checkConnectionFields:   () => null,
}));

// Import AFTER mocks are registered
import { acquireLockAndExecute } from '../api/lib/execute-action-logic.js';
import { runBudgetGuardsForExecution } from '../api/lib/budget-guards.js';
import { recordApiCall } from '../api/lib/api-cost.js';
import { recordActionOutcome } from '../api/lib/autonomy-coordinator.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const FPB_ACCOUNT = { id: 'fpb-uuid', slug: 'fpb', status: 'active' };

const GOOGLE_CONN = {
  account_id: 'fpb-uuid',
  platform:   'google_ads',
  connection_status:            'active',
  resolved_account_id_external: '8325311811',
  resolved_manager_account_id:  '5435219372',
  resolved_refresh_token:       'test-google-refresh-token',
  resolved_access_token:        null,
};

const META_CONN = {
  account_id: 'fpb-uuid',
  platform:   'meta_ads',
  connection_status:            'active',
  resolved_account_id_external: '123456789',
  resolved_access_token:        'test-meta-access-token',
  resolved_refresh_token:       null,
  resolved_manager_account_id:  null,
};

// ── Canned fetch responses ────────────────────────────────────────────────────
const OAUTH_OK = { ok: true, json: async () => ({ access_token: 'test-token' }) };
const gaql = (payload) => ({ ok: true, text: async () => JSON.stringify(payload) });
const BUDGET_LOOKUP_25 = gaql({
  results: [{
    campaign:       { campaignBudget: 'customers/8325311811/campaignBudgets/987654321' },
    campaignBudget: { amountMicros: '25000000' },
  }],
});
const BUDGET_READ_25  = gaql({ results: [{ campaignBudget: { id: '987654321', amountMicros: '25000000' } }] });
const STATUS_ENABLED  = gaql({ results: [{ campaign: { status: 'ENABLED' } }] });
const STATUS_PAUSED   = gaql({ results: [{ campaign: { status: 'PAUSED' } }] });
const MUTATE_OK       = gaql({ results: [] });

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeAction(overrides = {}) {
  return {
    id:             'action-123',
    account_id:     FPB_ACCOUNT.id,
    status:         STATUS.PENDING,
    action_type:    'pause_campaign',
    result:         null,
    execution_data: {},
    auto_execute:   false,
    ...overrides,
  };
}

function queueResults(...results) {
  singleQueue.length = 0;
  singleQueue.push(...results);
}

/** The update that finalizes the action row (last update on 'actions'). */
function finalActionsUpdate() {
  const rows = updateCalls.filter((u) => u.table === 'actions');
  return rows.length ? rows[rows.length - 1].payload : null;
}

/** True if any fetch call was a platform mutate (Google :mutate URL or Meta POST). */
function mutateWasCalled() {
  return mockFetch.mock.calls.some(([url, opts]) =>
    String(url).includes(':mutate') ||
    (String(url).includes('graph.facebook.com') && opts?.method === 'POST')
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  singleQueue.length = 0;
  updateCalls.length = 0;
  runBudgetGuardsForExecution.mockReset();
  runBudgetGuardsForExecution.mockResolvedValue({ verdict: 'allow', reason: null, triggered: [] });

  process.env.GOOGLE_ADS_CLIENT_ID       = 'test-client-id';
  process.env.GOOGLE_ADS_CLIENT_SECRET   = 'test-secret';
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
  process.env.META_PAGE_ID               = '987654321';
});

// ── Live snapshots + rollback per action_type ─────────────────────────────────

describe('live execution — before/after snapshots and rollback payload', () => {

  it('adjust_budget (slow path): before-snapshot rides the existing lookup, rollback restores old amount', async () => {
    const action = makeAction({
      action_type:    'adjust_budget',
      channel:        'google',
      execution_data: { campaign_id: '123456789', recommended_value: 50 },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch
      .mockResolvedValueOnce(OAUTH_OK)
      .mockResolvedValueOnce(BUDGET_LOOKUP_25)
      .mockResolvedValueOnce(MUTATE_OK);

    const { body } = await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: GOOGLE_CONN, reviewedBy: 'admin',
    });
    expect(body.executed).toBe(true);
    expect(body.execution_mode).toBe('live');

    const upd = finalActionsUpdate();
    expect(upd.execution_mode).toBe('live');
    expect(upd.result).toBe('success');
    expect(upd.executed_at).toBeTruthy();
    expect(upd.reviewed_by).toBe('admin');
    expect(upd.before_snapshot).toMatchObject({ budget_id: '987654321', amount_micros: 25000000, amount_usd: 25 });
    expect(upd.after_snapshot).toMatchObject({ budget_id: '987654321', amount_usd: 50, derived: true });
    expect(upd.rollback_payload).toEqual(expect.objectContaining({
      action_type:       'adjust_budget',
      budget_id:         '987654321',
      recommended_value: 25,
    }));
  });

  it('adjust_budget (fast path): dedicated snapshot read is cost-ledger recorded', async () => {
    const action = makeAction({
      action_type:    'adjust_budget',
      channel:        'google',
      execution_data: { campaign_id: '123456789', budget_id: '987654321', recommended_value: 50 },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch
      .mockResolvedValueOnce(OAUTH_OK)
      .mockResolvedValueOnce(BUDGET_READ_25)
      .mockResolvedValueOnce(MUTATE_OK);

    const { body } = await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: GOOGLE_CONN, reviewedBy: 'admin',
    });
    expect(body.executed).toBe(true);
    expect(recordApiCall).toHaveBeenCalledWith('google_ads', 'snapshot_read', 'fpb-uuid');

    const upd = finalActionsUpdate();
    expect(upd.before_snapshot).toMatchObject({ amount_usd: 25 });
    expect(upd.rollback_payload).toMatchObject({ action_type: 'adjust_budget', recommended_value: 25 });
  });

  it('pause_campaign (Google): before status ENABLED, rollback resumes', async () => {
    const action = makeAction({
      action_type:    'pause_campaign',
      channel:        'google',
      execution_data: { campaign_id: '123456789' },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch
      .mockResolvedValueOnce(OAUTH_OK)
      .mockResolvedValueOnce(STATUS_ENABLED)
      .mockResolvedValueOnce(MUTATE_OK);

    const { body } = await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: GOOGLE_CONN, reviewedBy: 'admin',
    });
    expect(body.executed).toBe(true);

    const upd = finalActionsUpdate();
    expect(upd.before_snapshot).toMatchObject({ campaign_id: '123456789', status: 'ENABLED' });
    expect(upd.after_snapshot).toMatchObject({ status: 'PAUSED', derived: true });
    expect(upd.rollback_payload).toEqual(expect.objectContaining({
      action_type: 'resume_campaign',
      campaign_id: '123456789',
    }));
  });

  it('resume_campaign (Google): before status PAUSED, rollback pauses again', async () => {
    const action = makeAction({
      action_type:    'resume_campaign',
      channel:        'google',
      execution_data: { campaign_id: '123456789' },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch
      .mockResolvedValueOnce(OAUTH_OK)
      .mockResolvedValueOnce(STATUS_PAUSED)
      .mockResolvedValueOnce(MUTATE_OK);

    await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: GOOGLE_CONN, reviewedBy: 'admin',
    });

    const upd = finalActionsUpdate();
    expect(upd.before_snapshot).toMatchObject({ status: 'PAUSED' });
    expect(upd.rollback_payload).toMatchObject({ action_type: 'pause_campaign' });
  });

  it('add_negative_keyword: rollback carries the created criterion resource name', async () => {
    const action = makeAction({
      action_type:    'add_negative_keyword',
      channel:        'google',
      execution_data: { campaign_id: '123456789', keyword_text: 'competitor brand' },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch
      .mockResolvedValueOnce(OAUTH_OK)
      .mockResolvedValueOnce(gaql({ results: [{ resourceName: 'customers/8325311811/campaignCriteria/123456789~9876' }] }));

    const { body } = await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: GOOGLE_CONN, reviewedBy: 'admin',
    });
    expect(body.executed).toBe(true);

    const upd = finalActionsUpdate();
    expect(upd.before_snapshot).toMatchObject({ keyword_text: 'competitor brand', criterion: null });
    expect(upd.rollback_payload).toEqual(expect.objectContaining({
      action_type:             'remove_negative_keyword',
      criterion_resource_name: 'customers/8325311811/campaignCriteria/123456789~9876',
    }));
  });

  it('pause_campaign (Meta): before status ACTIVE read via Graph, rollback resumes', async () => {
    const action = makeAction({
      action_type:    'pause_campaign',
      channel:        'meta',
      execution_data: { campaign_id: 'camp-456' },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ACTIVE' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

    const { body } = await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: META_CONN, reviewedBy: 'admin',
    });
    expect(body.executed).toBe(true);
    expect(recordApiCall).toHaveBeenCalledWith('meta_ads', 'snapshot_read', 'fpb-uuid');

    const upd = finalActionsUpdate();
    expect(upd.before_snapshot).toMatchObject({ campaign_id: 'camp-456', status: 'ACTIVE' });
    expect(upd.rollback_payload).toMatchObject({ action_type: 'resume_campaign', campaign_id: 'camp-456' });
  });

  it('publish_creative: rollback stores delete_creative with the created ID (never auto-executed)', async () => {
    const action = makeAction({
      action_type:    'publish_creative',
      channel:        'meta',
      execution_data: { imageBase64: 'base64imagedata', adName: 'Test Ad' },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ images: { 'img1.jpg': { hash: 'imagehash-abc' } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'creative-789' }) });

    await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: META_CONN, reviewedBy: 'admin',
    });

    const upd = finalActionsUpdate();
    expect(upd.before_snapshot).toMatchObject({ note: expect.stringMatching(/creation/i) });
    expect(upd.after_snapshot).toMatchObject({ creative_id: 'creative-789', derived: true });
    expect(upd.rollback_payload).toMatchObject({ action_type: 'delete_creative', creative_id: 'creative-789' });
  });

  it('create_meta_campaign: rollback stores delete_campaign with created IDs', async () => {
    const action = makeAction({
      action_type:    'create_meta_campaign',
      channel:        'meta',
      execution_data: { campaignName: 'Test Campaign', dailyBudget: 50 },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'campaign-id-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'adset-id-1' }) });

    await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: META_CONN, reviewedBy: 'admin',
    });

    const upd = finalActionsUpdate();
    expect(upd.rollback_payload).toMatchObject({
      action_type: 'delete_campaign',
      campaign_id: 'campaign-id-1',
      ad_set_id:   'adset-id-1',
    });
  });

});

// ── Dry-run: NEVER calls a platform mutate endpoint ───────────────────────────

describe('dry-run — simulates everything, mutates nothing', () => {

  it('adjust_budget dry-run: guards+snapshot+rollback run, zero mutate calls, row marked dry_run', async () => {
    const action = makeAction({
      action_type:    'adjust_budget',
      channel:        'google',
      execution_data: { campaign_id: '123456789', recommended_value: 50 },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch
      .mockResolvedValueOnce(OAUTH_OK)
      .mockResolvedValueOnce(BUDGET_LOOKUP_25);

    const { body } = await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: GOOGLE_CONN, reviewedBy: 'admin', dryRun: true,
    });

    // NEVER invariant: no platform mutate endpoint touched
    expect(mutateWasCalled()).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2); // OAuth + lookup read only
    expect(runBudgetGuardsForExecution).toHaveBeenCalledTimes(1); // guards still ran

    expect(body.executed).toBe(false);
    expect(body.dry_run).toBe(true);
    expect(body.execution_mode).toBe('dry_run');
    expect(body.new_budget_usd).toBe(50); // what WOULD have happened

    const upd = finalActionsUpdate();
    expect(upd.execution_mode).toBe('dry_run');
    expect(upd.result).toBe('dry_run_success');
    expect(upd).not.toHaveProperty('executed_at'); // nothing executed
    expect(upd).not.toHaveProperty('status');      // nothing approved
    expect(upd.before_snapshot).toMatchObject({ amount_usd: 25 });
    expect(upd.rollback_payload).toMatchObject({ recommended_value: 25 });
    expect(upd.reviewed_by).toBe('admin'); // attribution of who ran the simulation
  });

  it('pause_campaign dry-run: status read happens, mutate does not', async () => {
    const action = makeAction({
      action_type:    'pause_campaign',
      channel:        'google',
      execution_data: { campaign_id: '123456789' },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch
      .mockResolvedValueOnce(OAUTH_OK)
      .mockResolvedValueOnce(STATUS_ENABLED);

    const { body } = await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: GOOGLE_CONN, reviewedBy: 'admin', dryRun: true,
    });
    expect(mutateWasCalled()).toBe(false);
    expect(body.dry_run).toBe(true);

    const upd = finalActionsUpdate();
    expect(upd.result).toBe('dry_run_success');
    expect(upd.rollback_payload).toMatchObject({ action_type: 'resume_campaign' });
    expect(upd.after_snapshot).toMatchObject({ status: 'PAUSED', simulated: true });
  });

  it('add_negative_keyword dry-run: no platform call at all, rollback null (criterion never created)', async () => {
    const action = makeAction({
      action_type:    'add_negative_keyword',
      channel:        'google',
      execution_data: { campaign_id: '123456789', keyword_text: 'competitor brand' },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });

    const { body } = await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: GOOGLE_CONN, reviewedBy: 'admin', dryRun: true,
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(body.dry_run).toBe(true);

    const upd = finalActionsUpdate();
    expect(upd.result).toBe('dry_run_success');
    expect(upd.rollback_payload).toBeNull();
    expect(upd.after_snapshot).toMatchObject({ simulated: true, keyword_text: 'competitor brand' });
  });

  it('create_meta_campaign dry-run: no platform call, simulated would_create returned', async () => {
    const action = makeAction({
      action_type:    'create_meta_campaign',
      channel:        'meta',
      execution_data: { campaignName: 'Test Campaign', dailyBudget: 50 },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });

    const { body } = await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: META_CONN, reviewedBy: 'admin', dryRun: true,
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(body.dry_run).toBe(true);
    expect(body.simulated).toBe(true);

    const upd = finalActionsUpdate();
    expect(upd.after_snapshot.would_create).toMatchObject({ campaign_name: 'Test Campaign', status: 'PAUSED' });
    expect(upd.rollback_payload).toBeNull();
  });

  it('dry-run proceeds on snapshot-read failure with a noted-null snapshot and NO rollback', async () => {
    const action = makeAction({
      action_type:    'pause_campaign',
      channel:        'google',
      execution_data: { campaign_id: '123456789' },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch
      .mockResolvedValueOnce(OAUTH_OK)
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'INTERNAL' });

    const { body } = await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: GOOGLE_CONN, reviewedBy: 'admin', dryRun: true,
    });
    expect(mutateWasCalled()).toBe(false);
    expect(body.dry_run).toBe(true);

    const upd = finalActionsUpdate();
    expect(upd.result).toBe('dry_run_success');
    expect(upd.before_snapshot).toMatchObject({ unavailable: true });
    expect(upd.rollback_payload).toBeNull(); // never derived from missing data
  });

  it('dry-run does not feed autonomy outcome stats; live does', async () => {
    const action = makeAction({
      action_type:    'pause_campaign',
      channel:        'google',
      execution_data: { campaign_id: '123456789' },
    });

    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch.mockResolvedValueOnce(OAUTH_OK).mockResolvedValueOnce(STATUS_ENABLED);
    await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: GOOGLE_CONN, reviewedBy: 'admin', dryRun: true,
    });
    expect(recordActionOutcome).not.toHaveBeenCalled();

    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch
      .mockResolvedValueOnce(OAUTH_OK)
      .mockResolvedValueOnce(STATUS_ENABLED)
      .mockResolvedValueOnce(MUTATE_OK);
    await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: GOOGLE_CONN, reviewedBy: 'admin',
    });
    expect(recordActionOutcome).toHaveBeenCalledTimes(1);
  });

});

// ── Fail closed: no before-snapshot → no live mutation, no bogus rollback ─────

describe('fail-closed — live mutation aborted when before-snapshot capture fails', () => {

  it('pause_campaign (Google): status read fails → no mutate, no rollback, clear reason', async () => {
    const action = makeAction({
      action_type:    'pause_campaign',
      channel:        'google',
      execution_data: { campaign_id: '123456789' },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch
      .mockResolvedValueOnce(OAUTH_OK)
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'INTERNAL' });

    const { body } = await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: GOOGLE_CONN, reviewedBy: 'admin',
    });
    expect(body.executed).toBe(false);
    expect(body.error).toMatch(/snapshot capture failed/i);
    expect(mutateWasCalled()).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2); // OAuth + failed read only

    const upd = finalActionsUpdate();
    expect(upd.result).toMatch(/snapshot capture failed/i);
    expect(upd.before_snapshot).toBeNull();
    expect(upd.rollback_payload).toBeNull(); // never store a rollback derived from missing data
    expect(upd.reviewed_by).toBe('admin');   // still attributed on the same finalizing update
  });

  it('adjust_budget (fast path): budget read missing amount → no mutate, no rollback', async () => {
    const action = makeAction({
      action_type:    'adjust_budget',
      channel:        'google',
      execution_data: { campaign_id: '123456789', budget_id: '987654321', recommended_value: 50 },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch
      .mockResolvedValueOnce(OAUTH_OK)
      .mockResolvedValueOnce(gaql({ results: [{ campaignBudget: { id: '987654321' } }] })); // no amountMicros

    const { body } = await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: GOOGLE_CONN, reviewedBy: 'admin',
    });
    expect(body.executed).toBe(false);
    expect(body.error).toMatch(/snapshot capture failed/i);
    expect(mutateWasCalled()).toBe(false);
    expect(finalActionsUpdate().rollback_payload).toBeNull();
  });

  it('adjust_budget (slow path): lookup resolves budget but omits amount → no mutate', async () => {
    const action = makeAction({
      action_type:    'adjust_budget',
      channel:        'google',
      execution_data: { campaign_id: '123456789', recommended_value: 50 },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch
      .mockResolvedValueOnce(OAUTH_OK)
      .mockResolvedValueOnce(gaql({
        results: [{ campaign: { campaignBudget: 'customers/8325311811/campaignBudgets/987654321' } }],
      })); // budget resource present, amountMicros absent

    const { body } = await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: GOOGLE_CONN, reviewedBy: 'admin',
    });
    expect(body.executed).toBe(false);
    expect(body.error).toMatch(/snapshot capture failed/i);
    expect(mutateWasCalled()).toBe(false);
    expect(finalActionsUpdate().rollback_payload).toBeNull();
  });

  it('pause_campaign (Meta): status missing from Graph read → no POST fired', async () => {
    const action = makeAction({
      action_type:    'pause_campaign',
      channel:        'meta',
      execution_data: { campaign_id: 'camp-456' },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // no status field

    const { body } = await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: META_CONN, reviewedBy: 'admin',
    });
    expect(body.executed).toBe(false);
    expect(body.error).toMatch(/snapshot capture failed/i);
    expect(mockFetch).toHaveBeenCalledTimes(1); // the read only
    expect(mutateWasCalled()).toBe(false);
    expect(finalActionsUpdate().rollback_payload).toBeNull();
  });

});

// ── reviewed_by — never null, auto override wins ──────────────────────────────

describe('reviewed_by attribution', () => {

  it('auto_execute=true rows attribute to system:auto regardless of caller identity', async () => {
    const action = makeAction({
      action_type:    'pause_campaign',
      channel:        'google',
      auto_execute:   true,
      execution_data: { campaign_id: '123456789' },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch
      .mockResolvedValueOnce(OAUTH_OK)
      .mockResolvedValueOnce(STATUS_ENABLED)
      .mockResolvedValueOnce(MUTATE_OK);

    await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: GOOGLE_CONN, reviewedBy: 'system:execute-secret',
    });
    expect(finalActionsUpdate().reviewed_by).toBe('system:auto');
  });

  it('falls back to system:execute-secret when no caller identity is supplied', async () => {
    const action = makeAction({
      action_type:    'pause_campaign',
      channel:        'google',
      execution_data: { campaign_id: '123456789' },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    mockFetch
      .mockResolvedValueOnce(OAUTH_OK)
      .mockResolvedValueOnce(STATUS_ENABLED)
      .mockResolvedValueOnce(MUTATE_OK);

    await acquireLockAndExecute('action-123', { account: FPB_ACCOUNT, connection: GOOGLE_CONN });
    const upd = finalActionsUpdate();
    expect(upd.reviewed_by).toBe('system:execute-secret');
    expect(upd.reviewed_by).not.toBeNull();
  });

  it('manual action types record reviewed_by on the approval update too', async () => {
    const action = makeAction({ action_type: 'adjust_bid' });
    queueResults({ data: action, error: null }); // preflight only — manual short-circuits

    const { body } = await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: null, reviewedBy: 'admin',
    });
    expect(body.requires_manual).toBe(true);
    expect(finalActionsUpdate().reviewed_by).toBe('admin');
  });

});

// ── SESSION-05 guard gate precedes ALL hardening ──────────────────────────────

describe('guard-block ordering — S05 block precedes snapshot capture', () => {

  it('a block verdict short-circuits before any snapshot read or mutate', async () => {
    const action = makeAction({
      action_type:    'adjust_budget',
      channel:        'google',
      execution_data: { campaign_id: '123456789', recommended_value: 500 },
    });
    queueResults({ data: action, error: null }, { data: action, error: null });
    runBudgetGuardsForExecution.mockResolvedValueOnce({
      verdict: 'block',
      reason:  'projected account daily spend exceeds the account daily spend cap',
      triggered: ['account_daily_cap'],
    });

    const { body } = await acquireLockAndExecute('action-123', {
      account: FPB_ACCOUNT, connection: GOOGLE_CONN, reviewedBy: 'admin',
    });
    expect(body.executed).toBe(false);
    expect(body.error).toMatch(/blocked by budget guard/i);
    expect(mockFetch).not.toHaveBeenCalled(); // no OAuth, no snapshot read, no mutate

    const upd = finalActionsUpdate();
    expect(upd.before_snapshot).toBeNull();
    expect(upd.rollback_payload).toBeNull();
    expect(upd.reviewed_by).toBe('admin');
  });

});

// ── Endpoint: transient path rejects dry_run ──────────────────────────────────

describe('execute-action endpoint — transient dry_run rejection', () => {

  it('returns 400 when dry_run=true is combined with the transient path', async () => {
    process.env.EXECUTE_SECRET = 'test-exec-secret';
    const handler = (await import('../api/execute-action.js')).default;

    const req = {
      method:  'POST',
      url:     '/api/execute-action?dry_run=true',
      query:   { dry_run: 'true' },
      headers: { 'x-execute-secret': 'test-exec-secret' },
      body:    { platform: 'google', actionType: 'pause_campaign', campaignId: '123456789' },
    };
    const res = {
      _statusCode: 200,
      _body:       null,
      status(c) { this._statusCode = c; return this; },
      json(b)   { this._body = b;       return this; },
      setHeader: () => {},
      end:       () => {},
    };

    await handler(req, res);
    expect(res._statusCode).toBe(400);
    expect(res._body.error).toMatch(/dry_run requires actionId/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

});
