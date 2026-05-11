// ============================================================
// api/automation-log.js — read-only automation event feed
//
// GET /api/automation-log
//   Optional: ?account=<slug> or x-account-slug header (defaults to 'fpb')
//   Optional: ?platform=google|meta, ?limit=1..200
//
// Stage B1 retrofit:
//   • Account-scoped via resolveForRead (archived/inactive allowed —
//     dashboards still need to render historical events).
//   • SELECT filters by account_id so accounts only see their own log.
//   • Cron-level rows (cron_analysis) have account_id NULL by design;
//     those are intentionally NOT returned through this per-account view.
// ============================================================

import supabase from './lib/supabase.js';
import { resolveForRead } from './lib/accounts.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-account-slug',
};

function cors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const account = await resolveForRead(req, res);
  if (!account) return;

  const rawLimit = parseInt(req.query?.limit || '50', 10);
  const limit = Math.min(Math.max(rawLimit, 1), 200);
  const platform = req.query?.platform; // 'google' | 'meta' | undefined

  let query = supabase
    .from('automation_log')
    .select('*')
    .eq('account_id', account.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (platform === 'google') query = query.eq('platform', 'google_ads');
  if (platform === 'meta')   query = query.eq('platform', 'meta_ads');

  const { data, error } = await query;

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.status(200).json({ success: true, data });
}
