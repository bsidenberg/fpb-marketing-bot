// ============================================================
// budget-guards.js — spend-magnitude budget guards (SESSION-05)
//
// The autonomy coordinator caps action FREQUENCY (cadence); this module
// caps MAGNITUDE. All thresholds come from agent_config key 'budget_guards'
// (jsonb: { defaults, account_overrides }) merged over code defaults —
// never from constants sprinkled through the codebase.
//
// Layering:
//   PURE (no DB, no network — unit-testable with plain objects):
//     evaluateBudgetGuards(action, campaignState, config) -> { verdict, reason, triggered }
//     mergeGuardConfig, classifyCpl, buildCplNote, parseBudgetValue
//   IMPURE (thin orchestrators that assemble campaignState, then call the
//   pure evaluator):
//     runBudgetGuardsForExecution(action, { account, connection })
//       — execution-time backstop. Google actions get live campaign state
//         (one GAQL search: current budget, enabled list, budget sum).
//         Meta gets NO live fetch (Graph v19 is deprecated/unvalidated);
//         rules that need live state fail closed to require_approval.
//     runBudgetGuardsForStaging(accountId, actionClass, executionData)
//       — coordinator consult. Staging-visible data only (execution_data
//         values + campaign_daily_stats lookback). The account-cap and
//         last-campaign rules are execution-time only.
//
// Verdicts (strength: block > require_approval > allow):
//   'block'            — never executes. Terminal even on the human-approve
//                        path: block means blocked, for everyone.
//   'require_approval' — auto-execution is refused and returned to the human
//                        queue; a human-initiated execution proceeds.
//   'allow'            — no guard triggered.
//
// Fail-closed: missing or unfetchable data required by a rule produces
// require_approval with a reason naming what was unavailable. Guards never
// warn-and-allow, in any environment.
// ============================================================

import supabase from './supabase.js';
import { recordApiCall } from './api-cost.js';
// Circular with execute-action-logic.js (it imports our guard runner) — safe:
// both sides reference the other's exports only at call time, never at module
// top level. Importing the dispatcher's own normalizer keeps the guard's
// "is this Google?" decision in lockstep with dispatch routing (safety-review
// finding #1): a channel variant the dispatcher treats as Google can never
// silently skip the live-state fetch that powers the block rules.
import { normalizePlatform } from './execute-action-logic.js';

// ── Code defaults — overridable via agent_config 'budget_guards' ──────────────
export const GUARD_DEFAULTS = {
  max_budget_increase_pct_per_day: 15,
  max_budget_decrease_pct_per_day: 20,
  major_change_pct:                25,
  min_data_volume_conversions:     5,
  min_data_lookback_days:          14,
  aggressive_decrease_pct:         10,
  protected_campaigns:             ['21613067518'], // LP Branded - Florida Pole Barn
  cpl_target:                      50,
  cpl_warn:                        75,
  cpl_emergency:                   100,
};

// Action classes the guards evaluate. Everything else returns 'allow'.
export const GUARD_RELEVANT_TYPES = ['adjust_budget', 'pause_campaign'];

// ── Small pure helpers ────────────────────────────────────────────────────────

/**
 * Parse a budget value the way the executor does (Bug 14/16 compatibility):
 * bare numbers, quoted numbers ("31"), or currency strings ("$31/day",
 * "$1,500"). Returns a positive finite number or null.
 */
export function parseBudgetValue(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const cleaned = typeof raw === 'string' ? raw.replace(/[^0-9.]/g, '') : raw;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function toFiniteOrNull(value) {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n) ? null : n;
}

function toPositiveOrNull(value) {
  const n = toFiniteOrNull(value);
  return n !== null && n > 0 ? n : null;
}

/**
 * Merge guard config: code defaults ← config_value.defaults ←
 * config_value.account_overrides[accountId]. agent_config is a global
 * table (no account_id column), so per-account overrides live inside
 * the jsonb value keyed by account UUID.
 */
