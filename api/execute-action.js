// ============================================================
// execute-action.js — internal/programmatic execution endpoint
//
// POST /api/execute-action
//   Requires: x-execute-secret header
//   Optional: x-account-slug header (defaults to 'fpb')
//   Body (DB-backed):   { actionId }
//   Body (transient):   { platform, actionType, campaignId }
//
// DB-backed path:   used by scheduled jobs or server-to-server calls.
//                   Same account scoping + ownership check + connection
//                   resolution flow as /api/approve-action.
//                   Full idempotency + audit logging via acquireLockAndExecute.
//
// Transient path:   legacy path for chat ActionCard direct execution
//                   (no DB row, no idempotency guarantee — use sparingly).
//                   Account context comes from request envelope only
//                   (query/header), NOT body.
//
// For browser approval flows use /api/approve-action instead.
// ============================================================

import supabase from './lib/supabase.js';
import { canExecute, EXECUTABLE_TYPES } from './lib/action-states.js';
import {
  acquireLockAndExecute,
  executeTransient,
  normalizePlatform,
} from './lib/execute-action-logic.js';
import {
  resolveForWrite,
  getConnectionForAccount,
  checkConnectionFields,
} from './lib/accounts.js';
import { setCorsHeaders } from './lib/cors.js';
import { requireSecret } from './lib/require-secret.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'POST, OPTIONS', headers: 'Content-Type, x-execute-secret, x-account-slug' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!requireSecret(req, res, { envVar: 'EXECUTE_SECRET', header: 'x-execute-secret', label: '/api/execute-action' })) return;

  const account = await resolveForWrite(req, res);
  if (!account) return;

  const { actionId, platform, actionType, campaignId } = req.body || {};

  // ── DB-backed path ────────────────────────────────────────────────────────────
  if (actionId) {
    // Fetch action; verify ownership BEFORE delegating
    const { data: action, error: fetchErr } = await supabase
      .from('actions')
      .select('id, account_id, status, result, action_type, channel')
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

    if (!canExecute(action)) {
      const detail = action.result
        ? `Action already executed (result: ${action.result})`
        : `Action is not in an executable state (status: ${action.status})`;
      return res.status(409).json({ success: false, error: detail });
    }

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

    const { httpStatus, body } = await acquireLockAndExecute(actionId, { account, connection });
    return res.status(httpStatus).json(body);
  }

  // ── Transient path (legacy chat ActionCard) ───────────────────────────────────
  // No DB row, so account comes from request envelope only.
  // Connection still resolved via getConnectionForAccount.
  if (platform && actionType) {
    const channelPlatform = normalizePlatform(platform);
    if (!['google', 'meta'].includes(channelPlatform)) {
      return res.status(400).json({ success: false, error: `Unsupported platform: ${platform}` });
    }
    const connectionPlatform = channelPlatform === 'google' ? 'google_ads' : 'meta_ads';

    const connection = await getConnectionForAccount(account.id, connectionPlatform);
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

    const { httpStatus, body } = await executeTransient(
      { platform, actionType, campaignId },
      { account, connection },
    );
    return res.status(httpStatus).json(body);
  }

  return res.status(400).json({
    success: false,
    error:   'Provide either actionId (DB-backed) or platform+actionType (transient)',
  });
}
