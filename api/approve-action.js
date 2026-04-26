// ============================================================
// approve-action.js — client-facing approval proxy
//
// POST /api/approve-action
//   Body: { actionId: string }
//
// This endpoint is called directly by the browser dashboard.
// It does NOT require x-execute-secret — the secret is kept
// server-side only and never exposed to the client.
//
// ⚠️  Auth limitation (Sprint 2): Any caller who knows a valid
//     actionId and this endpoint URL can trigger execution.
//     Full user-session auth (Supabase Auth or similar) is
//     a productization gap documented in DEPLOY.md.
//     Mitigations in place:
//       - Idempotency lock: once executing, duplicate calls → 409
//       - Actions start in 'pending'; only pending/approved rows
//         can be executed (canExecute guard)
//       - Audit log records every execution attempt
//
// Success response:  { success: true, executed: true, ...extraMeta }
// Manual response:   { success: true, executed: false, requires_manual: true, message }
// Already done:      409 { success: false, error: '...' }
// Not found/invalid: 404/400 { success: false, error: '...' }
// ============================================================

import supabase from './lib/supabase.js';
import { canExecute } from './lib/action-states.js';
import { acquireLockAndExecute } from './lib/execute-action-logic.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function cors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { actionId } = req.body || {};
  if (!actionId) {
    return res.status(400).json({ success: false, error: 'Missing actionId' });
  }

  // ── Pre-flight: confirm action exists and is executable ─────────────────────
  const { data: action, error: fetchErr } = await supabase
    .from('actions')
    .select('id, status, execution_result, action_type')
    .eq('id', actionId)
    .single();

  if (fetchErr || !action) {
    return res.status(404).json({ success: false, error: 'Action not found' });
  }

  if (!canExecute(action)) {
    // Distinguish between "already done" and "wrong state"
    const detail = action.execution_result
      ? `Action already executed (execution_result: ${action.execution_result})`
      : `Action is not in an executable state (status: ${action.status})`;
    return res.status(409).json({ success: false, error: detail });
  }

  // ── Delegate to shared execution logic ───────────────────────────────────────
  const { httpStatus, body } = await acquireLockAndExecute(actionId);
  return res.status(httpStatus).json(body);
}
