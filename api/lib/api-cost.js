// ============================================================
// api/lib/api-cost.js — ad platform API call counter
//
// recordApiCall(vendor, eventType, accountId, metadata?)
//   Writes a cost_api_events row with units=1 for one API call.
//   No token or cost fields — ad platforms charge per spend, not per call.
//   Call counts aggregate in the monthly rollup for visibility.
//
//   Fire-and-forget contract:
//   - Always resolves; never re-throws to callers.
//   - DB errors logged as [COST-LEDGER-FAILURE] (grep-findable).
// ============================================================

import supabase from './supabase.js';

export async function recordApiCall(vendor, eventType, accountId, metadata = null) {
  try {
    const { error } = await supabase.from('cost_api_events').insert({
      vendor,
      event_type:  eventType,
      account_id:  accountId ?? null,
      units:       1,
      occurred_at: new Date().toISOString(),
      metadata:    metadata ?? null,
    });

    if (error) {
      console.error(`[COST-LEDGER-FAILURE] recordApiCall insert (${vendor}/${eventType}):`, error.message);
    }
  } catch (err) {
    console.error(`[COST-LEDGER-FAILURE] recordApiCall threw (${vendor}/${eventType}):`, err.message);
  }
}
