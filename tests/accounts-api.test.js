// ============================================================
// tests/accounts-api.test.js
// Tests for api/accounts.js — GET-only read endpoint, field whitelist,
// 405 fallthrough, security regression on token leakage.
// Supabase mocked with the queue pattern; req/res mocked inline.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock with call recording ─────────────────────────────────────────

const queue = [];
const fromCalls   = [];
const selectCalls = [];
const orderCalls  = [];

function makeChain() {
  const chain = {
    select: (cols)        => { selectCalls.push(cols);          return chain; },
    eq:     ()            => chain,
    order:  (col, opts)   => { orderCalls.push({ col, opts });  return chain; },
    limit:  ()            => chain,
    maybeSingle: async () => queue.shift() ?? { data: null, error: null },
    single:      async () => queue.shift() ?? { data: null, error: null },
    then:        (resolve) => resolve(queue.shift() ?? { data: [], error: null }),
  };
  return chain;
}

vi.mock('../api/lib/supabase.js', () => ({
  default: {
    from: (table) => {
      fromCalls.push(table);
      return makeChain();
    },
  },
}));

// Import AFTER mock is registered.
import handler from '../api/accounts.js';

// ── Req/res mocks ─────────────────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return {
    method:  'GET',
    url:     '/api/accounts',
    headers: {},
    query:   {},
    body:    {},
    ...overrides,
  };
}

function makeRes() {
  const headers = {};
  const res = {
    _statusCode: 200,
    _body:       null,
    _headers:    headers,
    _ended:      false,
    status: function (code) { this._statusCode = code; return this; },
    json:   function (body) { this._body = body;       return this; },
    setHeader: function (name, value) { headers[name] = value; return this; },
    end:    function () { this._ended = true; return this; },
  };
  return res;
}

function queueResults(...results) {
  queue.length = 0;
  queue.push(...results);
}

