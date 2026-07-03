// ============================================================
// api/cron-daily-stats.js — nightly Google Ads daily-stats ingestion
//
// Triggered by Vercel cron (11:45 UTC, see vercel.json — before
// cron-analyze at 12:30 and evaluate-outcomes at 13:00, so the analysis
// and outcome-evaluation runs can read fresh daily-grain rows).
//
// SESSION-03: pulls the last 3 complete days of per-campaign Google Ads
// metrics and upserts them into campaign_daily_stats. See
// api/lib/daily-stats.js for the ingestion logic and why it is the sole
// writer of true daily-grain rows to that table.
//
// Mirrors api/cron-analyze.js's structure:
//   • Auth: x-vercel-cron header OR Bearer CRON_SECRET, else 401.
//   • ENABLE_MULTI_ACCOUNT_CRON flag gates single-account (FPB only) vs.
//     looping over every active account.
//   • Per-account try/catch: one account's failure doesn't stop others.
//   • Best-effort automation_log insert; never fails the response.
// ============================================================

import supabase from './lib/supabase.js';
import {
  getAccountBySlug,
  listActiveAccounts,
  getConnectionForAccount,
  FPB_DEFAULT_SLUG,
} from './lib/accounts.js';
import { computeDateRange, fetchGoogleDailyStats, mapRowsToDailyStats, upsertDailyStats } from './lib/daily-stats.js';

// Read flag inside handler so tests can flip it per-test
function isMultiAccountCronEnabled() {
  return process.env.ENABLE_MULTI_ACCOUNT_CRON === 'true';
}

export default async function handler(req, res) {
  // ── Auth (mirrors cron-analyze.js) ────────────────────────────────────────
  const cronHeader = req.headers['x-vercel-cron'];
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;

  const validCronHeader = cronHeader === '1';
  const validSecret     = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!validCronHeader && !validSecret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const startedAt    = new Date().toISOString();
  const multiAccount = isMultiAccountCronEnabled();
  const { startDate, endDate } = computeDateRange(new Date());

  // ── Resolve which accounts to process ────────────────────────────────────
  let accounts = [];
  try {
    if (multiAccount) {
      accounts = await listActiveAccounts();
      console.log(`[cron-daily-stats] multi-account mode: ${accounts.length} active accounts`);
    } else {
      const fpb = await getAccountBySlug(FPB_DEFAULT_SLUG);
      if (fpb) accounts = [fpb];
      console.log(`[cron-daily-stats] single-account mode: FPB only`);
    }
  } catch (err) {
    return res.status(500).json({
      success: false,
      error:   `Failed to load accounts: ${err.message}`,
    });
  }

  const results = [];

  for (const account of accounts) {
    try {
      const conn = await getConnectionForAccount(account.id, 'google_ads');
      if (!conn) {
        console.warn(`[cron-daily-stats] account=${account.slug} skipped: no google_ads connection`);
        results.push({ account: account.slug, status: 'skipped', reason: 'no google_ads connection' });
        continue;
      }

      const rawResults = await fetchGoogleDailyStats(account, conn, { startDate, endDate });
      const rows        = mapRowsToDailyStats(rawResults, account);
      const { written, errors } = await upsertDailyStats(rows);

      if (errors.length > 0) {
        console.error(`[cron-daily-stats] account=${account.slug} upsert failed:`, errors.join('; '));
        results.push({ account: account.slug, status: 'failed', error: errors.join('; ') });
        continue;
      }

      results.push({ account: account.slug, status: 'ok', written, start_date: startDate, end_date: endDate });
    } catch (err) {
      console.error(`[cron-daily-stats] account=${account.slug} failed:`, err.message);
      results.push({ account: account.slug, status: 'failed', error: err.message });
    }
  }

  // ── Aggregate audit log (cron-level; not tied to a single account) ───────
  const succeededCount = results.filter(r => r.status === 'ok').length;
  const failedCount    = results.filter(r => r.status === 'failed').length;
  const skippedCount   = results.filter(r => r.status === 'skipped').length;

  try {
    await supabase.from('automation_log').insert({
      // account_id intentionally NULL: this row spans multiple accounts
      event_type:  'cron_daily_stats',
      status:      failedCount > 0 ? 'error' : 'complete',
      description: `Cron daily-stats: ${succeededCount} succeeded, ${failedCount} failed, ${skippedCount} skipped`,
      metadata:    { results, multi_account: multiAccount, start_date: startDate, end_date: endDate },
      created_at:  startedAt,
    });
  } catch (err) {
    console.error('[cron-daily-stats] aggregate automation_log insert failed:', err.message);
  }

  return res.status(200).json({
    success:       true,
    multi_account: multiAccount,
    start_date:    startDate,
    end_date:      endDate,
    results,
  });
}
