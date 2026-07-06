// ============================================================
// tests/budget-guards.test.js — SESSION-05 spend-magnitude budget guards
//
// The evaluator is PURE — rule tests use plain objects, no mocks.
// Impure orchestrators (staging/execution) are tested against a
// table-keyed Supabase mock and a stubbed fetch.
//
// Every rule is tested on BOTH sides of its boundary:
//   increase limit  15%:   15 allow / 15.1 require_approval
//   decrease limit  20%:   20 allow / 20.5 require_approval
//   major change    25%:   24.9 minor / 25 always-approval (both directions)
//   aggressive dec  10%:   10 allow / 10.5 flagged when low data
//   min data        5:     4 low / 5 sufficient
//   account cap:           at-cap allow / over-cap BLOCK
//   last lead-gen:         1 enabled BLOCK / 2 enabled allow
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Table-keyed Supabase mock ─────────────────────────────────────────────────
let mockResponses = {};

function makeChain(table) {
  const chain = {
    select:      () => chain,
    eq:          () => chain,
    gte:         () => chain,
    insert:      () => chain,
    update:      () => chain,
    single:      () => Promise.resolve(getResponse()),
    maybeSingle: () => Promise.resolve(getResponse()),
    then: (resolve, reject) => Promise.resolve(getResponse()).then(resolve, reject),
  };
  function getResponse() {
    return mockResponses[table] ?? { data: null, error: null };
  }
  return chain;
}

vi.mock('../api/lib/supabase.js', () => ({
  default: { from: (table) => makeChain(table) },
}));