export function mergeGuardConfig(rawConfigValue, accountId) {
  const defaults = rawConfigValue?.defaults && typeof rawConfigValue.defaults === 'object'
    ? rawConfigValue.defaults
    : {};
  const overrideSource = accountId ? rawConfigValue?.account_overrides?.[accountId] : null;
  const overrides = overrideSource && typeof overrideSource === 'object' ? overrideSource : {};

  const merged = { ...GUARD_DEFAULTS, ...defaults, ...overrides };
  merged.protected_campaigns = Array.isArray(merged.protected_campaigns)
    ? merged.protected_campaigns.map(String)
    : [...GUARD_DEFAULTS.protected_campaigns];
  return merged;
}

/**
 * CPL band for reason strings. Bands (config-driven, never constants):
 *   'target'       — cpl <= cpl_target
 *   'above_target' — cpl_target < cpl < cpl_warn
 *   'warn'         — cpl_warn <= cpl < cpl_emergency
 *   'emergency'    — cpl >= cpl_emergency
 *   'unknown'      — no CPL data
 */
export function classifyCpl(cpl, config = GUARD_DEFAULTS) {
  const value = toFiniteOrNull(cpl);
  if (value === null) return 'unknown';
  if (value >= config.cpl_emergency) return 'emergency';
  if (value >= config.cpl_warn)      return 'warn';
  if (value <= config.cpl_target)    return 'target';
  return 'above_target';
}

/** CPL note appended to every triggered-guard reason string. */
export function buildCplNote(cpl, config = GUARD_DEFAULTS) {
  const band  = classifyCpl(cpl, config);
  const bands = `target $${config.cpl_target} / warn $${config.cpl_warn} / emergency $${config.cpl_emergency}`;
  if (band === 'unknown') return ` | CPL unknown (${bands})`;
  const value = Math.round(Number(cpl) * 100) / 100;
  return ` | CPL $${value} is in the ${band} band (${bands})`;
}

// ── Pure evaluator ────────────────────────────────────────────────────────────

/**
 * Evaluate all budget-guard rules for one action.
 *
 * @param {object} action        — { action_type, execution_data } (row or synthetic)
 * @param {object} campaignState — assembled by an orchestrator:
 *   {
 *     currentDailyBudget:   number|null,  // live value preferred; null = unknown
 *     campaignStatus:       string|null,
 *     enabledCampaigns:     [{ id, dailyBudget }]|null,  // null = unknown/unfetchable
 *     conversionsLookback:  number|null,  // null = no data (treated as low data)
 *     cplLookback:          number|null,
 *     accountDailySpendCap: number|null,  // null = no cap configured
 *     lookbackDays:         number,
 *   }
 * @param {object} config — merged guard config (mergeGuardConfig output)
 * @returns {{ verdict: 'allow'|'require_approval'|'block', reason: string|null, triggered: string[] }}
 */
