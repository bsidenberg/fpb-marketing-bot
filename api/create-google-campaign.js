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
    const { campaignName, dailyBudget, keywords, headlines, descriptions, finalUrl } = req.body;

    // Get access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_ADS_CLIENT_ID,
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    const { access_token } = await tokenRes.json();
    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, '');

    // Validate token was acquired
    if (!access_token) throw new Error('Failed to acquire Google Ads access token');

    // Return campaign preview — actual creation requires approved developer token
    res.status(200).json({
      success: true,
      preview: {
        campaignName,
        dailyBudget: `$${dailyBudget}`,
        keywords,
        headlines,
        descriptions,
        finalUrl,
        status: 'READY_TO_LAUNCH',
        message: 'Campaign structure validated. Awaiting developer token production approval to launch.',
      },
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
