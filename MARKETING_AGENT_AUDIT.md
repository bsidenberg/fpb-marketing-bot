# MARKETING_AGENT_AUDIT.md — Prime Phase 0 Repository Audit

**Audited:** July 2, 2026
**Source:** `prime-audit.zip` (git archive of HEAD, matches production commit lineage `8df0789`) + live Supabase inspection of project `olpyqfuphiwdongzmazi` via read-only MCP.
**Test suite verified in audit sandbox:** 425/425 passing (25 files) — exact match to documented test floor.

---

## 1. Project Structure

```
/
├── api/                      25 Vercel serverless routes
│   └── lib/                  19 shared modules (supabase, cors, auth, attribution,
│                             autonomy-coordinator, execute-action-logic, cost ledger,
│                             lead-ingest, prompts/fpb.js)
├── src/main.jsx              Vite entry (mounts dashboard)
├── src/lib/chatImageUtils.js
├── marketing-bot-dashboard.jsx   ⚠️ 236 KB single-file React dashboard (entire UI)
├── sql/                      14 SQL files (001–014), applied ad hoc — NOT tracked
│                             in supabase_migrations (see §5)
├── tests/                    25 vitest files, 425 tests
├── scripts/preflight-b1-check.mjs
├── .claude/settings.json
└── docs: PRIME-STRATEGY.md, MARKETING_BOT_PLAN.md, TENANT-MODEL-SPEC.md,
    AUDIT-PHASE-0.md, KNOWN_SECURITY_GAPS.md, PRIME-TRIAGE-HANDOFF.md,
    VOICE-STACK-DECISION.md, DEPLOY.md, FSC-STACK-INSPECTION.md
```

## 2. Framework and Stack

Vite 5 + React 18 SPA frontend; Vercel serverless functions (plain JS, no framework) for the API; Supabase Postgres accessed **exclusively server-side via service-role key** (`api/lib/supabase.js`); vitest 2 for tests; sharp for image processing; Anthropic API for analysis/chat; Google Ads API **v23**; Meta Graph API **v19.0 (deprecated — Bug 19, open)**.

**Notable:** The frontend contains **zero direct Supabase calls**. `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` exist in `.env.example` but are unused by the app — vestigial. All data flows through `/api`. This is the single most important architectural fact for the RLS remediation: enabling RLS breaks nothing.

## 3. Existing API Routes (25)

**Secret-gated (8):** `execute-action` (EXECUTE_SECRET), `leads` POST ingest (LEADS_INGEST_SECRET), `image-process`, `meta-creative`, `create-facebook-campaign`, `create-google-campaign`, `autonomy-posture`, `verify-safety` (partial).
**Cron-gated (2):** `cron-analyze`, `evaluate-outcomes` (Bearer CRON_SECRET / x-vercel-cron).
**Unauthenticated (15):** `accounts`, `account-budget`, `actions`, `action-outcomes`, **`approve-action`** ⚠️, `analyze-ads` ⚠️ (spends Anthropic tokens), `automation-log`, `autonomy-holdout-classes`, **`chat`** ⚠️ (spends tokens, creates actions), `cost-hours`, `cost-rollup`, `cost-subscriptions`, `facebook-ads`, `google-ads` (live platform reads), `performance-snapshots`.

CORS is origin-locked (`api/lib/cors.js`, well-built) — but CORS only constrains browsers. Any curl/server can call unauthenticated routes directly.

## 4. Existing Database Schema (live, 17 tables)