export function evaluateBudgetGuards(action, campaignState = {}, config = GUARD_DEFAULTS) {
  const actionType = action?.action_type;
  if (!GUARD_RELEVANT_TYPES.includes(actionType)) {
    return { verdict: 'allow', reason: null, triggered: [] };
  }

  const cfg           = { ...GUARD_DEFAULTS, ...config };
  const executionData = action?.execution_data || {};
  const campaignId    = executionData.campaign_id != null ? String(executionData.campaign_id) : '';
  const protectedIds  = (cfg.protected_campaigns || []).map(String);
  const isProtected   = campaignId !== '' && protectedIds.includes(campaignId);

  const conversions  = toFiniteOrNull(campaignState.conversionsLookback);
  const lowData      = conversions === null || conversions < cfg.min_data_volume_conversions;
  const lookbackDays = campaignState.lookbackDays ?? cfg.min_data_lookback_days;
  const dataNote     = conversions === null
    ? `no conversion data in ${lookbackDays}d lookback`
    : `${conversions} conversions in ${lookbackDays}d lookback`;

  const triggered = [];
  const hit = (rule, verdict, reason) => triggered.push({ rule, verdict, reason });

  // ── adjust_budget rules ────────────────────────────────────────────────────
  if (actionType === 'adjust_budget') {
    const current = toPositiveOrNull(campaignState.currentDailyBudget);
    const next    = parseBudgetValue(executionData.recommended_value);

    if (next === null) {
      hit('invalid_target_budget', 'require_approval',
        `recommended budget value "${executionData.recommended_value}" could not be parsed — cannot evaluate change magnitude`);
    } else if (current === null) {
      hit('unknown_current_budget', 'require_approval',
        `current daily budget unknown for campaign ${campaignId || '(unknown)'} — cannot compute change magnitude`);
    } else if (next !== current) {
      // Round to 3 decimals so FP noise (e.g. 4.5/30*100 = 15.000000000000002)
      // cannot flip a boundary decision.
      const pct        = Math.round(Math.abs(((next - current) / current) * 100) * 1000) / 1000;
      const isIncrease = next > current;
      const word       = isIncrease ? 'increase' : 'decrease';

      // Rule 3: major change — always requires approval regardless of tier
      if (pct >= cfg.major_change_pct) {
        hit('major_change', 'require_approval',
          `budget ${word} of ${pct}% ($${current}/day -> $${next}/day) is >= major_change_pct ${cfg.major_change_pct}% — always requires approval regardless of autonomy tier`);
      // Rule 1: daily increase limit
      } else if (isIncrease && pct > cfg.max_budget_increase_pct_per_day) {
        hit('increase_limit', 'require_approval',
          `budget increase of ${pct}% ($${current}/day -> $${next}/day) exceeds max_budget_increase_pct_per_day ${cfg.max_budget_increase_pct_per_day}%`);
      // Rule 2: daily decrease limit
      } else if (!isIncrease && pct > cfg.max_budget_decrease_pct_per_day) {
        hit('decrease_limit', 'require_approval',
          `budget decrease of ${pct}% ($${current}/day -> $${next}/day) exceeds max_budget_decrease_pct_per_day ${cfg.max_budget_decrease_pct_per_day}%`);
      }

      if (isIncrease) {
        // Rule 4: absolute account daily-spend cap — BLOCK when exceeded
        const cap = toPositiveOrNull(campaignState.accountDailySpendCap);
        if (cap !== null) {
          if (!Array.isArray(campaignState.enabledCampaigns)) {
            hit('cap_unverifiable', 'require_approval',
              `account daily spend cap $${cap} is set but enabled-campaign budgets are unavailable — cannot project account spend`);
          } else {
            const othersSum = campaignState.enabledCampaigns
              .filter((c) => String(c.id) !== campaignId)
              .reduce((sum, c) => sum + (toPositiveOrNull(c.dailyBudget) ?? 0), 0);
            const projected = Math.round((othersSum + next) * 100) / 100;
            if (projected > cap) {
              hit('account_daily_cap', 'block',
                `projected account daily spend $${projected} (this campaign at $${next}/day + $${Math.round(othersSum * 100) / 100}/day across other enabled campaigns) exceeds the account daily spend cap $${cap}`);
            }
          }
        }
      } else {
        // Rule 5 (decrease half): protected campaigns
        if (isProtected) {
          hit('protected_campaign', 'require_approval',
            `campaign ${campaignId} is on the protected list — budget decreases always require approval`);
        }
        // Rule 6 min-data: aggressive decrease on a low-data campaign
        if (lowData && pct > cfg.aggressive_decrease_pct) {
          hit('min_data_volume', 'require_approval',
            `aggressive decrease (${pct}% > ${cfg.aggressive_decrease_pct}%) on a low-data campaign (${dataNote}, min ${cfg.min_data_volume_conversions}) — flagged for human review`);
        }
      }
    }
  }

  // ── pause_campaign rules ───────────────────────────────────────────────────
  if (actionType === 'pause_campaign') {
    // Rule 5 (pause half): protected campaigns
    if (isProtected) {
      hit('protected_campaign', 'require_approval',
        `campaign ${campaignId} is on the protected list — pausing always requires approval`);
    }

    // Rule 7: never pause the last enabled lead-gen campaign — BLOCK.
    // "Lead-gen" = enabled campaign NOT on the protected (branded) list;
    // no campaign-type metadata exists anywhere in the schema.
    if (!Array.isArray(campaignState.enabledCampaigns)) {
      hit('last_campaign_unverifiable', 'require_approval',
        'cannot verify this is not the last enabled lead-gen campaign — enabled-campaign list unavailable');
    } else {
      const enabledLeadGen = campaignState.enabledCampaigns.filter(
        (c) => !protectedIds.includes(String(c.id))
      );
      const targetIsEnabledLeadGen = enabledLeadGen.some((c) => String(c.id) === campaignId);
      if (targetIsEnabledLeadGen && enabledLeadGen.length <= 1) {
        hit('last_lead_gen_campaign', 'block',
          `campaign ${campaignId} is the last enabled lead-gen campaign for this account — pausing it would halt all lead generation`);
      }
    }

    // Rule 6 min-data: low-data campaigns are flagged, never auto-paused
    if (lowData) {
      hit('min_data_volume', 'require_approval',
        `pause requested on a low-data campaign (${dataNote}, min ${cfg.min_data_volume_conversions}) — flagged for human review; low-data campaigns are never auto-paused`);
    }
  }

  if (triggered.length === 0) {
    return { verdict: 'allow', reason: null, triggered: [] };
  }

  // Strongest verdict wins; block reasons lead the combined reason string.
  const hasBlock = triggered.some((t) => t.verdict === 'block');
  const ordered  = [...triggered].sort(
    (a, b) => (a.verdict === 'block' ? 0 : 1) - (b.verdict === 'block' ? 0 : 1)
  );
  const reason = ordered.map((t) => t.reason).join('; ') + buildCplNote(campaignState.cplLookback, cfg);

  return {
    verdict:   hasBlock ? 'block' : 'require_approval',
    reason,
    triggered: ordered.map((t) => t.rule),
  };
}

