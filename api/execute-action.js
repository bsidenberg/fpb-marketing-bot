import supabase from './lib/supabase.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function cors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

const SUPPORTED_TYPES = ['pause_campaign', 'enable_campaign'];

async function getGoogleAccessToken() {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) {
    throw new Error(`OAuth token error: ${JSON.stringify(tokenJson)}`);
  }
  return tokenJson.access_token;
}

async function mutateCampaignStatus(customerId, campaignId, status, accessToken) {
  const url = `https://googleads.googleapis.com/v19/customers/${customerId}/campaigns:mutate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization':   `Bearer ${accessToken}`,
      'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      'login-customer-id': process.env.GOOGLE_ADS_MANAGER_ID
        ? process.env.GOOGLE_ADS_MANAGER_ID.replace(/-/g, '')
        : undefined,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operations: [{
        update: {
          resourceName: `customers/${customerId}/campaigns/${campaignId}`,
          status,
        },
        updateMask: 'status',
      }],
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google Ads API ${res.status}: ${text.substring(0, 400)}`);
  }
  return JSON.parse(text);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { actionId, platform, actionType, campaignId } = req.body || {};

  // Normalize platform to canonical form
  const normalizedPlatform = ['google', 'google_ads', 'Google Ads'].includes(platform)
    ? 'google'
    : platform;

  // Validate
  if (normalizedPlatform !== 'google') {
    return res.status(400).json({
      success: false,
      error: 'Action type not supported for execution yet',
    });
  }
  if (!SUPPORTED_TYPES.includes(actionType)) {
    return res.status(400).json({
      success: false,
      error: 'Action type not supported for execution yet',
    });
  }
  if (!campaignId) {
    return res.status(400).json({ success: false, error: 'Missing campaignId' });
  }

  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID
    ? process.env.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, '')
    : '8325311811';

  const googleStatus = actionType === 'pause_campaign' ? 'PAUSED' : 'ENABLED';
  const logDescription = actionType === 'pause_campaign'
    ? 'Campaign paused via API'
    : 'Campaign enabled via API';

  const now = new Date().toISOString();
  let executionResult = 'success';
  let executionError  = null;

  try {
    const accessToken = await getGoogleAccessToken();
    await mutateCampaignStatus(customerId, campaignId, googleStatus, accessToken);
  } catch (err) {
    executionResult = 'failed';
    executionError  = err.message;
  }

  // Update action row — mark approved regardless of execution outcome
  if (actionId) {
    const updatePayload = {
      status:           'approved',
      reviewed_at:      now,
      executed_at:      now,
      execution_result: executionResult,
    };
    if (executionError) updatePayload.execution_error = executionError;

    await supabase
      .from('actions')
      .update(updatePayload)
      .eq('id', actionId);
  }

  // Log to automation_log
  await supabase.from('automation_log').insert({
    event_type:  actionType,
    platform:    'google_ads',
    status:      executionResult === 'success' ? 'complete' : 'error',
    description: executionResult === 'success' ? logDescription : executionError,
    metadata:    { campaignId, actionId },
    created_at:  now,
  });

  if (executionResult === 'success') {
    return res.status(200).json({ success: true, executed: true });
  } else {
    return res.status(200).json({
      success: true,
      executed: false,
      error: executionError,
    });
  }
}
