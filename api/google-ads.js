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
//
// Admin auth sprint:
//   • requireAdmin gate added (after OPTIONS, before account resolution).
//   • fetchGoogleAdsData extracted as a named export so api/analyze-ads.js
//     and api/chat.js can call it directly without an internal HTTP round-trip
//     (which would hit the new requireAdmin gate with no cookie).
// ============================================================

import {
  resolveForRead,
  getConnectionForAccount,
  checkConnectionFields,
} from './lib/accounts.js';
import { setCorsHeaders } from './lib/cors.js';
import { recordApiCall } from './lib/api-cost.js';
import { requireAdmin } from './lib/require-admin.js';

/**
 * Get a fresh OAuth access token using the connection's refresh token.
 * Extracted from fetchGoogleAdsData (same behavior, no logic change) so
 * fetchSearchTerms can share it.
 *
 * @param {object} connection — ad_platform_connections row (resolved_*)
 * @returns {Promise<{ access_token: string } | { error: true, tokenJson: object }>}
 */
async function getAccessToken(connection) {
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
    return { error: true, tokenJson };
  }

  return { access_token: tokenJson.access_token };
}

/**
 * Fetch Google Ads campaign performance data for the given account.
 * Pure code motion from the HTTP handler — no logic changes.
 *
 * @param {object} account    — account row with at least .id and .slug
 * @param {object} connection — ad_platform_connections row (resolved_*)
 * @returns {Promise<object>} — same shape as the HTTP 200 response body
 */
