// ============================================================
// api/lib/anthropic-cost.js — Anthropic cost event recorder
//
// recordAnthropicCost(claudeResponse, accountId, eventType, runId?)
//   Extracts usage + model from a raw Anthropic API JSON response,
//   computes cost_usd from cost-rates.js, and inserts a cost_api_events row.
//
//   Fire-and-forget contract:
//   - Always resolves; never re-throws to callers.
//   - DB errors and unexpected failures are logged as [COST-LEDGER-FAILURE]
//     so they are grep-findable in Vercel logs.
//   - callers should await this (the function is fast and non-blocking
//     from the user-facing flow's perspective since errors are swallowed).
// ============================================================

import supabase from './supabase.js';
import { computeAnthropicCost } from './cost-rates.js';

export async function recordAnthropicCost(claudeResponse, accountId, eventType, runId = null) {
  try {
    const usage = claudeResponse?.usage;
    const model = claudeResponse?.model ?? null;
    if (!usage) return;

    const inputTokens  = usage.input_tokens  ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const costUsd      = model ? computeAnthropicCost(model, inputTokens, outputTokens) : null;

    const { error } = await supabase.from('cost_api_events').insert({
      vendor:        'anthropic',
      event_type:    eventType,
      account_id:    accountId ?? null,
      tokens_in:     inputTokens,
      tokens_out:    outputTokens,
      cost_usd:      costUsd,
      occurred_at:   new Date().toISOString(),
      source_run_id: runId ?? null,
      metadata:      { model },
    });

    if (error) {
      console.error(`[COST-LEDGER-FAILURE] recordAnthropicCost insert (${eventType}):`, error.message);
    }
  } catch (err) {
    console.error(`[COST-LEDGER-FAILURE] recordAnthropicCost threw (${eventType}):`, err.message);
  }
}
