// ============================================================
// api/lib/rate-limit.js — in-memory sliding-window rate limiter
//
// Phase 0 Sub-Task 6.4. Defense-in-depth against a script spamming a
// cost-incurring endpoint (notably /api/chat -> Anthropic spend).
//
// Keyed per account so a noisy account cannot exhaust another tenant's
// budget. The window is a sliding 60s; the cap is 30 requests.
//
// In-memory only — state is per serverless instance and resets on cold
// start. That is an accepted trade-off for Sub-Task 6 (defense-in-depth,
// not a billing control): a burst spread across many cold instances
// could exceed the nominal cap. A durable limiter is a later concern.
// ============================================================

const WINDOW_MS    = 60_000;
const MAX_REQUESTS = 30;

// accountKey -> array of request timestamps (ms), oldest first.
const buckets = new Map();

/**
 * Record a request against `accountId` and report whether it is within
 * the rate limit.
 *
 * @param {string} accountId  caller's account id (the rate-limit key)
 * @param {{ now?: number, windowMs?: number, maxRequests?: number }} [opts]
 *   Options exist for deterministic testing; production callers pass
 *   nothing and get Date.now() + the module defaults.
 * @returns {{ allowed: boolean, count: number, limit: number, retryAfterSec?: number }}
 */
export function checkRateLimit(accountId, opts = {}) {
  const now         = opts.now         ?? Date.now();
  const windowMs    = opts.windowMs    ?? WINDOW_MS;
  const maxRequests = opts.maxRequests ?? MAX_REQUESTS;

  const key    = accountId || '__no_account__';
  const cutoff = now - windowMs;

  // Drop timestamps that have aged out of the window.
  const recent = (buckets.get(key) || []).filter((ts) => ts > cutoff);

  if (recent.length >= maxRequests) {
    // Limit hit — do not record this request. Retry-After is the time
    // until the oldest in-window request falls out of the window.
    const oldest        = recent[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    buckets.set(key, recent);
    return { allowed: false, count: recent.length, limit: maxRequests, retryAfterSec };
  }

  recent.push(now);
  buckets.set(key, recent);
  return { allowed: true, count: recent.length, limit: maxRequests };
}

/** Clear all rate-limit state. Intended for tests. */
export function clearRateLimits() {
  buckets.clear();
}

export const RATE_LIMIT_WINDOW_MS    = WINDOW_MS;
export const RATE_LIMIT_MAX_REQUESTS = MAX_REQUESTS;
