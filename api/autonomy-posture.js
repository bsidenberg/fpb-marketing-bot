// ============================================================
// api/autonomy-posture.js — manage autonomy posture rows
//
// GET  /api/autonomy-posture?account=<slug>&pillar=<pillar>
//   Returns posture rows for the resolved account, optionally filtered
//   by pillar. Includes computed graduation_readiness field:
//     'eligible'   — cycles >= 20 AND success_rate >= 0.95
//     'needs_more' — cycles < 20
//     'needs_success' — cycles >= 20 but success_rate < 0.95
//
// POST /api/autonomy-posture?account=<slug>
//   Upserts a posture row.
//   Body: { pillar, action_class, tier?, cap_per_window?, window_days?, holdout?, notes? }
//   Requires x-execute-secret.
// ============================================================

import supabase from './lib/supabase.js';
import { setCorsHeaders } from './lib/cors.js';
import { resolveForRead, resolveForWrite } from './lib/accounts.js';
import { requireSecret } from './lib/require-secret.js';

const VALID_PILLARS = ['paid_ads', 'seo_blog', 'gbp', 'social_media'];
const VALID_TIERS   = ['recommend', 'full'];

export default async function handler(req, res) {
  setCorsHeaders(req, res, {
    methods: 'GET, POST, OPTIONS',
    headers: 'Content-Type, x-account-slug, x-execute-secret',
  });
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET — list posture rows for account ─────────────────────────────────
  if (req.method === 'GET') {
    const account = await resolveForRead(req, res);
    if (!account) return;

    let query = supabase
      .from('autonomy_posture')
      .select('*')
      .eq('account_id', account.id)
      .order('pillar', { ascending: true })
      .order('action_class', { ascending: true });

    if (req.query?.pillar) {
      query = query.eq('pillar', req.query.pillar);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ success: false, error: error.message });

    const rows = (data || []).map(row => ({
      ...row,
      graduation_readiness: computeGraduationReadiness(row),
    }));

    return res.status(200).json({ success: true, data: rows });
  }

  // ── POST — upsert a posture row (requires secret) ─────────────────────────
  if (req.method === 'POST') {
    if (!requireSecret(req, res, {
      envVar: 'EXECUTE_SECRET',
      header: 'x-execute-secret',
      label: '/api/autonomy-posture POST',
    })) return;

    const account = await resolveForWrite(req, res);
    if (!account) return;

    const {
      pillar,
      action_class,
      tier,
      cap_per_window,
      window_days,
      holdout,
      notes,
    } = req.body || {};

    if (!pillar)       return res.status(400).json({ success: false, error: 'Missing pillar' });
    if (!action_class) return res.status(400).json({ success: false, error: 'Missing action_class' });

    if (!VALID_PILLARS.includes(pillar)) {
      return res.status(400).json({ success: false, error: `Invalid pillar: ${pillar}. Must be one of: ${VALID_PILLARS.join(', ')}` });
    }
    if (tier !== undefined && !VALID_TIERS.includes(tier)) {
      return res.status(400).json({ success: false, error: `Invalid tier: ${tier}. Must be 'recommend' or 'full'` });
    }

    const upsertPayload = {
      account_id:   account.id,
      pillar,
      action_class,
      updated_at:   new Date().toISOString(),
    };

    if (tier         !== undefined) upsertPayload.tier           = tier;
    if (cap_per_window !== undefined) upsertPayload.cap_per_window = cap_per_window === null ? null : Number(cap_per_window);
    if (window_days  !== undefined) upsertPayload.window_days    = Number(window_days);
    if (holdout      !== undefined) upsertPayload.holdout        = Boolean(holdout);
    if (notes        !== undefined) upsertPayload.notes          = notes || null;

    const { data, error } = await supabase
      .from('autonomy_posture')
      .upsert(upsertPayload, { onConflict: 'account_id,pillar,action_class' })
      .select()
      .single();

    if (error) return res.status(500).json({ success: false, error: error.message });

    return res.status(200).json({
      success: true,
      data: {
        ...data,
        graduation_readiness: computeGraduationReadiness(data),
      },
    });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

function computeGraduationReadiness(row) {
  if (!row) return 'unknown';
  const cycles  = row.cycles_completed ?? 0;
  const success = row.success_count    ?? 0;
  if (cycles < 20) return 'needs_more';
  const rate = cycles > 0 ? success / cycles : 0;
  if (rate >= 0.95) return 'eligible';
  return 'needs_success';
}
