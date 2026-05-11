// ============================================================
// tests/verify-safety.test.js
// Tests for the Stage B1 account_config additions to /api/verify-safety.
//
// Scope:
//   • account_config section appears in the response and reports only
//     presence booleans for resolved_* fields (never actual values).
//   • overall_pass = true when FPB account + both connections are
//     fully configured and all Safety Sprint 1 env checks pass.
//   • overall_pass = false when:
//       — FPB account row is missing
//       — FPB google_ads connection row is missing
//       — FPB google_ads connection has null resolved_refresh_token
//   • SECURITY regression: no resolved_* VALUE ever appears anywhere
//     in the serialized response body.
//
// accounts.js is mocked so tests can drive the account/connection state
// directly without touching supabase.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock state ───────────────────────────────────────────────────────────────
let mockAccount = null;
let mockGoogleConn = null;
let mockMetaConn = null;

vi.mock('../api/lib/accounts.js', () => ({
  FPB_DEFAULT_SLUG: 'fpb',
  getAccountBySlug: async (slug) => (slug === 'fpb' ? mockAccount : null),
  getConnectionForAccount: async (_accountId, platform) => {
    if (platform === 'google_ads') return mockGoogleConn;
    if (platform === 'meta_ads')   return mockMetaConn;
    return null;
  },
}));

// Import AFTER mock is registered
import handler from '../api/verify-safety.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const FPB_ACTIVE = { id: 'fpb-uuid', slug: 'fpb', status: 'active' };

// Real-looking but FAKE token values. The SECURITY test asserts that none of
// these strings ever appear in the response body.
const VALID_GOOGLE_CONN = {
  resolved_account_id_external: 'fake-google-customer-id',
  resolved_manager_account_id:  'fake-google-manager-id',
  resolved_refresh_token:       'fake-google-refresh-token',
  resolved_access_token:        null,
};
const VALID_META_CONN = {
  resolved_access_token:        'fake-meta-access-token',
  resolved_account_id_external: 'fake-meta-ad-account-id',
  resolved_refresh_token:       null,
  resolved_manager_account_id:  null,
};

const SECRET_VALUES = [
  'fake-google-customer-id',
  'fake-google-manager-id',
  'fake-google-refresh-token',
  'fake-meta-access-token',
  'fake-meta-ad-account-id',
];

function makeReq(overrides = {}) {
  return { method: 'GET', headers: {}, query: {}, url: '/api/verify-safety', ...overrides };
}

function makeRes() {
  return {
    _statusCode: 200,
    _body:       null,
    status:    function(code) { this._statusCode = code; return this; },
    json:      function(body) { this._body = body; return this; },
    setHeader: () => {},
    end:       () => {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default to fully-configured state — individual tests override.
  mockAccount    = FPB_ACTIVE;
  mockGoogleConn = { ...VALID_GOOGLE_CONN };
  mockMetaConn   = { ...VALID_META_CONN };

  // Make all Safety Sprint 1 env checks pass so the only failure surface
  // is the account_config section (the system under test).
  process.env.EXECUTE_SECRET    = 'test-execute-secret';
  process.env.META_ACCESS_TOKEN = 'test-meta-token';
});

// ============================================================================
// account_config presence + happy path
// ============================================================================

describe('verify-safety — account_config section', () => {

  it('returns 200 and includes account_config with all 9 presence booleans', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body).toHaveProperty('account_config');
    expect(res._body.account_config).toEqual({
      fpb_account_exists:                   true,
      fpb_account_active:                   true,
      fpb_google_ads_connection_exists:     true,
      fpb_google_ads_account_id_present:    true,
      fpb_google_ads_manager_id_present:    true,
      fpb_google_ads_refresh_token_present: true,
      fpb_meta_ads_connection_exists:       true,
      fpb_meta_ads_account_id_present:      true,
      fpb_meta_ads_access_token_present:    true,
    });
  });

  it('overall_pass = true when FPB account + both connections are fully configured', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._body.overall_pass).toBe(true);
    expect(res._body.overall).toBe('PASS');
  });

  it('every account_config check also appears as an entry in the checks array', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const ids = res._body.checks.map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining([
      'fpb_account_exists',
      'fpb_account_active',
      'fpb_google_ads_connection_exists',
      'fpb_google_ads_account_id_present',
      'fpb_google_ads_manager_id_present',
      'fpb_google_ads_refresh_token_present',
      'fpb_meta_ads_connection_exists',
      'fpb_meta_ads_account_id_present',
      'fpb_meta_ads_access_token_present',
    ]));
    // All status=pass when fully configured
    const configChecks = res._body.checks.filter(c => c.id.startsWith('fpb_'));
    for (const c of configChecks) {
      expect(c.status).toBe('pass');
    }
  });

});