| Table | Rows | RLS | Notes |
|---|---|---|---|
| actions | 26 | ✅ but policy is `USING(true)` for ALL roles | Effectively open |
| automation_log | 0 | ✅ same defect | Effectively open |
| performance_snapshots | 0 | ✅ same defect | Effectively open |
| agent_config | 7 | ✅ same defect | Effectively open |
| leads | 263 | ✅ no policy (deny-default) | Correct |
| action_outcomes | 0 | ✅ no policy | Correct |
| campaign_daily_stats | 0 | ✅ no policy | Correct |
| accounts | 4 | ❌ **disabled** | Tenant registry |
| ad_platform_connections | 2 | ❌ **disabled** | ⚠️ credential references |
| ai_analysis_runs | 43 | ❌ disabled | |
| cost_subscriptions / cost_api_events / cost_hours / cost_rollups_monthly | 0/101/0/0 | ❌ disabled | Cost telemetry |
| autonomy_posture | 1 | ❌ **disabled** | ⚠️ safety config writable via anon key |
| autonomy_holdout_classes | 7 | ❌ **disabled** | ⚠️ safety config |
| chat_messages | 66 | ❌ disabled | Flagged: sensitive `session_id` |

## 5. Existing Migrations

`sql/001` – `sql/014` exist as files, but **`supabase_migrations` history in production is empty** — every change was applied ad hoc (SQL editor / MCP). Known consequence already bitten once: Bug 10 schema drift (`execution_result` vs `result`). **Recommendation:** adopt Supabase CLI migration tracking; capture current production schema as a baseline migration before any further DDL.

## 6. Existing Tests

25 files / 425 tests, all passing. Strong coverage: attribution, account isolation, action states, approve/execute flows, rate limiting, CORS, secrets, cost ledger, autonomy coordinator, cron logic, lead ingest. **Known gap (from handoff doc):** `recordActionOutcome` mock lacks `.rpc` — the outcome-logging path is not truly exercised.

## 7. Environment Variables

21 documented in `.env.example`: Supabase (2 + 2 vestigial VITE_), secrets (EXECUTE / IMAGE_PROCESS / LEADS_INGEST / CRON), ALLOWED_ORIGINS, OUTCOME_WINDOW_DAYS, ENABLE_MULTI_ACCOUNT_CRON, Google Ads (6), Meta (3), ANTHROPIC_API_KEY. Full breakdown belongs in `ENVIRONMENT_REQUIREMENTS.md` (Phase 15 — not yet written).

## 8. Google Ads Integration

**Working end-to-end.** v23. OAuth refresh-token flow, MCC `login-customer-id` header. Budget changes validated live in both directions on campaign `21613067659` (June 16). Slow-path GET-then-mutate resolves `budget_id` when absent. Pause/resume and negative keywords share the code path but are **unvalidated in production**. Hardcoded customer-ID fallbacks removed in Stage A2 (fail-fast); credentials resolve via `ad_platform_connections`.

## 9. Meta Ads Integration

Present (`facebook-ads.js`, `meta-creative.js`, `create-facebook-campaign.js`, executors in `execute-action-logic.js`) but on **deprecated Graph v19.0 across 6 call sites in 4 files** (Bug 19, open). Meta App previously blocked in Development mode — Live mode fix applied per project history. Treat Meta write paths as unvalidated.

## 10. SEO Functionality

**None.** No GSC integration, no decay detection, no content tooling. Phase 9 of the operator spec is greenfield.

## 11. Blog/Content Functionality

**None** in this repo. (Joseph chatbot and site content live in the fpb-website repo.) Phase 10 agents are greenfield.

## 12. Lead Ingestion Flow

`POST /api/leads` gated by LEADS_INGEST_SECRET → `api/lib/lead-ingest.js` → `leads` table (263 rows live). Supports qualification fields, booked_revenue, gross_profit. **Gap:** `PATCH /api/leads` is unauthenticated (KNOWN_SECURITY_GAPS) — anyone can rewrite lead economics, which poisons the truth layer the optimizer learns from.

## 13. Attribution Flow

`api/lib/attribution.js` + tests + `normalize-channel.js`. UTM/channel normalization present (Bug 1 fixed markdown-polluted channel names). GCLID/FBCLID handling: partial — needs verification against website form payloads. Sold-job → campaign joinback not yet closed (CRM linkage absent).

## 14. Recommendation / Action / Outcome Flow

