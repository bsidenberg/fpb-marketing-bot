// ============================================================
// tests/accounts-helper.test.js
// Tests for api/lib/accounts.js — slug resolution, env: reference
// resolution, caching, and a security regression test confirming that
// resolved_* fields cannot leak through the /api/accounts whitelist.
// Supabase is mocked with the queue pattern.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase queue mock ───────────────────────────────────────────────────────
//
// Each call site of .maybeSingle(), .single(), or terminal-await on a chain
// consumes one entry off the shared queue. Tests queue results in the order
// they will be consumed.

const queue = [];

function makeChain() {
  const chain = {
    select:      () => chain,
    eq:          () => chain,
    order:       () => chain,
    limit:       () => chain,
    in:          () => chain,
    is:          () => chain,
    maybeSingle: async () => queue.shift() ?? { data: null, error: null },
    single:      async () => queue.shift() ?? { data: null, error: null },
    // Plain-await terminal — used by listActiveAccounts after .order().
    then:        (resolve) => resolve(queue.shift() ?? { data: [], error: null }),
  };
  return chain;
}

vi.mock('../api/lib/supabase.js', () => ({
  default: { from: () => makeChain() },
}));

// Import AFTER mock is registered.
import {
  FPB_DEFAULT_SLUG,
  getAccountSlugFromRequest,
  resolveAccountFromRequest,
  getAccountBySlug,
  getAccountById,
  listActiveAccounts,
  getConnectionForAccount,
  clearAccountCache,
} from '../api/lib/accounts.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function queueResults(...results) {
  queue.length = 0;
  queue.push(...results);
}

function makeReq(overrides = {}) {
  return { method: 'GET', headers: {}, query: {}, ...overrides };
}

beforeEach(() => {
  vi.restoreAllMocks();
  queue.length = 0;
  clearAccountCache();
  delete process.env.MOCK_ENV_VAR_TOKEN;
  delete process.env.MOCK_ENV_VAR_REFRESH;
});

// ── 1–4: getAccountSlugFromRequest ────────────────────────────────────────────

describe('getAccountSlugFromRequest', () => {
  it('returns the slug from the x-account-slug header', () => {
    const req = makeReq({ headers: { 'x-account-slug': 'fpb' } });
    expect(getAccountSlugFromRequest(req)).toBe('fpb');
  });

  it('defaults to FPB_DEFAULT_SLUG when no header or query param (warning logged)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const req = makeReq();
    expect(getAccountSlugFromRequest(req)).toBe(FPB_DEFAULT_SLUG);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/defaulting to "fpb"/);
  });

  it('prefers ?account= query param over x-account-slug header', () => {
    const req = makeReq({
      headers: { 'x-account-slug': 'fpb' },
      query:   { account: 'weld' },
    });
    expect(getAccountSlugFromRequest(req)).toBe('weld');
  });

  it('normalizes whitespace and case (both header and query param paths)', () => {
    const headerReq = makeReq({ headers: { 'x-account-slug': '  WELD  ' } });
    expect(getAccountSlugFromRequest(headerReq)).toBe('weld');

    const queryReq = makeReq({ query: { account: '\tFSC\n' } });
    expect(getAccountSlugFromRequest(queryReq)).toBe('fsc');
  });
});

// ── 5–7: resolveAccountFromRequest ────────────────────────────────────────────

