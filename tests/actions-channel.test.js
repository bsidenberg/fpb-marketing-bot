// ============================================================
// tests/actions-channel.test.js
// Tests for channel normalization in POST /api/actions.
//
// Production constraint (confirmed):
//   CHECK (channel = ANY (ARRAY['google_ads','meta_ads','seo','content','gbp']))
//
// Verifies that markdown-polluted channel values from Claude's response
// are normalized before reaching the Supabase insert, preventing the
// actions_channel_check constraint violation that caused production 500s.
//
// Covers:
//   • Clean valid channel values pass through unchanged
//   • "**LP Search - Kits" → 'seo' (strips markdown; "search" fuzzy-maps to seo)
//   • Missing channel defaults to 'content'
//   • Fuzzy-matched values ('meta') map to the correct enum ('meta_ads')
//   • Markdown-wrapped valid value "**google_ads**" → 'google_ads'
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock ─────────────────────────────────────────────────────────────
const insertsByTable = {};
let mockInsertError  = null;

function makeChain(table) {
  const chain = {
    select: () => chain,
    eq:     () => chain,
    order:  () => chain,
    limit:  () => chain,
    insert: (row) => {
      (insertsByTable[table] = insertsByTable[table] || []).push(
        Array.isArray(row) ? row[0] : row
      );
      return chain;
    },
    single: async () => {
      if (mockInsertError) return { data: null, error: mockInsertError };
      const last = (insertsByTable[table] || []).slice(-1)[0];
      return { data: { id: 'new-action-id', ...last }, error: null };
    },
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return chain;
}

vi.mock('../api/lib/supabase.js', () => ({
  default: { from: (table) => makeChain(table) },
}));

// ── Accounts mock ─────────────────────────────────────────────────────────────
const FPB = { id: 'fpb-uuid', slug: 'fpb', status: 'active' };

vi.mock('../api/lib/accounts.js', () => ({
  FPB_DEFAULT_SLUG: 'fpb',
  resolveForRead:  async () => FPB,
  resolveForWrite: async () => FPB,
}));

// ── Autonomy mocks — allow everything so we can reach the insert ──────────────
vi.mock('../api/lib/autonomy-coordinator.js', () => ({
  checkPostureForAction: async () => ({ verdict: 'require_approval', reason: null }),
}));

vi.mock('../api/lib/autonomy-escalation.js', () => ({
  detectNovelty:      async () => false,
  detectConflict:     async () => false,
  detectExternalFlag: ()       => false,
  detectAnomaly:      ()       => false,
}));

import handler from '../api/actions.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeReq(bodyOverrides = {}) {
  return {
    method:  'POST',
    url:     '/api/actions',
    headers: {},
    query:   {},
    body:    { action_type: 'pause_campaign', ...bodyOverrides },
  };
}

function makeRes() {
  return {
    _statusCode: 200,
    _body:       null,
    status: function(code) { this._statusCode = code; return this; },
    json:   function(body) { this._body = body; return this; },
    setHeader: () => {},
    end:       () => {},
  };
}

function lastActionsInsert() {
  return (insertsByTable['actions'] || []).slice(-1)[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(insertsByTable)) delete insertsByTable[k];
  mockInsertError = null;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/actions — channel normalization', () => {

  it('stores "google_ads" unchanged when channel is already valid', async () => {
    const res = makeRes();
    await handler(makeReq({ channel: 'google_ads' }), res);

    expect(res._statusCode).toBe(201);
    expect(lastActionsInsert()?.channel).toBe('google_ads');
  });

  it('stores "meta_ads" unchanged when channel is already valid', async () => {
    const res = makeRes();
    await handler(makeReq({ channel: 'meta_ads' }), res);

    expect(res._statusCode).toBe(201);
    expect(lastActionsInsert()?.channel).toBe('meta_ads');
  });

  it('normalizes "**LP Search - Kits" to "seo" — strips markdown, maps "search" keyword', async () => {
    // This is the production-failing value. After ** stripping: "LP Search - Kits"
    // contains "search" → fuzzy maps to 'seo', a valid constraint value.
    const res = makeRes();
    await handler(makeReq({ channel: '**LP Search - Kits' }), res);

    expect(res._statusCode).toBe(201);
    expect(lastActionsInsert()?.channel).toBe('seo');
  });

  it('normalizes "**LP Search - Kits**" (fully wrapped bold) to "seo"', async () => {
    const res = makeRes();
    await handler(makeReq({ channel: '**LP Search - Kits**' }), res);

    expect(res._statusCode).toBe(201);
    expect(lastActionsInsert()?.channel).toBe('seo');
  });

  it('defaults missing channel to "content"', async () => {
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._statusCode).toBe(201);
    expect(lastActionsInsert()?.channel).toBe('content');
  });

  it('fuzzy-maps "meta" to "meta_ads"', async () => {
    const res = makeRes();
    await handler(makeReq({ channel: 'meta' }), res);

    expect(res._statusCode).toBe(201);
    expect(lastActionsInsert()?.channel).toBe('meta_ads');
  });

  it('fuzzy-maps "**google_ads**" (markdown-wrapped valid) to "google_ads"', async () => {
    const res = makeRes();
    await handler(makeReq({ channel: '**google_ads**' }), res);

    expect(res._statusCode).toBe(201);
    expect(lastActionsInsert()?.channel).toBe('google_ads');
  });

  it('stores account_id from resolved account on every insert', async () => {
    const res = makeRes();
    await handler(makeReq({ channel: 'google_ads' }), res);

    expect(lastActionsInsert()?.account_id).toBe(FPB.id);
  });

});
