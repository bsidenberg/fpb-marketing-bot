// ============================================================
// approve-action.js — client-facing approval proxy
//
// POST /api/approve-action
//   Body: { actionId: string }
//   Headers: x-account-slug (optional, defaults to 'fpb')
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
//       - Account ownership check (Stage B1): caller's resolved
//         account must match action.account_id (else 403 ACCOUNT_MISMATCH)
//       - Idempotency lock: once executing, duplicate calls → 409
//       - Actions start in 'pending'; only pending/approved rows
//         can be executed (canExecute guard)
//       - Audit log records every execution attempt
//
// Stage B1 flow:
//   1. Resolve caller's account from request (rejects inactive/archived)
//   2. Fetch action; verify action.account_id === account.id
//   3. canExecute gate (state validation)
//   4. If executable type: resolve connection via getConnectionForAccount,
//      validate required resolved_* fields (404/503 on miss)
//      If manual or non-executable type: skip connection lookup
//   5. Delegate to acquireLockAndExecute({ account, connection })
//
// Success response:  { success: true, executed: true, ...extraMeta }
// Manual response:   { success: true, executed: false, requires_manual: true, message }
// Already done:      409 { success: false, error: '...' }
// Not found/invalid: 404/400 { success: false, error: '...' }
// Cross-account:     403 { success: false, code: 'ACCOUNT_MISMATCH' }
// Missing config:    404 CONNECTION_NOT_FOUND / 503 CONNECTION_INCOMPLETE
// ============================================================

import supabase from './lib/supabase.js';
import { canExecute, EXECUTABLE_TYPES } from './lib/action-states.js';
import { acquireLockAndExecute, normalizePlatform } from './lib/execute-action-logic.js';
import {
  resolveForWrite,
  getConnectionForAccount,
  checkConnectionFields,
} from './lib/accounts.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-account-slug',
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

  // ── Resolve caller's account (rejects archived/inactive) ────────────────
  const account = await resolveForWrite(req, res);
  if (!account) return;

  // ── Fetch action; verify ownership BEFORE leaking state info ────────────
  const { data: action, error: fetchErr } = await supabase
    .from('actions')
    .select('id, account_id, status, execution_result, action_type, channel')
    .eq('id', actionId)
    .single();

  if (fetchErr || !action) {
    return res.status(404).json({ success: false, error: 'Action not found' });
  }

  if (action.account_id !== account.id) {
    return res.status(403).json({
      success: false,
      error:   'Action belongs to a different account',
      code:    'ACCOUNT_MISMATCH',
    });
  }

  // ── State validation ─────────────────────────────────────────────────────
  if (!canExecute(action)) {
    const detail = action.execution_result
      ? `Action already executed (execution_result: ${action.execution_result})`
      : `Action is not in an executable state (status: ${action.status})`;
    return res.status(409).json({ success: false, error: detail });
  }

  // ── Resolve connection (only when an executor will actually use it) ─────
  // Manual types and non-executable types (flag_*, other) skip this — the
  // shared logic handles them without calling any external API.
  let connection = null;
  if (EXECUTABLE_TYPES.includes(action.action_type)) {
    const isCreative      = ['publish_creative', 'create_meta_campaign'].includes(action.action_type);
    const channelPlatform = normalizePlatform(action.channel);
    const connectionPlatform = isCreative
      ? 'meta_ads'
      : channelPlatform === 'google' ? 'google_ads' : 'meta_ads';

    connection = await getConnectionForAccount(account.id, connectionPlatform);
    if (!connection) {
      return res.status(404).json({
        success: false,
        error:   `No ${connectionPlatform} connection configured for account ${account.slug}`,
        code:    'CONNECTION_NOT_FOUND',
      });
    }

    const missing = checkConnectionFields(connection, connectionPlatform);
    if (missing) {
      return res.status(503).json({
        success: false,
        error:   `${connectionPlatform} connection for ${account.slug} is incomplete: ${missing}`,
        code:    'CONNECTION_INCOMPLETE',
      });
    }
  }

  // ── Delegate to shared execution logic ──────────────────────────────────
  const { httpStatus, body } = await acquireLockAndExecute(actionId, { account, connection });
  return res.status(httpStatus).json(body);
}
