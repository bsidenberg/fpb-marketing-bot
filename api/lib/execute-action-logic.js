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
  inferPillar,
} from './action-states.js';
import { recordApiCall } from './api-cost.js';
import { recordActionOutcome } from './autonomy-coordinator.js';
import { runBudgetGuardsForExecution } from './budget-guards.js';
import { AUTOMATION_LOG_EVENT_TYPE } from './automation-log-schema.js';

// ── Execution audit (SESSION-06B) ────────────────────────────────────────────
// A dry-run finalizes the row with this non-null result, which action-states
// isFinal() treats as terminal BY DESIGN: a simulated row is consumed and can
// never be confused with (or upgraded to) a live execution — re-stage to run live.
const DRY_RUN_RESULT = 'dry_run_success';

// ── Platform normaliser ───────────────────────────────────────────────────────
export function normalizePlatform(platform) {
  if (['google', 'google_ads', 'Google Ads'].includes(platform)) return 'google';
  if (['meta', 'meta_ads', 'Meta', 'Meta Ads', 'Facebook Ads'].includes(platform)) return 'meta';
  return platform;
}

// ── Audit log helper ─────────────────────────────────────────────────────────
// S-AUTOLOG-1 (2026-07-31): `event_type` was `actionType` verbatim (e.g.
// 'pause_campaign', 'adjust_budget') — none of which are in automation_log's
// own CHECK constraint (see automation-log-schema.js). Every insert on this
// path has therefore always failed, silently, since the feature was built —
// `.insert()` resolves { error } on a CHECK violation, it does not throw, so
// the surrounding try/catch never saw it. Fixed: event_type now derives from
// `status` (the only two values ever passed here are 'complete'/'error' —
// both valid automation_log statuses already); the actual action_type moves
// into metadata, where it was always readable via `description` anyway, so
// no information is lost, only the invalid literal is no longer written to
// the constrained column. The returned error is now checked and logged
// loudly on both the thrown-exception path and the resolved-with-error path.
async function writeLog({ actionId, accountId, actionType, platform, status, description, metadata, now }) {
  try {
    const { error } = await supabase.from('automation_log').insert({
      account_id: accountId,
      event_type: status === 'error'
        ? AUTOMATION_LOG_EVENT_TYPE.ACTION_FAILED
        : AUTOMATION_LOG_EVENT_TYPE.ACTION_EXECUTED,
      platform,
      status,
      description,
      metadata: {
        action_id:   actionId || null,
        action_type: actionType,
        ...metadata,
      },
      created_at: now || new Date().toISOString(),
    });
    if (error) {
      console.error('[automation_log] write failed (CHECK/DB error):', error.code, error.message);
    }
  } catch (e) {
    console.error('[automation_log] write failed (thrown):', e.message);
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

export async function executeGoogle(action, { account, connection, mode = 'live' }) {
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

  // ── Before-snapshot (SESSION-06B): read current campaign status ─────────────
  // Fail closed on live mutations: no before-snapshot → no mutation, and no
  // rollback_payload is ever derived from missing data. Dry-run alone may
  // proceed with a noted-null snapshot.
  const searchUrl = `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`;
  let beforeSnapshot  = null;
  let rollbackPayload = null;
  try {
    const readRes = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        Authorization:       `Bearer ${accessToken}`,
        'developer-token':   process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        'login-customer-id': managerAccountId,
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        query: `SELECT campaign.status FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`,
      }),
    });
    const readText = await readRes.text();
    if (!readRes.ok) throw new Error(`status read failed (${readRes.status}): ${readText.substring(0, 300)}`);
    const priorStatus = JSON.parse(readText).results?.[0]?.campaign?.status;
    if (!priorStatus) throw new Error(`campaign ${campaignId} status missing from read response`);
    await recordApiCall('google_ads', 'snapshot_read', account.id);
    beforeSnapshot  = { campaign_id: campaignId, status: priorStatus, source: 'google_ads', captured_at: new Date().toISOString() };
    rollbackPayload = {
      action_type: priorStatus === 'ENABLED' ? 'resume_campaign' : 'pause_campaign',
      campaign_id: campaignId,
    };
  } catch (snapErr) {
    if (mode !== 'dry_run') {
      throw new Error(`Snapshot capture failed — live mutation aborted: ${snapErr.message}`);
    }
    beforeSnapshot = { unavailable: true, reason: snapErr.message, captured_at: new Date().toISOString() };
  }

  const audit = { before_snapshot: beforeSnapshot, after_snapshot: null, rollback_payload: rollbackPayload };

  if (mode === 'dry_run') {
    audit.after_snapshot = { campaign_id: campaignId, status, derived: true, simulated: true };
    return { campaign_id: campaignId, status, simulated: true, audit };
  }

  const url = `https://googleads.googleapis.com/v23/customers/${customerId}/campaigns:mutate`;
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
  // Cost ledger — fire-and-forget
  await recordApiCall('google_ads', 'campaign_mutate', account.id);
  audit.after_snapshot = { campaign_id: campaignId, status, derived: true };
  return { campaign_id: campaignId, status, audit };
}

