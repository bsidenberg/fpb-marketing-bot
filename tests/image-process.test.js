// ============================================================
// tests/image-process.test.js
// Phase 0 Sub-Task 6.5 — /api/image-process auth + payload size.
//
// Verifies the IMAGE_PROCESS_SECRET gate (fail-closed in production)
// and the 10MB Base64 payload limit. Sharp is mocked — no real image
// decoding happens.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock sharp — a chainable pipeline that yields fake output bytes ──────────
vi.mock('sharp', () => {
  const pipeline = {
    resize:    () => pipeline,
    composite: () => pipeline,
    jpeg:      () => pipeline,
    metadata:  async () => ({ width: 1200, height: 628 }),
    toBuffer:  async () => Buffer.from('processed-image-bytes'),
  };
  return { default: () => pipeline };
});

import handler from '../api/image-process.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeReq(overrides = {}) {
  return {
    method:  'POST',
    headers: {},
    body:    { imageData: { base64: 'aGVsbG8=' }, format: 'feed' },
    ...overrides,
  };
}

function makeRes() {
  return {
    _statusCode: 200,
    _body:       null,
    _headers:    {},
    status(code) { this._statusCode = code; return this; },
    json(body)   { this._body = body; return this; },
    setHeader(k, v) { this._headers[k] = v; },
    end() { return this; },
  };
}

// IMAGE_PROCESS_SECRET and NODE_ENV must not leak between tests.
let savedSecret, savedNodeEnv;
beforeEach(() => {
  savedSecret  = process.env.IMAGE_PROCESS_SECRET;
  savedNodeEnv = process.env.NODE_ENV;
  delete process.env.IMAGE_PROCESS_SECRET;
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.IMAGE_PROCESS_SECRET;
  else process.env.IMAGE_PROCESS_SECRET = savedSecret;
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

// ── Auth gate ────────────────────────────────────────────────────────────────

describe('image-process — auth gate', () => {

  it('processes the image when the secret is set and the header matches', async () => {
    process.env.IMAGE_PROCESS_SECRET = 'img-secret';
    const req = makeReq({ headers: { 'x-image-process-secret': 'img-secret' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.processedImage.base64).toBeTruthy();
  });

  it('returns 401 when the secret is set but the header is missing', async () => {
    process.env.IMAGE_PROCESS_SECRET = 'img-secret';
    const req = makeReq({ headers: {} });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(401);
  });

  it('returns 503 when the secret is unset in production (fail-closed)', async () => {
    process.env.NODE_ENV = 'production';
    const req = makeReq({ headers: {} });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(503);
    expect(res._body.code).toBe('SECRET_NOT_CONFIGURED');
  });

  it('warns and proceeds when the secret is unset in development', async () => {
    process.env.NODE_ENV = 'development';
    const req = makeReq({ headers: {} });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
  });

});

// ── Payload size limit ───────────────────────────────────────────────────────

describe('image-process — payload size limit', () => {

  it('rejects a Base64 payload larger than 10MB with 413', async () => {
    process.env.NODE_ENV = 'development'; // skip auth via warn-and-allow
    const huge = 'A'.repeat(10 * 1024 * 1024 + 1);
    const req = makeReq({ headers: {}, body: { imageData: { base64: huge }, format: 'feed' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(413);
    expect(res._body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('accepts a Base64 payload exactly at the 10MB boundary', async () => {
    process.env.NODE_ENV = 'development';
    const atLimit = 'A'.repeat(10 * 1024 * 1024);
    const req = makeReq({ headers: {}, body: { imageData: { base64: atLimit }, format: 'feed' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(200);
  });

  it('returns 400 when imageData.base64 is missing', async () => {
    process.env.NODE_ENV = 'development';
    const req = makeReq({ headers: {}, body: { format: 'feed' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(400);
  });

});
