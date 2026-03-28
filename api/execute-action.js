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

function normalizePlatform(platform) {
  if (['google', 'google_ads', 'Google Ads'].includes(platform)) return 'google';
  if (['meta', 'meta_ads', 'Meta', 'Meta Ads', 'Facebook Ads'].includes(platform)) return 'meta';
  return platform;
}

// ── Google ──────────────────────────────────────────────────────────────────

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

async function executeGoogle(campaignId, actionType) {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID
    ? process.env.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, '')
    : '8325311811';

  const status = actionType === 'pause_campaign' ? 'PAUSED' : 'ENABLED';

  const accessToken = await getGoogleAccessToken();

  const url = `https://googleads.googleapis.com/v19/customers/${customerId}/campaigns:mutate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization':     `Bearer ${accessToken}`,
      'developer-token':   process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
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

// ── Meta ─────────────────────────────────────────────────────────────────────

async function executeMeta(campaignId, actionType) {
  const status = actionType === 'pause_campaign' ? 'PAUSED' : 'ACTIVE';
  const accessToken = process.env.META_ACCESS_TOKEN;

  const url = new URL(`https://graph.facebook.com/v19.0/${campaignId}`);
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('status', status);

  const res = await fetch(url.toString(), { method: 'POST' });
  const json = await res.json();

  if (json.error) {
    throw new Error(json.error.message || `Meta API error code ${json.error.code}`);
  }
  return json;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { actionId, platform, actionType, campaignId } = req.body || {};

  const normalizedPlatform = normalizePlatform(platform);

  // Validate platform and action type
  if (!['google', 'meta'].includes(normalizedPlatform) || !SUPPORTED_TYPES.includes(actionType)) {
    return res.status(400).json({
      success: false,
      error: 'Action type not supported for execution yet',
    });
  }
  if (!campaignId) {
    return res.status(400).json({ success: false, error: 'Missing campaignId' });
  }

  const supabasePlatform  = normalizedPlatform === 'google' ? 'google_ads' : 'meta_ads';
  const logDescriptionOk  = actionType === 'pause_campaign'
    ? `Campaign paused via ${normalizedPlatform === 'google' ? 'Google Ads' : 'Meta'} API`
    : `Campaign enabled via ${normalizedPlatform === 'google' ? 'Google Ads' : 'Meta'} API`;

  const now = new Date().toISOString();
  let executionResult = 'success';
  let executionError  = null;

  try {
    if (normalizedPlatform === 'google') {
      await executeGoogle(campaignId, actionType);
    } else {
      await executeMeta(campaignId, actionType);
    }
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

  // Write to automation_log
  await supabase.from('automation_log').insert({
    event_type:  actionType,
    platform:    supabasePlatform,
    status:      executionResult === 'success' ? 'complete' : 'error',
    description: executionResult === 'success' ? logDescriptionOk : executionError,
    metadata:    { campaignId, actionId },
    created_at:  now,
  });

  if (executionResult === 'success') {
    return res.status(200).json({ success: true, executed: true });
  } else {
    return res.status(200).json({ success: true, executed: false, error: executionError });
  }
}
