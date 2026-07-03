// ============================================================
// api/lib/daily-stats.js — nightly campaign_daily_stats ingestion (Google Ads)
//
// SESSION-03: this module is the SOLE writer of true daily-grain rows to
// campaign_daily_stats. It is called by api/cron-daily-stats.js.
//
// api/analyze-ads.js also writes to campaign_daily_stats via
// api/lib/campaign-stats.js#writeCampaignDailyStats, but that path is
// INERT for two reasons: (1) it upserts on a stale onConflict key
// ('platform,campaign_id,date') that no longer matches the real unique
// index created by sql/008
// (campaign_daily_stats_account_platform_campaign_date_uidx — which
// includes account_id), so every write there silently fails to satisfy
// the constraint's actual shape; and (2) the data it writes is shaped
// from analyze-ads' last-30-days aggregate fetch, not a true per-day
// grain. That path is slated for removal in a future session — do not
// "fix" it here (out of scope; campaign-stats.js is not in this
// session's file allowlist).
//
// OAuth: the refresh-token → access-token exchange and the v23
// googleAds:search call below are DELIBERATELY duplicated from
// api/google-ads.js#fetchGoogleAdsData rather than imported. google-ads.js
// is a money-path file outside this session's scope, so the pattern is
// copied instead of shared. A future consolidation target is
// api/lib/google-auth.js, which would extract the shared OAuth exchange
// for both modules to call.
// ============================================================

import supabase from './supabase.js';
import { recordApiCall } from './api-cost.js';

/**
 * Compute the [startDate, endDate] window for the nightly pull: the last
 * 3 COMPLETE days (today is never included — it's still in progress).
 * Re-upserting 3 days every night restates any late-arriving conversions
 * Google attributes to the prior couple of days.
 *
 * @param {Date} now — defaults to `new Date()`; pass explicitly in tests.
 * @returns {{ startDate: string, endDate: string }} YYYY-MM-DD UTC strings
 */
export function computeDateRange(now = new Date()) {
  const toUtcDateString = (d) => d.toISOString().slice(0, 10);

  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 3);

  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() - 1);

  return {
    startDate: toUtcDateString(start),
    endDate:   toUtcDateString(end),
  };
}

/**
 * Fetch per-campaign, per-day Google Ads metrics for the given account and
 * date window.
 *
 * Unlike fetchGoogleAdsData (api/google-ads.js), which returns
 * { success: false, ... } error objects, this function THROWS on any
 * failure (OAuth failure, non-ok API response, or JSON parse failure).
 * The cron's per-account try/catch (api/cron-daily-stats.js) is the
 * error boundary — one account's failure must not stop the others.
 *
 * @param {{id: string, slug: string}} account
 * @param {object} connection — ad_platform_connections row w/ resolved_* fields
 * @param {{startDate: string, endDate: string}} range
 * @returns {Promise<Array>} raw `results` array from the googleAds:search response
 */
export async function fetchGoogleDailyStats(account, connection, { startDate, endDate }) {
  // Step 1: exchange the refresh token for an access token.
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
    throw new Error(`Failed to get access token from Google OAuth: ${JSON.stringify(tokenJson)}`);
  }

  const access_token = tokenJson.access_token;
  const customerId   = connection.resolved_account_id_external.replace(/-/g, '');
  const managerId    = connection.resolved_manager_account_id
    ? connection.resolved_manager_account_id.replace(/-/g, '')
    : undefined;

  // Step 2: per-campaign per-day metrics for the window. segments.date is
  // in the SELECT list, so the API returns one row per campaign per date
  // (no LIMIT — we want every campaign).
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      segments.date,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'
  `;

  const apiUrl = `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`;

  const adsResponse = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization':     `Bearer ${access_token}`,
      'developer-token':   process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      'login-customer-id': managerId,
      'Content-Type':      'application/json',
    },
    body: JSON.stringify({ query }),
  });

  const rawText = await adsResponse.text();
  if (!adsResponse.ok) {
    throw new Error(`Google Ads API error: ${adsResponse.status} — ${rawText.substring(0, 300)}`);
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    throw new Error(`Failed to parse Google Ads response: ${rawText.substring(0, 300)}`);
  }

  // Cost ledger — fire-and-forget.
  await recordApiCall('google_ads', 'daily_stats_search', account.id);

  return data.results || [];
}

function round(n, decimals) {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/**
 * Map raw googleAds:search results (camelCase) to campaign_daily_stats rows.
 * Pure function — no I/O.
 *
 * @param {Array} results — raw results from fetchGoogleDailyStats
 * @param {{id: string, slug: string}} account
 * @returns {Array} rows shaped for campaign_daily_stats, filtered to valid rows
 */
export function mapRowsToDailyStats(results, account) {
  return (results || [])
    .map((result) => {
      const campaignId = String(result.campaign?.id || '');
      const date        = result.segments?.date;
      const metrics     = result.metrics || {};

      const spend       = round((metrics.costMicros || 0) / 1e6, 2);
      const conversions = parseFloat(metrics.conversions || 0);

      return {
        account_id:    account.id,
        client_key:    account.slug,
        platform:      'google_ads',
        campaign_id:   campaignId,
        campaign_name: result.campaign?.name || null,
        date,
        spend,
        impressions:   parseInt(metrics.impressions || 0),
        clicks:        parseInt(metrics.clicks || 0),
        conversions,
        ctr:           round((metrics.ctr || 0) * 100, 4),
        cpc:           round((metrics.averageCpc || 0) / 1e6, 2),
        cpl:           conversions > 0 ? round(spend / conversions, 2) : null,
        frequency:     null, // Meta-only metric
        raw_payload:   result,
      };
    })
    .filter((row) => row.campaign_id !== '' && !!row.date);
}

/**
 * Upsert campaign_daily_stats rows on the REAL unique index created by
 * sql/008 (account_id, platform, campaign_id, date) —
 * campaign_daily_stats_account_platform_campaign_date_uidx.
 *
 * @param {Array} rows — output of mapRowsToDailyStats
 * @returns {Promise<{ written: number, errors: string[] }>}
 */
export async function upsertDailyStats(rows) {
  if (!rows || rows.length === 0) {
    return { written: 0, errors: [] };
  }

  const { error } = await supabase
    .from('campaign_daily_stats')
    .upsert(rows, {
      onConflict:       'account_id,platform,campaign_id,date',
      ignoreDuplicates: false,
    });

  if (error) {
    return { written: 0, errors: [error.message] };
  }

  return { written: rows.length, errors: [] };
}
