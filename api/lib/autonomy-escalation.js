// ============================================================
// api/lib/autonomy-escalation.js — escalation context detectors
//
// These helpers build the `context` object consumed by
// autonomy-coordinator.js checkPostureForAction.
//
// Phase 0 live detectors:
//   detectNovelty     — true when no posture row exists for (account, action_class)
//   detectConflict    — true when another action for the account is already pending
//   detectExternalFlag — true when the action row has flag_external_review set
//
// Phase 0 stub (hardcoded false):
//   detectAnomaly     — Phase 1 will compute from action_outcomes history
// ============================================================

import supabase from './supabase.js';

/**
 * Returns true if no autonomy_posture row exists for (account, action_class).
 * Absence means the system has never tracked this action type for this tenant.
 */
export async function detectNovelty(actionClass, accountId) {
  try {
    const { data, error } = await supabase
      .from('autonomy_posture')
      .select('account_id')
      .eq('account_id', accountId)
      .eq('action_class', actionClass)
      .maybeSingle();

    if (error) {
      console.error('[AUTONOMY-ESCALATION] detectNovelty error:', error.message);
      return true; // fail-safe: unknown = novel → require_approval
    }
    return data === null;
  } catch (err) {
    console.error('[AUTONOMY-ESCALATION] detectNovelty unexpected error:', err.message);
    return true;
  }
}

/**
 * Returns true if another action for the same account is currently pending approval.
 * Filters out the current action (if excludeActionId provided).
 */
export async function detectConflict(accountId, excludeActionId = null) {
  try {
    let query = supabase
      .from('actions')
      .select('id')
      .eq('account_id', accountId)
      .eq('status', 'pending');

    if (excludeActionId) {
      query = query.neq('id', excludeActionId);
    }

    const { data, error } = await query.limit(1);

    if (error) {
      console.error('[AUTONOMY-ESCALATION] detectConflict error:', error.message);
      return true; // fail-safe
    }
    return (data || []).length > 0;
  } catch (err) {
    console.error('[AUTONOMY-ESCALATION] detectConflict unexpected error:', err.message);
    return true;
  }
}

/**
 * Returns true if the action row carries an external review flag.
 * Checks top-level field and execution_data.flag_external_review.
 */
export function detectExternalFlag(actionRow) {
  if (!actionRow) return false;
  return (
    actionRow.flag_external_review === true ||
    actionRow.execution_data?.flag_external_review === true
  );
}

/**
 * Anomaly detection — hardcoded false for Phase 0.
 * Phase 1 will compare against action_outcomes history baselines.
 */
export function detectAnomaly() {
  return false;
}
