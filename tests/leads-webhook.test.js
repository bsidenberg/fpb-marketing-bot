// ============================================================
// tests/leads-webhook.test.js
// Tests for api/leads.js — webhook secret, dedup, normalization path.
// Supabase mocked with queue pattern.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase queue mock ───────────────────────────────────────────────────────

const singleQueue = [];
let lastInsertRow = null;

function makeChain() {
  const chain = {
    select:  () => makeChain(),
    eq:      () => makeChain(),
    insert:  (row) => { lastInsertRow = row; return makeChain(); },
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