// ── Google Ads: adjust campaign budget ───────────────────────────────────────
export async function executeGoogleAdjustBudget(action, { account, connection, mode = 'live' }) {
  if (!connection) {
    throw new Error(`executeGoogleAdjustBudget requires a google_ads connection (account=${account?.slug ?? 'unknown'})`);
  }
  if (!connection.resolved_account_id_external) {
    throw new Error(`Google Ads connection missing customer ID for account ${account.slug}`);
  }
  if (!connection.resolved_refresh_token) {
    throw new Error(`Google Ads connection missing refresh token for account ${account.slug}`);
  }

  // Coerce to string — Prime may store campaign IDs as JSON numbers or strings
  const campaignId = String(action.execution_data?.campaign_id || '');
  // Coerce to number — Prime may emit bare numbers, quoted strings ("31"), or
  // formatted currency strings ("$31/day", "$1,500", "31 USD").
  // Strip everything except digits and decimal point before converting.
  const rawValue = action.execution_data?.recommended_value;
  const cleaned  = typeof rawValue === 'string' ? rawValue.replace(/[^0-9.]/g, '') : rawValue;
  const budget   = Number(cleaned);

  // Guard against placeholder IDs generated from hypothetical Prime actions
  if (!campaignId || !/^\d{8,}$/.test(campaignId)) {
    throw new Error(
      'Invalid campaign_id format — appears to be a placeholder, not a real Google Ads campaign ID. ' +
      'This usually means Prime generated a hypothetical action without real campaign data.'
    );
  }

  if (!Number.isFinite(budget) || budget <= 0 || budget > 10000) {
    throw new Error(
      budget > 10000
        ? `Budget $${rawValue}/day exceeds $10,000 safety limit — apply manually in Google Ads`
        : `Invalid budget value: ${rawValue} — must be a positive number in USD between 0 and 10000`
    );
  }

  const customerId       = connection.resolved_account_id_external.replace(/-/g, '');
  const managerAccountId = connection.resolved_manager_account_id
    ? connection.resolved_manager_account_id.replace(/-/g, '')
    : undefined;
  const accessToken      = await getGoogleAccessToken(connection.resolved_refresh_token);
  const amountMicros = Math.round(budget * 1_000_000);

  // Resolve the budget resource ID.
  // Fast path: execution_data.budget_id supplied (populated by api/google-ads.js when
  // Prime screenshots Live Data and includes it in the ACTION block).
  // Slow path: fetch the campaign record to find its linked campaignBudget resource name,
  // then extract the numeric ID. This avoids incorrectly using campaign_id as budget_id
  // (they are unrelated IDs in the Google Ads data model).
  // SESSION-06B: the slow-path lookup also selects campaign_budget.amount_micros so
  // the before-snapshot rides the read that already happens (no extra API call).
  // The fast path needs one dedicated snapshot read (cost-ledger recorded).
  const searchUrl = `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`;
  const searchHeaders = {
    Authorization:       `Bearer ${accessToken}`,
    'developer-token':   process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'login-customer-id': managerAccountId,
    'Content-Type':      'application/json',
  };

  let budgetId = action.execution_data?.budget_id
    ? String(action.execution_data.budget_id)
    : null;
  let beforeAmountMicros = null;
  let snapshotFailure    = null;

  if (!budgetId) {
    const searchRes = await fetch(searchUrl, {
      method:  'POST',
      headers: searchHeaders,
      body: JSON.stringify({
        query: `SELECT campaign.campaign_budget, campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`,
      }),
    });
    const searchText = await searchRes.text();
    if (!searchRes.ok) {
      throw new Error(`Google Ads campaign lookup failed (${searchRes.status}): ${searchText.substring(0, 300)}`);
    }
    let searchData;
    try {
      searchData = JSON.parse(searchText);
    } catch (e) {
      throw new Error(`Google Ads campaign lookup returned unparseable response: ${searchText.substring(0, 100)}`);
    }
    const budgetResource = searchData.results?.[0]?.campaign?.campaignBudget;
    if (!budgetResource) {
      throw new Error(`Could not find campaign budget resource for campaign ${campaignId} — provide budget_id in execution_data`);
    }
    budgetId = budgetResource.split('/').pop();
    const rawMicros = searchData.results?.[0]?.campaignBudget?.amountMicros;
    beforeAmountMicros = rawMicros != null && Number.isFinite(Number(rawMicros)) ? Number(rawMicros) : null;
    if (beforeAmountMicros == null) {
      snapshotFailure = `campaign budget amount missing from lookup response for budget ${budgetId}`;
    }
  } else {
    try {
      const readRes = await fetch(searchUrl, {
        method:  'POST',
        headers: searchHeaders,
        body: JSON.stringify({
          query: `SELECT campaign_budget.id, campaign_budget.amount_micros FROM campaign_budget WHERE campaign_budget.id = ${budgetId} LIMIT 1`,
        }),
      });
      const readText = await readRes.text();
      if (!readRes.ok) throw new Error(`budget read failed (${readRes.status}): ${readText.substring(0, 300)}`);
      const rawMicros = JSON.parse(readText).results?.[0]?.campaignBudget?.amountMicros;
      if (rawMicros == null || !Number.isFinite(Number(rawMicros))) {
        throw new Error(`budget amount missing from read response for budget ${budgetId}`);
      }
      beforeAmountMicros = Number(rawMicros);
      await recordApiCall('google_ads', 'snapshot_read', account.id);
    } catch (snapErr) {
      snapshotFailure = snapErr.message;
    }
  }

  // ── Snapshot / rollback assembly (SESSION-06B) ──────────────────────────────
  // Fail closed on live mutations: no before-snapshot → no mutation, and no
  // rollback_payload is ever derived from missing data. Dry-run alone may
  // proceed with a noted-null snapshot.
  let beforeSnapshot  = null;
  let rollbackPayload = null;
  if (beforeAmountMicros != null) {
    beforeSnapshot = {
      campaign_id:   campaignId,
      budget_id:     budgetId,
      amount_micros: beforeAmountMicros,
      amount_usd:    beforeAmountMicros / 1_000_000,
      source:        'google_ads',
      captured_at:   new Date().toISOString(),
    };
    rollbackPayload = {
      action_type:       'adjust_budget',
      campaign_id:       campaignId,
      budget_id:         budgetId,
      recommended_value: beforeAmountMicros / 1_000_000,
    };
  } else if (mode !== 'dry_run') {
    throw new Error(`Snapshot capture failed — live mutation aborted: ${snapshotFailure}`);
  } else {
    beforeSnapshot = { unavailable: true, reason: snapshotFailure, captured_at: new Date().toISOString() };
  }

  const audit = { before_snapshot: beforeSnapshot, after_snapshot: null, rollback_payload: rollbackPayload };

  if (mode === 'dry_run') {
    audit.after_snapshot = { budget_id: budgetId, amount_micros: amountMicros, amount_usd: budget, derived: true, simulated: true };
    return { campaign_id: campaignId, new_budget_usd: budget, amount_micros: amountMicros, simulated: true, audit };
  }

  const url = `https://googleads.googleapis.com/v23/customers/${customerId}/campaignBudgets:mutate`;
  const res  = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization:       `Bearer ${accessToken}`,
      'developer-token':   process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      'login-customer-id': managerAccountId,
      'Content-Type':      'application/json',
    },
    body: JSON.stringify({
      operations: [{
        update: {
          resourceName: `customers/${customerId}/campaignBudgets/${budgetId}`,
          amountMicros,
        },
        updateMask: 'amountMicros',
      }],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google Ads API ${res.status}: ${text.substring(0, 400)}`);

  await recordApiCall('google_ads', 'budget_mutate', account.id);

  audit.after_snapshot = { budget_id: budgetId, amount_micros: amountMicros, amount_usd: budget, derived: true };
  return { campaign_id: campaignId, new_budget_usd: budget, amount_micros: amountMicros, audit };
}

// ── Google Ads: add negative keyword to a campaign ────────────────────────────
export async function executeGoogleAddNegativeKeyword(action, { account, connection, mode = 'live' }) {
  if (!connection) {
    throw new Error(`executeGoogleAddNegativeKeyword requires a google_ads connection (account=${account?.slug ?? 'unknown'})`);
  }
  if (!connection.resolved_account_id_external) {
    throw new Error(`Google Ads connection missing customer ID for account ${account.slug}`);
  }
  if (!connection.resolved_refresh_token) {
    throw new Error(`Google Ads connection missing refresh token for account ${account.slug}`);
  }

  // Coerce to string — Prime may store campaign IDs as JSON numbers or strings
  const campaignId  = String(action.execution_data?.campaign_id || '');
  const keywordText = action.execution_data?.keyword_text;
  const matchType   = action.execution_data?.match_type || 'BROAD';

  if (!campaignId || !/^\d{8,}$/.test(campaignId)) {
    throw new Error(
      'Invalid campaign_id format — appears to be a placeholder, not a real Google Ads campaign ID. ' +
      'This usually means Prime generated a hypothetical action without real campaign data.'
    );
  }
  if (!keywordText || typeof keywordText !== 'string' || !keywordText.trim()) {
    throw new Error('executeGoogleAddNegativeKeyword requires execution_data.keyword_text');
  }

  // SESSION-06B audit: creation action — the prior platform state is absence,
  // so the before-snapshot needs no read. The rollback (remove the criterion)
  // can only be derived from the mutate response's resource name.
  const audit = {
    before_snapshot: {
      campaign_id:  campaignId,
      keyword_text: keywordText.trim(),
      match_type:   matchType,
      criterion:    null,
      note:         'creation — keyword did not exist before',
      captured_at:  new Date().toISOString(),
    },
    after_snapshot:   null,
    rollback_payload: null,
  };

  if (mode === 'dry_run') {
    audit.after_snapshot = { campaign_id: campaignId, keyword_text: keywordText.trim(), match_type: matchType, simulated: true };
    return { campaign_id: campaignId, keyword_text: keywordText.trim(), match_type: matchType, simulated: true, audit };
  }

  const customerId       = connection.resolved_account_id_external.replace(/-/g, '');
  const managerAccountId = connection.resolved_manager_account_id
    ? connection.resolved_manager_account_id.replace(/-/g, '')
    : undefined;
  const accessToken      = await getGoogleAccessToken(connection.resolved_refresh_token);

  const url = `https://googleads.googleapis.com/v23/customers/${customerId}/campaignCriteria:mutate`;
  const res  = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization:       `Bearer ${accessToken}`,
      'developer-token':   process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      'login-customer-id': managerAccountId,
      'Content-Type':      'application/json',
    },
    body: JSON.stringify({
      operations: [{
        create: {
          campaign: `customers/${customerId}/campaigns/${campaignId}`,
          negative: true,
          keyword:  { text: keywordText.trim(), matchType },
        },
      }],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google Ads API ${res.status}: ${text.substring(0, 400)}`);

  await recordApiCall('google_ads', 'negative_keyword_add', account.id);

  let criterionResourceName = null;
  try {
    criterionResourceName = JSON.parse(text)?.results?.[0]?.resourceName ?? null;
  } catch (e) { /* mutate succeeded but response not parseable — rollback stays null */ }
  audit.after_snapshot = {
    campaign_id:             campaignId,
    criterion_resource_name: criterionResourceName,
    keyword_text:            keywordText.trim(),
    match_type:              matchType,
    derived:                 true,
  };
  // Never store a rollback derived from missing data (SESSION-06B refinement)
  audit.rollback_payload = criterionResourceName
    ? { action_type: 'remove_negative_keyword', campaign_id: campaignId, criterion_resource_name: criterionResourceName }
    : null;
  return { campaign_id: campaignId, keyword_text: keywordText.trim(), match_type: matchType, audit };
}

// ── Meta campaign status ──────────────────────────────────────────────────────
export async function executeMeta(action, { account, connection, mode = 'live' }) {
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

  // ── Before-snapshot (SESSION-06B): read current campaign status ─────────────
  // Fail closed on live mutations: no before-snapshot → no mutation, and no
  // rollback_payload is ever derived from missing data. Dry-run alone may
  // proceed with a noted-null snapshot.
  let beforeSnapshot  = null;
  let rollbackPayload = null;
  try {
    const readUrl = new URL(`https://graph.facebook.com/v19.0/${campaignId}`);
    readUrl.searchParams.set('fields', 'status');
    readUrl.searchParams.set('access_token', accessToken);
    const readRes  = await fetch(readUrl.toString());
    const readJson = await readRes.json();
    if (readJson.error) throw new Error(readJson.error.message || `Meta status read error code ${readJson.error.code}`);
    if (!readJson.status) throw new Error(`campaign ${campaignId} status missing from read response`);
    await recordApiCall('meta_ads', 'snapshot_read', account.id);
    beforeSnapshot  = { campaign_id: campaignId, status: readJson.status, source: 'meta_ads', captured_at: new Date().toISOString() };
    rollbackPayload = {
      action_type: readJson.status === 'PAUSED' ? 'pause_campaign' : 'resume_campaign',
      campaign_id: campaignId,
    };
  } catch (snapErr) {
    if (mode !== 'dry_run') {
      throw new Error(`Snapshot capture failed — live mutation aborted: ${snapErr.message}`);
    }
    beforeSnapshot = { unavailable: true, reason: snapErr.message, captured_at: new Date().toISOString() };
  }

  const audit = { before_snapshot: beforeSnapshot, after_snapshot: null, rollback_payload: rollbackPayload };

  if (mode === 'dry_run') {
    audit.after_snapshot = { campaign_id: campaignId, status, derived: true, simulated: true };
    return { campaign_id: campaignId, status, simulated: true, audit };
  }

  const url = new URL(`https://graph.facebook.com/v19.0/${campaignId}`);
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('status', status);

  const res  = await fetch(url.toString(), { method: 'POST' });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || `Meta API error code ${json.error.code}`);
  // Cost ledger — fire-and-forget
  await recordApiCall('meta_ads', 'campaign_mutate', account.id);
  audit.after_snapshot = { campaign_id: campaignId, status, derived: true };
  return { campaign_id: campaignId, status, audit };
}

