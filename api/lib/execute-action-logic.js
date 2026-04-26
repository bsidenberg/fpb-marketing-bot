// ============================================================
// execute-action-logic.js — shared execution functions
//
// Used by:
//   api/approve-action.js  (client-facing, no secret)
//   api/execute-action.js  (internal/programmatic, requires x-execute-secret)
//
// This module has no HTTP dependencies — it accepts plain data and
// returns { httpStatus, body } objects that the caller converts to responses.
// ============================================================

import supabase from './supabase.js';
import {
  EXECUTABLE_TYPES,
  MANUAL_TYPES,
  EXEC_RESULT,
  STATUS,
  canExecute,
  isManualType,
} from './action-states.js';

// ── Platform normaliser ───────────────────────────────────────────────────────
export function normalizePlatform(platform) {
  if (['google', 'google_ads', 'Google Ads'].includes(platform)) return 'google';
  if (['meta', 'meta_ads', 'Meta', 'Meta Ads', 'Facebook Ads'].includes(platform)) return 'meta';
  return platform;
}

// ── Audit log helper ─────────────────────────────────────────────────────────
async function writeLog({ actionId, actionType, platform, status, description, metadata, now }) {
  try {
    await supabase.from('automation_log').insert({
      event_type:  actionType,
      platform,
      status,
      description,
      metadata: {
        action_id: actionId || null,
        ...metadata,
      },
      created_at: now || new Date().toISOString(),
    });
  } catch (e) {
    console.error('[automation_log] write failed:', e.message);
  }
}

// ── Google Ads helpers ────────────────────────────────────────────────────────
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
  const json = await tokenRes.json();
  if (!json.access_token) throw new Error(`OAuth token error: ${JSON.stringify(json)}`);
  return json.access_token;
}

export async function executeGoogle(campaignId, actionType) {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID
    ? process.env.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, '')
    : '8325311811';
  const status      = actionType === 'pause_campaign' ? 'PAUSED' : 'ENABLED';
  const accessToken = await getGoogleAccessToken();

  const url = `https://googleads.googleapis.com/v19/customers/${customerId}/campaigns:mutate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization:       `Bearer ${accessToken}`,
      'developer-token':   process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      'login-customer-id': process.env.GOOGLE_ADS_MANAGER_ID
        ? process.env.GOOGLE_ADS_MANAGER_ID.replace(/-/g, '')
        : undefined,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operations: [{
        update:     { resourceName: `customers/${customerId}/campaigns/${campaignId}`, status },
        updateMask: 'status',
      }],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google Ads API ${res.status}: ${text.substring(0, 400)}`);
  return JSON.parse(text);
}

// ── Meta campaign status ──────────────────────────────────────────────────────
export async function executeMeta(campaignId, actionType) {
  const status      = actionType === 'pause_campaign' ? 'PAUSED' : 'ACTIVE';
  const accessToken = process.env.META_ACCESS_TOKEN;
  const url         = new URL(`https://graph.facebook.com/v19.0/${campaignId}`);
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('status', status);

  const res  = await fetch(url.toString(), { method: 'POST' });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || `Meta API error code ${json.error.code}`);
  return json;
}

