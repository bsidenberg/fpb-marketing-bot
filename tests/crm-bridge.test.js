// ============================================================
// tests/crm-bridge.test.js
// Tests for api/lib/crm-bridge.js (CRM -> Prime profit bridge helpers
// + runCrmSync) and api/cron-crm-sync.js (the nightly cron handler).
//
// Mock design mirrors tests/daily-stats.test.js / tests/cron-analyze.test.js:
//   • '@supabase/supabase-js' createClient mocked so createCrmClient()
//     never makes a real network call — it returns a controllable raw
//     CRM mock (vi.fn() insert/update/upsert/delete/rpc + a working
//     from().select() chain supporting .in()/.not()/.neq()).
//   • '../api/lib/supabase.js' mocked with a table-aware chain
//     (Prime side) that captures update() calls per lead so
//     assertions can inspect exact payload + which row was updated.
//   • Direct runCrmSync({ crm, prime }) tests pass hand-built mocks
//     straight in — createCrmClient()/createClient are only exercised
//     by the cron handler tests.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── supabase-js createClient mock (only used by createCrmClient) ────────────
const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateClient,
}));

// ── Prime supabase mock — captures leads.update() calls, serves leads.select()
//    and agent_config.select() fixtures, records automation_log inserts ─────
let primeLeadsFixture   = [];
let marginsFixture      = { kit: 0.20, turnkey: 0.20, default: 0.20 };
let primeUpdateCalls    = [];
let primeInsertsByTable = {};