Exists and is the strongest part of the codebase:
- `actions` table with state machine (`api/lib/action-states.js`), idempotency lock (Bug 12A hardened), MANUAL_TYPES classification (Bug 12B).
- `approve-action` → `execute-action-logic.js` → platform executors → `recordActionOutcome` (fire-and-forget) → `evaluate-outcomes` cron grades against `campaign_daily_stats`.
- `action_outcomes` schema exists (before/after windows, "directional only — not causal" per table comment) but has **0 rows** — the learning loop has never closed because `campaign_daily_stats` is also empty (no daily stats ingestion job populating it).

**Missing vs Phase 3 spec:** no dry-run mode, no before/after snapshots, no rollback payloads, no per-action max_spend_impact, no risk_level field, no append-only enforcement at the DB layer.

## 15. Approval Workflow

Present: actions stage as pending; dashboard Approve button → `/api/approve-action` → execute. Autonomy coordinator (`checkPostureForAction`) gates auto-execution with verdicts: holdout list → posture tier → cadence cap → confidence → novelty → conflict → anomaly → escalation flag, **failing closed to `require_approval` on any error**. This is genuinely well-designed.
**Critical hole:** `/api/approve-action` itself is **unauthenticated** — approval authority is "anyone who knows the URL." The gate logic is sound; the door to the gate is open.

## 16. Cron Jobs

Two Vercel crons, both CRON_SECRET-gated: `cron-analyze` (12:30 UTC daily — AI analysis run) and `evaluate-outcomes` (13:00 UTC daily). Multi-account cron behind `ENABLE_MULTI_ACCOUNT_CRON` flag (deferred per strategy). No hourly watch loop, no weekly/monthly loops (Phase 11 gaps).

## 17. UI Pages

Single-file dashboard (236 KB): account switcher (Bug 2 — `/api/accounts` 500 still open), Live Data (campaigns + Campaign ID + Budget ID columns), chat with clipboard-paste screenshots, approvals, automation log, cost tracking, autonomy posture. **Maintainability risk:** one 236 KB JSX file is beyond safe hand-editing; component extraction should precede major UI phases. Cosmetic: `**` markdown leaking into campaign names.

## 18. Reporting Features

Cost ledger (api events populated: 101 rows; rollups job exists), performance snapshots (schema only, 0 rows), automation log (0 rows). No CFO-style spend-vs-profit reporting (Phase 11 monthly loop gap).

## 19. Broken / Incomplete Areas

1. **Bug 2 (open, NEXT):** `/api/accounts` 500 — references dropped/missing column; account switcher errors in prod logs.
2. **Bug 3 (verify):** `/api/chat` GET 500 — possibly fixed by Bug 6's `chat_messages` creation.
3. **Bug 19 (open):** Meta Graph v19.0 deprecated, 6 call sites.
4. `campaign_daily_stats` never populated → outcome evaluation and learning loop inert.
5. `recordActionOutcome` test mock gap.
6. Vestigial files: `generate-token.py`, `get-google-token.js`, `test-token.js` (one-time token helpers), unused VITE_SUPABASE_* vars.

## 20. Risks to Safe Autonomy (ranked)

1. **Unauthenticated `/api/approve-action`** — external actors can approve and thereby execute staged ad mutations. This is the #1 item, above RLS.
2. **RLS disabled on `autonomy_posture` / `autonomy_holdout_classes` / `ad_platform_connections`** — with the anon key (present in Supabase dashboard, trivially obtainable if ever shipped), an attacker can rewrite the bot's own safety configuration and credential references. Fix is zero-breakage (see §2).
3. **Unauthenticated `PATCH /api/leads`** — poisonable ground truth = poisoned optimization decisions.
4. **Unauthenticated `/api/chat` + `/api/analyze-ads`** — token-spend denial-of-wallet; chat can also stage actions.
5. **No spend-percentage budget guards** — coordinator caps action *frequency* (cadence cap), not *magnitude*. Nothing stops an approved action from a 10x budget change. Phase 6 gap.
6. **No dry-run / snapshot / rollback in execution path** — Phase 3 gap.
7. **No DB-level append-only enforcement** on `automation_log` / future execution logs.
8. **Untracked migrations** — schema drift class of bug (Bug 10) will recur.