// ── Meta creative publish ─────────────────────────────────────────────────────
export async function executePublishCreative(executionData) {
  const {
    imageBase64,
    format       = 'feed',
    adName       = 'FPB Ad Creative',
    headline     = 'Get Your Free Quote Today',
    primaryText  = 'Florida Pole Barn Kits — Built for Florida.',
    callToAction = 'LEARN_MORE',
  } = executionData || {};

  if (!imageBase64) throw new Error('Missing imageBase64 in execution_data');

  const accessToken  = process.env.META_ACCESS_TOKEN;
  const rawAccountId = process.env.META_AD_ACCOUNT_ID || '';
  const adAccountId  = rawAccountId.startsWith('act_') ? rawAccountId : `act_${rawAccountId}`;
  const pageId       = String(process.env.META_PAGE_ID);
  const apiBase      = 'https://graph.facebook.com/v19.0';
  const ctaMap       = {
    GET_QUOTE: 'GET_QUOTE', LEARN_MORE: 'LEARN_MORE',
    CONTACT_US: 'CONTACT_US', SHOP_NOW: 'SHOP_NOW',
    SIGN_UP: 'SIGN_UP', SUBSCRIBE: 'SUBSCRIBE',
  };
  const ctaType = ctaMap[callToAction] || 'LEARN_MORE';

  // Step 1: upload image
  const boundary = '----FPBBoundary' + Date.now().toString(16);
  const crlf     = '\r\n';
  const multipart = [
    `--${boundary}${crlf}`,
    `Content-Disposition: form-data; name="bytes"${crlf}${crlf}`,
    imageBase64,
    `${crlf}--${boundary}--${crlf}`,
  ].join('');

  const uploadRes  = await fetch(`${apiBase}/${adAccountId}/adimages`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body:    multipart,
  });
  const uploadJson = await uploadRes.json();
  if (uploadJson.error) throw new Error(uploadJson.error.message || `Meta image upload code ${uploadJson.error.code}`);

  const images   = uploadJson.images || {};
  const firstKey = Object.keys(images)[0];
  if (!firstKey || !images[firstKey]?.hash) throw new Error('Meta image upload returned no hash');
  const imageHash = images[firstKey].hash;

  // Step 2: create ad creative
  const creativeUrl = `${apiBase}/${adAccountId}/adcreatives?access_token=${encodeURIComponent(accessToken)}`;
  const creativeRes = await fetch(creativeUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      name: adName,
      object_story_spec: {
        page_id:   pageId,
        link_data: {
          image_hash: imageHash, link: 'https://floridapolebarn.com',
          message: primaryText, name: headline, call_to_action: { type: ctaType },
        },
      },
    }),
  });
  const creativeJson = await creativeRes.json();
  if (creativeJson.error) throw new Error(creativeJson.error.message || `Meta creative code ${creativeJson.error.code}`);
  if (!creativeJson.id) throw new Error('Ad creative created but no ID returned');

  return {
    creative_id: creativeJson.id,
    image_hash:  imageHash,
    format,
    preview_url: `https://www.facebook.com/ads/creativehub/creative/?id=${creativeJson.id}`,
  };
}

// ── Meta campaign creation ────────────────────────────────────────────────────
export async function executeCreateMetaCampaign(executionData) {
  const {
    campaignName = 'FPB Campaign',
    objective    = 'LEAD_GENERATION',
    dailyBudget  = 50,
    adSetName,
    targeting,
  } = executionData || {};

  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  const apiBase     = 'https://graph.facebook.com/v19.0';

  // Create campaign — always PAUSED; must be manually activated in Ads Manager
  const campaignRes  = await fetch(`${apiBase}/act_${adAccountId}/campaigns`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      name:                   campaignName,
      objective,
      status:                 'PAUSED',
      special_ad_categories:  [],
      access_token:           accessToken,
    }),
  });
  const campaignData = await campaignRes.json();
  if (campaignData.error) throw new Error(campaignData.error.message);

  // Create ad set — also PAUSED; targeting defaults to Florida
  const adSetRes  = await fetch(`${apiBase}/act_${adAccountId}/adsets`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      name:              adSetName || `${campaignName} — Ad Set`,
      campaign_id:       campaignData.id,
      daily_budget:      Math.round(dailyBudget * 100),
      billing_event:     'IMPRESSIONS',
      optimization_goal: 'LEAD_GENERATION',
      targeting:         targeting || {
        geo_locations: {
          countries: ['US'],
          regions:   [{ key: '3846' }], // Florida
        },
        age_min: 25, age_max: 65,
      },
      status:        'PAUSED',
      access_token:  accessToken,
    }),
  });
  const adSetData = await adSetRes.json();
  if (adSetData.error) throw new Error(adSetData.error.message);

  return {
    campaign_id: campaignData.id,
    ad_set_id:   adSetData.id,
    status:      'PAUSED',
  };
}

// ── Core: acquire idempotency lock and execute ────────────────────────────────
/**
 * The main execution path for DB-backed actions.
 *
 * 1. Atomically claims the action with an idempotency lock (execution_result: null → 'executing').
 *    Accepts status 'pending' or 'approved'.
 * 2. Dispatches to the appropriate platform function.
 * 3. Updates the action row and writes automation_log.
 *
 * Returns { httpStatus, body } — the caller converts to HTTP response.
 */