function primeChain(table) {
  if (table === 'leads') {
    return {
      select: () => Promise.resolve({ data: primeLeadsFixture, error: null }),
      update: (payload) => ({
        eq: (col, val) => {
          primeUpdateCalls.push({ payload: { ...payload }, id: val });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    };
  }
  if (table === 'agent_config') {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(
            marginsFixture
              ? { data: { config_value: marginsFixture }, error: null }
              : { data: null, error: null }
          ),
        }),
      }),
    };
  }
  if (table === 'automation_log') {
    return {
      insert: (row) => {
        (primeInsertsByTable[table] = primeInsertsByTable[table] || []).push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }
  return { select: () => Promise.resolve({ data: [], error: null }) };
}

vi.mock('../api/lib/supabase.js', () => ({
  default: { from: (table) => primeChain(table) },
}));

// Import AFTER all mocks
import {
  createReadOnlyClient,
  normalizeEmail,
  normalizePhone,
  getMargins,
  computeRevenue,
  computeGrossProfit,
  gpSuffix,
  applyGpSuffix,
  AMBIGUOUS_MARKER,
  runCrmSync,
} from '../api/lib/crm-bridge.js';
import handler from '../api/cron-crm-sync.js';
import { AUTOMATION_LOG_EVENT_TYPES, AUTOMATION_LOG_STATUSES } from '../api/lib/automation-log-schema.js';

// ── mockPrime — the same chain, usable directly by runCrmSync() calls ──────
const mockPrime = { from: (table) => primeChain(table) };

// ── Raw CRM mock builder ─────────────────────────────────────────────────────
function buildCrmRaw({ leads = [], projects = [] } = {}) {
  const calls = { leadsIn: null, projectsNot: null, projectsNeq: null };
  return {
    insert: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    rpc:    vi.fn(),
    _calls: calls,
    from: (table) => {
      if (table === 'leads') {
        return {
          select: () => ({
            in: (col, vals) => {
              calls.leadsIn = { col, vals };
              return Promise.resolve({ data: leads, error: null });
            },
          }),
        };
      }
      if (table === 'projects') {
        return {
          select: () => ({
            not: (col, op, val) => {
              calls.projectsNot = { col, op, val };
              return {
                neq: (col2, val2) => {
                  calls.projectsNeq = { col: col2, val: val2 };
                  return Promise.resolve({ data: projects, error: null });
                },
              };
            },
          }),
        };
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    },
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
function primeLead(overrides = {}) {
  return {
    id:                    'prime-1',
    contact_email:         'jane@example.com',
    contact_phone:         '4075550134',
    contact_name:          'Jane Doe',
    lead_date:             '2026-06-01',
    created_at:            '2026-06-01T00:00:00Z',
    qualification_status:  'new',
    qualified_at:          null,
    booked_revenue:        null,
    gross_profit:          null,
    booked_at:             null,
    lost_at:               null,
    lost_reason:           null,
    estimated_value:       null,
    attribution_notes:     null,
    notes:                 null,
    ...overrides,
  };
}

function crmLead(overrides = {}) {
  return {
    id:                'crm-1',
    email:             'jane@example.com',
    phone:             '4075550134',
    alt_phone:         null,
    first_name:        'Jane',
    last_name:         'Doe',
    stage:             'won',
    stage_changed_at:  '2026-06-10T00:00:00Z',
    value:             5000,
    lost_reason:       null,
    service_type:      'Kit + Installation',
    created_at:        '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function crmProject(overrides = {}) {
  return {
    id:              'proj-1',
    lead_id:         'crm-1',
    project_type:    'turnkey',
    status:          'closed_won',
    contract_amount: 5000,
    ...overrides,
  };
}

function makeReq(overrides = {}) {
  return {
    method:  'GET',
    url:     '/api/cron-crm-sync',
    headers: { 'x-vercel-cron': '1', host: 'test.local' },
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

beforeEach(() => {
  vi.clearAllMocks();

  primeLeadsFixture   = [];
  marginsFixture      = { kit: 0.20, turnkey: 0.20, default: 0.20 };
  primeUpdateCalls    = [];
  primeInsertsByTable = {};

  mockCreateClient.mockReset();
  mockCreateClient.mockImplementation(() => buildCrmRaw({ leads: [], projects: [] }));

  process.env.CRM_SUPABASE_URL         = 'https://fake-crm.supabase.co';
  process.env.CRM_SUPABASE_SERVICE_KEY = 'fake-crm-key';
  delete process.env.CRON_SECRET;
});

// ============================================================================
// normalizeEmail
// ============================================================================

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  JANE@Example.COM  ')).toBe('jane@example.com');
  });

  it('returns null for null, empty string, and whitespace-only', () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail('   ')).toBeNull();
  });
});

// ============================================================================
// normalizePhone
// ============================================================================

describe('normalizePhone', () => {
  it('strips formatting: "(407) 555-0134" -> "4075550134"', () => {
    expect(normalizePhone('(407) 555-0134')).toBe('4075550134');
  });

  it('strips leading country code: "+1 407 555 0134" -> "4075550134"', () => {
    expect(normalizePhone('+1 407 555 0134')).toBe('4075550134');
  });

  it('returns null for fewer than 10 digits', () => {
    expect(normalizePhone('555-0134')).toBeNull();
  });

  it('returns null for null', () => {
    expect(normalizePhone(null)).toBeNull();
  });
});

// ============================================================================
// computeRevenue
// ============================================================================

describe('computeRevenue', () => {
  it('projects sum wins over leads.value', () => {
    const result = computeRevenue(crmLead({ value: 99999 }), [crmProject({ contract_amount: 500 })]);
    expect(result).toMatchObject({ revenue: 500, source: 'projects' });
  });

  it('sums multiple usable projects', () => {
    const result = computeRevenue(crmLead(), [
      crmProject({ id: 'p1', contract_amount: 500 }),
      crmProject({ id: 'p2', contract_amount: 700 }),
    ]);
    expect(result.revenue).toBe(1200);
    expect(result.source).toBe('projects');
  });

  it('excludes null-contract_amount projects, falling through to the next usable one', () => {
    const result = computeRevenue(crmLead({ value: 999 }), [
      crmProject({ id: 'p1', contract_amount: null }),
      crmProject({ id: 'p2', contract_amount: 300 }),
    ]);
    expect(result.revenue).toBe(300);
    expect(result.source).toBe('projects');
  });

  it('falls back to leads.value when all projects have null contract_amount', () => {
    const result = computeRevenue(crmLead({ value: 4000 }), [crmProject({ contract_amount: null })]);
    expect(result).toMatchObject({ revenue: 4000, source: 'lead_value' });
  });

  it('returns null revenue/source when there are no projects and no value', () => {
    const result = computeRevenue(crmLead({ value: null }), []);
    expect(result).toEqual({ revenue: null, source: null, usableProjects: [] });
  });

  it('rounds lead_value revenue to 2 decimals like the projects path', () => {
    const result = computeRevenue(crmLead({ value: 1234.5678 }), []);
    expect(result).toMatchObject({ revenue: 1234.57, source: 'lead_value' });
  });
});

// ============================================================================
// computeGrossProfit
// ============================================================================

describe('computeGrossProfit', () => {
  const margins = { kit: 0.20, turnkey: 0.25, default: 0.20 };

  it('gp = revenue * margin for a single project type', () => {
    const revenueResult = computeRevenue(crmLead(), [crmProject({ project_type: 'kit', contract_amount: 1000 })]);
    const { gp, applied } = computeGrossProfit(revenueResult, crmLead(), margins);
    expect(gp).toBe(200);
    expect(applied).toEqual([{ key: 'kit', pct: 0.20 }]);
  });

  it('sums per-project GP across mixed project types', () => {
    const projects = [
      crmProject({ id: 'p1', project_type: 'kit',     contract_amount: 1000 }),
      crmProject({ id: 'p2', project_type: 'turnkey', contract_amount: 1000 }),
    ];
    const revenueResult = computeRevenue(crmLead(), projects);
    const { gp, applied } = computeGrossProfit(revenueResult, crmLead(), margins);
    expect(gp).toBe(450); // 1000*0.20 + 1000*0.25
    expect(applied).toEqual(expect.arrayContaining([
      { key: 'kit', pct: 0.20 },
      { key: 'turnkey', pct: 0.25 },
    ]));
  });

  it('returns gp: null when margins config is missing', () => {
    const revenueResult = computeRevenue(crmLead(), [crmProject({ contract_amount: 1000 })]);
    const { gp, applied } = computeGrossProfit(revenueResult, crmLead(), null);
    expect(gp).toBeNull();
    expect(applied).toEqual([]);
  });

  it('returns gp: null when the resolved margin is 0 (never invent profit)', () => {
    const zeroMargins = { kit: 0, turnkey: 0, default: 0 };
    const revenueResult = computeRevenue(crmLead(), [crmProject({ project_type: 'kit', contract_amount: 1000 })]);
    const { gp, applied } = computeGrossProfit(revenueResult, crmLead(), zeroMargins);
    expect(gp).toBeNull();
    expect(applied).toEqual([]);
  });
});

// ============================================================================
// gpSuffix / applyGpSuffix
// ============================================================================

describe('gpSuffix', () => {
  it('formats a single uniform margin as "(GP estimated at NN% margin)"', () => {
    expect(gpSuffix([{ key: 'kit', pct: 0.20 }])).toBe('(GP estimated at 20% margin)');
  });

  it('formats mixed margins listing each distinct key in kit/turnkey/default order', () => {
    const applied = [{ key: 'turnkey', pct: 0.25 }, { key: 'kit', pct: 0.20 }];
    expect(gpSuffix(applied)).toBe('(GP estimated at kit 20% / turnkey 25% margins)');
  });

  it('returns null for empty applied', () => {
    expect(gpSuffix([])).toBeNull();
  });
});

describe('applyGpSuffix', () => {
  it('appends suffix to null existing notes', () => {
    expect(applyGpSuffix(null, '(GP estimated at 20% margin)')).toBe('(GP estimated at 20% margin)');
  });

  it('is idempotent: rerunning with the same suffix does not duplicate it', () => {
    const once  = applyGpSuffix('Some note', '(GP estimated at 20% margin)');
    const twice = applyGpSuffix(once, '(GP estimated at 20% margin)');
    expect(twice).toBe('Some note (GP estimated at 20% margin)');
  });

  it('replaces a prior suffix when the margin changes', () => {
    const withOld = applyGpSuffix('Some note', '(GP estimated at 20% margin)');
    const withNew = applyGpSuffix(withOld, '(GP estimated at 25% margin)');
    expect(withNew).toBe('Some note (GP estimated at 25% margin)');
  });

  it('leaves existing notes untouched when suffix is null (not writing GP)', () => {
    expect(applyGpSuffix('Some note (GP estimated at 20% margin)', null)).toBe('Some note (GP estimated at 20% margin)');
  });
});

// ============================================================================
// getMargins
// ============================================================================

describe('getMargins', () => {
  it('returns the config_value when the row exists', async () => {
    marginsFixture = { kit: 0.2, turnkey: 0.25, default: 0.2 };
    const margins = await getMargins(mockPrime);
    expect(margins).toEqual(marginsFixture);
  });

  it('returns null when the row is missing', async () => {
    marginsFixture = null;
    const margins = await getMargins(mockPrime);
    expect(margins).toBeNull();
  });
});

// ============================================================================
// createReadOnlyClient — structural read-only guarantee
// ============================================================================

describe('createReadOnlyClient', () => {
  it('exposes only .select on from(table); no insert/update/upsert/delete', () => {
    const raw = buildCrmRaw();
    const wrapped = createReadOnlyClient(raw).from('leads');
    expect(Object.keys(wrapped)).toEqual(['select']);
    expect(wrapped.insert).toBeUndefined();
    expect(wrapped.update).toBeUndefined();
    expect(wrapped.upsert).toBeUndefined();
    expect(wrapped.delete).toBeUndefined();
  });
});

// ============================================================================
// runCrmSync — matching
// ============================================================================

describe('runCrmSync — matching', () => {
  it('matches via email exact, tolerating case/whitespace differences', async () => {
    primeLeadsFixture = [primeLead({ id: 'p1', contact_email: 'Jane@Example.com ' })];
    const raw = buildCrmRaw({
      leads: [crmLead({ id: 'crm-1', email: ' JANE@EXAMPLE.COM', stage: 'won' })],
      projects: [],
    });
    const result = await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });
    expect(result.matched).toBe(1);
    expect(primeUpdateCalls.some(c => c.id === 'p1')).toBe(true);
  });

  it('falls back to phone match when email misses', async () => {
    primeLeadsFixture = [primeLead({ id: 'p1', contact_email: 'nomatch@example.com', contact_phone: '4075550134' })];
    const raw = buildCrmRaw({
      leads: [crmLead({ id: 'crm-1', email: 'different@example.com', phone: '(407) 555-0134', stage: 'won' })],
      projects: [],
    });
    const result = await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });
    expect(result.matched).toBe(1);
    expect(primeUpdateCalls.some(c => c.id === 'p1')).toBe(true);
  });

  it('matches via alt_phone when phone misses', async () => {
    primeLeadsFixture = [primeLead({ id: 'p1', contact_email: 'nomatch@example.com', contact_phone: '4075559999' })];
    const raw = buildCrmRaw({
      leads: [crmLead({ id: 'crm-1', email: 'different@example.com', phone: '111-111-1111', alt_phone: '407-555-9999', stage: 'won' })],
      projects: [],
    });
    const result = await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });
    expect(result.matched).toBe(1);
    expect(primeUpdateCalls.some(c => c.id === 'p1')).toBe(true);
  });

  it('records unmatched CRM leads with no candidates, and issues no Prime update calls', async () => {
    primeLeadsFixture = [primeLead({ id: 'p1', contact_email: 'someone-else@example.com', contact_phone: '4075551111' })];
    const raw = buildCrmRaw({
      leads: [crmLead({ id: 'crm-orphan', email: 'nobody@example.com', phone: '999-999-9999', stage: 'won' })],
      projects: [],
    });
    const result = await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });
    expect(result.unmatched).toBe(1);
    expect(result.unmatched_crm_ids).toContain('crm-orphan');
    expect(primeUpdateCalls).toHaveLength(0);
  });

  it('resolves multiple candidates via the +/-7-day lead_date rule', async () => {
    const near = primeLead({ id: 'p-near', contact_email: 'dup@example.com', lead_date: '2026-06-08' });
    const far  = primeLead({ id: 'p-far',  contact_email: 'dup@example.com', lead_date: '2026-05-01' });
    primeLeadsFixture = [near, far];
    const raw = buildCrmRaw({
      leads: [crmLead({ id: 'crm-1', email: 'dup@example.com', created_at: '2026-06-10T00:00:00Z', stage: 'won' })],
      projects: [],
    });
    const result = await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });
    expect(result.matched).toBe(1);
    expect(primeUpdateCalls.some(c => c.id === 'p-near')).toBe(true);
    expect(primeUpdateCalls.some(c => c.id === 'p-far')).toBe(false);
  });

  it('marks ALL candidates ambiguous when the date rule does not resolve to exactly one, idempotently on rerun', async () => {
    const p1 = primeLead({ id: 'p1', contact_email: 'amb@example.com', lead_date: '2026-01-01', notes: null });
    const p2 = primeLead({ id: 'p2', contact_email: 'amb@example.com', lead_date: '2026-01-02', notes: null });
    primeLeadsFixture = [p1, p2];
    const cLead = crmLead({ id: 'crm-amb', email: 'amb@example.com', created_at: '2026-06-01T00:00:00Z', stage: 'won' });
    const marker = AMBIGUOUS_MARKER('crm-amb');

    const raw1 = buildCrmRaw({ leads: [cLead], projects: [] });
    const result1 = await runCrmSync({ crm: createReadOnlyClient(raw1), prime: mockPrime });

    expect(result1.ambiguous).toBe(1);
    expect(result1.matched).toBe(0);
    const notesUpdates = primeUpdateCalls.filter(c => c.payload.notes);
    expect(notesUpdates).toHaveLength(2);
    expect(notesUpdates.every(c => c.payload.notes.includes(marker))).toBe(true);

    // Second run: simulate the marker already persisted — no duplicate writes.
    primeUpdateCalls.length = 0;
    primeLeadsFixture = [
      { ...p1, notes: marker },
      { ...p2, notes: marker },
    ];
    const raw2 = buildCrmRaw({ leads: [cLead], projects: [] });
    const result2 = await runCrmSync({ crm: createReadOnlyClient(raw2), prime: mockPrime });

    expect(result2.ambiguous).toBe(1);
    expect(primeUpdateCalls).toHaveLength(0);
  });

  it('queries CRM projects excluding cancelled rows with a non-null lead_id', async () => {
    const raw = buildCrmRaw({ leads: [], projects: [] });
    await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });
    expect(raw._calls.projectsNot).toEqual({ col: 'lead_id', op: 'is', val: null });
    expect(raw._calls.projectsNeq).toEqual({ col: 'status', val: 'cancelled' });
  });
});