export async function fetchGoogleAdsData(account, connection) {
  // Step 1: Get fresh access token using the connection's refresh token
  const tokenResult = await getAccessToken(connection);

  if (tokenResult.error) {
    return {
      success: false,
      error: 'Failed to get access token from Google OAuth',
      detail: JSON.stringify(tokenResult.tokenJson),
      summary: { totalSpend: 0, totalClicks: 0, totalImpressions: 0, totalConversions: 0, roas: 0, cpl: 0, ctr: 0 },
      campaigns: [],
    };
  }

  const access_token = tokenResult.access_token;
  const customerId   = connection.resolved_account_id_external.replace(/-/g, '');
  const managerId    = connection.resolved_manager_account_id
    ? connection.resolved_manager_account_id.replace(/-/g, '')
    : undefined;

  // Step 2: Query campaign performance for last 30 days
  // campaign.campaign_budget exposes the budget resource name so the dashboard
  // can display budget_id — Prime can then include it in ACTION blocks, allowing
  // executeGoogleAdjustBudget to skip the extra GET-campaign lookup.
  // campaign_budget.amount_micros gives the current daily budget amount so
  // verifyAndEnrichAction can inject daily_budget into verified action payloads.
  // S07a: LIMIT raised 10 -> 100 (top-N truncation hid campaigns from chat);
  // 100 bounds prompt size for pathological accounts, not this one.
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.campaign_budget,
      campaign_budget.amount_micros,
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
    LIMIT 100
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
    return {
      success: false,
      error: `Google Ads API error: ${adsResponse.status}`,
      detail: rawText.substring(0, 500),
      summary: { totalSpend: 0, totalClicks: 0, totalImpressions: 0, totalConversions: 0, roas: 0, cpl: 0, ctr: 0 },
      campaigns: [],
    };
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch(e) {
    return {
      success: false,
      error: 'Failed to parse Google Ads response',
      detail: rawText.substring(0, 300),
      summary: { totalSpend: 0, totalClicks: 0, totalImpressions: 0, totalConversions: 0, roas: 0, cpl: 0, ctr: 0 },
      campaigns: [],
    };
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
    // campaign_budget resource name: "customers/X/campaignBudgets/Y" — extract Y
    const budgetResource = result.campaign?.campaignBudget;
    const budget_id = budgetResource ? budgetResource.split('/').pop() : null;
    const daily_budget = ((result.campaignBudget?.amountMicros || 0) / 1_000_000).toFixed(2);
    campaigns.push({
      id: result.campaign?.id,
      budget_id,
      daily_budget,
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

  // ── S07a: roster query — every non-removed campaign, no date segment ──────
  // The metrics query above is date-segmented (LAST_30_DAYS) and the API drops
  // zero-impression rows from segmented results: an ENABLED campaign with no
  // recent traffic would be invisible to chat while the budget guard counts
  // its budget toward the account cap. This metrics-free second query
  // guarantees the full campaign set; campaigns absent from the metrics
  // results are appended with zeroed metrics. Both queries must succeed —
  // partial data would recreate the chat-vs-guard disagreement this exists
  // to close.
  const rosterQuery = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.campaign_budget,
      campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.status != 'REMOVED'
  `;

  const rosterResponse = await fetch(
    apiUrl,
    {
      method: 'POST',
      headers: {
        'Authorization':     `Bearer ${access_token}`,
        'developer-token':   process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        'login-customer-id': managerId,
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({ query: rosterQuery }),
    }
  );

  const rosterText = await rosterResponse.text();
  if (!rosterResponse.ok) {
    return {
      success: false,
      error: `Google Ads API error (campaign roster): ${rosterResponse.status}`,
      detail: rosterText.substring(0, 500),
      summary: { totalSpend: 0, totalClicks: 0, totalImpressions: 0, totalConversions: 0, roas: 0, cpl: 0, ctr: 0 },
      campaigns: [],
    };
  }

  let rosterData;
  try {
    rosterData = JSON.parse(rosterText);
  } catch(e) {
    return {
      success: false,
      error: 'Failed to parse Google Ads campaign roster response',
      detail: rosterText.substring(0, 300),
      summary: { totalSpend: 0, totalClicks: 0, totalImpressions: 0, totalConversions: 0, roas: 0, cpl: 0, ctr: 0 },
      campaigns: [],
    };
  }

  const seenIds = new Set(campaigns.map((c) => String(c.id)));
  for (const row of rosterData.results || []) {
    const id = row.campaign?.id;
    if (id == null || seenIds.has(String(id))) continue;
    if (row.campaign?.status === 'REMOVED') continue; // defensive — query already filters
    const rosterBudgetResource = row.campaign?.campaignBudget;
    campaigns.push({
      id,
      budget_id: rosterBudgetResource ? rosterBudgetResource.split('/').pop() : null,
      daily_budget: ((row.campaignBudget?.amountMicros || 0) / 1_000_000).toFixed(2),
      name: row.campaign?.name,
      status: row.campaign?.status,
      spend: '0.00',
      clicks: 0,
      impressions: 0,
      conversions: '0.0',
      ctr: '0.00',
      avgCpc: '0.00',
    });
    seenIds.add(String(id));
  }

  const roas = totalSpend > 0 ? (totalConversions * 150 / totalSpend).toFixed(2) : '0.00';
  const cpl = totalConversions > 0 ? (totalSpend / totalConversions).toFixed(2) : '0.00';

  // Consistency invariant (S07a): same status semantics as the budget guard's
  // cap sum — ENABLED campaigns only. Chat quotes the same account total the
  // guard computes; PAUSED campaigns stay visible in the list but never count.
  const totalDailyBudget = campaigns
    .filter((c) => c.status === 'ENABLED')
    .reduce((sum, c) => sum + (parseFloat(c.daily_budget) || 0), 0);

  // Cost ledger — fire-and-forget
  await recordApiCall('google_ads', 'campaigns_search', account.id);
  await recordApiCall('google_ads', 'campaigns_roster', account.id);

  return {
    success: true,
    summary: {
      totalSpend: totalSpend.toFixed(2),
      totalClicks,
      totalImpressions,
      totalConversions: totalConversions.toFixed(1),
      totalDailyBudget: totalDailyBudget.toFixed(2),
      roas,
      cpl,
      ctr: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0.00',
    },
    campaigns,
  };
}

/**
 * Fetch Google Ads search-term-view data for waste analysis (negative
 * keyword recommendations). Same conventions as fetchGoogleAdsData:
 * token fetch via getAccessToken, customerId/managerId derived from
 * connection.resolved_* fields, error shape on failure, cost-ledger call.
 *
 * @param {object} account    — account row with at least .id and .slug
 * @param {object} connection — ad_platform_connections row (resolved_*)
 * @param {object} [options]
 * @param {string} [options.campaignId] — restrict to a single campaign
 * @param {number} [options.days=30]    — lookback window in days
 * @returns {Promise<object>}
 */
export async function fetchSearchTerms(account, connection, { campaignId, days = 30 } = {}) {
  // Step 1: Get fresh access token using the connection's refresh token
  const tokenResult = await getAccessToken(connection);

  if (tokenResult.error) {
    return {
      success: false,
      error: 'Failed to get access token from Google OAuth',
      detail: JSON.stringify(tokenResult.tokenJson),
      searchTerms: [],
    };
  }

  const access_token = tokenResult.access_token;
  const customerId   = connection.resolved_account_id_external.replace(/-/g, '');
  const managerId    = connection.resolved_manager_account_id
    ? connection.resolved_manager_account_id.replace(/-/g, '')
    : undefined;

  // Step 2: Compute explicit date range (segments.date BETWEEN, not DURING
  // LAST_30_DAYS) so arbitrary `days` values work.
  const fmt = (d) => d.toISOString().slice(0, 10);
  const endDateObj = new Date();
  const startDateObj = new Date(endDateObj);
  startDateObj.setUTCDate(startDateObj.getUTCDate() - days);
  const endDate = fmt(endDateObj);
  const startDate = fmt(startDateObj);

  // campaignId is interpolated directly into the GAQL string (no parameterized
  // query support) — reject anything that isn't digits-only before it ever
  // reaches the query, same defensive posture as the campaign_id format check
  // in executeGoogleAddNegativeKeyword.
  if (campaignId != null && !/^\d+$/.test(String(campaignId))) {
    return {
      success: false,
      error: 'Invalid campaignId — must be digits only',
      detail: String(campaignId).substring(0, 100),
      searchTerms: [],
    };
  }

  const query = `
    SELECT
      search_term_view.search_term,
      campaign.id,
      campaign.name,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions
    FROM search_term_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      ${campaignId ? `AND campaign.id = ${campaignId}` : ''}
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `;

  const apiUrl = `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`;

  const response = await fetch(
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

  const rawText = await response.text();
  if (!response.ok) {
    return {
      success: false,
      error: `Google Ads API error: ${response.status}`,
      detail: rawText.substring(0, 500),
      searchTerms: [],
    };
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    return {
      success: false,
      error: 'Failed to parse Google Ads response',
      detail: rawText.substring(0, 300),
      searchTerms: [],
    };
  }

  const results = data.results || [];

  const searchTerms = results.map((result) => ({
    searchTerm:  result.searchTermView?.searchTerm,
    campaignId:  result.campaign?.id,
    campaignName: result.campaign?.name,
    clicks:      parseInt(result.metrics?.clicks || 0),
    cost:        parseFloat((((result.metrics?.costMicros || 0) / 1_000_000)).toFixed(2)),
    conversions: parseFloat(result.metrics?.conversions || 0),
  }));

  const wasteRows = searchTerms
    .filter((row) => row.conversions === 0 && row.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  const totalWastedSpend = wasteRows.reduce((sum, row) => sum + row.cost, 0).toFixed(2);
  const wasteSummary = {
    totalWastedSpend,
    topWaste: wasteRows.slice(0, 20),
  };

  // Cost ledger — fire-and-forget
  await recordApiCall('google_ads', 'search_terms', account.id);

  return {
    success: true,
    searchTerms,
    wasteSummary,
  };
}

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'GET, POST, OPTIONS', headers: 'Content-Type, x-account-slug' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAdmin(req, res)) return;

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
    const result = await fetchGoogleAdsData(account, connection);
    return res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
