# Known Security Gaps

This file tracks known security issues that have been identified but not yet remediated.
Each entry should be addressed in a dedicated security sprint, not bundled with feature work.

## High Priority

## Medium Priority

### Hardcoded Google Ads customer IDs in code
- **Discovered:** Phase 0B inspection
- **Risk:** If env vars unset on Vercel, code falls through to hardcoded production FPB customer ID `8325311811` and manager ID `5435219372` (see `api/google-ads.js:36`, `api/google-ads.js:75`, `api/lib/execute-action-logic.js:68`).
- **Mitigation in place:** Env vars currently set in production. Hardcoded values are NON-SECRET (Google customer IDs are not sensitive, but binding code to a single account is a maintainability issue, not just security).
- **Plan:** Removed in Stage A2 (fail-fast pattern). After Stage A2, code throws if env unset, and customer IDs come from `ad_platform_connections.account_id_external`.

## Resolved

### Dashboard routes had no authentication (16 routes)
- **Discovered:** Phase 0B inspection
- **Resolved:** July 2, 2026 — Admin Session Auth Sprint (Phase B)
- **Fix:** `requireAdmin` middleware added to all 16 dashboard-facing API routes. Cookie-based session with HMAC-SHA256 signatures and 12-hour expiry. Password verified with `timingSafeEqual`. Production fail-closed (`AUTH_NOT_CONFIGURED` 503) when `ADMIN_PASSWORD` or `AUTH_SECRET` is unset. LoginScreen component in dashboard intercepts 401s via `prime:unauthorized` custom event.
- **Routes covered:** `/api/accounts`, `/api/account-budget`, `/api/actions`, `/api/action-outcomes`, `/api/approve-action`, `/api/automation-log`, `/api/autonomy-holdout-classes`, `/api/cost-hours`, `/api/cost-rollup`, `/api/cost-subscriptions`, `/api/performance-snapshots`, `/api/leads` (GET + PATCH only; POST keeps `LEADS_INGEST_SECRET`), `/api/google-ads`, `/api/facebook-ads`, `/api/analyze-ads`, `/api/chat`.
- **Internal callers fixed:** `api/analyze-ads.js` and `api/chat.js` previously HTTP-fetched `/api/google-ads` and `/api/facebook-ads`. Replaced with direct named-export imports (`fetchGoogleAdsData`, `fetchMetaAdsData`) — no internal HTTP to gated routes.

### RLS disabled / permissive policies on Supabase tables
- **Discovered:** July 2, 2026 (Phase 0 audit via Supabase security advisors)
- **Was:** 10 tables with RLS fully disabled (including ad_platform_connections,
  autonomy_posture, autonomy_holdout_classes, chat_messages) plus 4 tables
  (actions, agent_config, automation_log, performance_snapshots) with a
  misnamed "Service key full access" USING(true) policy that granted all
  roles, not just the service key.
- **Fix:** sql/015_rls_remediation.sql applied to production (project
  olpyqfuphiwdongzmazi) on July 2, 2026. RLS enabled on all 17 public tables,
  zero anon/authenticated policies (deny-by-default), direct grants revoked
  from anon/authenticated. Zero app impact — all queries flow through /api
  routes on the service-role key, which bypasses RLS.
- **Verified:** Supabase security advisors show no ERROR-level lints
  post-apply. Dashboard, Live Data, and chat confirmed working in production.
- **Remaining related follow-up:** two functions with mutable search_path
  (accounts_enforce_one_level_hierarchy, increment_posture_outcome) — WARN
  level, tracked for a future cleanup.