vi.mock('../api/lib/api-cost.js', () => ({
  recordApiCall: vi.fn(async () => {}),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  GUARD_DEFAULTS,
  GUARD_RELEVANT_TYPES,
  parseBudgetValue,
  mergeGuardConfig,
  classifyCpl,
  buildCplNote,
  evaluateBudgetGuards,
  runBudgetGuardsForStaging,
  runBudgetGuardsForExecution,
} from '../api/lib/budget-guards.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const ACCOUNT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const BRANDED    = '21613067518'; // default protected campaign

function adjust(recommendedValue, campaignId = '11111111', extra = {}) {
  return {
    action_type:    'adjust_budget',
    execution_data: { campaign_id: campaignId, recommended_value: recommendedValue, ...extra },
  };
}

function pause(campaignId = '11111111') {
  return { action_type: 'pause_campaign', execution_data: { campaign_id: campaignId } };
}

/** Healthy default state: $100/day budget, 2 enabled lead-gen campaigns, good data. */
function goodState(overrides = {}) {
  return {
    currentDailyBudget:   100,
    campaignStatus:       'ENABLED',
    enabledCampaigns:     [{ id: '11111111', dailyBudget: 100 }, { id: '22222222', dailyBudget: 50 }],
    conversionsLookback:  10,
    cplLookback:          45,
    accountDailySpendCap: null,
    lookbackDays:         14,
    ...overrides,
  };
}

beforeEach(() => {
  mockResponses = {};
  vi.clearAllMocks();
  process.env.GOOGLE_ADS_CLIENT_ID       = 'test-client-id';
  process.env.GOOGLE_ADS_CLIENT_SECRET   = 'test-secret';
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
});

// ── parseBudgetValue ──────────────────────────────────────────────────────────

describe('parseBudgetValue', () => {
  it('accepts bare numbers',            () => expect(parseBudgetValue(31)).toBe(31));
  it('accepts quoted numbers ("31")',   () => expect(parseBudgetValue('31')).toBe(31));
  it('accepts "$31/day"',               () => expect(parseBudgetValue('$31/day')).toBe(31));
  it('accepts "$1,500"',                () => expect(parseBudgetValue('$1,500')).toBe(1500));
  it('rejects non-numeric strings',     () => expect(parseBudgetValue('paused')).toBeNull());
  it('rejects null and undefined',      () => {
    expect(parseBudgetValue(null)).toBeNull();
    expect(parseBudgetValue(undefined)).toBeNull();
  });
  it('rejects zero',                    () => expect(parseBudgetValue(0)).toBeNull());
  it('rejects negative values',         () => expect(parseBudgetValue(-5)).toBeNull());
});

// ── mergeGuardConfig ──────────────────────────────────────────────────────────

describe('mergeGuardConfig', () => {
  it('returns code defaults when config row is absent', () => {
    const cfg = mergeGuardConfig(null, ACCOUNT_ID);
    expect(cfg).toEqual(GUARD_DEFAULTS);
  });

  it('jsonb defaults override code defaults', () => {
    const cfg = mergeGuardConfig({ defaults: { max_budget_increase_pct_per_day: 30 } }, ACCOUNT_ID);
    expect(cfg.max_budget_increase_pct_per_day).toBe(30);
    expect(cfg.max_budget_decrease_pct_per_day).toBe(20); // untouched default
  });

  it('account override wins over jsonb defaults', () => {
    const cfg = mergeGuardConfig({
      defaults:          { major_change_pct: 30 },
      account_overrides: { [ACCOUNT_ID]: { major_change_pct: 20 } },
    }, ACCOUNT_ID);
    expect(cfg.major_change_pct).toBe(20);
  });

  it('ignores overrides that belong to a different account', () => {
    const cfg = mergeGuardConfig({
      account_overrides: { 'other-account-uuid': { major_change_pct: 5 } },
    }, ACCOUNT_ID);
    expect(cfg.major_change_pct).toBe(GUARD_DEFAULTS.major_change_pct);
  });

  it('normalizes protected_campaigns entries to strings', () => {
    const cfg = mergeGuardConfig({ defaults: { protected_campaigns: [21613067518, '999'] } }, ACCOUNT_ID);
    expect(cfg.protected_campaigns).toEqual(['21613067518', '999']);
  });

  it('falls back to default protected list when the config value is not an array', () => {
    const cfg = mergeGuardConfig({ defaults: { protected_campaigns: 'oops' } }, ACCOUNT_ID);
    expect(cfg.protected_campaigns).toEqual(GUARD_DEFAULTS.protected_campaigns);
  });
});

// ── CPL bands ─────────────────────────────────────────────────────────────────

describe('classifyCpl / buildCplNote', () => {
  it('classifies at/below target as target',        () => expect(classifyCpl(50)).toBe('target'));
  it('classifies between target and warn',          () => expect(classifyCpl(74.99)).toBe('above_target'));
  it('classifies warn threshold as warn',           () => expect(classifyCpl(75)).toBe('warn'));
  it('classifies just under emergency as warn',     () => expect(classifyCpl(99.99)).toBe('warn'));
  it('classifies emergency threshold as emergency', () => expect(classifyCpl(100)).toBe('emergency'));
  it('classifies null as unknown',                  () => expect(classifyCpl(null)).toBe('unknown'));

  it('uses config bands, not constants', () => {
    const cfg = { ...GUARD_DEFAULTS, cpl_target: 40, cpl_warn: 60, cpl_emergency: 80 };
    expect(classifyCpl(70, cfg)).toBe('warn');
    expect(buildCplNote(70, cfg)).toContain('$40');
    expect(buildCplNote(70, cfg)).toContain('$60');
    expect(buildCplNote(70, cfg)).toContain('$80');
  });

  it('renders an unknown-CPL note when no data exists', () => {
    expect(buildCplNote(null, GUARD_DEFAULTS)).toMatch(/CPL unknown/);
  });
});

// ── evaluateBudgetGuards — magnitude rules ────────────────────────────────────

describe('evaluateBudgetGuards — budget increase/decrease limits', () => {
  it('allows an increase of exactly 15% (boundary)', () => {
    const r = evaluateBudgetGuards(adjust(115), goodState());
    expect(r.verdict).toBe('allow');
  });

  it('requires approval for an increase of 15.1%', () => {
    const r = evaluateBudgetGuards(adjust(115.1), goodState());
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('increase_limit');
    expect(r.reason).toMatch(/exceeds max_budget_increase_pct_per_day 15%/);
  });

  it('flags a 24.9% increase as increase_limit, not major_change', () => {
    const r = evaluateBudgetGuards(adjust(124.9), goodState());
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('increase_limit');
    expect(r.triggered).not.toContain('major_change');
  });

  it('flags a 25% increase as major_change — always requires approval regardless of tier', () => {
    const r = evaluateBudgetGuards(adjust(125), goodState());
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('major_change');
    expect(r.reason).toMatch(/regardless of autonomy tier/);
  });

  it('allows a decrease of exactly 20% (boundary)', () => {
    const r = evaluateBudgetGuards(adjust(80), goodState());
    expect(r.verdict).toBe('allow');
  });

  it('requires approval for a decrease of 20.5%', () => {
    const r = evaluateBudgetGuards(adjust(79.5), goodState());
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('decrease_limit');
  });

  it('flags a 25% decrease as major_change', () => {
    const r = evaluateBudgetGuards(adjust(75), goodState());
    expect(r.triggered).toContain('major_change');
  });

  it('flags a 30% decrease as major_change (>= is inclusive)', () => {
    const r = evaluateBudgetGuards(adjust(70), goodState());
    expect(r.triggered).toContain('major_change');
  });

  it('allows an unchanged budget (no-op)', () => {
    const r = evaluateBudgetGuards(adjust(100), goodState());
    expect(r.verdict).toBe('allow');
  });

  it('is immune to floating-point noise at the boundary (30 -> 34.5 = exactly 15%)', () => {
    const r = evaluateBudgetGuards(adjust(34.5), goodState({ currentDailyBudget: 30 }));
    expect(r.verdict).toBe('allow');
  });

  it('fails closed when the recommended value cannot be parsed', () => {
    const r = evaluateBudgetGuards(adjust('garbage$$'), goodState());
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('invalid_target_budget');
  });

  it('fails closed when the current budget is unknown', () => {
    const r = evaluateBudgetGuards(adjust(110), goodState({ currentDailyBudget: null }));
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('unknown_current_budget');
    expect(r.reason).toMatch(/current daily budget unknown/i);
  });

  it('honors config-driven limits instead of constants', () => {
    const cfg = { ...GUARD_DEFAULTS, max_budget_increase_pct_per_day: 30, major_change_pct: 50 };
    const r = evaluateBudgetGuards(adjust(125), goodState(), cfg); // 25% < 30%
    expect(r.verdict).toBe('allow');
  });
});

// ── evaluateBudgetGuards — account daily-spend cap (BLOCK) ────────────────────

describe('evaluateBudgetGuards — account daily-spend cap', () => {
  it('allows an increase that keeps projected spend at exactly the cap', () => {
    // others: 50; this campaign -> 110; projected 160 == cap 160
    const r = evaluateBudgetGuards(adjust(110), goodState({ accountDailySpendCap: 160 }));
    expect(r.verdict).toBe('allow');
  });

  it('BLOCKS an increase that pushes projected spend over the cap', () => {
    const r = evaluateBudgetGuards(adjust(115), goodState({ accountDailySpendCap: 160 }));
    expect(r.verdict).toBe('block');
    expect(r.triggered).toContain('account_daily_cap');
    expect(r.reason).toMatch(/exceeds the account daily spend cap \$160/);
  });

  it('replaces (not adds) the target campaign budget in the projection', () => {
    // enabled: target 100 + other 150; cap 260; target -> 105 => projected 255
    const state = goodState({
      enabledCampaigns:     [{ id: '11111111', dailyBudget: 100 }, { id: '22222222', dailyBudget: 150 }],
      accountDailySpendCap: 260,
    });
    expect(evaluateBudgetGuards(adjust(105), state).verdict).toBe('allow');
    expect(evaluateBudgetGuards(adjust(115), state).verdict).toBe('block'); // 265 > 260
  });

  it('fails closed to require_approval when a cap exists but enabled budgets are unknown', () => {
    const r = evaluateBudgetGuards(adjust(110), goodState({ accountDailySpendCap: 160, enabledCampaigns: null }));
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('cap_unverifiable');
  });

  it('skips the cap rule when no cap is configured', () => {
    const r = evaluateBudgetGuards(adjust(110), goodState({ accountDailySpendCap: null, enabledCampaigns: null }));
    expect(r.verdict).toBe('allow');
  });

  it('never applies the cap rule to decreases', () => {
    const r = evaluateBudgetGuards(adjust(90), goodState({ accountDailySpendCap: 100 })); // already "over cap"
    expect(r.triggered).not.toContain('account_daily_cap');
    expect(r.verdict).toBe('allow');
  });
});

// ── evaluateBudgetGuards — protected campaigns ────────────────────────────────

describe('evaluateBudgetGuards — protected campaigns', () => {
  it('requires approval to decrease a protected campaign, even a small decrease', () => {
    const r = evaluateBudgetGuards(adjust(95, BRANDED), goodState());
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('protected_campaign');
  });

  it('requires approval to pause a protected campaign', () => {
    const r = evaluateBudgetGuards(pause(BRANDED), goodState({
      enabledCampaigns: [{ id: BRANDED, dailyBudget: 20 }, { id: '22222222', dailyBudget: 50 }],
    }));
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('protected_campaign');
  });

  it('allows a within-limit increase on a protected campaign (rule covers pause/decrease only)', () => {
    const r = evaluateBudgetGuards(adjust(110, BRANDED), goodState());
    expect(r.verdict).toBe('allow');
  });

  it('coerces numeric campaign IDs when matching the protected list', () => {
    const action = {
      action_type:    'adjust_budget',
      execution_data: { campaign_id: 21613067518, recommended_value: 95 },
    };
    const r = evaluateBudgetGuards(action, goodState());
    expect(r.triggered).toContain('protected_campaign');
  });

  it('honors a custom protected list from config', () => {
    const cfg = { ...GUARD_DEFAULTS, protected_campaigns: ['55555555'] };
    expect(evaluateBudgetGuards(adjust(95, '55555555'), goodState(), cfg).triggered).toContain('protected_campaign');
    expect(evaluateBudgetGuards(adjust(95, BRANDED), goodState(), cfg).triggered).not.toContain('protected_campaign');
  });
});

// ── evaluateBudgetGuards — last enabled lead-gen campaign (BLOCK) ─────────────

describe('evaluateBudgetGuards — last enabled lead-gen campaign', () => {
  it('BLOCKS pausing the only enabled lead-gen campaign', () => {
    const r = evaluateBudgetGuards(pause('11111111'), goodState({
      enabledCampaigns: [{ id: '11111111', dailyBudget: 100 }],
    }));
    expect(r.verdict).toBe('block');
    expect(r.triggered).toContain('last_lead_gen_campaign');
    expect(r.reason).toMatch(/last enabled lead-gen campaign/);
  });

  it('does not block when a second enabled lead-gen campaign exists', () => {
    const r = evaluateBudgetGuards(pause('11111111'), goodState());
    expect(r.verdict).toBe('allow');
  });

  it('BLOCKS when the only other enabled campaign is protected (branded does not count as lead-gen)', () => {
    const r = evaluateBudgetGuards(pause('11111111'), goodState({
      enabledCampaigns: [{ id: '11111111', dailyBudget: 100 }, { id: BRANDED, dailyBudget: 20 }],
    }));
    expect(r.verdict).toBe('block');
    expect(r.triggered).toContain('last_lead_gen_campaign');
  });

  it('does not block pausing a campaign that is not currently enabled', () => {
    const r = evaluateBudgetGuards(pause('33333333'), goodState({
      enabledCampaigns: [{ id: '11111111', dailyBudget: 100 }],
    }));
    expect(r.triggered).not.toContain('last_lead_gen_campaign');
  });

  it('fails closed to require_approval when the enabled list is unavailable', () => {
    const r = evaluateBudgetGuards(pause('11111111'), goodState({ enabledCampaigns: null }));
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('last_campaign_unverifiable');
  });
});

// ── evaluateBudgetGuards — min data volume ────────────────────────────────────

describe('evaluateBudgetGuards — min data volume', () => {
  it('flags a pause on a campaign with 4 conversions (below min 5) — never auto-paused', () => {
    const r = evaluateBudgetGuards(pause('11111111'), goodState({ conversionsLookback: 4 }));
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('min_data_volume');
    expect(r.reason).toMatch(/never auto-paused/);
  });

  it('does not flag a pause with exactly 5 conversions (boundary)', () => {
    const r = evaluateBudgetGuards(pause('11111111'), goodState({ conversionsLookback: 5 }));
    expect(r.verdict).toBe('allow');
  });

  it('treats missing conversion data as low data (fail closed)', () => {
    const r = evaluateBudgetGuards(pause('11111111'), goodState({ conversionsLookback: null }));
    expect(r.triggered).toContain('min_data_volume');
    expect(r.reason).toMatch(/no conversion data/);
  });

  it('allows a decrease of exactly 10% on a low-data campaign (boundary)', () => {
    const r = evaluateBudgetGuards(adjust(90), goodState({ conversionsLookback: 2 }));
    expect(r.verdict).toBe('allow');
  });

  it('flags a 10.5% decrease on a low-data campaign', () => {
    const r = evaluateBudgetGuards(adjust(89.5), goodState({ conversionsLookback: 2 }));
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('min_data_volume');
  });

  it('does not flag a 10.5% decrease when data volume is sufficient', () => {
    const r = evaluateBudgetGuards(adjust(89.5), goodState({ conversionsLookback: 8 }));
    expect(r.verdict).toBe('allow');
  });

  it('never applies the low-data rule to increases', () => {
    const r = evaluateBudgetGuards(adjust(110), goodState({ conversionsLookback: 0 }));
    expect(r.verdict).toBe('allow');
  });
});

// ── evaluateBudgetGuards — CPL bands in reasons, precedence, relevance ────────

describe('evaluateBudgetGuards — reasons and verdict precedence', () => {
  it('appends the CPL band to every triggered reason', () => {
    const r = evaluateBudgetGuards(adjust(125), goodState({ cplLookback: 82 }));
    expect(r.reason).toMatch(/CPL \$82 is in the warn band/);
    expect(r.reason).toMatch(/target \$50 \/ warn \$75 \/ emergency \$100/);
  });

  it('uses config CPL bands in reasons, not constants', () => {
    const cfg = { ...GUARD_DEFAULTS, cpl_target: 40, cpl_warn: 60, cpl_emergency: 80 };
    const r = evaluateBudgetGuards(adjust(125), goodState({ cplLookback: 82 }), cfg);
    expect(r.reason).toMatch(/emergency band/);
    expect(r.reason).toMatch(/target \$40 \/ warn \$60 \/ emergency \$80/);
  });

  it('reports CPL unknown when no lookback data exists', () => {
    const r = evaluateBudgetGuards(adjust(125), goodState({ cplLookback: null }));
    expect(r.reason).toMatch(/CPL unknown/);
  });

  it('block wins over require_approval and leads the reason string', () => {
    // Pause the last lead-gen campaign that is ALSO low-data: block + flag
    const r = evaluateBudgetGuards(pause('11111111'), goodState({
      enabledCampaigns:    [{ id: '11111111', dailyBudget: 100 }],
      conversionsLookback: 2,
    }));
    expect(r.verdict).toBe('block');
    expect(r.triggered).toContain('last_lead_gen_campaign');
    expect(r.triggered).toContain('min_data_volume');
    expect(r.reason.indexOf('last enabled lead-gen')).toBeLessThan(r.reason.indexOf('low-data'));
  });

  it('returns allow for non-guarded action types', () => {
    for (const type of ['enable_campaign', 'resume_campaign', 'add_negative_keyword', 'publish_creative']) {
      const r = evaluateBudgetGuards({ action_type: type, execution_data: {} }, goodState());
      expect(r.verdict).toBe('allow');
    }
    expect(GUARD_RELEVANT_TYPES).toEqual(['adjust_budget', 'pause_campaign']);
  });
});

// ── runBudgetGuardsForStaging (impure) ────────────────────────────────────────

describe('runBudgetGuardsForStaging', () => {
  it('applies code defaults when no config row exists — 18% increase requires approval', async () => {
    const r = await runBudgetGuardsForStaging(ACCOUNT_ID, 'adjust_budget', {
      campaign_id: '11111111', current_value: 100, recommended_value: 118,
    });
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('increase_limit');
  });

  it('allows a small increase when lookback data is healthy', async () => {
    mockResponses['campaign_daily_stats'] = { data: [{ spend: 300, conversions: 6 }], error: null };
    const r = await runBudgetGuardsForStaging(ACCOUNT_ID, 'adjust_budget', {
      campaign_id: '11111111', current_value: 100, recommended_value: 110,
    });
    expect(r.verdict).toBe('allow');
  });

  it('honors agent_config overrides (config-driven, not constants)', async () => {
    mockResponses['agent_config'] = {
      data:  { config_value: { defaults: { max_budget_increase_pct_per_day: 30 } } },
      error: null,
    };
    mockResponses['campaign_daily_stats'] = { data: [{ spend: 300, conversions: 6 }], error: null };
    const r = await runBudgetGuardsForStaging(ACCOUNT_ID, 'adjust_budget', {
      campaign_id: '11111111', current_value: 100, recommended_value: 118, // 18% < 30%
    });
    expect(r.verdict).toBe('allow');
  });

  it('fails closed on pause at staging (enabled-campaign list is execution-time data)', async () => {
    mockResponses['campaign_daily_stats'] = { data: [{ spend: 300, conversions: 6 }], error: null };
    const r = await runBudgetGuardsForStaging(ACCOUNT_ID, 'pause_campaign', { campaign_id: '11111111' });
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('last_campaign_unverifiable');
  });

  it('falls back to defaults and still evaluates when the config fetch errors', async () => {
    mockResponses['agent_config'] = { data: null, error: { message: 'DB timeout' } };
    const r = await runBudgetGuardsForStaging(ACCOUNT_ID, 'adjust_budget', {
      campaign_id: '11111111', current_value: 100, recommended_value: 125,
    });
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('major_change');
  });

  it('returns allow for non-guarded action classes without touching the DB', async () => {
    const r = await runBudgetGuardsForStaging(ACCOUNT_ID, 'publish_blog_post', { anything: true });
    expect(r.verdict).toBe('allow');
  });
});

// ── runBudgetGuardsForExecution (impure) ──────────────────────────────────────

const EXEC_ACCOUNT = { id: ACCOUNT_ID, slug: 'fpb', status: 'active', daily_spend_cap: null };
const GOOGLE_CONN  = {
  resolved_account_id_external: '8325311811',
  resolved_manager_account_id:  '5435219372',
  resolved_refresh_token:       'test-refresh',
};

function mockGoogleLiveState(campaigns) {
  // campaigns: [{ id, status, budgetUsd }]
  mockFetch
    .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'live-token' }) })
    .mockResolvedValueOnce({
      ok:   true,
      text: async () => JSON.stringify({
        results: campaigns.map((c) => ({
          campaign:       { id: c.id, status: c.status },
          campaignBudget: { amountMicros: String(Math.round(c.budgetUsd * 1_000_000)) },
        })),
      }),
    });
}