// ============================================================================
// runCrmSync — gross profit
// ============================================================================

describe('runCrmSync — gross profit', () => {
  it('writes gross_profit = revenue * 0.20 and appends the GP suffix to attribution_notes', async () => {
    primeLeadsFixture = [primeLead({ id: 'p1', attribution_notes: 'Original note' })];
    marginsFixture = { kit: 0.20, turnkey: 0.20, default: 0.20 };
    const raw = buildCrmRaw({
      leads: [crmLead({ id: 'crm-1', stage: 'won' })],
      projects: [crmProject({ project_type: 'turnkey', contract_amount: 5000 })],
    });
    await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });

    const update = primeUpdateCalls.find(c => c.id === 'p1');
    expect(update.payload.gross_profit).toBe(1000);
    expect(update.payload.attribution_notes).toBe('Original note (GP estimated at 20% margin)');
  });

  it('sums per-project GP for mixed project types and lists both margins in the suffix', async () => {
    primeLeadsFixture = [primeLead({ id: 'p1' })];
    marginsFixture = { kit: 0.20, turnkey: 0.25, default: 0.20 };
    const raw = buildCrmRaw({
      leads: [crmLead({ id: 'crm-1', stage: 'won' })],
      projects: [
        crmProject({ id: 'proj-a', project_type: 'kit',     contract_amount: 1000 }),
        crmProject({ id: 'proj-b', project_type: 'turnkey', contract_amount: 1000 }),
      ],
    });
    await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });

    const update = primeUpdateCalls.find(c => c.id === 'p1');
    expect(update.payload.gross_profit).toBe(450);
    expect(update.payload.attribution_notes).toBe('(GP estimated at kit 20% / turnkey 25% margins)');
  });

  it('writes booked_revenue but leaves gross_profit null when the margins row is missing', async () => {
    primeLeadsFixture = [primeLead({ id: 'p1' })];
    marginsFixture = null;
    const raw = buildCrmRaw({
      leads: [crmLead({ id: 'crm-1', stage: 'won' })],
      projects: [crmProject({ contract_amount: 5000 })],
    });
    const result = await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });

    expect(result.margins_available).toBe(false);
    const update = primeUpdateCalls.find(c => c.id === 'p1');
    expect(update.payload.booked_revenue).toBe(5000);
    expect(update.payload.gross_profit).toBeUndefined();
  });
});

