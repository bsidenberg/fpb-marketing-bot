// ============================================================
// api/lib/autonomy-coordinator.js — autonomy posture runtime gate
//
// Central decision point for all action inserts. Called by:
//   api/actions.js POST handler (before INSERT)
//   api/lib/execute-action-logic.js (recordActionOutcome after execution)
//
// Fail-safe design: any unexpected error defaults to require_approval.
// Better to block work than to auto-execute on a coordinator bug.
// All failures logged with [AUTONOMY-COORDINATOR-FAILURE] tag.
//
// Verdicts from checkPostureForAction:
//   { verdict: 'allow_auto' }               — full tier, no escalation triggers
//   { verdict: 'require_approval', reason }  — human review required
//   { verdict: 'block', reason }             — cap exceeded, do not insert
// ============================================================

import supabase from './supabase.js';
import { detectAnomaly } from './autonomy-escalation.js';

/**
 * Gate function — call before inserting any action into the queue.
 *
 * @param {string} accountId
 * @param {string} pillar    — 'paid_ads' | 'seo_blog' | 'gbp' | 'social_media'
 * @param {string} actionClass — action type string, e.g. 'pause_campaign'
 * @param {object} context   — escalation signals:
 *   { confidence?: number, novel?: boolean, conflict?: boolean,
 *     anomaly?: boolean, external_flag?: boolean }
 * @returns {Promise<{ verdict: string, reason?: string }>}
 */
export async function checkPostureForAction(accountId, pillar, actionClass, context = {}) {
  try {
    // ── Step 1: holdout list (static reference table — always approve) ──────
    const inHoldout = await isInHoldoutList(actionClass);
    if (inHoldout) {
      log('require_approval', accountId, pillar, actionClass, 'holdout list');
      return { verdict: 'require_approval', reason: 'holdout list' };
    }

    // ── Step 2: load posture row (default to recommend if absent) ───────────
    const { data: postureRow, error: postureErr } = await supabase
      .from('autonomy_posture')
      .select('*')
      .eq('account_id', accountId)
      .eq('pillar', pillar)
      .eq('action_class', actionClass)
      .maybeSingle();

    if (postureErr) {
      console.error('[AUTONOMY-COORDINATOR-FAILURE] posture fetch error:', postureErr.message);
      return { verdict: 'require_approval', reason: 'coordinator error — defaulting to recommend' };
    }

    // Row-level holdout flag overrides tier
    if (postureRow?.holdout === true) {
      log('require_approval', accountId, pillar, actionClass, 'row holdout flag');
      return { verdict: 'require_approval', reason: 'holdout flag on posture row' };
    }

    // ── Step 3: cadence cap check ────────────────────────────────────────────
    const capResult = await checkCap(accountId, postureRow);
    if (capResult.exceeded) {
      log('block', accountId, pillar, actionClass,
        `cap exceeded (${capResult.count}/${capResult.cap} in ${capResult.windowDays}d)`);
      return {
        verdict: 'block',
        reason: `cadence cap exceeded: ${capResult.count} actions in last ${capResult.windowDays} days (cap: ${capResult.cap})`,
      };
    }

    // ── Step 4: tier check ───────────────────────────────────────────────────
    const tier = postureRow?.tier ?? 'recommend';
    if (tier === 'recommend') {
      log('require_approval', accountId, pillar, actionClass, 'recommend tier');
      return { verdict: 'require_approval', reason: 'posture is recommend tier' };
    }

    // ── Step 5: escalation checks (full tier only) ───────────────────────────
    const { confidence, novel, conflict, anomaly, external_flag } = context;

    if (confidence !== undefined && confidence !== null && confidence < 0.7) {
      log('require_approval', accountId, pillar, actionClass, `low confidence (${confidence})`);
      return { verdict: 'require_approval', reason: `low confidence: ${confidence}` };
    }

    if (novel === true) {
      log('require_approval', accountId, pillar, actionClass, 'novel action type');
      return { verdict: 'require_approval', reason: 'novel action type for this account' };
    }

    if (conflict === true) {
      log('require_approval', accountId, pillar, actionClass, 'conflict with pending action');
      return { verdict: 'require_approval', reason: 'conflicts with existing pending action' };
    }

    if (anomaly === true || detectAnomaly()) {
      log('require_approval', accountId, pillar, actionClass, 'anomaly detected');
      return { verdict: 'require_approval', reason: 'anomaly detected' };
    }

    if (external_flag === true) {
      log('require_approval', accountId, pillar, actionClass, 'external escalation flag');
      return { verdict: 'require_approval', reason: 'external escalation flag set' };
    }

    log('allow_auto', accountId, pillar, actionClass, 'full tier, no escalations');
    return { verdict: 'allow_auto' };

  } catch (err) {
    console.error('[AUTONOMY-COORDINATOR-FAILURE] unexpected error in checkPostureForAction:', err.message);
    return { verdict: 'require_approval', reason: 'coordinator failure — defaulting to recommend' };
  }
}

