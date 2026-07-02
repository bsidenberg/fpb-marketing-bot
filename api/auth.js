// ============================================================
// api/auth.js — admin session login / logout
//
// POST /api/auth
//   { password }       → verify ADMIN_PASSWORD with constant-time compare
//                        → on match, set prime_session HttpOnly cookie
//                        → 200 { success: true }
//   { logout: true }   → clear cookie → 200 { success: true }
//
// Rate-limited by IP using the existing api/lib/rate-limit.js
// (same 30 req / 60s sliding window shared across all keys).
//
// Cookie format and EXPIRY_MS are defined in api/lib/require-admin.js
// so the issuer and verifier share the same constants.
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';
import { setCorsHeaders } from './lib/cors.js';
import { checkRateLimit } from './lib/rate-limit.js';
import { COOKIE_NAME, EXPIRY_MS } from './lib/require-admin.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'POST, OPTIONS', headers: 'Content-Type' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { password, logout } = req.body || {};

  // ── Logout ────────────────────────────────────────────────────────────────
  if (logout === true) {
    res.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    );
    return res.status(200).json({ success: true });
  }

  if (!password) {
    return res.status(400).json({ success: false, error: 'Missing password' });
  }

  // ── Rate limit by IP ──────────────────────────────────────────────────────
  const rawIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || '__unknown__';
  const rl = checkRateLimit(`login:${rawIp}`);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return res.status(429).json({
      success: false,
      error:   `Too many login attempts. Retry in ${rl.retryAfterSec}s.`,
      code:    'RATE_LIMIT_EXCEEDED',
    });
  }

  // ── Verify password ───────────────────────────────────────────────────────
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        success: false,
        error:   'Auth not configured: ADMIN_PASSWORD is unset.',
        code:    'AUTH_NOT_CONFIGURED',
      });
    }
    // Non-production with no password configured: warn and issue cookie
    console.warn('[SECURITY] ADMIN_PASSWORD not set — auth gate unprotected (non-production)');
  } else {
    let match = false;
    try {
      const a = Buffer.from(password);
      const b = Buffer.from(adminPassword);
      match = a.length === b.length && timingSafeEqual(a, b);
    } catch {
      match = false;
    }
    if (!match) {
      return res.status(401).json({ success: false, error: 'Incorrect password' });
    }
  }

  // ── Issue session cookie ──────────────────────────────────────────────────
  const authSecret = process.env.AUTH_SECRET;
  const expiry     = Date.now() + EXPIRY_MS;
  const payload    = String(expiry);
  const sig        = authSecret
    ? createHmac('sha256', authSecret).update(payload).digest('hex')
    : 'dev';
  const cookieVal  = `${payload}.${sig}`;
  const secure     = process.env.NODE_ENV === 'production' ? '; Secure' : '';

  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${cookieVal}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(EXPIRY_MS / 1000)}${secure}`
  );
  return res.status(200).json({ success: true });
}