// ============================================================================
// runCrmSync — status lifecycle
// ============================================================================

describe('runCrmSync — status lifecycle', () => {
  it('won -> qualification_status booked, booked_at = stage_changed_at', async () => {
    primeLeadsFixture = [primeLead({ id: 'p1' })];
    const raw = buildCrmRaw({
      leads: [crmLead({ id: 'crm-1', stage: 'won', stage_changed_at: '2026-06-15T00:00:00Z' })],
      projects: [],
    });
    await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });
    const update = primeUpdateCalls.find(c => c.id === 'p1');
    expect(update.payload.qualification_status).toBe('booked');
    expect(update.payload.booked_at).toBe('2026-06-15T00:00:00Z');
  });

  it('lost -> qualification_status lost, lost_at + lost_reason set', async () => {
    primeLeadsFixture = [primeLead({ id: 'p1' })];
    const raw = buildCrmRaw({
      leads: [crmLead({ id: 'crm-1', stage: 'lost', stage_changed_at: '2026-06-15T00:00:00Z', lost_reason: 'went with competitor' })],
      projects: [],
    });
    await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });
    const update = primeUpdateCalls.find(c => c.id === 'p1');
    expect(update.payload.qualification_status).toBe('lost');
    expect(update.payload.lost_at).toBe('2026-06-15T00:00:00Z');
    expect(update.payload.lost_reason).toBe('went with competitor');
  });

  it('CRM lost vs Prime already booked -> no write, conflict recorded (no-downgrade)', async () => {
    primeLeadsFixture = [primeLead({ id: 'p1', qualification_status: 'booked', booked_revenue: 1000, estimated_value: 1000 })];
    const raw = buildCrmRaw({
      leads: [crmLead({ id: 'crm-1', stage: 'lost' })],
      projects: [],
    });
    const result = await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });
    expect(result.conflicts).toBe(1);
    expect(result.conflict_details[0]).toMatchObject({ crm_id: 'crm-1', prime_id: 'p1', reason: 'crm_lost_vs_prime_booked' });
    expect(primeUpdateCalls).toHaveLength(0);
  });

  it('CRM lost vs Prime booked skips the lead entirely — estimated_value not filled on conflict', async () => {
    primeLeadsFixture = [primeLead({ id: 'p1', qualification_status: 'booked', estimated_value: null })];
    const raw = buildCrmRaw({
      leads: [crmLead({ id: 'crm-1', stage: 'lost', value: 4000 })],
      projects: [],
    });
    const result = await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });
    expect(result.conflicts).toBe(1);
    expect(primeUpdateCalls).toHaveLength(0);
  });

  it('won with null stage_changed_at books the lead without writing booked_at', async () => {
    primeLeadsFixture = [primeLead({ id: 'p1' })];
    const raw = buildCrmRaw({
      leads: [crmLead({ id: 'crm-1', stage: 'won', stage_changed_at: null })],
      projects: [crmProject({ contract_amount: 5000 })],
    });
    await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });
    const update = primeUpdateCalls.find(c => c.id === 'p1');
    expect(update.payload.qualification_status).toBe('booked');
    expect('booked_at' in update.payload).toBe(false);
  });

  it('null CRM stage_changed_at never overwrites an existing booked_at / lost_at', async () => {
    const bookedLead = primeLead({ id: 'p1', contact_email: 'a@example.com', qualification_status: 'booked', booked_at: '2026-05-01T00:00:00Z', estimated_value: 5000 });
    const lostLead   = primeLead({ id: 'p2', contact_email: 'b@example.com', qualification_status: 'lost', lost_at: '2026-05-01T00:00:00Z', estimated_value: 100 });
    primeLeadsFixture = [bookedLead, lostLead];
    const raw = buildCrmRaw({
      leads: [
        crmLead({ id: 'crm-a', email: 'a@example.com', stage: 'won',  stage_changed_at: null, value: null }),
        crmLead({ id: 'crm-b', email: 'b@example.com', stage: 'lost', stage_changed_at: null, value: null }),
      ],
      projects: [],
    });
    await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });
    expect(primeUpdateCalls).toHaveLength(0);
  });

  it('CRM won upgrades a Prime lead that was previously lost', async () => {
    primeLeadsFixture = [primeLead({ id: 'p1', qualification_status: 'lost', lost_at: '2026-01-01T00:00:00Z' })];
    const raw = buildCrmRaw({
      leads: [crmLead({ id: 'crm-1', stage: 'won', stage_changed_at: '2026-06-15T00:00:00Z' })],
      projects: [crmProject({ contract_amount: 2000 })],
    });
    const result = await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });
    expect(result.booked).toBe(1);
    const update = primeUpdateCalls.find(c => c.id === 'p1');
    expect(update.payload.qualification_status).toBe('booked');
  });

  it('pipeline stage + Prime new -> qualified, qualified_at set', async () => {
    primeLeadsFixture = [primeLead({ id: 'p1', qualification_status: 'new' })];
    const raw = buildCrmRaw({
      leads: [crmLead({ id: 'crm-1', stage: 'estimate_sent', stage_changed_at: '2026-06-15T00:00:00Z' })],
      projects: [],
    });
    await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });
    const update = primeUpdateCalls.find(c => c.id === 'p1');
    expect(update.payload.qualification_status).toBe('qualified');
    expect(update.payload.qualified_at).toBe('2026-06-15T00:00:00Z');
  });

  it('pipeline stage leaves Prime booked/qualified/unqualified status untouched', async () => {
    const booked      = primeLead({ id: 'p-booked',      contact_email: 'a@example.com', qualification_status: 'booked' });
    const qualified   = primeLead({ id: 'p-qualified',   contact_email: 'b@example.com', qualification_status: 'qualified', qualified_at: '2026-01-01T00:00:00Z' });
    const unqualified = primeLead({ id: 'p-unqualified', contact_email: 'c@example.com', qualification_status: 'unqualified' });
    primeLeadsFixture = [booked, qualified, unqualified];

    const raw = buildCrmRaw({
      leads: [
        crmLead({ id: 'crm-a', email: 'a@example.com', stage: 'estimate_sent', value: null }),
        crmLead({ id: 'crm-b', email: 'b@example.com', stage: 'estimate_sent', value: null }),
        crmLead({ id: 'crm-c', email: 'c@example.com', stage: 'estimate_sent', value: null }),
      ],
      projects: [],
    });
    await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });

    expect(primeUpdateCalls.some(c => c.id === 'p-booked' && c.payload.qualification_status)).toBe(false);
    expect(primeUpdateCalls.some(c => c.id === 'p-qualified' && c.payload.qualification_status)).toBe(false);
    expect(primeUpdateCalls.some(c => c.id === 'p-unqualified' && c.payload.qualification_status)).toBe(false);
  });

  it('estimated_value fills only when Prime value is currently null', async () => {
    const filled  = primeLead({ id: 'p1', contact_email: 'a@example.com', estimated_value: null });
    const alreadySet = primeLead({ id: 'p2', contact_email: 'b@example.com', estimated_value: 999 });
    primeLeadsFixture = [filled, alreadySet];

    const raw = buildCrmRaw({
      leads: [
        crmLead({ id: 'crm-a', email: 'a@example.com', stage: 'estimate_sent', value: 4000 }),
        crmLead({ id: 'crm-b', email: 'b@example.com', stage: 'estimate_sent', value: 5000 }),
      ],
      projects: [],
    });
    await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });

    const u1 = primeUpdateCalls.find(c => c.id === 'p1');
    const u2 = primeUpdateCalls.find(c => c.id === 'p2');
    expect(u1.payload.estimated_value).toBe(4000);
    expect(u2?.payload.estimated_value).toBeUndefined();
  });
});

