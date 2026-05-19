// ============================================================
// api/account-budget.js — per-account budget + MTD spend rollup
//
// GET /api/account-budget
//   Optional: ?account=<slug> or x-account-slug header (defaults to 'fpb')
//
// Stage B2: powers the MTD Spend vs Cap panel in the dashboard Overview
// tab. Read-only. Returns:
//
//   {
//     success: true,
//     data: {
//       account_slug, account_name,
//       monthly_budget,          // accounts.monthly_budget (target)
//       monthly_spend_cap,       // accounts.monthly_spend_cap (hard cap)
//       mtd_spend_total,         // sum of spend across all platforms MTD
//       mtd_spend_by_platform,   // { google_ads: ..., meta_ads: ... }
//       period_start,            // first day of current month, YYYY-MM-DD
//       period_end               // today, YYYY-MM-DD (inclusive)
//     }
//   }
//
// Notes:
//   • Reads are allowed for archived/inactive accounts (per Stage B1 policy
//     — dashboards still need to render history).
//   • Aggregation is over campaign_daily_stats.date BETWEEN period_start
//     AND period_end (inclusive both ends). Today's value may be partial
//     until the day's cron-analyze run completes.
//   • Schema column is `date` (not `stats_date`) per campaign-stats.js.
// ============================================================

import supabase from './lib/supabase.js';
import { resolveForRead } from './lib/accounts.js';
import { setCorsHeaders } from './lib/cors.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'GET, OPTIONS', headers: 'Content-Type, x-account-slug' });
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error:   'Method not allowed',
      code:    'METHOD_NOT_ALLOWED',
    });
  }

  const account = await resolveForRead(req, res);
  if (!account) return; // resolveForRead already wrote the 400 response

  // Compute current-month window (inclusive both ends, UTC date strings)
  const now = new Date();
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const { data: stats, error } = await supabase
    .from('campaign_daily_stats')
    .select('platform, spend')
    .eq('account_id', account.id)
    .gte('date', firstOfMonth)
    .lte('date', today);

  if (error) {
    console.error('[account-budget] supabase error:', error.message);
    return res.status(500).json({
      success: false,
      error:   `Failed to fetch budget data: ${error.message}`,
      code:    'BUDGET_FETCH_FAILED',
    });
  }

  // Aggregate by platform + grand total. Rows with null/NaN spend contribute 0.
  const byPlatform = {};
  let total = 0;
  for (const row of (stats || [])) {
    const spend = parseFloat(row.spend);
    if (!Number.isFinite(spend)) continue;
    const key = row.platform || 'unknown';
    byPlatform[key] = (byPlatform[key] || 0) + spend;
    total += spend;
  }

  return res.status(200).json({
    success: true,
    data: {
      account_slug:          account.slug,
      account_name:          account.name,
      monthly_budget:        account.monthly_budget    ?? null,
      monthly_spend_cap:     account.monthly_spend_cap ?? null,
      mtd_spend_total:       total,
      mtd_spend_by_platform: byPlatform,
      period_start:          firstOfMonth,
      period_end:            today,
    },
  });
}
