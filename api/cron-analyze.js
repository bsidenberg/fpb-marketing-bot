// ============================================================
// api/cron-analyze.js — daily scheduled ad analysis
//
// Triggered by Vercel cron (12:30 UTC, see vercel.json).
//
// Stage B1 retrofit:
//   • Calls runAnalysisForAccount directly (named export from analyze-ads)
//     — no internal HTTP fetch. This avoids URL construction and one extra
//     hop, and makes per-account iteration straightforward.
//   • ENABLE_MULTI_ACCOUNT_CRON env var gates the loop. Default false →
//     processes only FPB. Set 'true' to loop over listActiveAccounts().
//   • Per-account error isolation: one account's failure doesn't stop the
//     others. Each account gets its own entry in the response `results` array.
//   • Skips accounts that don't have BOTH google_ads AND meta_ads
//     connections (warn). Per-platform skipping inside the analysis is
//     handled by analyze-ads itself if one connection is incomplete.
//
// TODO: When active account count exceeds 2, consider splitting per-account
// analysis into separate cron paths or a queue to avoid Vercel's 60-second
// function limit.
// ============================================================

import supabase from './lib/supabase.js';
import { runAnalysisForAccount } from './analyze-ads.js';
import {
  getAccountBySlug,
  listActiveAccounts,
  getConnectionForAccount,
  FPB_DEFAULT_SLUG,
} from './lib/accounts.js';

// Read flag inside handler so tests can flip it per-test
function isMultiAccountCronEnabled() {
  return process.env.ENABLE_MULTI_ACCOUNT_CRON === 'true';
}

export default async function handler(req, res) {
  // ── Auth (unchanged from prior versions) ─────────────────────────────────
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

  // ── Resolve which accounts to process ────────────────────────────────────
  let accounts = [];
  try {
    if (multiAccount) {
      accounts = await listActiveAccounts();
      console.log(`[cron-analyze] multi-account mode: ${accounts.length} active accounts`);
    } else {
      const fpb = await getAccountBySlug(FPB_DEFAULT_SLUG);
      if (fpb) accounts = [fpb];
      console.log(`[cron-analyze] single-account mode: FPB only`);
    }
  } catch (err) {
    return res.status(500).json({
      success: false,
      error:   `Failed to load accounts: ${err.message}`,
    });
  }

  // ── Derive baseUrl for analyze-ads's internal /api/google-ads etc. fetches ─
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host     = req.headers['x-forwarded-host'] || req.headers.host;
  const baseUrl  = `${protocol}://${host}`;

  const results = [];

  for (const account of accounts) {
    try {
      // Skip accounts missing either platform's connection — analysis would
      // be partial at best, and we want a single clear "skipped" signal in
      // the cron's aggregate log rather than a noisy partial run.
      const [google, meta] = await Promise.all([
        getConnectionForAccount(account.id, 'google_ads'),
        getConnectionForAccount(account.id, 'meta_ads'),
      ]);

      if (!google || !meta) {
        const missing = [!google && 'google_ads', !meta && 'meta_ads'].filter(Boolean).join(' + ');
        const reason  = `missing ${missing} connection`;
        console.warn(`[cron-analyze] account=${account.slug} skipped: ${reason}`);
        results.push({ account: account.slug, status: 'skipped', reason });
        continue;
      }

      const result = await runAnalysisForAccount(account, { baseUrl, triggeredBy: 'cron' });
      results.push({ account: account.slug, ...result });
    } catch (err) {
      console.error(`[cron-analyze] account=${account.slug} failed:`, err.message);
      results.push({ account: account.slug, status: 'failed', error: err.message });
    }
  }

  // ── Aggregate audit log (cron-level; not tied to a single account) ───────
  const succeededCount = results.filter(r => r.success === true).length;
  const failedCount    = results.filter(r => r.status === 'failed').length;
  const skippedCount   = results.filter(r => r.status === 'skipped').length;

  try {
    await supabase.from('automation_log').insert({
      // account_id intentionally NULL: this row spans multiple accounts
      event_type:  'cron_analysis',
      status:      failedCount > 0 ? 'error' : 'complete',
      description: `Cron analysis: ${succeededCount} succeeded, ${failedCount} failed, ${skippedCount} skipped`,
      metadata:    { results, multi_account: multiAccount },
      created_at:  startedAt,
    });
  } catch (err) {
    console.error('[cron-analyze] aggregate automation_log insert failed:', err.message);
  }

  return res.status(200).json({
    success:       true,
    multi_account: multiAccount,
    results,
  });
}