// ============================================================================
// runCrmSync — idempotency & read-only guarantee
// ============================================================================

describe('runCrmSync — idempotency & read-only guarantee', () => {
  it('a full second run with identical upstream data produces zero update calls', async () => {
    const p = primeLead({ id: 'p1', contact_email: 'idem@example.com' });
    primeLeadsFixture = [p];
    const cLead = crmLead({ id: 'crm-1', email: 'idem@example.com', stage: 'won', stage_changed_at: '2026-02-01T00:00:00Z', value: null });
    const proj  = crmProject({ lead_id: 'crm-1', contract_amount: 1000, project_type: 'turnkey' });

    const raw1 = buildCrmRaw({ leads: [cLead], projects: [proj] });
    await runCrmSync({ crm: createReadOnlyClient(raw1), prime: mockPrime });
    expect(primeUpdateCalls.length).toBeGreaterThan(0);

    // Simulate the DB now reflecting run 1's writes.
    const merged = { ...p, ...primeUpdateCalls[0].payload };
    primeUpdateCalls.length = 0;
    primeLeadsFixture = [merged];

    const raw2 = buildCrmRaw({ leads: [cLead], projects: [proj] });
    const result2 = await runCrmSync({ crm: createReadOnlyClient(raw2), prime: mockPrime });

    expect(primeUpdateCalls).toHaveLength(0);
    expect(result2.unchanged).toBe(1);
    expect(result2.updated).toBe(0);
  });

  it('never calls insert/update/upsert/delete/rpc on the raw CRM client during a full sync', async () => {
    primeLeadsFixture = [primeLead({ id: 'p1' })];
    const raw = buildCrmRaw({
      leads: [crmLead({ id: 'crm-1', stage: 'won' })],
      projects: [crmProject({ contract_amount: 1000 })],
    });
    await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });

    expect(raw.insert).not.toHaveBeenCalled();
    expect(raw.update).not.toHaveBeenCalled();
    expect(raw.upsert).not.toHaveBeenCalled();
    expect(raw.delete).not.toHaveBeenCalled();
    expect(raw.rpc).not.toHaveBeenCalled();
  });
});

