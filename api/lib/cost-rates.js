// ============================================================
// api/lib/cost-rates.js — Anthropic per-token pricing constants
//
// Tag: CHOSEN. Owner: Brian. Source: https://claude.com/pricing, verified 2026-05-19.
// Re-derivation trigger (SDR-6 — a date, a trigger, or a ratchet, not an
// intention): (1) any "[COST-LEDGER-UNKNOWN-MODEL]" line in Vercel logs —
// that is a live signal this table no longer covers a model in use; or
// (2) quarterly review; whichever comes first. Neither existed before
// session S-COST-2 (2026-07-30) — the prior header said only "update this
// file when Anthropic changes pricing," which SDR-6 calls out by name as an
// unscheduled intention: no date, no trigger, no ratchet attached to it.
//
// ── Alias resolution (S-COST-2, 2026-07-30) ──────────────────────────────
// Anthropic model ALIASES (e.g. "claude-sonnet-4-6") can resolve server-side
// to a dated snapshot id (e.g. "claude-sonnet-4-6-20260115"), and the API
// response echoes the RESOLVED id, not the alias that was requested. Before
// this session, only the bare alias was keyed for sonnet/opus, so a dated
// response silently missed the table and cost_usd was written NULL with no
// signal anywhere (D-6 FLAG 3 — the main chat call, CHAT_MODEL, is exactly
// this shape). resolveRateKey() below tries an exact match first, then
// strips a trailing "-YYYYMMDD" segment and retries, so any dated
// resolution of a known alias still prices correctly without requiring the
// specific date to be hardcoded in advance.
// ============================================================

export const ANTHROPIC_RATES = {
  'claude-sonnet-4-20250514':  { input_per_mtok: 3.00, output_per_mtok: 15.00 },
  'claude-haiku-4-5-20251001': { input_per_mtok: 1.00, output_per_mtok: 5.00  },
  'claude-haiku-4-5':          { input_per_mtok: 1.00, output_per_mtok: 5.00  },
  'claude-sonnet-4-6':         { input_per_mtok: 3.00, output_per_mtok: 15.00 },
  'claude-opus-4-7':           { input_per_mtok: 5.00, output_per_mtok: 25.00 },
};

const DATED_SUFFIX = /-\d{8}$/; // e.g. "-20260115"

/**
 * Resolve a model string returned by the Anthropic API to a key in
 * ANTHROPIC_RATES. Tries an exact match first (covers fully-dated requests
 * like 'claude-sonnet-4-20250514', and any alias that happens to be keyed
 * verbatim), then strips a trailing 8-digit date suffix and retries (covers
 * an alias that resolved server-side to a dated snapshot not individually
 * enumerated here). Returns null if neither resolves.
 */
export function resolveRateKey(model) {
  if (!model) return null;
  if (ANTHROPIC_RATES[model]) return model;
  const stripped = model.replace(DATED_SUFFIX, '');
  if (stripped !== model && ANTHROPIC_RATES[stripped]) return stripped;
  return null;
}

/**
 * Compute cost in USD for an Anthropic API call.
 * Returns null when the model cannot be resolved to a rate (use as sentinel
 * for "unknown model" — callers must treat null as "log/alert", never as $0).
 * Result is rounded to 6 decimal places ($0.000001 granularity).
 */
export function computeAnthropicCost(model, inputTokens, outputTokens) {
  const key = resolveRateKey(model);
  if (!key) return null;
  const rates = ANTHROPIC_RATES[key];
  const raw = (inputTokens * rates.input_per_mtok + outputTokens * rates.output_per_mtok) / 1_000_000;
  return Math.round(raw * 1_000_000) / 1_000_000;
}
