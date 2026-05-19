// ============================================================
// evaluate-outcomes.js — before/after outcome evaluator
//
// GET  /api/evaluate-outcomes              — run evaluation now (cron or manual)
// GET  /api/evaluate-outcomes?dry_run=true — preview without writing
// GET  /api/evaluate-outcomes?action_id=x  — evaluate a specific action only
//
// Protections:
//   - Requires x-vercel-cron: 1 OR Authorization: Bearer CRON_SECRET
//   - Skips manual action types (adjust_budget, adjust_bid)
//   - Skips actions without a post-window evaluation yet due
//   - Uses unique index on (action_id, metric_window_after_start) to prevent
//     double-writes (idempotent)
//
// Stage B1 retrofit (Sub-Task 9):
//   • Account-scoped throughout. Closes Sub-Task 7 deferred holes:
//       — countLeads filters by account_id (was: client_key='fpb')
//       — performance_snapshots fallback filters by account_id
//       — action_outcomes upsert includes account_id
//   • ENABLE_MULTI_ACCOUNT_CRON gates the per-account loop.
//     Default false → only FPB. Same flag as cron-analyze.
//   • Per-account error isolation: one account's failure doesn't stop others.
//
// What it does NOT do:
//   - Does not touch the approval flow
//   - Does not modify actions table
//   - Does not claim causality
//   - Does not require leads table to have data (gracefully degrades)
// ============================================================

import supabase from './lib/supabase.js';
import { MANUAL_TYPES } from './lib/action-states.js';
import {
  buildWindows,
  isWindowComplete,
  calcCPL,
  calcCostPerQualifiedLead,
  buildConclusion,
} from './lib/attribution.js';
import { getCampaignSpend } from './lib/campaign-stats.js';
import {
  getAccountBySlug,
  listActiveAccounts,
  FPB_DEFAULT_SLUG,
} from './lib/accounts.js';
import { setCorsHeaders } from './lib/cors.js';

const WINDOW_DAYS = parseInt(process.env.OUTCOME_WINDOW_DAYS || '7', 10);

// Read flag inside handler so tests can flip it per-test
function isMultiAccountCronEnabled() {
  return process.env.ENABLE_MULTI_ACCOUNT_CRON === 'true';
}

function isAuthorized(req) {
  const cronHeader  = req.headers['x-vercel-cron'];
  const authHeader  = req.headers['authorization'];
  const cronSecret  = process.env.CRON_SECRET;

  if (cronHeader === '1') return true;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  return false;
}

/** Convert a Date to a YYYY-MM-DD string */
function toDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Count leads from the leads table within a window for a campaign,
 * scoped to one account.
 *
 * Stage B1 Sub-Task 9: filter is now `.eq('account_id', accountId)`.
 * The previous `.eq('client_key', 'fpb')` filter is gone — it would have
 * mixed accounts together once multiple slugs existed in `client_key`.
 */
async function countLeads(campaignId, accountId, platform, startDate, endDate) {
  if (!campaignId) return { total: null, qualified: null };

  const platformKey = platform === 'google_ads' ? 'google' : 'meta';

  const { data, error } = await supabase
    .from('leads')
    .select('id, qualification_status')
    .eq('account_id', accountId)
    .eq('source_platform', platformKey)
    .eq('campaign_id', campaignId)
    .gte('created_at', new Date(startDate).toISOString())
    .lt('created_at', new Date(endDate).toISOString());

  if (error || !data) return { total: null, qualified: null };

  return {
    total:     data.length,
    qualified: data.filter(l => ['qualified', 'booked'].includes(l.qualification_status)).length,
  };
}

/**
 * Get the spend for a campaign in a date window, scoped to one account.
 * Prefers campaign_daily_stats (precise) — falls back to performance_snapshots
 * (approximate) only if daily stats are unavailable.
 *
 * Stage B1 Sub-Task 9: the performance_snapshots fallback is now also
 * account-scoped via `.eq('account_id', accountId)`. Without this filter,
 * a multi-account install would mix snapshots from different accounts.
 *
 * @returns {{ spend: number|null, source: 'daily_stats'|'snapshots'|'none' }}
 */
