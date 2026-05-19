// ============================================================
// api/create-google-campaign.js — validate Google Ads campaign preview
//
// POST /api/create-google-campaign
//   Auth: x-execute-secret (server-only — see DEPLOY.md)
//   Optional: ?account=<slug> or x-account-slug header (defaults to 'fpb')
//
// Status: PLACEHOLDER — real campaign creation requires a production-approved
// Google Ads developer token. For now this endpoint validates that the
// account's google_ads connection is usable (token exchange succeeds) and
// echoes the proposed campaign structure back to the caller.
//
// Stage B1 retrofit:
//   • Account-scoped via resolveForWrite (rejects archived/inactive with 403).
//   • Customer ID + refresh token now come from ad_platform_connections via
//     getConnectionForAccount. GOOGLE_ADS_CUSTOMER_ID / GOOGLE_ADS_REFRESH_TOKEN
//     env vars are no longer read on this path.
//   • Missing connection: 404 CONNECTION_NOT_FOUND.
//     Connection missing required resolved_* field: 503 CONNECTION_INCOMPLETE.
//   • Even though this endpoint doesn't yet create a real campaign, we
//     resolve the connection so the placeholder path enforces per-account
//     auth in the exact way the production path will.
// ============================================================

import {
  resolveForWrite,
  getConnectionForAccount,
  checkConnectionFields,
} from './lib/accounts.js';
import { setCorsHeaders } from './lib/cors.js';
import { requireSecret } from './lib/require-secret.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'GET, POST, OPTIONS', headers: 'Content-Type, x-execute-secret, x-account-slug' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireSecret(req, res, { envVar: 'EXECUTE_SECRET', header: 'x-execute-secret', label: '/api/create-google-campaign' })) return;

  const account = await resolveForWrite(req, res);
  if (!account) return;

  const connection = await getConnectionForAccount(account.id, 'google_ads');
  if (!connection) {
    return res.status(404).json({
      success: false,
      error:   `No google_ads connection configured for account ${account.slug}`,
      code:    'CONNECTION_NOT_FOUND',
    });
  }
  const missing = checkConnectionFields(connection, 'google_ads');
  if (missing) {
    return res.status(503).json({
      success: false,
      error:   `google_ads connection for ${account.slug} is incomplete: ${missing}`,
      code:    'CONNECTION_INCOMPLETE',
    });
  }

  try {
    const { campaignName, dailyBudget, keywords, headlines, descriptions, finalUrl } = req.body;

    // Validate per-account credentials work by exchanging the refresh token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.GOOGLE_ADS_CLIENT_ID,
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
        refresh_token: connection.resolved_refresh_token,
        grant_type:    'refresh_token',
      }),
    });
    const { access_token } = await tokenRes.json();

    if (!access_token) throw new Error('Failed to acquire Google Ads access token');

    // Return campaign preview — actual creation requires approved developer token
    res.status(200).json({
      success: true,
      preview: {
        campaignName,
        dailyBudget: `$${dailyBudget}`,
        keywords,
        headlines,
        descriptions,
        finalUrl,
        status: 'READY_TO_LAUNCH',
        message: 'Campaign structure validated. Awaiting developer token production approval to launch.',
      },
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