// ============================================================================
// Failure modes — overall_pass goes false
// ============================================================================

describe('verify-safety — overall_pass failure modes', () => {

  it('overall_pass = false when FPB account is missing', async () => {
    mockAccount    = null;
    mockGoogleConn = null;
    mockMetaConn   = null;

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._body.overall_pass).toBe(false);
    expect(res._body.overall).toBe('WARN');
    expect(res._body.account_config.fpb_account_exists).toBe(false);
    expect(res._body.account_config.fpb_account_active).toBe(false);
    // All connection-level booleans should also be false when the account
    // doesn't exist (we can't have a connection for a non-existent account).
    expect(res._body.account_config.fpb_google_ads_connection_exists).toBe(false);
    expect(res._body.account_config.fpb_meta_ads_connection_exists).toBe(false);
  });

  it('overall_pass = false when FPB google_ads connection row is missing', async () => {
    mockGoogleConn = null; // FPB account exists, meta works, google is missing

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._body.overall_pass).toBe(false);
    expect(res._body.account_config.fpb_account_exists).toBe(true);
    expect(res._body.account_config.fpb_google_ads_connection_exists).toBe(false);
    expect(res._body.account_config.fpb_meta_ads_connection_exists).toBe(true);
    // The specific check entry surfaces the warn status
    const check = res._body.checks.find(c => c.id === 'fpb_google_ads_connection_exists');
    expect(check.status).toBe('warn');
  });

  it('overall_pass = false when resolved_refresh_token is null on the google_ads connection', async () => {
    mockGoogleConn = { ...VALID_GOOGLE_CONN, resolved_refresh_token: null };

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._body.overall_pass).toBe(false);
    expect(res._body.account_config.fpb_google_ads_connection_exists).toBe(true);
    expect(res._body.account_config.fpb_google_ads_refresh_token_present).toBe(false);
    // Other google_ads fields still register as present
    expect(res._body.account_config.fpb_google_ads_account_id_present).toBe(true);
    expect(res._body.account_config.fpb_google_ads_manager_id_present).toBe(true);
  });

  it('overall_pass = false when FPB account exists but is archived', async () => {
    mockAccount = { ...FPB_ACTIVE, status: 'archived' };

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._body.overall_pass).toBe(false);
    expect(res._body.account_config.fpb_account_exists).toBe(true);
    expect(res._body.account_config.fpb_account_active).toBe(false);
  });

});

// ============================================================================
// SECURITY regression — resolved_* values never leak
// ============================================================================

describe('verify-safety — SECURITY: resolved_* values are never serialized', () => {

  it('account_config returns only booleans (never the resolved string values)', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    for (const [key, value] of Object.entries(res._body.account_config)) {
      expect(
        typeof value === 'boolean',
        `account_config.${key} should be a boolean, got ${typeof value}`,
      ).toBe(true);
    }
  });

  it('no resolved_* token VALUE appears anywhere in the serialized response', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const serialized = JSON.stringify(res._body);
    for (const secret of SECRET_VALUES) {
      expect(
        serialized.includes(secret),
        `Response leaked the secret value: ${secret}`,
      ).toBe(false);
    }
    // Defense in depth — the literal key names for raw resolved fields
    // must not appear either.
    expect(serialized).not.toMatch(/"resolved_access_token"/);
    expect(serialized).not.toMatch(/"resolved_refresh_token"/);
    expect(serialized).not.toMatch(/"resolved_account_id_external"/);
    expect(serialized).not.toMatch(/"resolved_manager_account_id"/);
  });

});
