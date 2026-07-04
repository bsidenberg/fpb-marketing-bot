// ============================================================
// api/cron-crm-sync.js — nightly CRM -> Prime profit bridge (SESSION-04)
//
// Triggered by Vercel cron (11:15 UTC, see vercel.json — before
// cron-daily-stats at 11:45, so the day's ingestion runs land after
// outcome data is fresh).
//
// Reads the FPB CRM's own Supabase project READ-ONLY (never writes to
// it) via a separate client, matches CRM leads to Prime leads, and
// fills booked_revenue / gross_profit / qualification lifecycle
// fields. See api/lib/crm-bridge.js for the matching + sync logic.
//
// Mirrors api/cron-daily-stats.js's structure:
//   • Auth: x-vercel-cron header OR Bearer CRON_SECRET, else 401.
//   • GET only; anything else -> 405.
//   • Best-effort automation_log insert; never fails the response.
//   • Fails closed on any error (missing CRM env vars, query failure).
// ============================================================

import supabase from './lib/supabase.js';
import { createCrmClient, runCrmSync } from './lib/crm-bridge.js';

export default async function handler(req, res) {
  // ── Auth (mirrors cron-daily-stats.js) ────────────────────────────────────
  const cronHeader  = req.headers['x-vercel-cron'];
  const authHeader  = req.headers['authorization'];
  const cronSecret  = process.env.CRON_SECRET;

  const validCronHeader = cronHeader === '1';
  const validSecret     = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!validCronHeader && !validSecret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const startedAt = new Date().toISOString();

  try {
    const crm    = createCrmClient();
    const counts = await runCrmSync({ crm, prime: supabase });

    try {
      await supabase.from('automation_log').insert({
        // account_id intentionally NULL: CRM sync spans all leads, not one account
        account_id:  null,
        event_type:  'crm_sync',
        status:      'success',
        description: `CRM sync: ${counts.matched} matched, ${counts.booked} booked, $${counts.revenue_total} revenue`,
        metadata:    counts,
        created_at:  startedAt,
      });
    } catch (logErr) {
      console.error('[cron-crm-sync] automation_log insert failed:', logErr.message);
    }

    return res.status(200).json({ success: true, ...counts });
  } catch (err) {
    console.error('[cron-crm-sync] failed:', err.message);

    try {
      await supabase.from('automation_log').insert({
        account_id:  null,
        event_type:  'crm_sync',
        status:      'error',
        description: `CRM sync failed: ${err.message}`,
        metadata:    { error: err.message },
        created_at:  startedAt,
      });
    } catch (logErr) {
      console.error('[cron-crm-sync] error automation_log insert failed:', logErr.message);
    }

    return res.status(500).json({ success: false, error: err.message });
  }
}
