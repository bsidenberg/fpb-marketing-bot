// ============================================================
// tests/cors.test.js
// Phase 0 Sub-Task 6.3 — origin-locked CORS.
//
// Verifies api/lib/cors.js: allowed origins get an exact ACAO header,
// disallowed origins get none (never the `*` wildcard), Vary: Origin is
// always set, and the ALLOWED_ORIGINS env var overrides the defaults.
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setCorsHeaders, isOriginAllowed, getAllowedOrigins } from '../api/lib/cors.js';

function makeRes() {
  return {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
  };
}

function makeReq(origin) {
  return { headers: origin ? { origin } : {} };
}

// ALLOWED_ORIGINS must not leak between tests.
let savedAllowed;
beforeEach(() => {
  savedAllowed = process.env.ALLOWED_ORIGINS;
  delete process.env.ALLOWED_ORIGINS;
});
afterEach(() => {
  if (savedAllowed === undefined) delete process.env.ALLOWED_ORIGINS;
  else process.env.ALLOWED_ORIGINS = savedAllowed;
});

// ── Default allow-list ───────────────────────────────────────────────────────

describe('cors — default allow-list', () => {

  it('echoes the production origin back exactly', () => {
    const res = makeRes();
    setCorsHeaders(makeReq('https://fpb-marketing-bot.vercel.app'), res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://fpb-marketing-bot.vercel.app');
  });

  it('allows a localhost dev origin', () => {
    const res = makeRes();
    setCorsHeaders(makeReq('http://localhost:5173'), res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
  });

  it('omits the ACAO header for a disallowed origin', () => {
    const res = makeRes();
    setCorsHeaders(makeReq('https://evil.example.com'), res);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('never responds with the * wildcard', () => {
    const res = makeRes();
    setCorsHeaders(makeReq('https://evil.example.com'), res);
    expect(res.headers['Access-Control-Allow-Origin']).not.toBe('*');
  });

  it('omits the ACAO header when the request has no Origin', () => {
    const res = makeRes();
    setCorsHeaders(makeReq(), res);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('always sets Vary: Origin', () => {
    const res = makeRes();
    setCorsHeaders(makeReq('https://evil.example.com'), res);
    expect(res.headers['Vary']).toBe('Origin');
  });

  it('allows a Vercel preview deployment of this project', () => {
    const origin = 'https://fpb-marketing-bot-abc123-bsidenberg.vercel.app';
    const res = makeRes();
    setCorsHeaders(makeReq(origin), res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe(origin);
  });

  it('does not allow an unrelated *.vercel.app origin', () => {
    expect(isOriginAllowed('https://some-other-project.vercel.app')).toBe(false);
  });

  it('applies the methods and headers passed in options', () => {
    const res = makeRes();
    setCorsHeaders(makeReq(), res, { methods: 'POST, OPTIONS', headers: 'Content-Type, x-execute-secret' });
    expect(res.headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
    expect(res.headers['Access-Control-Allow-Headers']).toBe('Content-Type, x-execute-secret');
  });

});

// ── ALLOWED_ORIGINS env override ─────────────────────────────────────────────

describe('cors — ALLOWED_ORIGINS env override', () => {

  it('honors a single custom origin', () => {
    process.env.ALLOWED_ORIGINS = 'https://app.prime.test';
    const res = makeRes();
    setCorsHeaders(makeReq('https://app.prime.test'), res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://app.prime.test');
  });

  it('honors multiple comma-separated origins (with surrounding whitespace)', () => {
    process.env.ALLOWED_ORIGINS = 'https://a.prime.test, https://b.prime.test';
    expect(isOriginAllowed('https://a.prime.test')).toBe(true);
    expect(isOriginAllowed('https://b.prime.test')).toBe(true);
    expect(isOriginAllowed('https://c.prime.test')).toBe(false);
    expect(getAllowedOrigins()).toEqual(['https://a.prime.test', 'https://b.prime.test']);
  });

  it('an explicit override does not implicitly allow the production default', () => {
    process.env.ALLOWED_ORIGINS = 'https://only-this.test';
    expect(isOriginAllowed('https://fpb-marketing-bot.vercel.app')).toBe(false);
  });

  it('an explicit override disables the Vercel preview pattern', () => {
    process.env.ALLOWED_ORIGINS = 'https://only-this.test';
    expect(isOriginAllowed('https://fpb-marketing-bot-abc123-x.vercel.app')).toBe(false);
  });

});