// ── Impure: config + state assembly ───────────────────────────────────────────

/** Load and merge guard config for an account. Falls back to code defaults. */
export async function loadGuardConfig(accountId) {
  try {
    const { data, error } = await supabase
      .from('agent_config')
      .select('config_value')
      .eq('config_key', 'budget_guards')
      .maybeSingle();

    if (error) {
      console.error('[BUDGET-GUARDS] config fetch error:', error.message);
      return mergeGuardConfig(null, accountId);
    }
    return mergeGuardConfig(data?.config_value ?? null, accountId);
  } catch (err) {
    console.error('[BUDGET-GUARDS] config fetch unexpected error:', err.message);
    return mergeGuardConfig(null, accountId);
  }
}

/**
 * Conversions + CPL for one campaign over the lookback window, from
 * campaign_daily_stats. Nulls (not zeros) when no rows exist, so the
 * evaluator can distinguish "no data" from "zero conversions".
 */
export async function getCampaignLookbackStats(accountId, campaignId, lookbackDays) {
  try {
    if (!campaignId) return { conversions: null, cpl: null };
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const { data, error } = await supabase
      .from('campaign_daily_stats')
      .select('spend, conversions')
      .eq('account_id', accountId)
      .eq('campaign_id', String(campaignId))
      .gte('date', since);

    if (error) {
      console.error('[BUDGET-GUARDS] lookback stats error:', error.message);
      return { conversions: null, cpl: null };
    }
    if (!Array.isArray(data) || data.length === 0) {
      return { conversions: null, cpl: null };
    }

    const conversions = data.reduce((sum, r) => sum + (Number(r.conversions) || 0), 0);
    const spend       = data.reduce((sum, r) => sum + (Number(r.spend) || 0), 0);
    return { conversions, cpl: conversions > 0 ? spend / conversions : null };
  } catch (err) {
    console.error('[BUDGET-GUARDS] lookback stats unexpected error:', err.message);
    return { conversions: null, cpl: null };
  }
}

