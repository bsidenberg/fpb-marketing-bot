// ============================================================
// tests/meta-creative.test.js — S-AUTOLOG-1 (2026-07-31)
//
// api/meta-creative.js had NO test file before this session. Its
// automation_log write used event_type: 'creative_uploaded' — not a member
// of the table's live CHECK constraint — wrapped in an empty catch block
// that swallowed even a thrown exception. The insert has therefore always
// failed, silently, since the feature was built (see
// api/lib/automation-log-schema.js and harness/DECISIONS.md S-AUTOLOG-1).
//
// Scope here is narrow and deliberate: enough handler mocking to reach the
// automation_log write on a successful creative upload, not full coverage
// of the Meta creative-upload flow itself (out of this session's scope).
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertsByTable = {};

function makeChain(table) {
  const chain = {
    select: () => chain,
    eq:     () => chain,
    insert: (row) => {
      (insertsByTable[table] = insertsByTable[table] || []).push(row);
      return chain;
    },
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return chain;
}

vi.mock('../api/lib/supabase.js', () => ({
  default: { from: (table) => makeChain(table) },
}));

const FPB = { id: 'fpb-uuid', slug: 'fpb', status: 'active' };
const META_CONN = {
  resolved_access_token:        'm-token',
  resolved_account_id_external: '123456789',
};

vi.mock('../api/lib/accounts.js', () => ({
  resolveForWrite: async () => FPB,
  getConnectionForAccount: vi.fn(async () => META_CONN),
  checkConnectionFields: (conn) => (conn ? null : 'no connection row'),
}));

const { mockRecordApiCall } = vi.hoisted(() => ({ mockRecordApiCall: vi.fn(async () => {}) }));
vi.mock('../api/lib/api-cost.js', () => ({ recordApiCall: mockRecordApiCall }));

import { AUTOMATION_LOG_EVENT_TYPES, AUTOMATION_LOG_STATUSES } from '../api/lib/automation-log-schema.js';
import handler from '../api/meta-creative.js';

function makeReq(body = {}) {
  return {
    method: 'POST',
    headers: {},
    body: { imageBase64: 'ZmFrZS1pbWFnZS1kYXRh', ...body },
  };
}

function makeRes() {
  const res = {
    _statusCode: 200,
    _body: null,
    setHeader() { return this; },
    status(code) { this._statusCode = code; return this; },
    json(body) { this._body = body; return this; },
    end() { return this; },
  };
  return res;
}

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(insertsByTable)) delete insertsByTable[key];
  process.env.META_PAGE_ID = '987654321';
  delete process.env.EXECUTE_SECRET; // non-production warn-and-allow

  // STEP 0 diagnostic, STEP 1 image upload, STEP 2 creative create — in order.
  mockFetch
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ images: { f: { hash: 'img-hash-1' } } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'creative-1' }) });
});

describe('meta-creative — automation_log write path (S-AUTOLOG-1)', () => {
  it('logs an automation_log row within the live CHECK constraint on a successful upload', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(insertsByTable['automation_log']).toHaveLength(1);
    const row = insertsByTable['automation_log'][0];

    // AUTOMATION_LOG_EVENT_TYPES/_STATUSES is a HAND-MAINTAINED mirror of the
    // live constraint (Supabase MCP list_tables against olpyqfuphiwdongzmazi,
    // 2026-07-31), not a live drift detector — see automation-log-schema.js.
    expect(AUTOMATION_LOG_EVENT_TYPES).toContain(row.event_type);
    expect(AUTOMATION_LOG_STATUSES).toContain(row.status);
    expect(row.event_type).toBe('action_executed');
    expect(row.account_id).toBe('fpb-uuid');
    expect(row.metadata.source_event).toBe('creative_uploaded'); // preserved, moved off the constrained column
  });
});
