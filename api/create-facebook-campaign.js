// ============================================================
// api/create-facebook-campaign.js — create a paused campaign + ad set
//
// POST /api/create-facebook-campaign
//   Auth: x-execute-secret (server-only — see DEPLOY.md)
//   Optional: ?account=<slug> or x-account-slug header (defaults to 'fpb')
//
// Stage B1 retrofit:
//   • Account-scoped via resolveForWrite (rejects archived/inactive with 403).
//   • Access token + ad account ID now come from ad_platform_connections
//     via getConnectionForAccount. META_ACCESS_TOKEN / META_AD_ACCOUNT_ID
//     env vars are no longer read on this path.
//   • Missing connection: 404 CONNECTION_NOT_FOUND.
//     Connection missing required resolved_* field: 503 CONNECTION_INCOMPLETE.
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
  if (!requireSecret(req, res, { envVar: 'EXECUTE_SECRET', header: 'x-execute-secret', label: '/api/create-facebook-campaign' })) return;

  const account = await resolveForWrite(req, res);
  if (!account) return;

  const connection = await getConnectionForAccount(account.id, 'meta_ads');
  if (!connection) {
    return res.status(404).json({
      success: false,
      error:   `No meta_ads connection configured for account ${account.slug}`,
      code:    'CONNECTION_NOT_FOUND',
    });
  }
  const missing = checkConnectionFields(connection, 'meta_ads');
  if (missing) {
    return res.status(503).json({
      success: false,
      error:   `meta_ads connection for ${account.slug} is incomplete: ${missing}`,
      code:    'CONNECTION_INCOMPLETE',
    });
  }

  try {
    const { campaignName, objective, dailyBudget, adSetName, targeting } = req.body;
    const accessToken  = connection.resolved_access_token;
    const rawAccountId = connection.resolved_account_id_external;
    // Defensive prefix handling — connection value may or may not include 'act_'
    const adAccountId  = rawAccountId.startsWith('act_') ? rawAccountId.slice(4) : rawAccountId;
    const apiVersion   = 'v19.0';
    const baseUrl      = `https://graph.facebook.com/${apiVersion}`;

    // Step 1: Create Campaign
    const campaignRes = await fetch(`${baseUrl}/act_${adAccountId}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: campaignName,
        objective: objective || 'LEAD_GENERATION',
        status: 'PAUSED',
        special_ad_categories: [],
        access_token: accessToken,
      }),
    });
    const campaignData = await campaignRes.json();
    if (campaignData.error) throw new Error(campaignData.error.message);

    // Step 2: Create Ad Set
    const adSetRes = await fetch(`${baseUrl}/act_${adAccountId}/adsets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: adSetName || `${campaignName} - Ad Set`,
        campaign_id: campaignData.id,
        daily_budget: Math.round(dailyBudget * 100),
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'LEAD_GENERATION',
        targeting: targeting || {
          geo_locations: { countries: ['US'] },
          age_min: 25,
          age_max: 65,
        },
        status: 'PAUSED',
        access_token: accessToken,
      }),
    });
    const adSetData = await adSetRes.json();
    if (adSetData.error) throw new Error(adSetData.error.message);

    res.status(200).json({
      success: true,
      campaignId: campaignData.id,
      adSetId: adSetData.id,
      status: 'PAUSED',
      message: 'Campaign and Ad Set created successfully in PAUSED state. Review in Facebook Ads Manager before activating.',
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
