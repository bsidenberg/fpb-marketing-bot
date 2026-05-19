// ============================================================
// api/cost-subscriptions.js — manage recurring subscription costs
//
// GET  /api/cost-subscriptions?account=<slug>
//   Returns all subscription rows ordered by started_at DESC.
//   (Subscriptions are shared/global — account param satisfies tenant
//   resolution but does not filter results.)
//
// POST /api/cost-subscriptions?account=<slug>
//   Creates a new subscription entry.
//   Body: {
//     vendor, plan, monthly_amount_usd, started_at,
//     ended_at?          — ISO timestamp, null = still active
//     notes?
//     allocation_account_id? — UUID; null = shared across tenants
//   }
// ============================================================

import supabase from './lib/supabase.js';
import { setCorsHeaders } from './lib/cors.js';
import { resolveForRead, resolveForWrite } from './lib/accounts.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'GET, POST, OPTIONS', headers: 'Content-Type, x-account-slug' });
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET — list all subscriptions ────────────────────────────────────────
  if (req.method === 'GET') {
    const account = await resolveForRead(req, res);
    if (!account) return;

    const { data, error } = await supabase
      .from('cost_subscriptions')
      .select('*')
      .order('started_at', { ascending: false });

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(200).json({ success: true, data: data || [] });
  }

  // ── POST — create a subscription ────────────────────────────────────────
  if (req.method === 'POST') {
    const account = await resolveForWrite(req, res);
    if (!account) return;

    const {
      vendor, plan, monthly_amount_usd, started_at,
      ended_at, notes, allocation_account_id,
    } = req.body || {};

    if (!vendor)            return res.status(400).json({ success: false, error: 'Missing vendor' });
    if (!plan)              return res.status(400).json({ success: false, error: 'Missing plan' });
    if (monthly_amount_usd == null) {
      return res.status(400).json({ success: false, error: 'Missing monthly_amount_usd' });
    }
    if (!started_at)        return res.status(400).json({ success: false, error: 'Missing started_at' });

    const amount = parseFloat(monthly_amount_usd);
    if (isNaN(amount) || amount < 0) {
      return res.status(400).json({ success: false, error: 'monthly_amount_usd must be a non-negative number' });
    }

    const { data, error } = await supabase
      .from('cost_subscriptions')
      .insert({
        vendor,
        plan,
        monthly_amount_usd: amount,
        started_at,
        ended_at:              ended_at              || null,
        notes:                 notes                 || null,
        allocation_account_id: allocation_account_id || null,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(201).json({ success: true, data });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
