// ============================================================
// api/verify-safety.js — health + safety verification endpoint
//
// GET /api/verify-safety
//   Returns a JSON report covering:
//     • Safety Sprint 1 checks (credential hygiene, EXECUTE_SECRET,
//       idempotency lock, approval queue, etc.) — unchanged from
//       the original Safety Sprint 1 implementation.
//     • Stage B1 account_config section: verifies the FPB account row
//       exists and is active, and that the FPB google_ads + meta_ads
//       connections in ad_platform_connections resolve to non-null
//       values for the credentials each platform requires.
//
// No external API calls are made. Token VALUES are never returned —
// the account_config section reports only presence booleans.
//
// Usage (browser):  https://your-app.vercel.app/api/verify-safety
// Usage (curl):     curl https://your-app.vercel.app/api/verify-safety | jq
// ============================================================

import {
  getAccountBySlug,
  getConnectionForAccount,
  FPB_DEFAULT_SLUG,
} from './lib/accounts.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const checks = [];

  // ── 1. Credential debug logging removed ─────────────────────────────────────
  // Cannot test at runtime; mark as implemented (verified by code inspection).
  checks.push({
    id:     'no_credential_logs',
    title:  'Credential debug logs removed from google-ads.js',
    status: 'implemented',
    detail: 'TOKEN REQUEST DEBUG block and token response dump removed from api/google-ads.js.',
  });

  // ── 2. EXECUTE_SECRET configured ────────────────────────────────────────────
  const secretSet = !!process.env.EXECUTE_SECRET;
  checks.push({
    id:     'execute_secret_set',
    title:  'EXECUTE_SECRET env var is set',
    status: secretSet ? 'pass' : 'warn',
    detail: secretSet
      ? 'EXECUTE_SECRET is present — mutation endpoints will enforce the x-execute-secret header.'
      : 'EXECUTE_SECRET is NOT set — mutation endpoints are currently unprotected (will warn in logs). Add EXECUTE_SECRET to Vercel env vars and redeploy.',
  });

  // ── 3. Mutation endpoints protected ─────────────────────────────────────────
  // Static assertion: auth is added to execute-action, meta-creative,
  // create-facebook-campaign, create-google-campaign.
  checks.push({
    id:     'mutation_auth_wired',
    title:  'x-execute-secret auth wired to mutation endpoints',
    status: 'implemented',
    detail: 'requireExecuteSecret() is called at handler entry in execute-action.js, meta-creative.js, create-facebook-campaign.js, create-google-campaign.js.',
  });

  // ── 4. Creative publish gated through approval queue ────────────────────────
  // Static assertion: doPublish() and handlePush() in the dashboard
  // now POST to /api/actions (pending queue) instead of /api/meta-creative.
  checks.push({
    id:     'creative_publish_gated',
    title:  'Creative publishing routes through the approval queue',
    status: 'implemented',
    detail: 'doPublish() and handlePush() in marketing-bot-dashboard.jsx POST to /api/actions with action_type="publish_creative". The Meta creative API is only called from execute-action.js after human approval.',
  });

  // ── 5. Idempotency lock wired ────────────────────────────────────────────────
  // Static assertion: execute-action.js does an atomic update
  // (execution_result: null → 'executing') before calling any platform API.
  checks.push({
    id:     'idempotency_lock',
    title:  'Execution idempotency lock in execute-action.js',
    status: 'implemented',
    detail: 'execute-action.js atomically sets execution_result="executing" with .eq("status","approved").is("execution_result",null) before any platform API call. Duplicate requests return 409.',
  });

  // ── 6. Manual action types handled correctly ─────────────────────────────────
  checks.push({
    id:     'manual_types_safe',
    title:  'adjust_budget / adjust_bid return requires_manual — no platform call',
    status: 'implemented',
    detail: 'MANUAL_TYPES in execute-action.js returns {requires_manual:true, executed:false} and marks execution_result="requires_manual" without touching any ad platform API.',
  });

  // ── 7. META_ACCESS_TOKEN present ────────────────────────────────────────────
  // Preserved for backward compatibility. Stage B1 moved FPB's actual Meta
  // token into ad_platform_connections — see the account_config section below
  // for the per-account view. This env check is still useful as a fallback
  // signal for environments not yet migrated.
  const metaTokenSet = !!process.env.META_ACCESS_TOKEN;
  checks.push({
    id:     'meta_token_set',
    title:  'META_ACCESS_TOKEN env var is set',
    status: metaTokenSet ? 'pass' : 'warn',
    detail: metaTokenSet
      ? 'META_ACCESS_TOKEN is present.'
      : 'META_ACCESS_TOKEN is not set — Meta API calls will fail.',
  });

  // ── 8. Stage B1 account_config ──────────────────────────────────────────────
  // Resolve FPB's account row and its two platform connections. We report
  // ONLY presence booleans for each resolved_* field — never the actual
  // value — so this endpoint stays safe to call from any context.

  let fpbAccount = null;
  let fpbAccountLookupError = null;
  try {
    fpbAccount = await getAccountBySlug(FPB_DEFAULT_SLUG);
  } catch (err) {
    fpbAccountLookupError = err?.message || 'unknown error';
  }

  let googleConn = null;
  let metaConn   = null;
  if (fpbAccount) {
    try { googleConn = await getConnectionForAccount(fpbAccount.id, 'google_ads'); }
    catch { /* treat as missing */ }
    try { metaConn   = await getConnectionForAccount(fpbAccount.id, 'meta_ads'); }
    catch { /* treat as missing */ }
  }

  // Boolean presence map — this is the authoritative shape consumers should
  // grep. Never contains resolved values, only true/false flags.
  const accountConfig = {
    fpb_account_exists:                   !!fpbAccount,
    fpb_account_active:                   fpbAccount?.status === 'active',
    fpb_google_ads_connection_exists:     !!googleConn,
    fpb_google_ads_account_id_present:    !!googleConn?.resolved_account_id_external,
    fpb_google_ads_manager_id_present:    !!googleConn?.resolved_manager_account_id,
    fpb_google_ads_refresh_token_present: !!googleConn?.resolved_refresh_token,
    fpb_meta_ads_connection_exists:       !!metaConn,
    fpb_meta_ads_account_id_present:      !!metaConn?.resolved_account_id_external,
    fpb_meta_ads_access_token_present:    !!metaConn?.resolved_access_token,
  };

  // Mirror each account_config boolean as a check entry so the existing
  // checks-array UI surfaces it alongside the Safety Sprint 1 checks.
  function pushConfigCheck(id, title, ok, missingDetail) {
    checks.push({
      id,
      title,
      status: ok ? 'pass' : 'warn',
      detail: ok ? 'Present.' : missingDetail,
    });
  }

  pushConfigCheck(
    'fpb_account_exists',
    'FPB account row exists in accounts table',
    accountConfig.fpb_account_exists,
    fpbAccountLookupError
      ? `Lookup failed: ${fpbAccountLookupError}`
      : `No accounts row found for slug="${FPB_DEFAULT_SLUG}". Run sql/008 migration or insert the FPB row.`,
  );
  pushConfigCheck(
    'fpb_account_active',
    'FPB account.status is "active"',
    accountConfig.fpb_account_active,
    fpbAccount
      ? `FPB account status is "${fpbAccount.status}", expected "active".`
      : 'FPB account does not exist — cannot evaluate status.',
  );
  pushConfigCheck(
    'fpb_google_ads_connection_exists',
    'FPB has a google_ads row in ad_platform_connections',
    accountConfig.fpb_google_ads_connection_exists,
    'No ad_platform_connections row for (FPB, google_ads).',
  );
  pushConfigCheck(
    'fpb_google_ads_account_id_present',
    'FPB google_ads connection resolves customer ID',
    accountConfig.fpb_google_ads_account_id_present,
    'resolved_account_id_external is null — check account_id_external column or env reference.',
  );
  pushConfigCheck(
    'fpb_google_ads_manager_id_present',
    'FPB google_ads connection resolves manager account ID',
    accountConfig.fpb_google_ads_manager_id_present,
    'resolved_manager_account_id is null — check manager_account_id column or env reference.',
  );
  pushConfigCheck(
    'fpb_google_ads_refresh_token_present',
    'FPB google_ads connection resolves refresh token',
    accountConfig.fpb_google_ads_refresh_token_present,
    'resolved_refresh_token is null — check refresh_token_reference column or env var.',
  );
  pushConfigCheck(
    'fpb_meta_ads_connection_exists',
    'FPB has a meta_ads row in ad_platform_connections',
    accountConfig.fpb_meta_ads_connection_exists,
    'No ad_platform_connections row for (FPB, meta_ads).',
  );
  pushConfigCheck(
    'fpb_meta_ads_account_id_present',
    'FPB meta_ads connection resolves ad account ID',
    accountConfig.fpb_meta_ads_account_id_present,
    'resolved_account_id_external is null — check account_id_external column or env reference.',
  );
  pushConfigCheck(
    'fpb_meta_ads_access_token_present',
    'FPB meta_ads connection resolves access token',
    accountConfig.fpb_meta_ads_access_token_present,
    'resolved_access_token is null — check access_token_reference column or env var.',
  );

  // ── Aggregate ───────────────────────────────────────────────────────────────
  // overall_pass requires every check to pass — both the legacy Safety
  // Sprint 1 checks AND every account_config check. A missing FPB row,
  // missing connection, or any null resolved_* field will flip it false.
  const allChecksPass    = checks.every(c => c.status === 'pass' || c.status === 'implemented');
  const accountConfigPass = Object.values(accountConfig).every(Boolean);
  const overallPass      = allChecksPass && accountConfigPass;

  return res.status(200).json({
    sprint:         'Safety Sprint 1 + Stage B1',
    overall:        overallPass ? 'PASS' : 'WARN',
    overall_pass:   overallPass,
    account_config: accountConfig,
    checks,
    note: 'Status "implemented" means the change is in the code. Status "pass"/"warn" means a live runtime value was checked. account_config returns presence booleans only — never resolved token values.',
  });
}