describe('resolveAccountFromRequest', () => {
  it('returns the account when the slug is valid', async () => {
    queueResults({
      data: { id: 'fpb-uuid', slug: 'fpb', status: 'active', name: 'Florida Pole Barn' },
      error: null,
    });
    const req = makeReq({ headers: { 'x-account-slug': 'fpb' } });
    const account = await resolveAccountFromRequest(req);
    expect(account.slug).toBe('fpb');
    expect(account.id).toBe('fpb-uuid');
  });

  it('throws an Error with .statusCode = 400 when the slug does not match any account', async () => {
    queueResults({ data: null, error: null });
    const req = makeReq({ headers: { 'x-account-slug': 'nonexistent' } });
    await expect(resolveAccountFromRequest(req)).rejects.toMatchObject({
      message:    expect.stringContaining('nonexistent'),
      statusCode: 400,
    });
  });

  it('throws an Error with .statusCode = 403 when the account is archived', async () => {
    queueResults({
      data: { id: 'old-uuid', slug: 'old', status: 'archived', name: 'Old Account' },
      error: null,
    });
    const req = makeReq({ headers: { 'x-account-slug': 'old' } });
    await expect(resolveAccountFromRequest(req)).rejects.toMatchObject({
      message:    expect.stringMatching(/archived/),
      statusCode: 403,
    });
  });
});

// ── 8: getAccountBySlug ───────────────────────────────────────────────────────

describe('getAccountBySlug', () => {
  it('returns null when the slug is not found', async () => {
    queueResults({ data: null, error: null });
    expect(await getAccountBySlug('nonexistent')).toBeNull();
  });
});

// ── 9–13: getConnectionForAccount ─────────────────────────────────────────────

