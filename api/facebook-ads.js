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

    // Fetch active campaigns
    const campaignsUrl = `${baseUrl}/act_${adAccountId}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget&effective_status=["ACTIVE","PAUSED"]&access_token=${accessToken}`;
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
      campaigns: campaignsData.data || [],
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