/**
 * One GAQL search for live campaign state: the target campaign's current
 * budget/status plus every enabled campaign's budget (feeds the account-cap
 * projection and the last-campaign rule). Returns null on ANY failure —
 * the evaluator fails closed on the rules that need this data.
 *
 * S07a status semantics: the query keeps status != 'REMOVED' (not = 'ENABLED')
 * on purpose — GAQL has no OR, and this same search must surface a PAUSED
 * target's live budget so magnitude checks never run on agent-claimed values.
 * The cap sum is ENABLED-only via the enabledCampaigns filter below: PAUSED
 * and REMOVED budgets never count toward the account-spend projection.
 */
async function fetchGoogleCampaignState(campaignId, { account, connection }) {
  try {
    if (!connection?.resolved_account_id_external || !connection?.resolved_refresh_token) {
      return null;
    }
    const customerId       = connection.resolved_account_id_external.replace(/-/g, '');
    const managerAccountId = connection.resolved_manager_account_id
      ? connection.resolved_manager_account_id.replace(/-/g, '')
      : undefined;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.GOOGLE_ADS_CLIENT_ID,
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
        refresh_token: connection.resolved_refresh_token,
        grant_type:    'refresh_token',
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenJson.access_token) {
      console.error('[BUDGET-GUARDS] OAuth token error during live state fetch');
      return null;
    }

    const searchUrl = `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`;
    const res = await fetch(searchUrl, {
      method:  'POST',
      headers: {
        Authorization:       `Bearer ${tokenJson.access_token}`,
        'developer-token':   process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        'login-customer-id': managerAccountId,
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        query: "SELECT campaign.id, campaign.status, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'",
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('[BUDGET-GUARDS] live campaign fetch failed:', res.status, text.substring(0, 200));
      return null;
    }
    const data = JSON.parse(text);
    await recordApiCall('google_ads', 'guard_state_read', account.id);

    const rows = (data.results || []).map((r) => ({
      id:          String(r.campaign?.id ?? ''),
      status:      r.campaign?.status ?? null,
      dailyBudget: r.campaignBudget?.amountMicros != null
        ? Number(r.campaignBudget.amountMicros) / 1_000_000
        : null,
    }));

    const target = rows.find((r) => r.id === String(campaignId));
    return {
      targetFound:        Boolean(target),
      currentDailyBudget: target?.dailyBudget ?? null,
      campaignStatus:     target?.status ?? null,
      enabledCampaigns:   rows
        .filter((r) => r.status === 'ENABLED')
        .map((r) => ({ id: r.id, dailyBudget: r.dailyBudget })),
    };
  } catch (err) {
    console.error('[BUDGET-GUARDS] live campaign fetch error:', err.message);
    return null;
  }
}

// ── Impure orchestrators ──────────────────────────────────────────────────────

const GUARD_ERROR_RESULT = {
  verdict:   'require_approval',
  reason:    'budget guard could not evaluate (internal error) — defaulting to human approval',
  triggered: ['guard_error'],
};

/**
 * Execution-time guard — the enforcement backstop. Called by
 * acquireLockAndExecute and executeTransient. Self-filters on action type,
 * so callers invoke it unconditionally.
 */
export async function runBudgetGuardsForExecution(action, { account, connection }) {
  try {
    const actionType = action?.action_type;
    if (!GUARD_RELEVANT_TYPES.includes(actionType)) {
      return { verdict: 'allow', reason: null, triggered: [] };
    }
    if (!account?.id) return GUARD_ERROR_RESULT;

    const config        = await loadGuardConfig(account.id);
    const executionData = action.execution_data || {};
    const campaignId    = executionData.campaign_id != null ? String(executionData.campaign_id) : '';
    const isGoogle      = normalizePlatform(action.channel) === 'google';

    const stats = await getCampaignLookbackStats(account.id, campaignId, config.min_data_lookback_days);
    // Meta gets no live fetch (Graph v19 — deprecated, unvalidated until
    // Session 07): live-state rules fail closed to require_approval.
    const live = isGoogle ? await fetchGoogleCampaignState(campaignId, { account, connection }) : null;

    // S07a fail-close: the live fetch SUCCEEDED but the target id matched no
    // non-removed campaign — the id is wrong or the campaign no longer exists.
    // The old fallback to agent-supplied current_value masked exactly this
    // failure on 7/6: the unexcluded target double-counted into the cap
    // projection ($98 phantom vs $73 real). Live-verified state or nothing:
    // null routes the evaluator to require_approval (unknown_current_budget)
    // and skips the cap projection. live === null (Meta, or Google fetch
    // failure) keeps the fallback — those rules fail closed elsewhere.
    const targetMissingFromLive = live !== null && !live.targetFound;

    if (live !== null) {
      console.log('[BUDGET-GUARDS] cap projection state:', JSON.stringify({
        campaign_id:  campaignId || null,
        target_found: live.targetFound,
        enabled:      live.enabledCampaigns.map((c) => `${c.id}:$${c.dailyBudget}`),
      }));
    }

    const campaignState = {
      currentDailyBudget:   targetMissingFromLive
        ? null
        : (live?.currentDailyBudget ?? parseBudgetValue(executionData.current_value)),
      campaignStatus:       live?.campaignStatus ?? null,
      enabledCampaigns:     live?.enabledCampaigns ?? null,
      conversionsLookback:  stats.conversions,
      cplLookback:          stats.cpl,
      accountDailySpendCap: account.daily_spend_cap != null ? Number(account.daily_spend_cap) : null,
      lookbackDays:         config.min_data_lookback_days,
    };

    return evaluateBudgetGuards(action, campaignState, config);
  } catch (err) {
    console.error('[BUDGET-GUARDS] execution guard failure:', err.message);
    return GUARD_ERROR_RESULT;
  }
}

/**
 * Staging-time guard consult for the autonomy coordinator. Uses only
 * staging-visible data: execution_data values + campaign_daily_stats.
 * The account-cap and last-campaign rules need live platform state and
 * are enforced at execution time; here the last-campaign rule fails
 * closed (require_approval) and the cap rule is skipped (cap = null).
 */
export async function runBudgetGuardsForStaging(accountId, actionClass, executionData) {
  try {
    if (!GUARD_RELEVANT_TYPES.includes(actionClass)) {
      return { verdict: 'allow', reason: null, triggered: [] };
    }

    const config     = await loadGuardConfig(accountId);
    const campaignId = executionData?.campaign_id != null ? String(executionData.campaign_id) : '';
    const stats      = await getCampaignLookbackStats(accountId, campaignId, config.min_data_lookback_days);

    const campaignState = {
      currentDailyBudget:   parseBudgetValue(executionData?.current_value),
      campaignStatus:       null,
      enabledCampaigns:     null, // live list not fetched at staging
      conversionsLookback:  stats.conversions,
      cplLookback:          stats.cpl,
      accountDailySpendCap: null, // cap projection is execution-time only
      lookbackDays:         config.min_data_lookback_days,
    };

    const action = { action_type: actionClass, execution_data: executionData || {} };
    return evaluateBudgetGuards(action, campaignState, config);
  } catch (err) {
    console.error('[BUDGET-GUARDS] staging guard failure:', err.message);
    return GUARD_ERROR_RESULT;
  }
}