describe('runBudgetGuardsForExecution', () => {
  it('uses LIVE Google budget for magnitude, ignoring a stale execution_data.current_value', async () => {
    mockResponses['campaign_daily_stats'] = { data: [{ spend: 300, conversions: 6 }], error: null };
    mockGoogleLiveState([
      { id: '11111111', status: 'ENABLED', budgetUsd: 100 },
      { id: '22222222', status: 'ENABLED', budgetUsd: 50 },
    ]);
    // stale current_value says 10 (which would make 110 a 1000% increase)
    const action = { ...adjust(110, '11111111', { current_value: 10 }), channel: 'google' };
    const r = await runBudgetGuardsForExecution(action, { account: EXEC_ACCOUNT, connection: GOOGLE_CONN });
    expect(r.verdict).toBe('allow'); // 100 -> 110 = 10% vs live truth
    expect(mockFetch.mock.calls[1][0]).toContain('googleAds:search');
  });

  it('BLOCKS when the live projection exceeds accounts.daily_spend_cap', async () => {
    mockResponses['campaign_daily_stats'] = { data: [{ spend: 300, conversions: 6 }], error: null };
    mockGoogleLiveState([
      { id: '11111111', status: 'ENABLED', budgetUsd: 100 },
      { id: '22222222', status: 'ENABLED', budgetUsd: 50 },
    ]);
    const account = { ...EXEC_ACCOUNT, daily_spend_cap: 160 };
    const action  = { ...adjust(112, '11111111'), channel: 'google' }; // 112 + 50 = 162 > 160
    const r = await runBudgetGuardsForExecution(action, { account, connection: GOOGLE_CONN });
    expect(r.verdict).toBe('block');
    expect(r.triggered).toContain('account_daily_cap');
  });

  it('BLOCKS pausing the last enabled lead-gen campaign using live state', async () => {
    mockResponses['campaign_daily_stats'] = { data: [{ spend: 300, conversions: 6 }], error: null };
    mockGoogleLiveState([
      { id: '11111111', status: 'ENABLED', budgetUsd: 100 },
      { id: '22222222', status: 'PAUSED',  budgetUsd: 50 },
    ]);
    const action = { ...pause('11111111'), channel: 'google' };
    const r = await runBudgetGuardsForExecution(action, { account: EXEC_ACCOUNT, connection: GOOGLE_CONN });
    expect(r.verdict).toBe('block');
    expect(r.triggered).toContain('last_lead_gen_campaign');
  });

  it('fails closed when the live Google fetch fails and a cap is configured', async () => {
    mockResponses['campaign_daily_stats'] = { data: [{ spend: 300, conversions: 6 }], error: null };
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'live-token' }) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'INTERNAL' });
    const account = { ...EXEC_ACCOUNT, daily_spend_cap: 160 };
    const action  = { ...adjust(110, '11111111', { current_value: 100 }), channel: 'google' };
    const r = await runBudgetGuardsForExecution(action, { account, connection: GOOGLE_CONN });
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('cap_unverifiable');
  });

  it('recognizes every dispatcher Google channel variant — block rules stay live (safety finding #1)', async () => {
    // 'Google Ads' (display variant) must still trigger the live-state fetch;
    // otherwise the last-campaign BLOCK would silently downgrade to approval.
    mockResponses['campaign_daily_stats'] = { data: [{ spend: 300, conversions: 6 }], error: null };
    mockGoogleLiveState([{ id: '11111111', status: 'ENABLED', budgetUsd: 100 }]);
    const action = { ...pause('11111111'), channel: 'Google Ads' };
    const r = await runBudgetGuardsForExecution(action, { account: EXEC_ACCOUNT, connection: GOOGLE_CONN });
    expect(r.verdict).toBe('block');
    expect(r.triggered).toContain('last_lead_gen_campaign');
    expect(mockFetch.mock.calls[1][0]).toContain('googleAds:search');
  });

  it('Meta pause gets NO live fetch and fails closed to require_approval', async () => {
    mockResponses['campaign_daily_stats'] = { data: [{ spend: 300, conversions: 6 }], error: null };
    const action = { ...pause('meta-camp-1'), channel: 'meta' };
    const r = await runBudgetGuardsForExecution(action, { account: EXEC_ACCOUNT, connection: null });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('last_campaign_unverifiable');
  });

  it('short-circuits to allow for non-guarded types without any fetch', async () => {
    const action = { action_type: 'add_negative_keyword', channel: 'google', execution_data: {} };
    const r = await runBudgetGuardsForExecution(action, { account: EXEC_ACCOUNT, connection: GOOGLE_CONN });
    expect(r.verdict).toBe('allow');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fails closed to require_approval when account context is missing', async () => {
    const action = { ...adjust(110), channel: 'google' };
    const r = await runBudgetGuardsForExecution(action, { account: null, connection: GOOGLE_CONN });
    expect(r.verdict).toBe('require_approval');
    expect(r.triggered).toContain('guard_error');
  });
});