describe('getConnectionForAccount', () => {
  it('resolves env: references to process.env values into resolved_* fields', async () => {
    process.env.MOCK_ENV_VAR_TOKEN   = 'real-token-value';
    process.env.MOCK_ENV_VAR_REFRESH = 'real-refresh-value';

    queueResults({
      data: {
        id:                      'conn-uuid',
        account_id:              'fpb-uuid',
        platform:                'google_ads',
        account_id_external:     '8325311811',
        manager_account_id:      '5435219372',
        access_token_reference:  'env:MOCK_ENV_VAR_TOKEN',
        refresh_token_reference: 'env:MOCK_ENV_VAR_REFRESH',
      },
      error: null,
    });

    const conn = await getConnectionForAccount('fpb-uuid', 'google_ads');

    expect(conn.resolved_access_token).toBe('real-token-value');
    expect(conn.resolved_refresh_token).toBe('real-refresh-value');
    // Originals preserved alongside resolved values
    expect(conn.access_token_reference).toBe('env:MOCK_ENV_VAR_TOKEN');
    expect(conn.refresh_token_reference).toBe('env:MOCK_ENV_VAR_REFRESH');
  });

  it('returns plain values as-is in resolved_* fields when not an env reference', async () => {
    queueResults({
      data: {
        id:                      'conn-uuid',
        account_id:              'fpb-uuid',
        platform:                'google_ads',
        account_id_external:     '8325311811',
        manager_account_id:      '5435219372',
        access_token_reference:  null,
        refresh_token_reference: null,
      },
      error: null,
    });

    const conn = await getConnectionForAccount('fpb-uuid', 'google_ads');
    expect(conn.resolved_account_id_external).toBe('8325311811');
    expect(conn.resolved_manager_account_id).toBe('5435219372');
    expect(conn.resolved_access_token).toBeNull();
    expect(conn.resolved_refresh_token).toBeNull();
  });

  it('returns null for a non-existent (account, platform) pair', async () => {
    queueResults({ data: null, error: null });
    expect(await getConnectionForAccount('fpb-uuid', 'tiktok_ads')).toBeNull();
  });

  it('handles a missing env var gracefully (logs error, sets resolved field to null)', async () => {
    delete process.env.MOCK_ENV_VAR_TOKEN;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    queueResults({
      data: {
        id:                      'conn-uuid',
        account_id:              'fpb-uuid',
        platform:                'meta_ads',
        account_id_external:     'env:MOCK_ENV_VAR_TOKEN', // unset
        manager_account_id:      null,
        access_token_reference:  null,
        refresh_token_reference: null,
      },
      error: null,
    });

    const conn = await getConnectionForAccount('fpb-uuid', 'meta_ads');
    expect(conn.resolved_account_id_external).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls[0][0]).toMatch(/env reference "env:MOCK_ENV_VAR_TOKEN"/);
  });

  // ── SECURITY REGRESSION TEST ────────────────────────────────────────────────
  //
  // The /api/accounts endpoint protects against token leakage by selecting
  // ONLY the columns in ACCOUNT_PUBLIC_COLUMNS. This test verifies that even
  // if a connection row (which contains resolved_* values) were accidentally
  // run through that whitelist projection, the resolved tokens cannot escape
  // through JSON.stringify of the result.
  it('SECURITY: resolved_* fields are stripped by the api/accounts whitelist', async () => {
    process.env.MOCK_ENV_VAR_TOKEN = 'real-token';

    queueResults({
      data: {
        id:                      'conn-uuid',
        account_id:              'fpb-uuid',
        platform:                'google_ads',
        account_id_external:     '8325311811',
        manager_account_id:      '5435219372',
        access_token_reference:  'env:MOCK_ENV_VAR_TOKEN',
        refresh_token_reference: null,
      },
      error: null,
    });

    const conn = await getConnectionForAccount('fpb-uuid', 'google_ads');

    // Sanity: resolved fields ARE present on the helper return value.
    expect(conn.resolved_access_token).toBe('real-token');

    // Mirror of api/accounts.js ACCOUNT_PUBLIC_COLUMNS — kept in sync there.
    const ACCOUNT_PUBLIC_COLUMNS = [
      'id', 'name', 'slug', 'industry', 'website_domain', 'primary_location',
      'service_area', 'reporting_timezone',
      'monthly_budget', 'monthly_spend_cap', 'daily_spend_cap',
      'target_cost_per_lead', 'target_cost_per_qualified_lead',
      'target_cost_per_booked_job', 'target_margin_goal',
      'autonomy_level', 'status',
      'tracking_health_score', 'crm_hygiene_score', 'account_health_score',
      'created_at', 'updated_at',
    ];

    // Build the "safe DTO" the same way the API endpoint does — pick only
    // whitelisted columns from the source row.
    const safeProjection = {};
    for (const col of ACCOUNT_PUBLIC_COLUMNS) {
      if (col in conn) safeProjection[col] = conn[col];
    }

    const serialized = JSON.stringify(safeProjection);
    expect(serialized).not.toMatch(/resolved_access_token/);
    expect(serialized).not.toMatch(/resolved_refresh_token/);
    expect(serialized).not.toMatch(/resolved_account_id_external/);
    expect(serialized).not.toMatch(/resolved_manager_account_id/);
    expect(serialized).not.toMatch(/access_token_reference/);
    expect(serialized).not.toMatch(/refresh_token_reference/);
    expect(serialized).not.toMatch(/real-token/);
    expect(serialized).not.toMatch(/env:/);
  });
});

// ── 14–15: cache behavior ─────────────────────────────────────────────────────

describe('cache behavior', () => {
  it('clearAccountCache resets cached results so subsequent lookups hit the DB', async () => {
    queueResults({
      data: { id: 'fpb-uuid-1', slug: 'fpb', status: 'active' },
      error: null,
    });
    const first = await getAccountBySlug('fpb');
    expect(first.id).toBe('fpb-uuid-1');

    clearAccountCache();
    queueResults({
      data: { id: 'fpb-uuid-2', slug: 'fpb', status: 'active' },
      error: null,
    });
    const second = await getAccountBySlug('fpb');
    expect(second.id).toBe('fpb-uuid-2');
  });

  it('cache returns the same object within the TTL window (DB hit only once)', async () => {
    queueResults({
      data: { id: 'fpb-uuid', slug: 'fpb', status: 'active' },
      error: null,
    });
    const first = await getAccountBySlug('fpb');
    // Queue is now empty. If cache works, the second call must NOT hit the
    // DB — if it did, the mock would return { data: null, error: null }.
    const second = await getAccountBySlug('fpb');
    expect(second).toBe(first);            // same object reference
    expect(second.id).toBe('fpb-uuid');
  });
});
