// ============================================================
// execute-action-logic.js — shared execution functions
//
// Used by:
//   api/approve-action.js  (client-facing, no secret)
//   api/execute-action.js  (internal/programmatic, requires x-execute-secret)
//
// This module has no HTTP dependencies — it accepts plain data and
// returns { httpStatus, body } objects that the caller converts to responses.
//
// Stage B1 retrofit:
//   • Every executor takes (action, { account, connection }).
//   • `connection` is the row produced by api/lib/accounts.js
//     getConnectionForAccount, with env: references already resolved into
//     resolved_* fields.
//   • Executors fail fast (throw) when required resolved_* fields are
//     missing. NO fallback to global env vars — that would silently mask
//     misconfigured connections.
//   • acquireLockAndExecute does a TOCTOU re-check after its preflight
//     fetch (caller already verified, this is belt-and-suspenders).
//
// Globals that intentionally stay in env (not in ad_platform_connections):
//   • GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET — shared developer credentials
//   • GOOGLE_ADS_DEVELOPER_TOKEN — shared developer credential
//   • META_PAGE_ID — page IDs are not in the schema (Phase 4 gap)
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
async function writeLog({ actionId, accountId, actionType, platform, status, description, metadata, now }) {
  try {
    await supabase.from('automation_log').insert({
      account_id: accountId,
      event_type: actionType,
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
// Stage B1: refreshToken is now a parameter (was process.env.GOOGLE_ADS_REFRESH_TOKEN).
// Client_id / secret remain global — shared developer creds, not per-account.
async function getGoogleAccessToken(refreshToken) {
  if (!refreshToken) {
    throw new Error('getGoogleAccessToken requires a refresh token');
  }
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const json = await tokenRes.json();
  if (!json.access_token) throw new Error(`OAuth token error: ${JSON.stringify(json)}`);
  return json.access_token;
}

export async function executeGoogle(action, { account, connection }) {
  if (!connection) {
    throw new Error(`executeGoogle requires a google_ads connection (account=${account?.slug ?? 'unknown'})`);
  }
  if (!connection.resolved_account_id_external) {
    throw new Error(`Google Ads connection missing customer ID for account ${account.slug}`);
  }
  if (!connection.resolved_refresh_token) {
    throw new Error(`Google Ads connection missing refresh token for account ${account.slug}`);
  }

  const customerId       = connection.resolved_account_id_external.replace(/-/g, '');
  const managerAccountId = connection.resolved_manager_account_id
    ? connection.resolved_manager_account_id.replace(/-/g, '')
    : undefined;
  const refreshToken     = connection.resolved_refresh_token;

  const actionType = action.action_type;
  const campaignId = action.execution_data?.campaign_id;
  if (!campaignId) {
    throw new Error('executeGoogle requires action.execution_data.campaign_id');
  }

  const status      = actionType === 'pause_campaign' ? 'PAUSED' : 'ENABLED';
  const accessToken = await getGoogleAccessToken(refreshToken);

  const url = `https://googleads.googleapis.com/v19/customers/${customerId}/campaigns:mutate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization:       `Bearer ${accessToken}`,
      'developer-token':   process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      'login-customer-id': managerAccountId,
      'Content-Type':      'application/json',
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
export async function executeMeta(action, { account, connection }) {
  if (!connection) {
    throw new Error(`executeMeta requires a meta_ads connection (account=${account?.slug ?? 'unknown'})`);
  }
  if (!connection.resolved_access_token) {
    throw new Error(`Meta Ads connection missing access token for account ${account.slug}`);
  }

  const accessToken = connection.resolved_access_token;
  const actionType  = action.action_type;
  const campaignId  = action.execution_data?.campaign_id;
  if (!campaignId) {
    throw new Error('executeMeta requires action.execution_data.campaign_id');
  }

  const status = actionType === 'pause_campaign' ? 'PAUSED' : 'ACTIVE';
  const url    = new URL(`https://graph.facebook.com/v19.0/${campaignId}`);
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('status', status);

  const res  = await fetch(url.toString(), { method: 'POST' });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || `Meta API error code ${json.error.code}`);
  return json;
}

// ── Meta creative publish ─────────────────────────────────────────────────────
export async function executePublishCreative(action, { account, connection }) {
  if (!connection) {
    throw new Error(`executePublishCreative requires a meta_ads connection (account=${account?.slug ?? 'unknown'})`);
  }
  if (!connection.resolved_access_token) {
    throw new Error(`Meta Ads connection missing access token for account ${account.slug}`);
  }
  if (!connection.resolved_account_id_external) {
    throw new Error(`Meta Ads connection missing ad account ID for account ${account.slug}`);
  }

  const executionData = action.execution_data || {};
  const {
    imageBase64,
    format       = 'feed',
    adName       = 'FPB Ad Creative',
    headline     = 'Get Your Free Quote Today',
    primaryText  = 'Florida Pole Barn Kits — Built for Florida.',
    callToAction = 'LEARN_MORE',
  } = executionData;

  if (!imageBase64) throw new Error('Missing imageBase64 in execution_data');

  const accessToken  = connection.resolved_access_token;
  const rawAccountId = connection.resolved_account_id_external;
  // Defensive prefix handling — env var may be stored with or without 'act_'
  const adAccountId  = rawAccountId.startsWith('act_') ? rawAccountId : `act_${rawAccountId}`;
  const pageId       = String(process.env.META_PAGE_ID); // global env — Phase 4 gap
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
export async function executeCreateMetaCampaign(action, { account, connection }) {
  if (!connection) {
    throw new Error(`executeCreateMetaCampaign requires a meta_ads connection (account=${account?.slug ?? 'unknown'})`);
  }
  if (!connection.resolved_access_token) {
    throw new Error(`Meta Ads connection missing access token for account ${account.slug}`);
  }
  if (!connection.resolved_account_id_external) {
    throw new Error(`Meta Ads connection missing ad account ID for account ${account.slug}`);
  }

  const executionData = action.execution_data || {};
  const {
    campaignName = 'FPB Campaign',
    objective    = 'LEAD_GENERATION',
    dailyBudget  = 50,
    adSetName,
    targeting,
  } = executionData;

  const accessToken = connection.resolved_access_token;
  // NOTE: pre-existing inconsistency vs executePublishCreative — this function
  // unconditionally prepends 'act_' below, expecting the resolved value to be raw.
  // Stage B1 preserves the existing behavior. Don't try to "fix" the discrepancy.
  const adAccountId = connection.resolved_account_id_external;
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
 * Caller MUST:
 *   1. Resolve a caller account from request.
 *   2. Verify action.account_id === account.id (ownership).
 *   3. Resolve a connection for the action's platform (or null for manual types).
 *   4. Pass { account, connection } as the second arg.
 *
 * This function:
 *   1. Atomically claims the action with an idempotency lock
 *      (execution_result: null → 'executing'). Accepts status pending/approved.
 *   2. Re-asserts ownership (TOCTOU defense — throws if account_id changed
 *      since caller's check). This is a "should never happen" invariant.
 *   3. Dispatches to the appropriate platform function with { account, connection }.
 *   4. Updates the action row and writes automation_log (with account_id).
 *
 * Returns { httpStatus, body } — caller converts to HTTP response.
 *
 * Throws (rather than returning a structured response) ONLY on TOCTOU mismatch.
 * The route handler's outer try/catch (or platform error handler) converts to 500.
 */
export async function acquireLockAndExecute(actionId, { account, connection }) {
  if (!account) {
    throw new Error('acquireLockAndExecute requires { account } context');
  }
  const now = new Date().toISOString();

  // Fetch current state so we can validate before acquiring the lock
  const { data: current, error: fetchErr } = await supabase
    .from('actions')
    .select('account_id, status, execution_result, action_type, channel, execution_data')
    .eq('id', actionId)
    .single();

  if (fetchErr || !current) {
    return { httpStatus: 404, body: { success: false, error: 'Action not found' } };
  }

  // TOCTOU defense — caller already verified ownership, but the row could
  // change between the caller's read and ours. Fail loudly if so.
  if (current.account_id !== account.id) {
    throw new Error('Account mismatch detected after preflight (TOCTOU defense)');
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
      actionId, accountId: account.id, now,
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
    .select('account_id, action_type, channel, execution_data')
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
      extraMeta = await executePublishCreative(locked, { account, connection });
    } else if (actionType === 'create_meta_campaign') {
      extraMeta = await executeCreateMetaCampaign(locked, { account, connection });
    } else if (normalizedPlatform === 'google' && campaignId) {
      await executeGoogle(locked, { account, connection });
      extraMeta = { campaign_id: campaignId };
    } else if (normalizedPlatform === 'meta' && campaignId) {
      await executeMeta(locked, { account, connection });
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
    actionId, accountId: account.id, now,
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
 *
 * Stage B1: takes { account, connection } from caller. There is no DB row,
 * so the caller resolves both from the request envelope (query/header for
 * account, getConnectionForAccount for connection). Internally constructs a
 * synthetic action shape so executors only ever work with action-shaped inputs.
 */
export async function executeTransient({ platform, actionType, campaignId }, { account, connection }) {
  if (!account) {
    throw new Error('executeTransient requires { account } context');
  }
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

  // Synthetic action so executors have a uniform contract whether DB-backed or not
  const action = {
    action_type:    actionType,
    execution_data: { campaign_id: campaignId },
  };

  const supabasePlatform = normalizedPlatform === 'google' ? 'google_ads' : 'meta_ads';
  let executionError = null;
  let extraMeta      = {};

  try {
    if (normalizedPlatform === 'google') {
      await executeGoogle(action, { account, connection });
    } else {
      await executeMeta(action, { account, connection });
    }
    extraMeta = { campaign_id: campaignId };
  } catch (err) {
    executionError = err.message;
  }

  await writeLog({
    actionId: null, accountId: account.id, now,
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
    case 'pause_campaign':       return `Campaign paused (ID: ${meta.campaign_id})`;
    case 'enable_campaign':      return `Campaign enabled (ID: ${meta.campaign_id})`;
    case 'publish_creative':     return `Creative published to Meta (creative ID: ${meta.creative_id})`;
    case 'create_meta_campaign': return `Meta campaign created in PAUSED state (campaign ID: ${meta.campaign_id}, ad set ID: ${meta.ad_set_id})`;
    default:                     return `${actionType} completed`;
  }
}

// Flatten camelCase legacy keys so API response is consistent
function flattenMeta(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = v;
  }
  return out;
}
