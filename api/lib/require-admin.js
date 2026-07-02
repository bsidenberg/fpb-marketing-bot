// ============================================================
// api/lib/require-admin.js — admin session cookie gate
//
// Verifies the prime_session cookie issued by /api/auth.
//
// Cookie format:
//   prime_session = <unix_ms_expiry>.<hmac_sha256_hex>
//
// Behavior (mirrors api/lib/require-secret.js exactly):
//   cookie valid                        → allow (returns true)
//   cookie missing / expired / tampered → 401, returns false
//   ADMIN_PASSWORD or AUTH_SECRET unset
//     + NODE_ENV=production             → 503 AUTH_NOT_CONFIGURED, false
//     + non-production                  → warn-and-allow, true
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'prime_session';
export const EXPIRY_MS   = 12 * 60 * 60 * 1000; // 12 hours in ms

/**
 * Verify the admin session cookie on a request.
 * Returns true if the request may proceed; false if a 401/503 has already been sent.
 *
 * @param {object} req
 * @param {object} res
 * @returns {boolean}
 */
export function requireAdmin(req, res) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const authSecret    = process.env.AUTH_SECRET;

  if (!adminPassword || !authSecret) {
    if (process.env.NODE_ENV === 'production') {
      const missing = !adminPassword ? 'ADMIN_PASSWORD' : 'AUTH_SECRET';
      console.error(
        `[SECURITY] ${missing} is not set in production — admin auth is refusing all requests (fail-closed)`
      );
      res.status(503).json({
        success: false,
        error:   `Admin auth not configured: ${missing} is unset.`,
        code:    'AUTH_NOT_CONFIGURED',
      });
      return false;
    }
    console.warn(
      '[SECURITY] ADMIN_PASSWORD or AUTH_SECRET not set — admin gate unprotected (non-production warn-and-allow)'
    );
    return true;
  }

  const cookieHeader = req.headers?.cookie || '';
  const cookieValue  = parseCookie(cookieHeader, COOKIE_NAME);

  if (!cookieValue) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return false;
  }

  const dotIdx = cookieValue.lastIndexOf('.');
  if (dotIdx === -1) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return false;
  }

  const payloadStr = cookieValue.slice(0, dotIdx);
  const sigHex     = cookieValue.slice(dotIdx + 1);
  const expected   = createHmac('sha256', authSecret).update(payloadStr).digest('hex');

  let sigValid = false;
  try {
    const sigBuf = Buffer.from(sigHex,   'hex');
    const expBuf = Buffer.from(expected, 'hex');
    sigValid = sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
  } catch {
    sigValid = false;
  }

  if (!sigValid) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return false;
  }

  const expiry = parseInt(payloadStr, 10);
  if (!Number.isFinite(expiry) || Date.now() > expiry) {
    res.status(401).json({ success: false, error: 'Unauthorized — session expired' });
    return false;
  }

  return true;
}

function parseCookie(header, name) {
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return part.slice(eq + 1).trim();
  }
  return null;
}
