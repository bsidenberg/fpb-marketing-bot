// ============================================================
// tests/require-admin.test.js
// Unit tests for api/lib/require-admin.js
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { requireAdmin, COOKIE_NAME, EXPIRY_MS } from '../api/lib/require-admin.js';

const SECRET   = 'test-auth-secret-32-bytes-long!!';
const PASSWORD = 'correct-password';

function makeCookie(payload, secret = SECRET) {
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${COOKIE_NAME}=${payload}.${sig}`;
}

function makeValidCookie(offsetMs = 0) {
  const expiry = Date.now() + EXPIRY_MS + offsetMs;
  return makeCookie(String(expiry));
}

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json   = (body)  => { res._body  = body;  return res; };
  return res;
}

function makeReq(cookieHeader = '') {
  return { headers: { cookie: cookieHeader } };
}

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSWORD', PASSWORD);
  vi.stubEnv('AUTH_SECRET', SECRET);
  vi.stubEnv('NODE_ENV', 'production');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('requireAdmin — valid cookie', () => {
  it('returns true and sets no response when cookie is valid', () => {
    const req = makeReq(makeValidCookie());
    const res = makeRes();
    const result = requireAdmin(req, res);
    expect(result).toBe(true);
    expect(res._status).toBeNull();
  });
});

describe('requireAdmin — missing cookie', () => {
  it('returns false and sends 401 when Cookie header is absent', () => {
    const req = makeReq('');
    const res = makeRes();
    const result = requireAdmin(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(401);
    expect(res._body.success).toBe(false);
  });

  it('returns false and sends 401 when cookie is present but prime_session is missing', () => {
    const req = makeReq('other_cookie=abc123');
    const res = makeRes();
    const result = requireAdmin(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(401);
  });
});

describe('requireAdmin — wrong HMAC', () => {
  it('returns false and sends 401 when signature is tampered', () => {
    const expiry = Date.now() + EXPIRY_MS;
    const tamperedCookie = `${COOKIE_NAME}=${expiry}.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`;
    const req = makeReq(tamperedCookie);
    const res = makeRes();
    const result = requireAdmin(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(401);
  });

  it('returns false and sends 401 when signed with wrong secret', () => {
    const cookie = makeCookie(String(Date.now() + EXPIRY_MS), 'wrong-secret');
    const req = makeReq(cookie);
    const res = makeRes();
    const result = requireAdmin(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(401);
  });
});

describe('requireAdmin — expired cookie', () => {
  it('returns false and sends 401 when session has expired', () => {
    const expiry = Date.now() - 1000; // 1 second in the past
    const cookie = makeCookie(String(expiry));
    const req = makeReq(cookie);
    const res = makeRes();
    const result = requireAdmin(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(401);
  });
});

describe('requireAdmin — malformed cookie value', () => {
  it('returns false and sends 401 when there is no dot separator', () => {
    const req = makeReq(`${COOKIE_NAME}=nodotinthisvalue`);
    const res = makeRes();
    const result = requireAdmin(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(401);
  });
});

describe('requireAdmin — missing env vars in production', () => {
  it('returns false and sends 503 when ADMIN_PASSWORD is unset in production', () => {
    vi.stubEnv('ADMIN_PASSWORD', '');
    const req = makeReq(makeValidCookie());
    const res = makeRes();
    const result = requireAdmin(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(503);
    expect(res._body.code).toBe('AUTH_NOT_CONFIGURED');
  });

  it('returns false and sends 503 when AUTH_SECRET is unset in production', () => {
    vi.stubEnv('AUTH_SECRET', '');
    const req = makeReq(makeValidCookie());
    const res = makeRes();
    const result = requireAdmin(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(503);
    expect(res._body.code).toBe('AUTH_NOT_CONFIGURED');
  });
});

describe('requireAdmin — missing env vars in non-production', () => {
  it('returns true without checking cookie when secrets unset in non-production', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ADMIN_PASSWORD', '');
    vi.stubEnv('AUTH_SECRET', '');
    const req = makeReq('');
    const res = makeRes();
    const result = requireAdmin(req, res);
    expect(result).toBe(true);
    expect(res._status).toBeNull();
  });
});
