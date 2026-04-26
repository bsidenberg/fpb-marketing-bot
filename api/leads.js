// ============================================================
// leads.js — CRUD for the leads table
//
// GET   /api/leads              — list leads (filterable)
// POST  /api/leads              — create lead from webhook (requires x-leads-ingest-secret)
// PATCH /api/leads/:id          — update qualification status / revenue
//
// ⚠️  Auth notes:
//   POST requires x-leads-ingest-secret header matching LEADS_INGEST_SECRET env var.
//   If LEADS_INGEST_SECRET is not set, the endpoint logs a warning and accepts
//   any POST — set it in Vercel before accepting real webhook traffic.
//
//   PATCH is currently unauthenticated (dashboard-internal use only).
//   Auth gap: anyone with a lead UUID can update its qualification status.
//   Fix: add Supabase Auth session check before PATCH in a future sprint.
//
// Query params for GET:
//   ?status=new|qualified|booked|lost|unqualified
//   ?platform=google|meta|organic|unknown
//   ?limit=50 (max 200)
//   ?campaign_id=xxx
// ============================================================

import supabase from './lib/supabase.js';
import { normalizePayload, buildDedupKey } from './lib/lead-ingest.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-leads-ingest-secret',
};

function cors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

function requireIngestSecret(req, res) {
  const secret = process.env.LEADS_INGEST_SECRET;
  if (!secret) {
    console.warn('[SECURITY] LEADS_INGEST_SECRET not set — /api/leads POST is unprotected');
    return true; // warn but allow (matches execute-action pattern)
  }
  if (req.headers['x-leads-ingest-secret'] !== secret) {
    res.status(401).json({ success: false, error: 'Unauthorized — missing or invalid x-leads-ingest-secret' });
    return false;
  }
  return true;
}

const VALID_STATUSES   = ['new','qualified','unqualified','booked','lost','unknown'];
const VALID_PLATFORMS  = ['google','meta','organic','referral','manual','unknown'];

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET — list leads ────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const rawLimit = parseInt(req.query?.limit || '50', 10);
    const limit    = Math.min(Math.max(rawLimit, 1), 200);

    let query = supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (req.query?.status && VALID_STATUSES.includes(req.query.status)) {
      query = query.eq('qualification_status', req.query.status);
    }
    if (req.query?.platform && VALID_PLATFORMS.includes(req.query.platform)) {
      query = query.eq('source_platform', req.query.platform);
    }
    if (req.query?.campaign_id) {
      query = query.eq('campaign_id', req.query.campaign_id);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(200).json({ success: true, data });
  }

  // ── POST — create a lead ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    if (!requireIngestSecret(req, res)) return;

    const body = req.body || {};

    // Normalize the payload — handles Gravity Forms, CallRail, generic
    const { normalized, source_type } = normalizePayload(body);

    // Deduplication: check for an existing lead with the same key today
    const dedupKey = buildDedupKey(normalized, source_type);
    if (dedupKey) {
      const { data: existing } = await supabase
        .from('leads')
        .select('id, created_at')
        .eq('dedup_key', dedupKey)
        .limit(1);

      if (existing && existing.length > 0) {
        return res.status(200).json({
          success:    true,
          duplicate:  true,
          message:    'Duplicate lead — an identical lead was already recorded today.',
          existing_id: existing[0].id,
        });
      }
    }

    // Merge explicitly-passed fields on top of normalized ones
    // (lets callers override with known-good values)
    const merged = {
      ...normalized,
      // Caller-supplied overrides
      source_platform:  VALID_PLATFORMS.includes(body.source_platform) ? body.source_platform : normalized.source_platform,
      campaign_id:      body.campaign_id   || normalized.campaign_id,
      campaign_name:    body.campaign_name || normalized.campaign_name,
      ad_id:            body.ad_id         || normalized.ad_id,
      ad_name:          body.ad_name       || normalized.ad_name,
      ad_set_id:        body.ad_set_id     || normalized.ad_set_id,
      ad_set_name:      body.ad_set_name   || normalized.ad_set_name,
      estimated_value:  body.estimated_value ? parseFloat(body.estimated_value) : normalized.estimated_value,
    };

    // Strip external_id and source_type — not schema columns
    const { external_id, ...mergedClean } = merged;

    const row = {
      client_key:            'fpb',
      qualification_status:  'new',
      dedup_key:             dedupKey,
      ingest_source:         source_type,  // 'gravity_forms' | 'callrail' | 'generic'
      raw_payload:           body,
      ...mergedClean,
    };

    const { data, error } = await supabase
      .from('leads')
      .insert(row)
      .select()
      .single();

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(201).json({ success: true, data, source_type });
  }

  // ── PATCH — update qualification/revenue ────────────────────────────────────
  // Auth note: currently unauthenticated. Only call from dashboard.
  // Future: require Supabase Auth session.
  if (req.method === 'PATCH') {
    const urlParts = (req.url || '').split('?')[0].split('/').filter(Boolean);
    const id       = urlParts[urlParts.length - 1];

    if (!id || id === 'leads') {
      return res.status(400).json({ success: false, error: 'Missing lead id in URL' });
    }

    const {
      qualification_status,
      booked_revenue,
      gross_profit,
      estimated_value,
      attribution_confidence,
      attribution_notes,
      notes,
      lost_reason,
    } = req.body || {};

    const patch = {};
    const now   = new Date().toISOString();

    if (qualification_status) {
      if (!VALID_STATUSES.includes(qualification_status)) {
        return res.status(400).json({ success: false, error: `Invalid qualification_status: ${qualification_status}` });
      }
      patch.qualification_status = qualification_status;
      if (qualification_status === 'qualified')  patch.qualified_at = now;
      if (qualification_status === 'booked')     patch.booked_at    = now;
      if (qualification_status === 'lost')       patch.lost_at      = now;
    }

    if (booked_revenue      != null) patch.booked_revenue      = parseFloat(booked_revenue);
    if (gross_profit        != null) patch.gross_profit        = parseFloat(gross_profit);
    if (estimated_value     != null) patch.estimated_value     = parseFloat(estimated_value);
    if (attribution_confidence)      patch.attribution_confidence = attribution_confidence;
    if (attribution_notes   != null) patch.attribution_notes   = attribution_notes;
    if (notes               != null) patch.notes               = notes;
    if (lost_reason         != null) patch.lost_reason         = lost_reason;

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    }

    const { data, error } = await supabase
      .from('leads')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(200).json({ success: true, data });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
