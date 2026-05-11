// ============================================================
// tests/leads-webhook.test.js
// Tests for api/leads.js — webhook secret, dedup, normalization path.
// Supabase mocked with queue pattern.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase queue mock ───────────────────────────────────────────────────────

const singleQueue = [];
let lastInsertRow  = null;
let lastUpdatePatch = null;
let eqCalls        = []; // track .eq(col, val) calls so tests can verify scoping

function makeChain() {
  const chain = {
    select:  () => makeChain(),
    eq:      (col, val) => { eqCalls.push([col, val]); return makeChain(); },
    insert:  (row)   => { lastInsertRow   = row;   return makeChain(); },
    update:  (patch) => { lastUpdatePatch = patch; return makeChain(); },
    limit:   () => makeChain(),
    order:   () => makeChain(),
    single:  async () => singleQueue.shift() ?? { data: null, error: null },
    // Plain await — returns all
    then:    (resolve) => resolve({ data: singleQueue.shift()?.data ?? [], error: null }),
  };
  return chain;
}

vi.mock('../api/lib/supabase.js', () => ({
  default: { from: () => makeChain() },
}));

// ── Accounts helper mock ──────────────────────────────────────────────────────
// Tests control resolution by mutating module-scope state below. The mock
// mirrors the real helper's contract: resolveAccountFromRequest throws for
// 400/403; getAccountBySlug never throws and returns null for missing.

const DEFAULT_FPB_ACCOUNT = { id: 'fpb-uuid', slug: 'fpb', status: 'active' };
let mockAccount      = DEFAULT_FPB_ACCOUNT; // what getAccountBySlug + resolveAccountFromRequest return on success
let mockResolveError = null;                // what resolveAccountFromRequest throws (Error w/ statusCode)

function setMockAccount(account) {
  mockAccount      = account;
  mockResolveError = null;
}

function setMockResolveError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  mockResolveError = err;
}

vi.mock('../api/lib/accounts.js', () => {
  const getAccountSlugFromRequest = (req) =>
    req?.query?.account || req?.headers?.['x-account-slug'] || 'fpb';
  const getAccountBySlug = async (slug) =>
    (mockAccount?.slug === slug ? mockAccount : null);
  const resolveAccountFromRequest = async () => {
    if (mockResolveError) throw mockResolveError;
    return mockAccount;
  };
  return {
    FPB_DEFAULT_SLUG: 'fpb',
    resolveAccountFromRequest,
    getAccountSlugFromRequest,
    getAccountBySlug,
    resolveForRead: async (req, res) => {
      const slug = getAccountSlugFromRequest(req);
      const account = await getAccountBySlug(slug);
      if (!account) {
        res.status(400).json({
          success: false,
          error:   `Account slug not found: ${slug}`,
          code:    'INVALID_ACCOUNT',
        });
        return null;
      }
      return account;
    },
    resolveForWrite: async (req, res) => {
      let account;
      try {
        account = await resolveAccountFromRequest(req);
      } catch (err) {
        const code = err.statusCode === 400 ? 'INVALID_ACCOUNT' : 'ACCOUNT_ARCHIVED';
        res.status(err.statusCode || 500).json({
          success: false,
          error:   err.message,
          code,
        });
        return null;
      }
      if (account.status === 'inactive') {
        res.status(403).json({
          success: false,
          error:   `Account is inactive: ${account.slug}`,
          code:    'ACCOUNT_INACTIVE',
        });
        return null;
      }
      return account;
    },
  };
});

import handler from '../api/leads.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return {
    method:  'POST',
    url:     '/api/leads',
    headers: {},
    query:   {},
    body:    {},
    ...overrides,
  };
}

function makeRes() {
  const res = {
    _statusCode: 200,
    _body:       null,
    status:    function(code) { this._statusCode = code; return this; },
    json:      function(body) { this._body = body; return this; },
    setHeader: () => {},
    end:       () => {},
  };
  return res;
}

function queueResults(...results) {
  singleQueue.length = 0;
  singleQueue.push(...results);
}

