export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Step 1: Get fresh access token using refresh token
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
    const { access_token } = await tokenResponse.json();

    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, '');

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

    const adsResponse = await fetch(
      `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:searchStream`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      }
    );

    const data = await adsResponse.json();

    // Step 3: Parse and aggregate metrics
    let totalSpend = 0, totalClicks = 0, totalImpressions = 0, totalConversions = 0;
    const campaigns = [];

    if (Array.isArray(data)) {
      for (const batch of data) {
        for (const result of batch.results || []) {
          const spend = (result.metrics.costMicros || 0) / 1000000;
          totalSpend += spend;
          totalClicks += result.metrics.clicks || 0;
          totalImpressions += result.metrics.impressions || 0;
          totalConversions += result.metrics.conversions || 0;
          campaigns.push({
            id: result.campaign.id,
            name: result.campaign.name,
            status: result.campaign.status,
            spend: spend.toFixed(2),
            clicks: result.metrics.clicks || 0,
            impressions: result.metrics.impressions || 0,
            conversions: result.metrics.conversions || 0,
            ctr: ((result.metrics.ctr || 0) * 100).toFixed(2),
            avgCpc: ((result.metrics.averageCpc || 0) / 1000000).toFixed(2),
            convRate: ((result.metrics.conversionRate || 0) * 100).toFixed(2),
          });
        }
      }
    }

    const roas = totalSpend > 0 ? (totalConversions * 150 / totalSpend).toFixed(2) : 0;
    const cpl = totalConversions > 0 ? (totalSpend / totalConversions).toFixed(2) : 0;

    res.status(200).json({
      success: true,
      summary: {
        totalSpend: totalSpend.toFixed(2),
        totalClicks,
        totalImpressions,
        totalConversions,
        roas,
        cpl,
        ctr: totalClicks > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : 0,
      },
      campaigns,
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
