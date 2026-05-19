// ============================================================
// api/cost-hours.js — log and list Brian-hours
//
// GET  /api/cost-hours?account=<slug>&limit=<n>
//   Returns hours entries ordered by log_date DESC, created_at DESC.
//   Default limit: 100. Max: 500.
//
// POST /api/cost-hours?account=<slug>
//   Logs a new hours entry.
//   Body: {
//     hours,           — numeric >= 0
//     focus_area,      — e.g. 'fpb', 'weld', 'fsc', 'prime-platform', 'cross-tenant'
//     category,        — 'build' | 'operating' | 'review' | 'investigation' | 'other'
//     log_date?,       — YYYY-MM-DD; defaults to today
//     notes?
//   }
// ============================================================

import supabase from './lib/supabase.js';
import { setCorsHeaders } from './lib/cors.js';
import { resolveForRead, resolveForWrite } from './lib/accounts.js';

const VALID_CATEGORIES = ['build', 'operating', 'review', 'investigation', 'other'];

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'GET, POST, OPTIONS', headers: 'Content-Type, x-account-slug' });
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET — list hours entries ─────────────────────────────────────────────
  if (req.method === 'GET') {
    const account = await resolveForRead(req, res);
    if (!account) return;

    const limit = Math.min(parseInt(req.query?.limit || '100', 10), 500);

    const { data, error } = await supabase
      .from('cost_hours')
      .select('*')
      .order('log_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(200).json({ success: true, data: data || [] });
  }

  // ── POST — log hours ─────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const account = await resolveForWrite(req, res);
    if (!account) return;

    const { hours, focus_area, category, log_date, notes } = req.body || {};

    if (hours == null)  return res.status(400).json({ success: false, error: 'Missing hours' });
    if (!focus_area)    return res.status(400).json({ success: false, error: 'Missing focus_area' });
    if (!category)      return res.status(400).json({ success: false, error: 'Missing category' });
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        error: `category must be one of: ${VALID_CATEGORIES.join(', ')}`,
      });
    }

    const h = parseFloat(hours);
    if (isNaN(h) || h < 0) {
      return res.status(400).json({ success: false, error: 'hours must be a non-negative number' });
    }

    const { data, error } = await supabase
      .from('cost_hours')
      .insert({
        hours:      h,
        focus_area,
        category,
        log_date:   log_date || new Date().toISOString().slice(0, 10),
        notes:      notes || null,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(201).json({ success: true, data });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