## 21. Security Concerns

Everything in §20, plus: `Service key full access` policies on 4 tables are `USING(true)` for ALL roles (misnamed — they grant anon, not just service); `chat_messages.session_id` flagged by linter as sensitive and exposed; two functions with mutable `search_path` (`accounts_enforce_one_level_hierarchy`, `increment_posture_outcome`); no rate limiting on unauthenticated AI endpoints (a `rate-limit.js` lib exists — verify coverage); Vercel Protection Bypass token handling in PowerShell sessions (fine, keep out of repo).

## 22. Data Quality Concerns

`campaign_daily_stats` empty (blocks outcomes); `performance_snapshots` empty; lead economics mutable by anyone (§20.3); channel normalization good but GCLID capture unverified end-to-end; sold-job revenue/GP joinback to CRM absent — "gross-profit ROAS" is currently unanswerable; 4 tenant accounts seeded but only FPB validated.

## 23. Recommended Implementation Sequence

**Sprint S0 — Lock the doors (before ANY new features):**
&nbsp;&nbsp;a. Apply `sql/015_rls_remediation.sql` (prepared, zero-breakage — Brian reviews and applies).
&nbsp;&nbsp;b. Admin auth on the dashboard + API (Supabase Auth or signed session cookie; Vercel middleware checking it on all non-webhook routes). Closes §20 items 1, 3, 4 in one mechanism. This was already the plan in KNOWN_SECURITY_GAPS ("dedicated security sprint") — it is now due.
&nbsp;&nbsp;c. Fix Bug 2 (accounts 500) — small, blocks daily use.
&nbsp;&nbsp;d. Adopt migration tracking; baseline the schema.

**Sprint S1 — Truth layer foundations (spec Phase 2 + 1):**
&nbsp;&nbsp;a. Build the `campaign_daily_stats` ingestion job (Google first) — unblocks outcomes/learning.
&nbsp;&nbsp;b. Connection Health endpoint + dashboard section (spec Phase 1) — mostly assembling checks that `verify-safety.js` already prototypes.
&nbsp;&nbsp;c. Fix `recordActionOutcome` mock; verify Bug 3.

**Sprint S2 — Harden the action architecture (spec Phase 3 + 6):**
&nbsp;&nbsp;a. Add dry-run, before/after snapshots, rollback payloads, `max_spend_impact`, `risk_level` to the existing action flow (extend, don't rebuild).
&nbsp;&nbsp;b. Spend-percentage budget guards with `agent_config`-driven limits (target CPL $50 / warn $75 / emergency $100; ±10–20% auto bands; ≥25% = approval).
&nbsp;&nbsp;c. DB triggers making `automation_log` and execution records append-only.

**Sprint S3 — Meta parity + operator loops (spec Phases 8, 11):** Graph v19→current; validate Meta writes with the S2 safety rails; hourly watch loop.

**Defer (unchanged from strategy):** SEO/content tooling (Phases 9–10), multi-tenant cron, Level-5 autonomy (recommend: never build the switch), brand voice.

---

## Output Requirements Report (per master prompt)

1. **Inspected:** full repo tree, all 25 API routes' auth posture, safety/coordinator/execution libs, CORS, crons, 14 SQL files, live DB schema + security advisors + migration history, env inventory, 6 project docs.
2. **Changed:** nothing in the repo. Two new files prepared for review.
3. **Files produced:** `MARKETING_AGENT_AUDIT.md`, `sql/015_rls_remediation.sql`.
4. **Tests added:** none (audit phase).
5. **Tests passing:** 425/425 verified in sandbox.
6. **Risks found:** §20–22.
7. **Follow-up:** Sprint S0 items.
8. **Credentials required:** none for this phase.
9. **DB migration proposed:** yes — `015_rls_remediation.sql`, **not applied**, awaiting Brian's review.
10. **Live-platform execution enabled:** no.
