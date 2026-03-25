export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const adAccountId = process.env.META_AD_ACCOUNT_ID;
    const apiVersion = 'v19.0';
    const baseUrl = `https://graph.facebook.com/${apiVersion}`;

    // Fetch account-level insights for last 30 days
    const insightsUrl = `${baseUrl}/act_${adAccountId}/insights?fields=spend,clicks,impressions,actions,action_values,ctr,cpc,cpp,reach&date_preset=last_30d&access_token=${accessToken}`;
    const insightsRes = await fetch(insightsUrl);
    const insightsData = await insightsRes.json();
    const insights = insightsData.data?.[0] || {};

    // Fetch active campaigns with per-campaign insights
    const campaignsUrl = `${baseUrl}/act_${adAccountId}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,insights.date_preset(last_30d){spend,clicks,actions,impressions}&effective_status=["ACTIVE","PAUSED","DELETED","ARCHIVED"]&access_token=${accessToken}&limit=25`;
    const campaignsRes = await fetch(campaignsUrl);
    const campaignsData = await campaignsRes.json();

    // Parse conversions from actions
    const actions = insights.actions || [];
    const conversions = actions
      .filter(a => ['lead', 'purchase', 'complete_registration'].includes(a.action_type))
      .reduce((sum, a) => sum + parseFloat(a.value || 0), 0);

    const spend = parseFloat(insights.spend || 0);
    const roas = spend > 0 ? (conversions * 150 / spend).toFixed(2) : 0;
    const cpl = conversions > 0 ? (spend / conversions).toFixed(2) : 0;

    const campaigns = (campaignsData.data || []).map(campaign => {
      const cInsights = campaign.insights?.data?.[0] || {};
      const cActions = cInsights.actions || [];
      const cConversions = cActions
        .filter(a => ['lead', 'purchase', 'complete_registration'].includes(a.action_type))
        .reduce((sum, a) => sum + parseFloat(a.value || 0), 0);
      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        objective: campaign.objective,
        spend: parseFloat(cInsights.spend || 0).toFixed(2),
        clicks: cInsights.clicks || 0,
        impressions: cInsights.impressions || 0,
        conversions: Math.round(cConversions),
        dailyBudget: campaign.daily_budget ? (campaign.daily_budget / 100).toFixed(2) : null,
        lifetimeBudget: campaign.lifetime_budget ? (campaign.lifetime_budget / 100).toFixed(2) : null,
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
        roas,
        cpl,
        ctr: parseFloat(insights.ctr || 0).toFixed(2),
        cpc: parseFloat(insights.cpc || 0).toFixed(2),
      },
      campaigns,
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