/**
 * Record the outcome of a completed action.
 * Atomically upserts the posture row and increments counters via RPC.
 * Fire-and-forget — swallows all errors, never throws to caller.
 */
export async function recordActionOutcome(actionId, accountId, pillar, actionClass, succeeded) {
  try {
    const { error } = await supabase.rpc('increment_posture_outcome', {
      p_account_id:   accountId,
      p_pillar:       pillar,
      p_action_class: actionClass,
      p_succeeded:    succeeded,
      p_now:          new Date().toISOString(),
    });
    if (error) {
      console.error('[AUTONOMY-COORDINATOR-FAILURE] recordActionOutcome RPC error:', error.message);
    }
  } catch (err) {
    console.error('[AUTONOMY-COORDINATOR-FAILURE] recordActionOutcome unexpected error:', err.message);
  }
}

/**
 * Count completed actions for an account in the last windowDays.
 * Used by the cap check. Pillar is not filterable at the DB level in Phase 0
 * (automation_log has no pillar column) — counts all account activity.
 */
export async function getActiveCount(accountId, _pillar, windowDays) {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data, error } = await supabase
      .from('automation_log')
      .select('id')
      .eq('account_id', accountId)
      .eq('status', 'complete')
      .gte('created_at', since);

    if (error) {
      console.error('[AUTONOMY-COORDINATOR-FAILURE] getActiveCount error:', error.message);
      return 0;
    }
    return (data || []).length;
  } catch (err) {
    console.error('[AUTONOMY-COORDINATOR-FAILURE] getActiveCount unexpected error:', err.message);
    return 0;
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

async function isInHoldoutList(actionClass) {
  try {
    const { data, error } = await supabase
      .from('autonomy_holdout_classes')
      .select('action_class')
      .eq('action_class', actionClass)
      .maybeSingle();

    if (error) {
      console.error('[AUTONOMY-COORDINATOR-FAILURE] holdout list fetch error:', error.message);
      return true; // fail-safe: treat as holdout on error
    }
    return data !== null;
  } catch (err) {
    console.error('[AUTONOMY-COORDINATOR-FAILURE] holdout list unexpected error:', err.message);
    return true;
  }
}

async function checkCap(accountId, postureRow) {
  const cap = postureRow?.cap_per_window;
  if (cap === null || cap === undefined) {
    return { exceeded: false };
  }

  const windowDays = postureRow?.window_days ?? 7;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await supabase
      .from('automation_log')
      .select('id')
      .eq('account_id', accountId)
      .eq('status', 'complete')
      .gte('created_at', since);

    if (error) {
      console.error('[AUTONOMY-COORDINATOR-FAILURE] cap check error:', error.message);
      return { exceeded: false }; // fail-open: don't block if DB unavailable
    }

    const count = (data || []).length;
    return { exceeded: count >= cap, count, cap, windowDays };
  } catch (err) {
    console.error('[AUTONOMY-COORDINATOR-FAILURE] cap check unexpected error:', err.message);
    return { exceeded: false };
  }
}

function log(verdict, accountId, pillar, actionClass, reason) {
  console.log(
    `[AUTONOMY] verdict=${verdict} account=${accountId} pillar=${pillar} action=${actionClass} reason="${reason}"`
  );
}