export async function acquireLockAndExecute(actionId) {
  const now = new Date().toISOString();

  // Fetch current state so we can validate before acquiring the lock
  const { data: current, error: fetchErr } = await supabase
    .from('actions')
    .select('status, execution_result, action_type, channel, execution_data')
    .eq('id', actionId)
    .single();

  if (fetchErr || !current) {
    return { httpStatus: 404, body: { success: false, error: 'Action not found' } };
  }

  // Manual-type gate — record approval intent but never execute
  if (isManualType(current.action_type)) {
    await supabase.from('actions').update({
      status:           STATUS.APPROVED,
      reviewed_at:      now,
      execution_result: EXEC_RESULT.REQUIRES_MANUAL,
      execution_error:  'This action type must be applied manually in the ad platform.',
    }).eq('id', actionId);

    await writeLog({
      actionId, now,
      actionType: current.action_type,
      platform:   normalizePlatform(current.channel) === 'google' ? 'google_ads' : 'meta_ads',
      status:     'complete',
      description: `${current.action_type} approved — requires manual implementation in ad platform`,
      metadata:   { requires_manual: true },
    });

    return {
      httpStatus: 200,
      body: {
        success:         true,
        executed:        false,
        requires_manual: true,
        message:         'Approval recorded. Apply this change manually in the ad platform — no automated change was made.',
      },
    };
  }

  // Validate the action is in a state we can execute
  if (!canExecute(current)) {
    return {
      httpStatus: 409,
      body: {
        success: false,
        error:   `Action cannot be executed (status=${current.status}, execution_result=${current.execution_result ?? 'null'})`,
      },
    };
  }

  // ── Atomic idempotency lock ───────────────────────────────────────────────────
  // Transitions execution_result: null → 'executing'.
  // Requires status IN ('pending','approved') AND execution_result IS NULL.
  // If another request got here first, the update matches 0 rows → 409.
  const { data: locked, error: lockErr } = await supabase
    .from('actions')
    .update({ execution_result: EXEC_RESULT.EXECUTING })
    .eq('id', actionId)
    .in('status', [STATUS.PENDING, STATUS.APPROVED])
    .is('execution_result', null)
    .select('action_type, channel, execution_data')
    .single();

  // PGRST116 = no rows matched the WHERE (already locked or executed)
  if (lockErr?.code === 'PGRST116' || !locked) {
    return { httpStatus: 409, body: { success: false, error: 'Action already executing or executed — concurrent request was rejected.' } };
  }
  if (lockErr) {
    return { httpStatus: 500, body: { success: false, error: `Lock acquisition failed: ${lockErr.message}` } };
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────────
  const actionType         = locked.action_type;
  const normalizedPlatform = normalizePlatform(locked.channel);
  const executionData      = locked.execution_data || {};
  const campaignId         = executionData.campaign_id || null;
  const supabasePlatform   = normalizedPlatform === 'google' ? 'google_ads' : 'meta_ads';

  let executionError = null;
  let extraMeta      = {};

  try {
    if (actionType === 'publish_creative') {
      extraMeta = await executePublishCreative(executionData);
    } else if (actionType === 'create_meta_campaign') {
      extraMeta = await executeCreateMetaCampaign(executionData);
    } else if (normalizedPlatform === 'google' && campaignId) {
      await executeGoogle(campaignId, actionType);
      extraMeta = { campaign_id: campaignId };
    } else if (normalizedPlatform === 'meta' && campaignId) {
      await executeMeta(campaignId, actionType);
      extraMeta = { campaign_id: campaignId };
    } else {
      throw new Error(`No executor for action_type=${actionType} platform=${normalizedPlatform}`);
    }
  } catch (err) {
    executionError = err.message;
  }

  // ── Update action row ─────────────────────────────────────────────────────────
  const finalResult = executionError || EXEC_RESULT.SUCCESS;
  await supabase.from('actions').update({
    status:           STATUS.APPROVED,
    reviewed_at:      now,
    executed_at:      now,
    execution_result: finalResult,
    ...(executionError ? { execution_error: executionError } : {}),
  }).eq('id', actionId);

  // ── Audit log ─────────────────────────────────────────────────────────────────
  const succeeded = !executionError;
  await writeLog({
    actionId, now,
    actionType,
    platform:    supabasePlatform,
    status:      succeeded ? 'complete' : 'error',
    description: succeeded
      ? buildSuccessDesc(actionType, extraMeta)
      : `${actionType} failed: ${executionError}`,
    metadata: { ...extraMeta, ...(executionError ? { error: executionError } : {}) },
  });

  if (succeeded) {
    return { httpStatus: 200, body: { success: true, executed: true, ...flattenMeta(extraMeta) } };
  } else {
    return { httpStatus: 200, body: { success: true, executed: false, error: executionError } };
  }
}

// ── Ephemeral execution (no DB row — chat ActionCard path) ────────────────────
/**
 * Execute directly without a DB action row or idempotency guarantee.
 * Used only for inline chat ActionCard confirmations.
 * No lock, no state tracking — fire and log.
 */
export async function executeTransient({ platform, actionType, campaignId }) {
  const normalizedPlatform = normalizePlatform(platform);
  const now = new Date().toISOString();

  if (!EXECUTABLE_TYPES.includes(actionType)) {
    if (MANUAL_TYPES.includes(actionType)) {
      return { httpStatus: 200, body: { success: true, executed: false, requires_manual: true, message: 'Apply this change manually in the ad platform.' } };
    }
    return { httpStatus: 400, body: { success: false, error: `Unsupported action type: ${actionType}` } };
  }

  // publish_creative and create_meta_campaign require a DB row (execution_data lives there)
  if (['publish_creative', 'create_meta_campaign'].includes(actionType)) {
    return { httpStatus: 400, body: { success: false, error: `${actionType} requires an actionId (must go through the approval queue)` } };
  }

  if (!['google', 'meta'].includes(normalizedPlatform)) {
    return { httpStatus: 400, body: { success: false, error: `Unsupported platform: ${platform}` } };
  }
  if (!campaignId) {
    return { httpStatus: 400, body: { success: false, error: 'Missing campaignId' } };
  }

  const supabasePlatform = normalizedPlatform === 'google' ? 'google_ads' : 'meta_ads';
  let executionError = null;
  let extraMeta      = {};

  try {
    if (normalizedPlatform === 'google') {
      await executeGoogle(campaignId, actionType);
    } else {
      await executeMeta(campaignId, actionType);
    }
    extraMeta = { campaign_id: campaignId };
  } catch (err) {
    executionError = err.message;
  }

  await writeLog({
    actionId: null, now,
    actionType,
    platform:    supabasePlatform,
    status:      executionError ? 'error' : 'complete',
    description: executionError
      ? `${actionType} failed (transient): ${executionError}`
      : buildSuccessDesc(actionType, extraMeta),
    metadata: { ...extraMeta, transient: true, ...(executionError ? { error: executionError } : {}) },
  });

  if (executionError) {
    return { httpStatus: 200, body: { success: true, executed: false, error: executionError } };
  }
  return { httpStatus: 200, body: { success: true, executed: true } };
}

// ── Internal helpers ──────────────────────────────────────────────────────────
function buildSuccessDesc(actionType, meta) {
  switch (actionType) {
    case 'pause_campaign':      return `Campaign paused (ID: ${meta.campaign_id})`;
    case 'enable_campaign':     return `Campaign enabled (ID: ${meta.campaign_id})`;
    case 'publish_creative':    return `Creative published to Meta (creative ID: ${meta.creative_id})`;
    case 'create_meta_campaign': return `Meta campaign created in PAUSED state (campaign ID: ${meta.campaign_id}, ad set ID: ${meta.ad_set_id})`;
    default:                    return `${actionType} completed`;
  }
}

// Flatten camelCase legacy keys so API response is consistent
function flattenMeta(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    // Keep snake_case as-is; convert camelCase keys from older helpers if any slip through
    out[k] = v;
  }
  return out;
}