async function getSpendWithSource(campaignId, accountId, platform, startDate, endDate) {
  if (!campaignId) return { spend: null, source: 'none' };

  // ── Preferred: campaign_daily_stats ────────────────────────────────────────
  const dailySpend = await getCampaignSpend(campaignId, accountId, platform, startDate, endDate);
  if (dailySpend != null) return { spend: dailySpend, source: 'daily_stats' };

  // ── Fallback: performance_snapshots (now account-scoped) ──────────────────
  const { data, error } = await supabase
    .from('performance_snapshots')
    .select('*')
    .eq('account_id', accountId)
    .gte('created_at', new Date(startDate).toISOString())
    .lt('created_at', new Date(endDate).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !data || data.length === 0) return { spend: null, source: 'none' };

  let totalSpend = 0;
  let count      = 0;

  for (const snap of data) {
    const platformData = platform === 'google_ads' ? snap.google_data : snap.meta_data;
    if (!platformData) continue;
    const campaigns = platformData.campaigns || platformData.data || [];
    const match = campaigns.find(c => String(c.id || c.campaign_id) === String(campaignId));
    if (match) {
      const spend = parseFloat(match.spend || match.cost || 0);
      if (spend > 0) { totalSpend += spend; count++; }
    }
  }

  if (count === 0) return { spend: null, source: 'none' };
  return { spend: totalSpend / count, source: 'snapshots' };
}

async function evaluateAction(action, account, dryRun) {
  const executedAt = action.executed_at || action.reviewed_at;
  if (!executedAt) return { skipped: true, reason: 'No executed_at timestamp' };

  const isManual = MANUAL_TYPES.includes(action.action_type);

  const { before, after } = buildWindows(executedAt, WINDOW_DAYS);
  const windowComplete    = isWindowComplete(after.end);

  const campaignId = action.execution_data?.campaign_id || null;
  const platform   = action.channel === 'google_ads' ? 'google_ads' : 'meta_ads';
  const accountId  = account.id;

  // Gather before metrics
  const [spendBeforeResult, leadsBefore] = await Promise.all([
    isManual ? Promise.resolve({ spend: null, source: 'none' }) : getSpendWithSource(campaignId, accountId, platform, toDate(before.start), toDate(before.end)),
    isManual ? Promise.resolve({ total: null, qualified: null }) : countLeads(campaignId, accountId, platform, toDate(before.start), toDate(before.end)),
  ]);

  // Gather after metrics
  const [spendAfterResult, leadsAfter] = await Promise.all([
    isManual ? Promise.resolve({ spend: null, source: 'none' }) : getSpendWithSource(campaignId, accountId, platform, toDate(after.start), toDate(after.end)),
    isManual ? Promise.resolve({ total: null, qualified: null }) : countLeads(campaignId, accountId, platform, toDate(after.start), toDate(after.end)),
  ]);

  const spendBefore = spendBeforeResult.spend;
  const spendAfter  = spendAfterResult.spend;
  const spendSource = spendBeforeResult.source !== 'none' ? spendBeforeResult.source : spendAfterResult.source;

  const cplBefore  = calcCPL(spendBefore, leadsBefore.total);
  const cplAfter   = calcCPL(spendAfter, leadsAfter.total);
  const cpqlBefore = calcCostPerQualifiedLead(spendBefore, leadsBefore.qualified);
  const cpqlAfter  = calcCostPerQualifiedLead(spendAfter, leadsAfter.qualified);

  const { conclusion, confidence } = buildConclusion({
    spendBefore,
    spendAfter,
    leadsBefore:           leadsBefore.total,
    leadsAfter:            leadsAfter.total,
    qualifiedLeadsBefore:  leadsBefore.qualified,
    qualifiedLeadsAfter:   leadsAfter.qualified,
    windowComplete,
    isManual,
  });

  const row = {
    action_id:                         action.id,
    account_id:                        accountId,
    client_key:                        account.slug,  // kept in sync with slug; not authoritative
    platform,
    campaign_id:                       campaignId,
    campaign_name:                     action.execution_data?.campaign_name || null,
    action_type:                       action.action_type,
    metric_window_before_start:        toDate(before.start),
    metric_window_before_end:          toDate(before.end),
    metric_window_after_start:         toDate(after.start),
    metric_window_after_end:           toDate(after.end),
    window_days:                       WINDOW_DAYS,
    spend_before:                      spendBefore,
    spend_after:                       spendAfter,
    leads_before:                      leadsBefore.total,
    leads_after:                       leadsAfter.total,
    qualified_leads_before:            leadsBefore.qualified,
    qualified_leads_after:             leadsAfter.qualified,
    cpl_before:                        cplBefore,
    cpl_after:                         cplAfter,
    cost_per_qualified_lead_before:    cpqlBefore,
    cost_per_qualified_lead_after:     cpqlAfter,
    revenue_before:                    null,  // future: aggregate from leads.booked_revenue
    revenue_after:                     null,
    gross_profit_before:               null,
    gross_profit_after:                null,
    conclusion,
    confidence,
    evaluation_notes:                  `Window: ${WINDOW_DAYS} days each side. Spend from ${spendSource === 'daily_stats' ? 'campaign_daily_stats (precise)' : spendSource === 'snapshots' ? 'performance_snapshots (approximate)' : 'no source available'}. Leads from leads table.`,
    is_manual_action:                  isManual,
  };

  if (!dryRun) {
    // Upsert — unique index on (action_id, metric_window_after_start) prevents double-writes
    const { error } = await supabase
      .from('action_outcomes')
      .upsert(row, { onConflict: 'action_id,metric_window_after_start', ignoreDuplicates: false });

    if (error) {
      return { skipped: false, error: error.message, action_id: action.id };
    }
  }

  return {
    skipped:    false,
    action_id:  action.id,
    action_type: action.action_type,
    confidence,
    conclusion,
    dry_run:    dryRun,
  };
}