beforeEach(() => {
  vi.clearAllMocks();
  singleQueue.length = 0;
  lastInsertRow      = null;
  lastUpdatePatch    = null;
  eqCalls            = [];
  mockAccount        = DEFAULT_FPB_ACCOUNT;
  mockResolveError   = null;
  delete process.env.LEADS_INGEST_SECRET;
});

// ── Secret enforcement ────────────────────────────────────────────────────────

describe('POST /api/leads — webhook secret', () => {
  it('returns 401 when secret is set and header is missing', async () => {
    process.env.LEADS_INGEST_SECRET = 'supersecret';
    const req = makeReq({ headers: {}, body: { contact_name: 'Test' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(401);
    expect(res._body.success).toBe(false);
  });

  it('returns 401 when secret is wrong', async () => {
    process.env.LEADS_INGEST_SECRET = 'supersecret';
    const req = makeReq({ headers: { 'x-leads-ingest-secret': 'wrong' }, body: {} });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(401);
  });

  it('accepts request when secret matches', async () => {
    process.env.LEADS_INGEST_SECRET = 'supersecret';
    // dedup check returns no existing, insert returns new lead
    queueResults({ data: [], error: null });                    // dedup .limit() → empty
    queueResults({ data: { id: 'lead-1', qualification_status: 'new' }, error: null }); // insert

    const req = makeReq({
      headers: { 'x-leads-ingest-secret': 'supersecret' },
      body:    { contact_name: 'Jane', contact_email: 'jane@test.com' },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(201);
    expect(res._body.success).toBe(true);
  });

  it('allows POST when secret is not set (warns in logs)', async () => {
    // LEADS_INGEST_SECRET not set — should warn but allow
    queueResults({ data: [], error: null });
    queueResults({ data: { id: 'lead-2', qualification_status: 'new' }, error: null });

    const req = makeReq({ headers: {}, body: { contact_name: 'Bob' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(201);
  });
});

// ── Deduplication ─────────────────────────────────────────────────────────────

describe('POST /api/leads — deduplication', () => {
  it('returns duplicate response when lead exists with same email today', async () => {
    // dedup check returns existing lead
    queueResults({ data: [{ id: 'existing-lead-id', created_at: new Date().toISOString() }], error: null });

    const req = makeReq({
      headers: {},
      body: { contact_email: 'duplicate@test.com', contact_name: 'Dup User' },
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._body.duplicate).toBe(true);
    expect(res._body.existing_id).toBe('existing-lead-id');
    expect(res._statusCode).toBe(200); // 200 not 201 — not a new row
  });

  it('creates lead when no duplicate exists', async () => {
    queueResults({ data: [], error: null });   // dedup check: none
    queueResults({ data: { id: 'new-lead', qualification_status: 'new' }, error: null });

    const req = makeReq({
      headers: {},
      body: { contact_email: 'unique@test.com', contact_name: 'Unique' },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._body.success).toBe(true);
    expect(res._body.duplicate).toBeFalsy();
    expect(res._statusCode).toBe(201);
  });

  it('skips dedup check when no dedup key is possible', async () => {
    // No email, no phone, no external_id → no dedup → goes straight to insert
    queueResults({ data: { id: 'anon-lead', qualification_status: 'new' }, error: null });

    const req = makeReq({
      headers: {},
      body: { contact_name: 'Anonymous Only' },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(201);
  });
});

// ── Payload normalization routing ────────────────────────────────────────────

describe('POST /api/leads — normalization', () => {
  it('detects CallRail payload and sets lead_type=call', async () => {
    queueResults({ data: { id: 'cr-lead', qualification_status: 'new' }, error: null });

    const req = makeReq({
      headers: {},
      body: {
        id: 'cr-999',
        caller_name: 'Mike',
        caller_number: '+13215550000',
        utm_source: 'google',
      },
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(201);
    expect(res._body.source_type).toBe('callrail');
  });

  it('detects Gravity Forms payload and sets lead_type=form', async () => {
    queueResults({ data: [], error: null });    // dedup: none (has email)
    queueResults({ data: { id: 'gf-lead', qualification_status: 'new' }, error: null });

    const req = makeReq({
      headers: {},
      body: {
        form_id: '5',
        entry_id: '101',
        name: 'Sue',
        email: 'sue@newlead.com',
        source_url: 'https://floridapolebarn.com/?utm_source=google&utm_medium=cpc',
      },
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(201);
    expect(res._body.source_type).toBe('gravity_forms');
  });
});

// ── PATCH /api/leads — qualification update ───────────────────────────────────

describe('PATCH /api/leads — qualification update', () => {
  it('returns 400 when id is missing', async () => {
    const req = makeReq({ method: 'PATCH', url: '/api/leads', query: {}, body: { qualification_status: 'qualified' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(400);
    expect(res._body.success).toBe(false);
  });

  it('returns 400 for invalid qualification_status', async () => {
    const req = makeReq({ method: 'PATCH', url: '/api/leads', query: { id: 'lead-uuid' }, body: { qualification_status: 'nonsense' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(400);
    expect(res._body.error).toMatch(/Invalid qualification_status/);
  });

  it('returns 400 when no updatable fields are provided', async () => {
    const req = makeReq({ method: 'PATCH', url: '/api/leads', query: { id: 'lead-uuid' }, body: {} });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(400);
    expect(res._body.error).toMatch(/No updatable fields/);
  });

  it('PATCH new -> qualified sets qualification_status and qualified_at', async () => {
    const updatedRow = { id: 'lead-uuid', qualification_status: 'qualified', qualified_at: new Date().toISOString() };
    queueResults(
      { data: { id: 'lead-uuid', account_id: 'fpb-uuid' }, error: null }, // ownership fetch
      { data: updatedRow, error: null },                                  // update result
    );

    const req = makeReq({ method: 'PATCH', url: '/api/leads', query: { id: 'lead-uuid' }, body: { qualification_status: 'qualified' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
    expect(lastUpdatePatch.qualification_status).toBe('qualified');
    expect(lastUpdatePatch.qualified_at).toBeTruthy();
    expect(lastUpdatePatch.booked_at).toBeUndefined();
  });

  it('PATCH -> booked sets booked_at, booked_revenue, gross_profit', async () => {
    const updatedRow = { id: 'lead-uuid', qualification_status: 'booked', booked_revenue: 35000, gross_profit: 8000 };
    queueResults(
      { data: { id: 'lead-uuid', account_id: 'fpb-uuid' }, error: null },
      { data: updatedRow, error: null },
    );

    const req = makeReq({
      method: 'PATCH',
      url:    '/api/leads',
      query:  { id: 'lead-uuid' },
      body:   { qualification_status: 'booked', booked_revenue: '35000', gross_profit: '8000' },
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(lastUpdatePatch.qualification_status).toBe('booked');
    expect(lastUpdatePatch.booked_at).toBeTruthy();
    expect(lastUpdatePatch.booked_revenue).toBe(35000);
    expect(lastUpdatePatch.gross_profit).toBe(8000);
  });

  it('PATCH -> lost sets lost_at', async () => {
    queueResults(
      { data: { id: 'lead-uuid', account_id: 'fpb-uuid' }, error: null },
      { data: { id: 'lead-uuid', qualification_status: 'lost' }, error: null },
    );

    const req = makeReq({ method: 'PATCH', url: '/api/leads', query: { id: 'lead-uuid' }, body: { qualification_status: 'lost', lost_reason: 'Price too high' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(lastUpdatePatch.lost_at).toBeTruthy();
    expect(lastUpdatePatch.lost_reason).toBe('Price too high');
    expect(lastUpdatePatch.qualified_at).toBeUndefined();
  });

  it('PATCH notes-only persists notes', async () => {
    queueResults(
      { data: { id: 'lead-uuid', account_id: 'fpb-uuid' }, error: null },
      { data: { id: 'lead-uuid', notes: 'Interested in 30x40' }, error: null },
    );

    const req = makeReq({ method: 'PATCH', url: '/api/leads', query: { id: 'lead-uuid' }, body: { notes: 'Interested in 30x40' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(lastUpdatePatch.notes).toBe('Interested in 30x40');
    expect(lastUpdatePatch.qualification_status).toBeUndefined();
  });

  it('returns updated row in response', async () => {
    const updatedRow = { id: 'lead-uuid', qualification_status: 'qualified', qualified_at: '2026-04-25T12:00:00Z', notes: 'Called back' };
    queueResults(
      { data: { id: 'lead-uuid', account_id: 'fpb-uuid' }, error: null },
      { data: updatedRow, error: null },
    );

    const req = makeReq({ method: 'PATCH', url: '/api/leads', query: { id: 'lead-uuid' }, body: { qualification_status: 'qualified' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._body.data.id).toBe('lead-uuid');
    expect(res._body.data.qualification_status).toBe('qualified');
  });
});

// ── Account scoping (Stage B1) ───────────────────────────────────────────────

describe('POST /api/leads — account scoping', () => {
  it('POST without account header defaults to FPB', async () => {
    queueResults({ data: [], error: null });                                        // dedup: none
    queueResults({ data: { id: 'fpb-lead', qualification_status: 'new' }, error: null }); // insert

    const req = makeReq({ headers: {}, body: { contact_email: 'default@fpb.com' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(201);
    expect(lastInsertRow.account_id).toBe('fpb-uuid');
    expect(lastInsertRow.client_key).toBe('fpb');
    expect(lastInsertRow.dedup_key).toMatch(/^fpb::email::default@fpb\.com::/);
  });

  it('POST with x-account-slug: weld inserts row with weld account_id and weld-prefixed dedup_key', async () => {
    setMockAccount({ id: 'weld-uuid', slug: 'weld', status: 'active' });
    queueResults({ data: [], error: null });
    queueResults({ data: { id: 'weld-lead', qualification_status: 'new' }, error: null });

    const req = makeReq({
      headers: { 'x-account-slug': 'weld' },
      body:    { contact_email: 'lead@weld.com' },
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(201);
    expect(lastInsertRow.account_id).toBe('weld-uuid');
    expect(lastInsertRow.client_key).toBe('weld');
    expect(lastInsertRow.dedup_key).toMatch(/^weld::email::lead@weld\.com::/);
  });

  it('POST with unknown slug returns 400 INVALID_ACCOUNT', async () => {
    setMockResolveError(400, 'Account slug not found: bogus');

    const req = makeReq({ headers: { 'x-account-slug': 'bogus' }, body: { contact_email: 'x@y.com' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(400);
    expect(res._body.code).toBe('INVALID_ACCOUNT');
    expect(lastInsertRow).toBeNull();
  });

  it('POST when account is archived returns 403 ACCOUNT_ARCHIVED', async () => {
    setMockResolveError(403, 'Account is archived: oldco');

    const req = makeReq({ headers: { 'x-account-slug': 'oldco' }, body: { contact_email: 'x@y.com' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(403);
    expect(res._body.code).toBe('ACCOUNT_ARCHIVED');
    expect(lastInsertRow).toBeNull();
  });

  it('POST when account is inactive returns 403 ACCOUNT_INACTIVE', async () => {
    setMockAccount({ id: 'pause-uuid', slug: 'pause', status: 'inactive' });

    const req = makeReq({ headers: { 'x-account-slug': 'pause' }, body: { contact_email: 'x@y.com' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(403);
    expect(res._body.code).toBe('ACCOUNT_INACTIVE');
    expect(lastInsertRow).toBeNull();
  });
});

describe('GET /api/leads — account scoping', () => {
  it('GET filters results by account_id', async () => {
    queueResults({ data: [{ id: 'lead-1', account_id: 'fpb-uuid' }], error: null });

    const req = makeReq({ method: 'GET', headers: {}, query: {} });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
    expect(eqCalls).toContainEqual(['account_id', 'fpb-uuid']);
  });
});

describe('PATCH /api/leads — account scoping', () => {
  it('returns 403 ACCOUNT_MISMATCH when lead belongs to a different account', async () => {
    // Caller's account is FPB by default; lead's account is weld.
    queueResults({ data: { id: 'lead-uuid', account_id: 'weld-uuid' }, error: null });

    const req = makeReq({
      method: 'PATCH',
      url:    '/api/leads',
      query:  { id: 'lead-uuid' },
      body:   { qualification_status: 'qualified' },
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(403);
    expect(res._body.code).toBe('ACCOUNT_MISMATCH');
    expect(lastUpdatePatch).toBeNull(); // never reached the update path
  });
});
