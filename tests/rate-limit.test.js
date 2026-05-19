// ============================================================
// tests/rate-limit.test.js
// Phase 0 Sub-Task 6.4 — in-memory sliding-window rate limiter.
//
// Verifies api/lib/rate-limit.js: requests are allowed up to the limit,
// blocked over it, freed once the window passes, and counted
// independently per account. `now` is injected for determinism.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkRateLimit,
  clearRateLimits,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
} from '../api/lib/rate-limit.js';

beforeEach(() => clearRateLimits());

describe('rate-limit — checkRateLimit', () => {

  it('allows a request under the limit', () => {
    const r = checkRateLimit('a', { now: 0, windowMs: 1000, maxRequests: 3 });
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
  });

  it('allows requests up to the limit', () => {
    const opts = { now: 0, windowMs: 1000, maxRequests: 3 };
    expect(checkRateLimit('a', opts).allowed).toBe(true);
    expect(checkRateLimit('a', opts).allowed).toBe(true);
    expect(checkRateLimit('a', opts).allowed).toBe(true);
  });

  it('blocks the request that exceeds the limit with a 429-style result', () => {
    const opts = { now: 0, windowMs: 1000, maxRequests: 3 };
    checkRateLimit('a', opts);
    checkRateLimit('a', opts);
    checkRateLimit('a', opts);
    const over = checkRateLimit('a', opts);
    expect(over.allowed).toBe(false);
    expect(over.limit).toBe(3);
    expect(over.retryAfterSec).toBeGreaterThan(0);
  });

  it('allows requests again once the window has passed', () => {
    const win = { windowMs: 1000, maxRequests: 3 };
    checkRateLimit('a', { ...win, now: 0 });
    checkRateLimit('a', { ...win, now: 0 });
    checkRateLimit('a', { ...win, now: 0 });
    expect(checkRateLimit('a', { ...win, now: 0 }).allowed).toBe(false);
    // 1001ms later — every prior timestamp has aged out of the window.
    const after = checkRateLimit('a', { ...win, now: 1001 });
    expect(after.allowed).toBe(true);
    expect(after.count).toBe(1);
  });

  it('keeps independent limits per account', () => {
    const opts = { now: 0, windowMs: 1000, maxRequests: 2 };
    checkRateLimit('acct-a', opts);
    checkRateLimit('acct-a', opts);
    expect(checkRateLimit('acct-a', opts).allowed).toBe(false);
    // acct-b has its own fresh budget.
    expect(checkRateLimit('acct-b', opts).allowed).toBe(true);
    expect(checkRateLimit('acct-b', opts).allowed).toBe(true);
    expect(checkRateLimit('acct-b', opts).allowed).toBe(false);
  });

  it('uses the production defaults of 30 requests per 60 seconds', () => {
    expect(RATE_LIMIT_MAX_REQUESTS).toBe(30);
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
    for (let i = 0; i < 30; i++) {
      expect(checkRateLimit('big', { now: 1000 }).allowed).toBe(true);
    }
    expect(checkRateLimit('big', { now: 1000 }).allowed).toBe(false);
  });

  it('computes retryAfterSec from the oldest in-window request', () => {
    const win = { windowMs: 60_000, maxRequests: 2 };
    checkRateLimit('a', { ...win, now: 0 });
    checkRateLimit('a', { ...win, now: 5_000 });
    const over = checkRateLimit('a', { ...win, now: 10_000 });
    expect(over.allowed).toBe(false);
    // oldest request at t=0 ages out at t=60_000; now=10_000 → 50s.
    expect(over.retryAfterSec).toBe(50);
  });

});
