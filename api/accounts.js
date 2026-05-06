// ============================================================
// api/accounts.js — read-only list of accounts
//
// GET /api/accounts → JSON array of all accounts (active + inactive +
// archived), ordered by created_at asc.
//
// All other HTTP methods return 405 with Allow: GET.
// ============================================================

/**
 * SECURITY:
 *   - This endpoint is temporarily unauthenticated. It is for Stage A1
 *     internal use only and must not be exposed to external clients in
 *     this state.
 *   - The endpoint must NOT return ad_platform_connections data, token
 *     references (access_token_reference, refresh_token_reference),
 *     env: references, or any resolved_* values. Enforcement is done by
 *     the hardcoded SELECT column list below — never switch to
 *     select('*'), and never join in connection rows here.
 *   - Auth (Supabase Auth or session cookie) must be added before this
 *     endpoint is exposed to external clients.
 *   - Tracked in KNOWN_SECURITY_GAPS.md at the repo root.
 */

import supabase from './lib/supabase.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-account-slug',
};

function cors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

// Whitelist of columns returned to clients. Enumerated explicitly to
// guarantee that future schema additions cannot leak through this
// endpoint without an intentional code change. Do NOT replace with '*'.
const ACCOUNT_PUBLIC_COLUMNS = [
  'id',
  'name',
  'slug',
  'industry',
  'website_domain',
  'primary_location',
  'service_area',
  'reporting_timezone',
  'monthly_budget',
  'monthly_spend_cap',
  'daily_spend_cap',
  'target_cost_per_lead',
  'target_cost_per_qualified_lead',
  'target_cost_per_booked_job',
  'target_margin_goal',
  'autonomy_level',
  'status',
  'tracking_health_score',
  'crm_hygiene_score',
  'account_health_score',
  'created_at',
  'updated_at',
].join(', ');

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { data, error } = await supabase
    .from('accounts')
    .select(ACCOUNT_PUBLIC_COLUMNS)
    .order('created_at', { ascending: true });

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  return res.status(200).json({ success: true, data: data || [] });
}