// ── Meta creative publish ─────────────────────────────────────────────────────
export async function executePublishCreative(action, { account, connection, mode = 'live' }) {
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

  // SESSION-06B audit: creation action — prior platform state is absence.
  const audit = {
    before_snapshot:  { note: 'creation — no prior platform state', captured_at: new Date().toISOString() },
    after_snapshot:   null,
    rollback_payload: null,
  };

  if (mode === 'dry_run') {
    audit.after_snapshot = { simulated: true, would_create: { ad_name: adName, format, headline, call_to_action: ctaType } };
    return { simulated: true, format, audit };
  }

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

  // Cost ledger — fire-and-forget (image upload + creative = 2 calls)
  await recordApiCall('meta_ads', 'creative_upload', account.id, { format });

  audit.after_snapshot   = { creative_id: creativeJson.id, image_hash: imageHash, format, derived: true };
  audit.rollback_payload = { action_type: 'delete_creative', creative_id: creativeJson.id, note: 'stored only — deletion is never auto-executed' };
  return {
    creative_id: creativeJson.id,
    image_hash:  imageHash,
    format,
    preview_url: `https://www.facebook.com/ads/creativehub/creative/?id=${creativeJson.id}`,
    audit,
  };
}

// ── Meta campaign creation ────────────────────────────────────────────────────
export async function executeCreateMetaCampaign(action, { account, connection, mode = 'live' }) {
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

  // SESSION-06B audit: creation action — prior platform state is absence.
  const audit = {
    before_snapshot:  { note: 'creation — no prior platform state', captured_at: new Date().toISOString() },
    after_snapshot:   null,
    rollback_payload: null,
  };

  if (mode === 'dry_run') {
    audit.after_snapshot = { simulated: true, would_create: { campaign_name: campaignName, objective, daily_budget_usd: dailyBudget, status: 'PAUSED' } };
    return { simulated: true, status: 'PAUSED', audit };
  }

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

  // Cost ledger — fire-and-forget (campaign + adset = 2 API calls, logged as one event)
  await recordApiCall('meta_ads', 'campaign_create', account.id);

  audit.after_snapshot   = { campaign_id: campaignData.id, ad_set_id: adSetData.id, status: 'PAUSED', derived: true };
  audit.rollback_payload = { action_type: 'delete_campaign', campaign_id: campaignData.id, ad_set_id: adSetData.id, note: 'stored only — deletion is never auto-executed' };
  return {
    campaign_id: campaignData.id,
    ad_set_id:   adSetData.id,
    status:      'PAUSED',
    audit,
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
 *      (result: null → 'executing'). Accepts status pending/approved.
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
export async function acquireLockAndExecute(actionId, { account, connection, reviewedBy, dryRun }) {
  if (!account) {
    throw new Error('acquireLockAndExecute requires { account } context');
  }
  const now  = new Date().toISOString();
  const mode = dryRun === true ? 'dry_run' : 'live';

  // SESSION-06B: reviewed_by is NEVER null on a finalized row. auto_execute=true
  // rows are coordinator-staged and always attribute to 'system:auto' regardless
  // of which endpoint fired them; otherwise the caller's identity wins
  // ('admin' from approve-action, 'system:execute-secret' from execute-action).
  const resolveReviewer = (row) =>
    row?.auto_execute === true ? 'system:auto' : (reviewedBy || 'system:execute-secret');

  // Fetch current state so we can validate before acquiring the lock
  const { data: current, error: fetchErr } = await supabase
    .from('actions')
    .select('account_id, status, result, action_type, channel, execution_data, auto_execute')
    .eq('id', actionId)
    .maybeSingle();

  if (fetchErr) {
    console.error('[execute-action-logic] action fetch failed:', JSON.stringify({
      code:    fetchErr.code,
      message: fetchErr.message,
      details: fetchErr.details,
      hint:    fetchErr.hint,
    }));
    return { httpStatus: 500, body: { success: false, error: 'Failed to retrieve action' } };
  }
  if (!current) {
    return { httpStatus: 404, body: { success: false, error: 'Action not found' } };
  }

  // TOCTOU defense — caller already verified ownership, but the row could
  // change between the caller's read and ours. Fail loudly if so.
  if (current.account_id !== account.id) {
    throw new Error('Account mismatch detected after preflight (TOCTOU defense)');
  }

  // Manual-type gate — record approval intent but never execute
  if (isManualType(current.action_type)) {
    const { error: manualUpdateErr } = await supabase.from('actions').update({
      status:      STATUS.APPROVED,
      reviewed_at: now,
      reviewed_by: resolveReviewer(current),
      result:      EXEC_RESULT.REQUIRES_MANUAL,
    }).eq('id', actionId);
    if (manualUpdateErr) {
      console.error('[execute-action-logic] manual approval update failed:', manualUpdateErr.code, manualUpdateErr.message);
    }

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
        error:   `Action cannot be executed (status=${current.status}, result=${current.result ?? 'null'})`,
      },
    };
  }

  // ── Atomic idempotency lock ───────────────────────────────────────────────────
  // Transitions result: null → 'executing'.
  // Requires status IN ('pending','approved') AND result IS NULL.
  // If another request got here first, the update matches 0 rows → 409.
  const { data: locked, error: lockErr } = await supabase
    .from('actions')
    .update({ result: EXEC_RESULT.EXECUTING })
    .eq('id', actionId)
    .in('status', [STATUS.PENDING, STATUS.APPROVED])
    .is('result', null)
    .select('account_id, action_type, channel, execution_data, auto_execute')
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
    // ── Budget guards (SESSION-05) — spend magnitude & protection ─────────────
    // 'block' is terminal: thrown into the shared error path, so the row is
    // finalized with the guard reason and NO execution path — including a
    // human approve click — may proceed. 'require_approval' refuses only
    // auto-execution (auto_execute=true rows) and returns the action to the
    // human queue; auto_execute=false rows only reach here via approve-action
    // or the operator secret, which satisfies the approval requirement.
    const guard = await runBudgetGuardsForExecution(locked, { account, connection });
    if (guard.verdict === 'block') {
      throw new Error(`Blocked by budget guard: ${guard.reason}`);
    }
    if (guard.verdict === 'require_approval' && locked.auto_execute === true) {
      const { error: releaseErr } = await supabase
        .from('actions')
        .update({ result: null, auto_execute: false })
        .eq('id', actionId);
      if (releaseErr) {
        console.error('[execute-action-logic] guard lock release failed:', releaseErr.code, releaseErr.message);
      }
      await writeLog({
        actionId, accountId: account.id, now,
        actionType,
        platform:    supabasePlatform,
        status:      'complete',
        description: `${actionType} auto-execution deferred by budget guard — requires human approval: ${guard.reason}`,
        metadata:    { budget_guard: 'require_approval', reason: guard.reason, ...(campaignId ? { campaign_id: campaignId } : {}) },
      });
      return {
        httpStatus: 200,
        body: { success: true, executed: false, requires_approval: true, reason: guard.reason },
      };
    }

    if (actionType === 'publish_creative') {
      extraMeta = await executePublishCreative(locked, { account, connection, mode });
    } else if (actionType === 'create_meta_campaign') {
      extraMeta = await executeCreateMetaCampaign(locked, { account, connection, mode });
    } else if (actionType === 'adjust_budget') {
      extraMeta = await executeGoogleAdjustBudget(locked, { account, connection, mode });
    } else if (actionType === 'add_negative_keyword') {
      extraMeta = await executeGoogleAddNegativeKeyword(locked, { account, connection, mode });
    } else if (normalizedPlatform === 'google' && campaignId) {
      // handles pause_campaign, enable_campaign, resume_campaign
      extraMeta = await executeGoogle(locked, { account, connection, mode });
    } else if (normalizedPlatform === 'meta' && campaignId) {
      extraMeta = await executeMeta(locked, { account, connection, mode });
    } else {
      throw new Error(`No executor for action_type=${actionType} platform=${normalizedPlatform}`);
    }
  } catch (err) {
    executionError = err.message;
  }

  // ── Update action row ─────────────────────────────────────────────────────────
  // SESSION-06B: snapshots, rollback, execution_mode, and reviewed_by land on
  // the SAME update that finalizes the row — no window where a finalized row
  // has a null approver or a live mutation lacks its audit trail. A throw
  // before/during the mutate leaves audit null (and therefore rollback null).
  const { audit = null, ...responseMeta } = extraMeta || {};
  const succeeded   = !executionError;
  const finalResult = executionError || (mode === 'dry_run' ? DRY_RUN_RESULT : EXEC_RESULT.SUCCESS);
  const finalUpdate = {
    reviewed_at:      now,
    reviewed_by:      resolveReviewer(locked),
    result:           finalResult,
    execution_mode:   mode,
    before_snapshot:  audit?.before_snapshot ?? null,
    after_snapshot:   audit?.after_snapshot ?? null,
    rollback_payload: audit?.rollback_payload ?? null,
  };
  if (mode === 'live') {
    // Dry-run leaves status untouched and executed_at unset — nothing was
    // approved or executed; the mode column is the authoritative marker.
    finalUpdate.status      = STATUS.APPROVED;
    finalUpdate.executed_at = now;
  }
  const { error: finalUpdateErr } = await supabase.from('actions').update(finalUpdate).eq('id', actionId);
  if (finalUpdateErr) {
    console.error('[execute-action-logic] final status update failed:', finalUpdateErr.code, finalUpdateErr.message);
  }

  // ── Audit log ─────────────────────────────────────────────────────────────────
  await writeLog({
    actionId, accountId: account.id, now,
    actionType,
    platform:    supabasePlatform,
    status:      succeeded ? 'complete' : 'error',
    description: succeeded
      ? (mode === 'dry_run'
          ? `DRY RUN (no platform change): ${buildSuccessDesc(actionType, responseMeta)}`
          : buildSuccessDesc(actionType, responseMeta))
      : `${actionType} failed: ${executionError}`,
    metadata: { ...responseMeta, execution_mode: mode, ...(executionError ? { error: executionError } : {}) },
  });

  // ── Record outcome for autonomy posture tracking (fire-and-forget) ────────────
  // Dry-runs are simulations — they must not feed autonomy graduation stats.
  if (mode === 'live') {
    recordActionOutcome(actionId, account.id, inferPillar(actionType), actionType, succeeded);
  }

  if (succeeded) {
    return {
      httpStatus: 200,
      body: {
        success:        true,
        executed:       mode === 'live',
        execution_mode: mode,
        ...(mode === 'dry_run' ? { dry_run: true } : {}),
        ...flattenMeta(responseMeta),
      },
    };
  } else {
    return {
      httpStatus: 200,
      body: {
        success:        true,
        executed:       false,
        execution_mode: mode,
        ...(mode === 'dry_run' ? { dry_run: true } : {}),
        error:          executionError,
      },
    };
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
    channel:        normalizedPlatform, // budget guards fetch live Google state by channel
    execution_data: { campaign_id: campaignId },
  };

  const supabasePlatform = normalizedPlatform === 'google' ? 'google_ads' : 'meta_ads';

  // ── Budget guards (SESSION-05) — transient path enforces 'block' only ───────
  // Transient executions are always human-initiated (chat confirmation click),
  // so 'require_approval' is satisfied by the click; 'block' stays terminal.
  const guard = await runBudgetGuardsForExecution(action, { account, connection });
  if (guard.verdict === 'block') {
    await writeLog({
      actionId: null, accountId: account.id, now,
      actionType,
      platform:    supabasePlatform,
      status:      'error',
      description: `${actionType} blocked by budget guard (transient): ${guard.reason}`,
      metadata:    { campaign_id: campaignId, transient: true, budget_guard: 'block', reason: guard.reason },
    });
    return { httpStatus: 200, body: { success: true, executed: false, blocked: true, error: `Blocked by budget guard: ${guard.reason}` } };
  }

  let executionError = null;
  let extraMeta      = {};

  try {
    // SESSION-06B: executors capture before/after snapshots + rollback even on
    // the transient path (fail-closed applies). There is no action row here,
    // so the audit lands in automation_log metadata below.
    let r;
    if (normalizedPlatform === 'google') {
      r = await executeGoogle(action, { account, connection });
    } else {
      r = await executeMeta(action, { account, connection });
    }
    extraMeta = { campaign_id: campaignId, ...(r?.audit ? { audit: r.audit } : {}) };
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
    case 'pause_campaign':        return `Campaign paused (ID: ${meta.campaign_id})`;
    case 'enable_campaign':       return `Campaign enabled (ID: ${meta.campaign_id})`;
    case 'resume_campaign':       return `Campaign resumed/enabled (ID: ${meta.campaign_id})`;
    case 'publish_creative':      return `Creative published to Meta (creative ID: ${meta.creative_id})`;
    case 'create_meta_campaign':  return `Meta campaign created in PAUSED state (campaign ID: ${meta.campaign_id}, ad set ID: ${meta.ad_set_id})`;
    case 'adjust_budget':         return `Campaign budget updated to $${meta.new_budget_usd}/day (campaign ID: ${meta.campaign_id})`;
    case 'add_negative_keyword':  return `Negative keyword added: "${meta.keyword_text}" (campaign ID: ${meta.campaign_id})`;
    default:                      return `${actionType} completed`;
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
