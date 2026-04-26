function requireExecuteSecret(req, res) {
  const secret = process.env.EXECUTE_SECRET;
  if (!secret) {
    console.warn('[SECURITY] EXECUTE_SECRET not set — mutation endpoint is unprotected');
    return true;
  }
  if (req.headers['x-execute-secret'] !== secret) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireExecuteSecret(req, res)) return;

  try {
    const { campaignName, objective, dailyBudget, adSetName, targeting, adName, adCopy, imageUrl, linkUrl } = req.body;
    const accessToken = process.env.META_ACCESS_TOKEN;
    const adAccountId = process.env.META_AD_ACCOUNT_ID;
    const apiVersion = 'v19.0';
    const baseUrl = `https://graph.facebook.com/${apiVersion}`;

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
