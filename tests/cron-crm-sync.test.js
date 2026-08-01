// ============================================================
// tests/cron-crm-sync.test.js — S-AUTOLOG-1 (2026-07-31)
//
// api/cron-crm-sync.js had NO test file before this session. Its
// automation_log writes had TWO CHECK-constraint violations, both found by
// reading the live constraint directly (Supabase MCP list_tables against
// olpyqfuphiwdongzmazi) rather than inferring it from code (SDR-2):
//   1. event_type: 'crm_sync' — not a member of the constraint.
//   2. status: 'success' (success path only) — not a member of
//      automation_log's status constraint either (running/complete/error).
// Both inserts have therefore always failed, silently, since the feature
// was built — see api/lib/automation-log-schema.js and
// harness/DECISIONS.md S-AUTOLOG-1.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertsByTable = {};

function makeChain(table) {
  const chain = {
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

const { mockCreateCrmClient, mockRunCrmSync } = vi.hoisted(() => ({
  mockCreateCrmClient: vi.fn(() => ({})),
  mockRunCrmSync:      vi.fn(),
}));
vi.mock('../api/lib/crm-bridge.js', () => ({
  createCrmClient: mockCreateCrmClient,
  runCrmSync:      mockRunCrmSync,
}));

import { AUTOMATION_LOG_EVENT_TYPES, AUTOMATION_LOG_STATUSES } from '../api/lib/automation-log-schema.js';
import handler from '../api/cron-crm-sync.js';

function makeReq() {
  return { method: 'GET', headers: { 'x-vercel-cron': '1' } };
}

function makeRes() {
  const res = {
    _statusCode: 200,
    _body: null,
    status(code) { this._statusCode = code; return this; },
    json(body) { this._body = body; return this; },
  };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(insertsByTable)) delete insertsByTable[key];
  delete process.env.CRON_SECRET;
});

describe('cron-crm-sync — automation_log write path (S-AUTOLOG-1)', () => {
  it('logs a valid automation_log row on a successful sync (was event_type "crm_sync" + status "success", BOTH invalid)', async () => {
    mockRunCrmSync.mockResolvedValue({ matched: 5, booked: 2, revenue_total: 1000 });

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
    expect(row.event_type).toBe('data_pull');
    expect(row.status).toBe('complete'); // was the invalid literal 'success'
    expect(row.metadata.source_event).toBe('crm_sync');
  });

  it('logs a valid automation_log row on a failed sync', async () => {
    mockRunCrmSync.mockRejectedValue(new Error('CRM API unreachable'));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(500);
    expect(insertsByTable['automation_log']).toHaveLength(1);
    const row = insertsByTable['automation_log'][0];

    expect(AUTOMATION_LOG_EVENT_TYPES).toContain(row.event_type);
    expect(AUTOMATION_LOG_STATUSES).toContain(row.status);
    expect(row.event_type).toBe('data_pull');
    expect(row.status).toBe('error');
    expect(row.metadata.source_event).toBe('crm_sync');
  });
});
