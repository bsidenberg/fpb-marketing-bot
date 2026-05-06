# Known Security Gaps

This file tracks known security issues that have been identified but not yet remediated.
Each entry should be addressed in a dedicated security sprint, not bundled with feature work.

## High Priority

### /api/approve-action has no authentication
- **Discovered:** Phase 0B inspection
- **Risk:** Any caller with a valid action ID can trigger ad mutations on the resolved account's Google or Meta accounts.
- **Mitigation in place:** Idempotency lock prevents double-execution. EXECUTE_SECRET on /api/execute-action is the deeper layer for direct execution.
- **Why deferred:** Adding EXECUTE_SECRET to /api/approve-action would expose it to the browser dashboard. Proper fix requires admin auth (Supabase Auth, magic link, or session cookie) which deserves its own sprint.
- **Plan:** Address in dedicated security sprint between Phase 1 and Phase 2.

### PATCH /api/leads has no authentication
- **Discovered:** Phase 0B inspection
- **Risk:** Anyone can mutate lead status, qualification, booked_revenue, gross_profit on any lead.
- **Mitigation in place:** None.
- **Why deferred:** Same as above — would expose secret to browser. Needs admin auth.
- **Plan:** Address in dedicated security sprint.

### /api/accounts has no authentication
- **Discovered:** Phase 1 Stage A1 (introduced)
- **Risk:** Read-only endpoint exposes account configuration metadata (slugs, names, industries, websites, budgets, caps, targets, autonomy levels, health scores) without authentication.
- **Mitigation in place:** Endpoint explicitly excludes token references, ad_platform_connections data, and any secrets via a field whitelist enforced through a hardcoded SELECT clause. Tests verify exclusion in three layers: response body content, SELECT clause content, and `from()` call recording (`tests/accounts-api.test.js`).
- **Why deferred:** Phase 1 Stage A1 is internal-use only. No external clients have access yet.
- **Plan:** Add admin auth in dedicated security sprint, alongside other auth gap fixes.

## Medium Priority

### Hardcoded Google Ads customer IDs in code
- **Discovered:** Phase 0B inspection
- **Risk:** If env vars unset on Vercel, code falls through to hardcoded production FPB customer ID `8325311811` and manager ID `5435219372` (see `api/google-ads.js:36`, `api/google-ads.js:75`, `api/lib/execute-action-logic.js:68`).
- **Mitigation in place:** Env vars currently set in production. Hardcoded values are NON-SECRET (Google customer IDs are not sensitive, but binding code to a single account is a maintainability issue, not just security).
- **Plan:** Removed in Stage A2 (fail-fast pattern). After Stage A2, code throws if env unset, and customer IDs come from `ad_platform_connections.account_id_external`.