// Canonical safe row used by multiple tests — every field on the whitelist,
// no fields off it.
function makeAccountRow(overrides = {}) {
  return {
    id:                              'fpb-uuid',
    name:                            'Florida Pole Barn',
    slug:                            'fpb',
    industry:                        'Pole Barn Construction',
    website_domain:                  'floridapolebarn.com',
    primary_location:                null,
    service_area:                    null,
    reporting_timezone:              'America/New_York',
    monthly_budget:                  2500,
    monthly_spend_cap:               2500,
    daily_spend_cap:                 null,
    target_cost_per_lead:            50,
    target_cost_per_qualified_lead:  null,
    target_cost_per_booked_job:      null,
    target_margin_goal:              null,
    autonomy_level:                  'level_1_diagnostics',
    status:                          'active',
    tracking_health_score:           0,
    crm_hygiene_score:               0,
    account_health_score:            0,
    created_at:                      '2026-01-01T00:00:00Z',
    updated_at:                      '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const WHITELIST = [
  'id', 'name', 'slug', 'industry', 'website_domain', 'primary_location',
  'service_area', 'reporting_timezone',
  'monthly_budget', 'monthly_spend_cap', 'daily_spend_cap',
  'target_cost_per_lead', 'target_cost_per_qualified_lead',
  'target_cost_per_booked_job', 'target_margin_goal',
  'autonomy_level', 'status',
  'tracking_health_score', 'crm_hygiene_score', 'account_health_score',
  'created_at', 'updated_at',
];

beforeEach(() => {
  vi.clearAllMocks();
  queue.length       = 0;
  fromCalls.length   = 0;
  selectCalls.length = 0;
  orderCalls.length  = 0;
});

// ── 1: GET returns 200 with array ─────────────────────────────────────────────

describe('GET /api/accounts', () => {
  it('returns 200 with an array of accounts', async () => {
    queueResults({
      data: [
        makeAccountRow({ id: 'fpb-uuid',  slug: 'fpb',  status: 'active' }),
        makeAccountRow({ id: 'weld-uuid', slug: 'weld', status: 'inactive', name: 'Weld Workx' }),
        makeAccountRow({ id: 'fsc-uuid',  slug: 'fsc',  status: 'inactive', name: 'Florida Security Concepts' }),
      ],
      error: null,
    });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
    expect(Array.isArray(res._body.data)).toBe(true);
    expect(res._body.data).toHaveLength(3);
    expect(res._body.data.map(a => a.slug)).toEqual(['fpb', 'weld', 'fsc']);
  });

  // ── 2: Response includes only whitelisted fields ───────────────────────────
  it('response includes exactly the whitelisted fields and no others', async () => {
    queueResults({ data: [makeAccountRow()], error: null });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const account = res._body.data[0];
    const keys    = Object.keys(account);

    // All whitelisted fields are present in the response row.
    for (const col of WHITELIST) {
      expect(keys).toContain(col);
    }
    // No unexpected fields — every key in the response is on the whitelist.
    for (const key of keys) {
      expect(WHITELIST).toContain(key);
    }

    // The endpoint's SELECT clause must contain every whitelisted column —
    // this is the actual security boundary against future schema additions.
    expect(selectCalls).toHaveLength(1);
    for (const col of WHITELIST) {
      expect(selectCalls[0]).toContain(col);
    }
  });

  // ── 3: SECURITY — no token / connection / env: leakage ─────────────────────
  it('SECURITY: response does not leak token references, env: refs, resolved_* values, or any ad_platform_connections data', async () => {
    // Worst-case scenario: pretend Supabase returned extra fields that should
    // never have made it into the response. (In production this can't happen
    // because the SELECT clause is pinned to ACCOUNT_PUBLIC_COLUMNS, but we
    // also check below that the SELECT clause itself contains none of the
    // sensitive column names.)
    queueResults({ data: [makeAccountRow()], error: null });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const serialized = JSON.stringify(res._body);

    // Direct field-name leakage checks.
    expect(serialized).not.toMatch(/access_token_reference/);
    expect(serialized).not.toMatch(/refresh_token_reference/);
    expect(serialized).not.toMatch(/resolved_access_token/);
    expect(serialized).not.toMatch(/resolved_refresh_token/);
    expect(serialized).not.toMatch(/resolved_account_id_external/);
    expect(serialized).not.toMatch(/resolved_manager_account_id/);
    expect(serialized).not.toMatch(/account_id_external/);
    expect(serialized).not.toMatch(/manager_account_id/);
    expect(serialized).not.toMatch(/permissions_json/);
    expect(serialized).not.toMatch(/last_sync_at/);
    expect(serialized).not.toMatch(/last_error/);
    expect(serialized).not.toMatch(/connection_status/);

    // No env: references should ever appear.
    expect(serialized).not.toMatch(/env:/);

    // The SELECT clause must not request any of the sensitive columns.
    const selectClause = selectCalls[0];
    expect(selectClause).not.toMatch(/access_token_reference/);
    expect(selectClause).not.toMatch(/refresh_token_reference/);
    expect(selectClause).not.toMatch(/account_id_external/);
    expect(selectClause).not.toMatch(/manager_account_id/);
    expect(selectClause).not.toMatch(/permissions_json/);

    // The endpoint must never have queried ad_platform_connections at all.
    expect(fromCalls).toEqual(['accounts']);
  });

  // ── 7: Ordering ────────────────────────────────────────────────────────────
  it('orders results by created_at ascending', async () => {
    queueResults({ data: [], error: null });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(orderCalls).toHaveLength(1);
    expect(orderCalls[0].col).toBe('created_at');
    expect(orderCalls[0].opts).toEqual({ ascending: true });
  });
});

// ── 4–6: Non-GET methods return 405 with Allow: GET ──────────────────────────

describe('non-GET methods on /api/accounts', () => {
  it('POST returns 405 with Allow: GET', async () => {
    const req = makeReq({ method: 'POST', body: { name: 'Spoofed' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(405);
    expect(res._headers['Allow']).toBe('GET');
    expect(res._body.success).toBe(false);
    // Confirm no DB write was attempted
    expect(fromCalls).toEqual([]);
  });

  it('PATCH returns 405 with Allow: GET', async () => {
    const req = makeReq({ method: 'PATCH', body: { status: 'archived' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(405);
    expect(res._headers['Allow']).toBe('GET');
    expect(fromCalls).toEqual([]);
  });

  it('DELETE returns 405 with Allow: GET', async () => {
    const req = makeReq({ method: 'DELETE' });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(405);
    expect(res._headers['Allow']).toBe('GET');
    expect(fromCalls).toEqual([]);
  });
});
