// ============================================================
// api/lib/accounts.js — account resolution helper
//
// Resolves which account a request belongs to, looks up account rows,
// and resolves env: references in ad_platform_connections rows.
//
// Stage A1: created in this phase but consumed only by the new
// /api/accounts read-only endpoint and by tests. Stage A2 will wire it
// into existing routes (analyze-ads, leads, execute-action, etc.).
// ============================================================

/**
 * SECURITY:
 *   - resolved_access_token, resolved_refresh_token,
 *     resolved_account_id_external, and resolved_manager_account_id
 *     contain runtime-resolved values.
 *   - These resolved fields MUST NOT be returned through API responses
 *     or logs.
 *   - Only server-side execution code (Stage A2+) should call
 *     getConnectionForAccount.
 *   - Tests must not snapshot resolved token values.
 */

import supabase from './supabase.js';

export const FPB_DEFAULT_SLUG = 'fpb';

// ── Cache ─────────────────────────────────────────────────────────────
//
// Simple in-memory Map with per-entry TTL. Keys:
//   slug:<slug>      — single account row by slug (or null on miss)
//   id:<uuid>        — single account row by id   (or null on miss)
//   active           — array of accounts where status='active'
//
// Cached null is a valid result — saves repeated DB lookups for
// unknown slugs within the TTL window.

const CACHE_TTL_MS = 60_000;
const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCached(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Clear the entire in-memory account cache. Intended for testing.
 */
export function clearAccountCache() {
  cache.clear();
}

// ── Env reference resolution ──────────────────────────────────────────

/**
 * Resolve an 'env:VAR_NAME' reference to its process.env value, or pass
 * a plain value through unchanged.
 *
 * Returns null for null/undefined input. Returns null with an error log
 * when the env var is unset or empty — never throws — so a missing env
 * var cannot crash the request path. Callers decide how to react.
 *
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
function resolveEnvReference(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  if (!value.startsWith('env:')) return value;
  const varName = value.slice(4);
  const envValue = process.env[varName];
  if (envValue == null || envValue === '') {
    console.error(`[accounts] env reference "${value}" — process.env.${varName} is not set`);
    return null;
  }
  return envValue;
}

// ── Slug helpers ──────────────────────────────────────────────────────

function normalizeSlug(raw) {
  if (raw == null) return null;
  // If a query param appears multiple times, Vercel returns an array.
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null) return null;
  const trimmed = String(value).trim().toLowerCase();
  return trimmed === '' ? null : trimmed;
}

/**
 * Resolve the account slug for an HTTP request.
 *
 * Precedence:
 *   1. ?account=<slug>           query param (wins)
 *   2. x-account-slug header     fallback
 *   3. FPB_DEFAULT_SLUG          default (warning logged)
 *
 * The slug is normalized with trim + lowercase. Whitespace-only strings
 * are treated as not provided.
 *
 * @param {{ query?: object, headers?: object }} req
 * @returns {string}
 */
export function getAccountSlugFromRequest(req) {
  const fromQuery  = normalizeSlug(req?.query?.account);
  const fromHeader = normalizeSlug(req?.headers?.['x-account-slug']);

  if (fromQuery)  return fromQuery;
  if (fromHeader) return fromHeader;

  console.warn(
    `[accounts] no ?account= query param or x-account-slug header on request; defaulting to "${FPB_DEFAULT_SLUG}"`
  );
  return FPB_DEFAULT_SLUG;
}

// ── Account lookups ───────────────────────────────────────────────────

/**
 * Fetch an account row by slug. Cached for 60s.
 *
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getAccountBySlug(slug) {
  const norm = normalizeSlug(slug);
  if (!norm) return null;

  const key = `slug:${norm}`;
  const hit = getCached(key);
  if (hit !== undefined) return hit;

  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('slug', norm)
    .maybeSingle();

  if (error) {
    console.error(`[accounts] getAccountBySlug("${norm}") failed:`, error.message);
    throw error;
  }

  const value = data || null;
  setCached(key, value);
  return value;
}

/**
 * Fetch an account row by id. Cached for 60s.
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getAccountById(id) {
  if (!id) return null;

  const key = `id:${id}`;
  const hit = getCached(key);
  if (hit !== undefined) return hit;

  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error(`[accounts] getAccountById("${id}") failed:`, error.message);
    throw error;
  }

  const value = data || null;
  setCached(key, value);
  return value;
}

/**
 * Fetch all accounts where status='active', ordered by created_at asc.
 * Cached for 60s.
 *
 * @returns {Promise<object[]>}
 */
export async function listActiveAccounts() {
  const key = 'active';
  const hit = getCached(key);
  if (hit !== undefined) return hit;

  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[accounts] listActiveAccounts failed:', error.message);
    throw error;
  }

  const list = data || [];
  setCached(key, list);
  return list;
}

/**
 * Resolve the account for a request and validate it's usable.
 *
 * Throws an Error with .statusCode = 400 if the slug doesn't match any
 * account row. Throws with .statusCode = 403 if the account is archived.
 *
 * @param {object} req
 * @returns {Promise<object>} account row
 */
export async function resolveAccountFromRequest(req) {
  const slug = getAccountSlugFromRequest(req);
  const account = await getAccountBySlug(slug);

  if (!account) {
    const err = new Error(`Account slug not found: ${slug}`);
    err.statusCode = 400;
    throw err;
  }

  if (account.status === 'archived') {
    const err = new Error(`Account is archived and cannot be used: ${slug}`);
    err.statusCode = 403;
    throw err;
  }

  return account;
}

// ── Connections ───────────────────────────────────────────────────────

/**
 * Fetch the (account, platform) connection row, augmented with
 * server-side resolved_* fields.
 *
 * Returns the raw row spread together with:
 *   resolved_access_token         — env-resolved or plain
 *   resolved_refresh_token        — env-resolved or plain
 *   resolved_account_id_external  — env-resolved or plain
 *   resolved_manager_account_id   — env-resolved or plain
 *
 * Returns null when no connection row exists for the pair. Never
 * throws on a missing env var — the resolved field becomes null and an
 * error is logged so callers can decide how to react.
 *
 * SECURITY: never serialize the returned object (or any of its
 * resolved_* fields) through an API response or log line. This function
 * is for server-side execution code only.
 *
 * @param {string} accountId  — accounts.id
 * @param {'google_ads'|'meta_ads'} platform
 * @returns {Promise<object|null>}
 */
export async function getConnectionForAccount(accountId, platform) {
  if (!accountId || !platform) return null;

  const { data, error } = await supabase
    .from('ad_platform_connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('platform', platform)
    .maybeSingle();

  if (error) {
    console.error(
      `[accounts] getConnectionForAccount(${accountId}, ${platform}) failed:`,
      error.message
    );
    throw error;
  }

  if (!data) return null;

  return {
    ...data,
    resolved_access_token:        resolveEnvReference(data.access_token_reference),
    resolved_refresh_token:       resolveEnvReference(data.refresh_token_reference),
    resolved_account_id_external: resolveEnvReference(data.account_id_external),
    resolved_manager_account_id:  resolveEnvReference(data.manager_account_id),
  };
}
