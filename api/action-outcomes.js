// ============================================================
// action-outcomes.js — read action_outcomes table
//
// GET /api/action-outcomes         — list outcomes (newest first)
// GET /api/action-outcomes?action_id=x  — specific action
// ============================================================

import supabase from './lib/supabase.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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

  const rawLimit  = parseInt(req.query?.limit || '50', 10);
  const limit     = Math.min(Math.max(rawLimit, 1), 200);
  const actionId  = req.query?.action_id || null;
  const platform  = req.query?.platform  || null;

  let query = supabase
    .from('action_outcomes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (actionId)  query = query.eq('action_id', actionId);
  if (platform)  query = query.eq('platform', platform);

  const { data, error } = await query;
  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.status(200).json({ success: true, data });
}
