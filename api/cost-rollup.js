// ============================================================
// api/cost-rollup.js — trigger monthly cost rollup for one account + month
//
// GET /api/cost-rollup?account=<slug>&month=YYYY-MM
//   Runs computeMonthlyRollup and returns the resulting row.
//   Uses the same security primitives as the rest of Prime:
//     setCorsHeaders from api/lib/cors.js
//     resolveForRead from api/lib/accounts.js for tenant resolution
//
// Phase 0: cron scheduling is deferred. Brian or the dashboard Refresh
// button triggers this manually. The endpoint is intentionally simple —
// no auth beyond tenant resolution — because cost data is Brian-internal.
// ============================================================

import { setCorsHeaders } from './lib/cors.js';
import { resolveForRead } from './lib/accounts.js';
import { computeMonthlyRollup } from './lib/cost-rollup.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'GET, OPTIONS', headers: 'Content-Type, x-account-slug' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const account = await resolveForRead(req, res);
  if (!account) return;

  const month = req.query?.month || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
  }

  try {
    const rollup = await computeMonthlyRollup(account.id, month);
    return res.status(200).json({ success: true, rollup });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