/**
 * Evaluate all eligible actions for one account.
 * Returns a per-account summary suitable for the multi-account aggregate.
 */
async function evaluateForAccount(account, { dryRun, specificId }) {
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();

  let query = supabase
    .from('actions')
    .select('id, account_id, action_type, channel, execution_data, executed_at, reviewed_at')
    .eq('account_id', account.id)
    .eq('execution_result', 'success')
    .lt('executed_at', cutoff)
    .order('executed_at', { ascending: false })
    .limit(50);

  if (specificId) {
    query = supabase
      .from('actions')
      .select('id, account_id, action_type, channel, execution_data, executed_at, reviewed_at')
      .eq('id', specificId)
      .eq('account_id', account.id)
      .eq('execution_result', 'success');
  }

  const { data: actions, error: fetchErr } = await query;

  if (fetchErr) {
    return { account: account.slug, status: 'failed', error: fetchErr.message };
  }

  if (!actions || actions.length === 0) {
    return {
      account:   account.slug,
      status:    'succeeded',
      evaluated: 0,
      skipped:   0,
      message:   'No executed actions found that are old enough for post-window evaluation.',
    };
  }

  // Skip manual types — they cannot be auto-verified
  const toEvaluate    = actions.filter(a => !MANUAL_TYPES.includes(a.action_type));
  const manualSkipped = actions.length - toEvaluate.length;

  const results = [];
  for (const action of toEvaluate) {
    const result = await evaluateAction(action, account, dryRun);
    results.push(result);
  }

  const evaluated = results.filter(r => !r.skipped && !r.error).length;
  const skipped   = results.filter(r => r.skipped).length + manualSkipped;
  const errors    = results.filter(r => r.error);

  return {
    account:   account.slug,
    status:    'succeeded',
    evaluated,
    skipped,
    errors:    errors.length > 0 ? errors : undefined,
    results,
  };
}

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'GET, OPTIONS', headers: 'Content-Type, Authorization' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const dryRun       = req.query?.dry_run === 'true';
  const specificId   = req.query?.action_id || null;
  const multiAccount = isMultiAccountCronEnabled();

  // ── Resolve which accounts to process ────────────────────────────────────
  let accounts = [];
  try {
    if (multiAccount) {
      accounts = await listActiveAccounts();
    } else {
      const fpb = await getAccountBySlug(FPB_DEFAULT_SLUG);
      if (fpb) accounts = [fpb];
    }
  } catch (err) {
    return res.status(500).json({
      success: false,
      error:   `Failed to load accounts: ${err.message}`,
    });
  }

  // ── Per-account loop with error isolation ────────────────────────────────
  const accountResults = [];
  for (const account of accounts) {
    try {
      const result = await evaluateForAccount(account, { dryRun, specificId });
      accountResults.push(result);
    } catch (err) {
      console.error(`[evaluate-outcomes] account=${account.slug} failed:`, err.message);
      accountResults.push({ account: account.slug, status: 'failed', error: err.message });
    }
  }

  const totalEvaluated = accountResults.reduce((sum, r) => sum + (r.evaluated || 0), 0);
  const totalSkipped   = accountResults.reduce((sum, r) => sum + (r.skipped   || 0), 0);
  const errors         = accountResults.flatMap(r => r.errors || []).concat(
    accountResults.filter(r => r.status === 'failed').map(r => ({ account: r.account, error: r.error }))
  );

  return res.status(200).json({
    success:       true,
    evaluated:     totalEvaluated,
    skipped:       totalSkipped,
    errors:        errors.length > 0 ? errors : undefined,
    dry_run:       dryRun,
    multi_account: multiAccount,
    results:       accountResults,
  });
}
