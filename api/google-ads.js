// ============================================================
// api/google-ads.js — read-only Google Ads campaign data
//
// GET /api/google-ads
//   Optional: ?account=<slug> or x-account-slug header (defaults to 'fpb')
//
// Stage B1 retrofit:
//   • Customer ID, manager ID, and refresh token now come from
//     ad_platform_connections via getConnectionForAccount.
//   • Hardcoded '8325311811' / '5435219372' fallbacks removed.
//   • Reads are allowed for archived/inactive accounts (per policy).
//   • Missing connection: 404 CONNECTION_NOT_FOUND.
//   • Connection missing required resolved_* field: 503 CONNECTION_INCOMPLETE.
//   • OAuth client_id / client_secret / developer_token remain global env
//     (shared developer credentials, not per-account).
// ============================================================

import {
  resolveForRead,
  getConnectionForAccount,
  checkConnectionFields,
} from './lib/accounts.js';
import { setCorsHeaders } from './lib/cors.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'GET, POST, OPTIONS', headers: 'Content-Type, x-account-slug' });
  if (req.method === 'OPTIONS') return res.status(200).end();

  const account = await resolveForRead(req, res);
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
    // Step 1: Get fresh access token using the connection's refresh token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.GOOGLE_ADS_CLIENT_ID,
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
        refresh_token: connection.resolved_refresh_token,
        grant_type:    'refresh_token',
      }),
    });
    const tokenJson = await tokenResponse.json();

    if (!tokenJson.access_token) {
      return res.status(200).json({
        success: false,
        error: 'Failed to get access token from Google OAuth',
        detail: JSON.stringify(tokenJson),
        summary: { totalSpend: 0, totalClicks: 0, totalImpressions: 0, totalConversions: 0, roas: 0, cpl: 0, ctr: 0 },
        campaigns: [],
      });
    }

    const access_token = tokenJson.access_token;
    const customerId   = connection.resolved_account_id_external.replace(/-/g, '');
    const managerId    = connection.resolved_manager_account_id
      ? connection.resolved_manager_account_id.replace(/-/g, '')
      : undefined;

    // Step 2: Query campaign performance for last 30 days
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions_from_interactions_rate
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 10
    `;

    const apiUrl = `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`;

    const adsResponse = await fetch(
      apiUrl,
      {
        method: 'POST',
        headers: {
          'Authorization':     `Bearer ${access_token}`,
          'developer-token':   process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
          'login-customer-id': managerId,
          'Content-Type':      'application/json',
        },
        body: JSON.stringify({ query }),
      }
    );

    const rawText = await adsResponse.text();
    if (!adsResponse.ok) {
      return res.status(200).json({
        success: false,
        error: `Google Ads API error: ${adsResponse.status}`,
        detail: rawText.substring(0, 500),
        summary: { totalSpend: 0, totalClicks: 0, totalImpressions: 0, totalConversions: 0, roas: 0, cpl: 0, ctr: 0 },
        campaigns: [],
      });
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch(e) {
      return res.status(200).json({
        success: false,
        error: 'Failed to parse Google Ads response',
        detail: rawText.substring(0, 300),
        summary: { totalSpend: 0, totalClicks: 0, totalImpressions: 0, totalConversions: 0, roas: 0, cpl: 0, ctr: 0 },
        campaigns: [],
      });
    }

    // :search returns { results: [...] } not an array of batches
    const results = data.results || [];

    let totalSpend = 0, totalClicks = 0, totalImpressions = 0, totalConversions = 0;
    const campaigns = [];

    for (const result of results) {
      const spend = (result.metrics?.costMicros || 0) / 1000000;
      totalSpend += spend;
      totalClicks += parseInt(result.metrics?.clicks || 0);
      totalImpressions += parseInt(result.metrics?.impressions || 0);
      totalConversions += parseFloat(result.metrics?.conversions || 0);
      campaigns.push({
        id: result.campaign?.id,
        name: result.campaign?.name,
        status: result.campaign?.status,
        spend: spend.toFixed(2),
        clicks: parseInt(result.metrics?.clicks || 0),
        impressions: parseInt(result.metrics?.impressions || 0),
        conversions: parseFloat(result.metrics?.conversions || 0).toFixed(1),
        ctr: ((parseFloat(result.metrics?.ctr || 0)) * 100).toFixed(2),
        avgCpc: ((result.metrics?.averageCpc || 0) / 1000000).toFixed(2),
      });
    }

    const roas = totalSpend > 0 ? (totalConversions * 150 / totalSpend).toFixed(2) : '0.00';
    const cpl = totalConversions > 0 ? (totalSpend / totalConversions).toFixed(2) : '0.00';

    return res.status(200).json({
      success: true,
      summary: {
        totalSpend: totalSpend.toFixed(2),
        totalClicks,
        totalImpressions,
        totalConversions: totalConversions.toFixed(1),
        roas,
        cpl,
        ctr: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0.00',
      },
      campaigns,
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