// ============================================================================
// DoD scenario
// ============================================================================

describe('DoD scenario', () => {
  it('maps a won CRM lead with a project end-to-end: booked_revenue, gross_profit, status booked', async () => {
    primeLeadsFixture = [primeLead({ id: 'p1', contact_email: 'dod@example.com' })];
    marginsFixture = { kit: 0.20, turnkey: 0.20, default: 0.20 };

    const raw = buildCrmRaw({
      leads: [crmLead({ id: 'crm-1', email: 'dod@example.com', stage: 'won', stage_changed_at: '2026-06-20T00:00:00Z' })],
      projects: [crmProject({ lead_id: 'crm-1', project_type: 'turnkey', contract_amount: 5000 })],
    });

    const result = await runCrmSync({ crm: createReadOnlyClient(raw), prime: mockPrime });
    expect(result.booked).toBe(1);

    const update = primeUpdateCalls.find(c => c.id === 'p1');
    expect(update.payload.qualification_status).toBe('booked');
    expect(update.payload.booked_revenue).toBe(5000);
    expect(update.payload.gross_profit).toBe(1000); // 5000 * 0.20
  });
});

// ============================================================================
// cron-crm-sync handler
// ============================================================================

describe('cron-crm-sync handler', () => {
  it('returns 401 without x-vercel-cron header and without a matching CRON_SECRET', async () => {
    const req = makeReq({ headers: {} });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(401);
    expect(res._body).toEqual({ success: false, error: 'Unauthorized' });
  });

  it('returns 200 with x-vercel-cron: 1', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
  });

  it('returns 200 with Authorization: Bearer matching CRON_SECRET', async () => {
    process.env.CRON_SECRET = 'topsecret';
    const req = makeReq({ headers: { authorization: 'Bearer topsecret', host: 'test.local' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(200);
  });

  it('returns 405 for a non-GET request even with valid auth', async () => {
    const req = makeReq({ method: 'POST' });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(405);
    expect(res._body).toEqual({ success: false, error: 'Method not allowed' });
  });

  it('returns 500 and fails closed when CRM env vars are missing', async () => {
    delete process.env.CRM_SUPABASE_URL;
    delete process.env.CRM_SUPABASE_SERVICE_KEY;
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(500);
    expect(res._body.success).toBe(false);
    expect(primeInsertsByTable['automation_log']?.[0]).toMatchObject({ status: 'error' });
  });

  it('writes an automation_log summary row with metadata counts', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(primeInsertsByTable['automation_log']).toHaveLength(1);
    // S-AUTOLOG-1 (2026-07-31): was event_type 'crm_sync' + status 'success'
    // — NEITHER a member of automation_log's live CHECK constraints (read
    // directly via Supabase MCP against olpyqfuphiwdongzmazi — see
    // api/lib/automation-log-schema.js). Both inserts on this path had
    // always failed, silently, since the feature was built.
    expect(primeInsertsByTable['automation_log'][0]).toMatchObject({
      event_type: 'data_pull',
      status:     'complete',
    });
    expect(AUTOMATION_LOG_EVENT_TYPES).toContain(primeInsertsByTable['automation_log'][0].event_type);
    expect(AUTOMATION_LOG_STATUSES).toContain(primeInsertsByTable['automation_log'][0].status);
    expect(primeInsertsByTable['automation_log'][0].metadata.source_event).toBe('crm_sync');
    expect(primeInsertsByTable['automation_log'][0].metadata).toHaveProperty('matched');
  });
});
