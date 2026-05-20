// ============================================================
// api/autonomy-holdout-classes.js — read-only holdout class list
//
// GET /api/autonomy-holdout-classes
//   Returns all seeded holdout action classes.
//   No account scoping needed — this is a global static reference table.
//   Resolves account for auth purposes only.
// ============================================================

import supabase from './lib/supabase.js';
import { setCorsHeaders } from './lib/cors.js';
import { resolveForRead } from './lib/accounts.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'GET, OPTIONS', headers: 'Content-Type, x-account-slug' });
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const account = await resolveForRead(req, res);
  if (!account) return;

  const { data, error } = await supabase
    .from('autonomy_holdout_classes')
    .select('*')
    .order('action_class', { ascending: true });

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.status(200).json({ success: true, data: data || [] });
}
