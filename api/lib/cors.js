// ============================================================
// api/lib/cors.js — origin-locked CORS for API routes
//
// Phase 0 Sub-Task 6.3. Replaces the blanket
// `Access-Control-Allow-Origin: '*'` that every API route used to set.
//
// The browser is told a specific allowed origin (echoed back exactly,
// never the `*` wildcard) only when the request's Origin header matches
// the allow-list. Otherwise the header is omitted and the browser
// blocks the cross-origin response.
//
// Allow-list resolution:
//   • If ALLOWED_ORIGINS env var is set (comma-separated), it is the
//     exact, authoritative list — nothing else is allowed, and the
//     Vercel preview pattern below is NOT applied.
//   • Otherwise the hardcoded default list applies, PLUS Vercel preview
//     deployments of this project (fpb-marketing-bot-*.vercel.app).
//
// `Vary: Origin` is always set so a shared cache cannot serve a
// response carrying one origin's ACAO header to a different origin.
// ============================================================

const DEFAULT_ALLOWED_ORIGINS = [
  'https://fpb-marketing-bot.vercel.app',  // production deployment
  'http://localhost:5173',                 // vite dev server
  'http://localhost:4173',                 // vite preview server
];

// Vercel preview deployments of this project, e.g.
//   https://fpb-marketing-bot-<hash>-<scope>.vercel.app
//   https://fpb-marketing-bot-git-<branch>-<scope>.vercel.app
const VERCEL_PREVIEW_PATTERN =
  /^https:\/\/fpb-marketing-bot-[a-z0-9._-]+\.vercel\.app$/i;

/** Parse the ALLOWED_ORIGINS env var into a trimmed list, or null when unset. */
function envOrigins() {
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw || !raw.trim()) return null;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * The effective allow-list. When ALLOWED_ORIGINS is set it wins
 * outright; otherwise the hardcoded defaults are returned.
 * @returns {string[]}
 */
export function getAllowedOrigins() {
  return envOrigins() || [...DEFAULT_ALLOWED_ORIGINS];
}

/**
 * True when `origin` is allowed to receive a CORS response.
 *
 * When ALLOWED_ORIGINS is explicitly set, only exact members of that
 * list match — the Vercel preview pattern is NOT applied, so an
 * explicit override means exactly what it says. With the default list,
 * Vercel preview deployments of this project also match.
 *
 * @param {string|undefined|null} origin
 * @returns {boolean}
 */
export function isOriginAllowed(origin) {
  if (!origin) return false;
  const fromEnv = envOrigins();
  if (fromEnv) return fromEnv.includes(origin);
  if (DEFAULT_ALLOWED_ORIGINS.includes(origin)) return true;
  return VERCEL_PREVIEW_PATTERN.test(origin);
}

/**
 * Apply CORS headers to a response.
 *
 * Sets `Access-Control-Allow-Origin` to the exact request origin only
 * when that origin is allowed (never the `*` wildcard). Always sets
 * `Vary: Origin`. Methods and headers default to the common case and
 * can be overridden per route.
 *
 * @param {object} req
 * @param {object} res
 * @param {{ methods?: string, headers?: string }} [options]
 */
export function setCorsHeaders(req, res, options = {}) {
  const {
    methods = 'GET, POST, OPTIONS',
    headers = 'Content-Type, x-account-slug',
  } = options;

  res.setHeader('Vary', 'Origin');

  const origin = req?.headers?.origin;
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', headers);
}
