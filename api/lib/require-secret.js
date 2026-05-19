// ============================================================
// api/lib/require-secret.js — shared secret gate for server-only routes
//
// Phase 0 Sub-Task 6.2. Several mutation / ingest endpoints are guarded
// by a shared-secret header (EXECUTE_SECRET, LEADS_INGEST_SECRET,
// IMAGE_PROCESS_SECRET). The original pattern was "warn-and-allow" when
// the secret env var was unset — a deploy that dropped the var would
// silently run the endpoint completely unprotected.
//
// This helper makes that fail-closed in production:
//
//   secret set + header matches        -> allow  (returns true)
//   secret set + header missing/wrong  -> 401 Unauthorized, returns false
//   secret unset + NODE_ENV=production -> 503 SECRET_NOT_CONFIGURED, false
//   secret unset + non-production      -> warn-and-allow, returns true
//
// The non-production branch keeps local dev and the test suite working
// without every developer having to set every secret. NODE_ENV is set
// to 'production' automatically by Vercel on production deployments.
// ============================================================

/**
 * Enforce a shared-secret header on a request.
 *
 * @param {object} req
 * @param {object} res
 * @param {{ envVar: string, header: string, label: string }} config
 *   envVar — process.env key holding the secret
 *   header — request header carrying the caller's secret
 *   label  — human-readable endpoint name for log + error messages
 * @returns {boolean} true if the request may proceed; false if a
 *   response has already been sent.
 */
export function requireSecret(req, res, { envVar, header, label }) {
  const secret = process.env[envVar];

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        `[SECURITY] ${envVar} is not set in production — ${label} is refusing requests (fail-closed)`
      );
      res.status(503).json({
        success: false,
        error:   `${label} is not configured: ${envVar} is unset on the server. The request was refused.`,
        code:    'SECRET_NOT_CONFIGURED',
      });
      return false;
    }
    console.warn(
      `[SECURITY] ${envVar} not set — ${label} is unprotected (non-production warn-and-allow)`
    );
    return true;
  }

  if (req.headers?.[header] !== secret) {
    res.status(401).json({
      success: false,
      error:   `Unauthorized — missing or invalid ${header}`,
    });
    return false;
  }

  return true;
}
