// ============================================================
// api/lib/cost-rates.js — Anthropic per-token pricing constants
//
// Source: verified 2026-05-19 against https://claude.com/pricing
// Update this file when Anthropic changes pricing; bump cost-rates
// version comment to track when the update was made.
// ============================================================

export const ANTHROPIC_RATES = {
  'claude-sonnet-4-20250514':  { input_per_mtok: 3.00, output_per_mtok: 15.00 },
  'claude-haiku-4-5-20251001': { input_per_mtok: 1.00, output_per_mtok: 5.00  },
  'claude-haiku-4-5':          { input_per_mtok: 1.00, output_per_mtok: 5.00  },
  'claude-sonnet-4-6':         { input_per_mtok: 3.00, output_per_mtok: 15.00 },
  'claude-opus-4-7':           { input_per_mtok: 5.00, output_per_mtok: 25.00 },
};

/**
 * Compute cost in USD for an Anthropic API call.
 * Returns null when the model is not in the rate table (use as sentinel for "unknown model").
 * Result is rounded to 6 decimal places ($0.000001 granularity).
 */
export function computeAnthropicCost(model, inputTokens, outputTokens) {
  const rates = ANTHROPIC_RATES[model];
  if (!rates) return null;
  const raw = (inputTokens * rates.input_per_mtok + outputTokens * rates.output_per_mtok) / 1_000_000;
  return Math.round(raw * 1_000_000) / 1_000_000;
}
