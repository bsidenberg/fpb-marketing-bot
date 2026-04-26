// ============================================================
// execute-action.js — internal/programmatic execution endpoint
//
// POST /api/execute-action
//   Requires: x-execute-secret header
//   Body (DB-backed):   { actionId }
//   Body (transient):   { platform, actionType, campaignId }
//
// DB-backed path:   used by scheduled jobs or server-to-server calls.
//                   Full idempotency + audit logging via acquireLockAndExecute.
//
// Transient path:   legacy path for chat ActionCard direct execution
//                   (no DB row, no idempotency guarantee — use sparingly).
//
// For browser approval flows use /api/approve-action instead.
// ============================================================

import { acquireLockAndExecute, executeTransient } from './lib/execute-action-logic.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-execute-secret',
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

  const { actionId, platform, actionType, campaignId } = req.body || {};

  // ── DB-backed path ────────────────────────────────────────────────────────────
  if (actionId) {
    const { httpStatus, body } = await acquireLockAndExecute(actionId);
    return res.status(httpStatus).json(body);
  }

  // ── Transient path (legacy chat ActionCard) ───────────────────────────────────
  if (platform && actionType) {
    const { httpStatus, body } = await executeTransient({ platform, actionType, campaignId });
    return res.status(httpStatus).json(body);
  }

  return res.status(400).json({
    success: false,
    error:   'Provide either actionId (DB-backed) or platform+actionType (transient)',
  });
}
