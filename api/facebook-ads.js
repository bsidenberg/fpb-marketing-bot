// ============================================================
// api/facebook-ads.js — read-only Meta Ads campaign data
//
// GET /api/facebook-ads
//   Optional: ?account=<slug> or x-account-slug header (defaults to 'fpb')
//
// Stage B1 retrofit:
//   • Access token + ad account ID now come from ad_platform_connections
//     via getConnectionForAccount.
//   • Reads allowed for archived/inactive accounts (per policy).
//   • Missing connection: 404 CONNECTION_NOT_FOUND.
//   • Connection missing required resolved_* field: 503 CONNECTION_INCOMPLETE.
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
    const accessToken = connection.resolved_access_token;
    // Defensive prefix handling — env var may or may not include 'act_'
    const rawAccountId = connection.resolved_account_id_external;
    const adAccountId  = rawAccountId.startsWith('act_') ? rawAccountId.slice(4) : rawAccountId;
    const apiVersion   = 'v19.0';
    const baseUrl      = `https://graph.facebook.com/${apiVersion}`;

    // Fetch account-level insights for last 30 days
    const insightsUrl = `${baseUrl}/act_${adAccountId}/insights?fields=spend,clicks,impressions,actions,action_values,ctr,cpc,cpp,reach,frequency&date_preset=last_30d&access_token=${accessToken}`;
    const insightsRes = await fetch(insightsUrl);
    const insightsData = await insightsRes.json();
    const insights = insightsData.data?.[0] || {};

    // Fetch active campaigns with per-campaign insights
    const campaignsUrl = `${baseUrl}/act_${adAccountId}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,insights.date_preset(last_30d){spend,clicks,actions,impressions,frequency}&effective_status=["ACTIVE","PAUSED"]&access_token=${accessToken}&limit=25`;
    const campaignsRes = await fetch(campaignsUrl);
    const campaignsData = await campaignsRes.json();

    const CONVERSION_TYPES = [
      'lead',
      'purchase',
      'complete_registration',
      'submit_application',
      'contact',
      'find_location',
      'schedule',
      'start_trial',
      'subscribe',
      'offsite_conversion.fb_pixel_lead',
      'offsite_conversion.fb_pixel_purchase',
      'onsite_conversion.lead_grouped',
    ];

    // Parse conversions from actions
    const actions = insights.actions || [];
    const conversions = actions
      .filter(a => CONVERSION_TYPES.includes(a.action_type))
      .reduce((sum, a) => sum + parseFloat(a.value || 0), 0);

    const spend = parseFloat(insights.spend || 0);
    const cpl = conversions > 0 ? (spend / conversions).toFixed(2) : null;

    const rawCampaigns = campaignsData.data || [];

    const campaigns = rawCampaigns.map(campaign => {
      // insights can be nested as campaign.insights.data[0] or campaign.insights
      const insightData = campaign.insights?.data?.[0] || campaign.insights || {};
      const actions = insightData.actions || [];

      const conversions = actions
        .filter(a => [
          'lead',
          'purchase',
          'complete_registration',
          'contact',
          'schedule',
          'offsite_conversion.fb_pixel_lead',
          'offsite_conversion.fb_pixel_purchase',
          'onsite_conversion.lead_grouped',
        ].includes(a.action_type))
        .reduce((sum, a) => sum + parseFloat(a.value || 0), 0);

      const campaignSpend = parseFloat(insightData.spend || 0);
      const campaignCpl = conversions > 0 ? (campaignSpend / conversions).toFixed(2) : null;

      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        objective: campaign.objective || '',
        spend: campaignSpend.toFixed(2),
        clicks: parseInt(insightData.clicks || 0),
        impressions: parseInt(insightData.impressions || 0),
        conversions: Math.round(conversions),
        cpl: campaignCpl,
        frequency: parseFloat(insightData.frequency || 0),
        dailyBudget: campaign.daily_budget
          ? (parseInt(campaign.daily_budget) / 100).toFixed(2)
          : null,
      };
    });

    res.status(200).json({
      success: true,
      summary: {
        totalSpend: spend.toFixed(2),
        totalClicks: insights.clicks || 0,
        totalImpressions: insights.impressions || 0,
        totalReach: insights.reach || 0,
        totalConversions: Math.round(conversions),
        cpl,
        ctr: parseFloat(insights.ctr || 0).toFixed(2),
        cpc: parseFloat(insights.cpc || 0).toFixed(2),
        frequency: parseFloat(insights.frequency || 0).toFixed(2),
      },
      campaigns,
      actions: actions.map(a => ({ type: a.action_type, value: a.value })),
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
