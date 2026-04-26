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

const WINDOW_DAYS = parseInt(process.env.OUTCOME_WINDOW_DAYS || '7', 10);

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

/** Count leads from the leads table within a window for a campaign. */
async function countLeads(campaignId, platform, startDate, endDate) {
  if (!campaignId) return { total: null, qualified: null };

  const platformKey = platform === 'google_ads' ? 'google' : 'meta';

  const { data, error } = await supabase
    .from('leads')
    .select('id, qualification_status')
    .eq('client_key', 'fpb')
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
 * Get the spend for a campaign in a date window.
 * Prefers campaign_daily_stats (precise) — falls back to performance_snapshots
 * (approximate) only if daily stats are unavailable.
 * @returns {{ spend: number|null, source: 'daily_stats'|'snapshots'|'none' }}
 */
async function getSpendWithSource(campaignId, platform, startDate, endDate) {
  if (!campaignId) return { spend: null, source: 'none' };

  // ── Preferred: campaign_daily_stats ────────────────────────────────────────
  const dailySpend = await getCampaignSpend(campaignId, platform, startDate, endDate);
  if (dailySpend != null) return { spend: dailySpend, source: 'daily_stats' };

  // ── Fallback: performance_snapshots ────────────────────────────────────────
  const { data, error } = await supabase
    .from('performance_snapshots')
    .select('*')
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

/** Convenience wrapper: return spend only (backwards-compatible) */
async function getSpendEstimate(campaignId, platform, startDate, endDate) {
  const { spend } = await getSpendWithSource(campaignId, platform, startDate, endDate);
  return spend;
}

async function evaluateAction(action, dryRun) {
  const executedAt = action.executed_at || action.reviewed_at;
  if (!executedAt) return { skipped: true, reason: 'No executed_at timestamp' };

  const isManual = MANUAL_TYPES.includes(action.action_type);

  const { before, after } = buildWindows(executedAt, WINDOW_DAYS);
  const windowComplete    = isWindowComplete(after.end);

  const campaignId = action.execution_data?.campaign_id || null;
  const platform   = action.channel === 'google_ads' ? 'google_ads' : 'meta_ads';

  // Gather before metrics
  const [spendBeforeResult, leadsBefore] = await Promise.all([
    isManual ? Promise.resolve({ spend: null, source: 'none' }) : getSpendWithSource(campaignId, platform, toDate(before.start), toDate(before.end)),
    isManual ? Promise.resolve({ total: null, qualified: null }) : countLeads(campaignId, platform, toDate(before.start), toDate(before.end)),
  ]);

  // Gather after metrics
  const [spendAfterResult, leadsAfter] = await Promise.all([
    isManual ? Promise.resolve({ spend: null, source: 'none' }) : getSpendWithSource(campaignId, platform, toDate(after.start), toDate(after.end)),
    isManual ? Promise.resolve({ total: null, qualified: null }) : countLeads(campaignId, platform, toDate(after.start), toDate(after.end)),
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
    client_key:                        'fpb',
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const dryRun      = req.query?.dry_run === 'true';
  const specificId  = req.query?.action_id || null;

  // Find executed actions old enough to have a completed post-window
  // (executed at least WINDOW_DAYS ago, so post window is potentially done)
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();

  let query = supabase
    .from('actions')
    .select('id, action_type, channel, execution_data, executed_at, reviewed_at')
    .eq('execution_result', 'success')
    .lt('executed_at', cutoff)
    .order('executed_at', { ascending: false })
    .limit(50);

  if (specificId) {
    query = supabase
      .from('actions')
      .select('id, action_type, channel, execution_data, executed_at, reviewed_at')
      .eq('id', specificId)
      .eq('execution_result', 'success');
  }

  const { data: actions, error: fetchErr } = await query;

  if (fetchErr) {
    return res.status(500).json({ success: false, error: fetchErr.message });
  }

  if (!actions || actions.length === 0) {
    return res.status(200).json({
      success: true,
      evaluated: 0,
      skipped:   0,
      message:   'No executed actions found that are old enough for post-window evaluation.',
    });
  }

  // Skip manual types — they cannot be auto-verified
  const toEvaluate = actions.filter(a => !MANUAL_TYPES.includes(a.action_type));
  const manualSkipped = actions.length - toEvaluate.length;

  const results = [];
  for (const action of toEvaluate) {
    const result = await evaluateAction(action, dryRun);
    results.push(result);
  }

  const evaluated = results.filter(r => !r.skipped && !r.error).length;
  const skipped   = results.filter(r => r.skipped).length + manualSkipped;
  const errors    = results.filter(r => r.error);

  return res.status(200).json({
    success: true,
    evaluated,
    skipped,
    errors:   errors.length > 0 ? errors : undefined,
    dry_run:  dryRun,
    results,
  });
}
