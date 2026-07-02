// ============================================================
// tests/auth.test.js
// Unit tests for api/auth.js
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../api/auth.js';
import { clearRateLimits } from '../api/lib/rate-limit.js';
import { COOKIE_NAME } from '../api/lib/require-admin.js';

const PASSWORD = 'super-secure-password';
const SECRET   = 'test-auth-secret-32-bytes-long!!';

function makeRes() {
  const res = { _status: null, _body: null, _headers: {} };
  res.status    = (code)         => { res._status = code; return res; };
  res.json      = (body)         => { res._body   = body;  return res; };
  res.setHeader = (name, value)  => { res._headers[name.toLowerCase()] = value; };
  res.end       = ()             => res;
  return res;
}

function makeReq(body = {}, method = 'POST', headers = {}) {
  return {
    method,
    body,
    headers: { 'x-forwarded-for': '127.0.0.1', ...headers },
    socket: {},
  };
}

beforeEach(() => {
  clearRateLimits();
  vi.stubEnv('ADMIN_PASSWORD', PASSWORD);
  vi.stubEnv('AUTH_SECRET', SECRET);
  vi.stubEnv('NODE_ENV', 'production');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/auth — correct password', () => {
  it('returns 200 with success:true and sets HttpOnly Set-Cookie', async () => {
    const req = makeReq({ password: PASSWORD });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    const cookie = res._headers['set-cookie'] || '';
    expect(cookie).toContain(COOKIE_NAME);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
  });
});

describe('POST /api/auth — wrong password', () => {
  it('returns 401 when password does not match', async () => {
    const req = makeReq({ password: 'wrong-password' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(401);
    expect(res._body.success).toBe(false);
  });
});

describe('POST /api/auth — missing password', () => {
  it('returns 400 when password field is absent', async () => {
    const req = makeReq({});
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.success).toBe(false);
  });
});

describe('POST /api/auth — logout', () => {
  it('returns 200 and clears cookie with Max-Age=0', async () => {
    const req = makeReq({ logout: true });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    const cookie = res._headers['set-cookie'] || '';
    expect(cookie).toContain('Max-Age=0');
  });
});

describe('POST /api/auth — rate limiting', () => {
  it('returns 429 after 30 failed attempts from same IP', async () => {
    const now = Date.now();
    // Fill 30 slots
    for (let i = 0; i < 30; i++) {
      const req = makeReq({ password: 'bad' }, 'POST', { 'x-forwarded-for': '10.0.0.1' });
      const res = makeRes();
      await handler(req, res);
    }
    // 31st should be rate-limited
    const req = makeReq({ password: PASSWORD }, 'POST', { 'x-forwarded-for': '10.0.0.1' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(429);
    expect(res._body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(res._headers['retry-after']).toBeDefined();
  });
});

describe('POST /api/auth — ADMIN_PASSWORD unset in production', () => {
  it('returns 503 when ADMIN_PASSWORD is not configured', async () => {
    vi.stubEnv('ADMIN_PASSWORD', '');
    const req = makeReq({ password: 'anything' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(503);
    expect(res._body.code).toBe('AUTH_NOT_CONFIGURED');
  });
});

describe('GET /api/auth — wrong method', () => {
  it('returns 405 for GET requests', async () => {
    const req = makeReq({}, 'GET');
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(405);
    expect(res._body.success).toBe(false);
  });
});
