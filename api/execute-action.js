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

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-execute-secret, x-account-slug',
};

function cors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

function requireExecuteSecret(req, res) {
  const secret = process.env.EXECUTE_SECRET;
  if (!secret) {
    console.warn('[SECURITY] EXECUTE_SECRET not set — execute-action endpoint is unprotected');
    return true;
  }
  if (req.headers['x-execute-secret'] !== secret) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!requireExecuteSecret(req, res)) return;

  const account = await resolveForWrite(req, res);
  if (!account) return;

  const { actionId, platform, actionType, campaignId } = req.body || {};

  // ── DB-backed path ────────────────────────────────────────────────────────────
  if (actionId) {
    // Fetch action; verify ownership BEFORE delegating
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

    if (!canExecute(action)) {
      const detail = action.execution_result
        ? `Action already executed (execution_result: ${action.execution_result})`
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
