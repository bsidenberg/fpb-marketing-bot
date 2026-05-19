// ============================================================
// tests/require-secret.test.js
// Phase 0 Sub-Task 6.2 — fail-closed shared-secret gate.
//
// Verifies api/lib/require-secret.js:
//   secret set + header matches        -> allow
//   secret set + header missing/wrong  -> 401
//   secret unset + production          -> 503 SECRET_NOT_CONFIGURED
//   secret unset + non-production      -> warn-and-allow
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { requireSecret } from '../api/lib/require-secret.js';

const CONFIG = { envVar: 'TEST_SECRET', header: 'x-test-secret', label: '/api/test' };

function makeRes() {
  return {
    _statusCode: 200,
    _body:       null,
    status(code) { this._statusCode = code; return this; },
    json(body)   { this._body = body; return this; },
  };
}

// TEST_SECRET and NODE_ENV must not leak between tests.
let savedSecret, savedNodeEnv;
beforeEach(() => {
  savedSecret  = process.env.TEST_SECRET;
  savedNodeEnv = process.env.NODE_ENV;
  delete process.env.TEST_SECRET;
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.TEST_SECRET;
  else process.env.TEST_SECRET = savedSecret;
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

describe('require-secret — secret is set', () => {

  it('allows the request when the header matches', () => {
    process.env.TEST_SECRET = 'sesame';
    const res = makeRes();
    const ok = requireSecret({ headers: { 'x-test-secret': 'sesame' } }, res, CONFIG);
    expect(ok).toBe(true);
    expect(res._body).toBeNull();
  });

  it('returns 401 when the header is missing', () => {
    process.env.TEST_SECRET = 'sesame';
    const res = makeRes();
    const ok = requireSecret({ headers: {} }, res, CONFIG);
    expect(ok).toBe(false);
    expect(res._statusCode).toBe(401);
  });

  it('returns 401 when the header is wrong', () => {
    process.env.TEST_SECRET = 'sesame';
    const res = makeRes();
    const ok = requireSecret({ headers: { 'x-test-secret': 'wrong' } }, res, CONFIG);
    expect(ok).toBe(false);
    expect(res._statusCode).toBe(401);
  });

});

describe('require-secret — secret unset, production (fail-closed)', () => {

  it('returns 503 SECRET_NOT_CONFIGURED', () => {
    process.env.NODE_ENV = 'production';
    const res = makeRes();
    const ok = requireSecret({ headers: {} }, res, CONFIG);
    expect(ok).toBe(false);
    expect(res._statusCode).toBe(503);
    expect(res._body.code).toBe('SECRET_NOT_CONFIGURED');
    expect(res._body.error).toMatch(/TEST_SECRET/);
  });

});

describe('require-secret — secret unset, non-production (warn-and-allow)', () => {

  it('allows the request in development', () => {
    process.env.NODE_ENV = 'development';
    const res = makeRes();
    expect(requireSecret({ headers: {} }, res, CONFIG)).toBe(true);
    expect(res._body).toBeNull();
  });

  it('allows the request under NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';
    const res = makeRes();
    expect(requireSecret({ headers: {} }, res, CONFIG)).toBe(true);
  });

});
