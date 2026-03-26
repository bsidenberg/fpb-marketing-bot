// Updated: force redeploy
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Step 1: Get fresh access token using refresh token
    console.log('=== TOKEN REQUEST DEBUG ===');
    console.log('Client ID being used:', process.env.GOOGLE_ADS_CLIENT_ID?.substring(0, 30) + '...');
    console.log('Client Secret length:', process.env.GOOGLE_ADS_CLIENT_SECRET?.length);
    console.log('Client Secret first 10 chars:', process.env.GOOGLE_ADS_CLIENT_SECRET?.substring(0, 10));
    console.log('Refresh Token first 20 chars:', process.env.GOOGLE_ADS_REFRESH_TOKEN?.substring(0, 20));
    console.log('Refresh Token length:', process.env.GOOGLE_ADS_REFRESH_TOKEN?.length);

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_ADS_CLIENT_ID,
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    const tokenJson = await tokenResponse.json();
    console.log('Token refresh status:', tokenResponse.status);
    console.log('Token refresh response:', JSON.stringify(tokenJson));

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

    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID
      ? process.env.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, '')
      : '8325311811';

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
        metrics.conversion_rate
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 10
    `;

    const apiUrl = `https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:search`;
    console.log('=== GOOGLE ADS DEBUG ===');
    console.log('API URL:', apiUrl);
    console.log('Customer ID:', customerId);
    console.log('Manager ID:', process.env.GOOGLE_ADS_MANAGER_ID);
    console.log('Dev token present:', !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN);
    console.log('Access token present:', !!access_token);

    const adsResponse = await fetch(
      apiUrl,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
          'login-customer-id': process.env.GOOGLE_ADS_MANAGER_ID
            ? process.env.GOOGLE_ADS_MANAGER_ID.replace(/-/g, '')
            : '5435219372',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      }
    );

    console.log('Google Ads response status:', adsResponse.status);
    console.log('Google Ads response headers:', JSON.stringify(Object.fromEntries(adsResponse.headers.entries())));

    const rawText = await adsResponse.text();
    console.log('Google Ads status:', adsResponse.status);
    console.log('Google Ads response preview:', rawText.substring(0, 800));

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
