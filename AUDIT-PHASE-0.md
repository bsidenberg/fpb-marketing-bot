# Phase 0 Capability Audit — FPB Marketing Bot → Prime

Owner: Brian Sidenberg
Auditor: Claude Code
Date: 2026-05-14
Repo: `C:\Users\BrianSidenberg\Python\FPB Marketing Bot`
Reference: `PRIME-STRATEGY.md` v1.0

This audit maps the current codebase against the Prime vision. Sections 1–12 are factual. Section 13 is recommendation, not commitment.

---

## 1. Repo state baseline

- **HEAD:** `4eb1363` — `docs: add PRIME-STRATEGY.md — product strategy v1.0`
- **Working tree:** clean
- **Tracked files:** 72
- **Total LOC (tracked):** 22,662
- **Tests:** `npm test` → **250 passed, 15 test files, 2.07s**

Last 10 commits:

| SHA | Subject |
|---|---|
| `4eb1363` | docs: add PRIME-STRATEGY.md |
| `46e4db5` | fix(nav): tab bar contrast — weight + active text WCAG fix |
| `a611188` | chore(dev): proxy /api/* to Vercel deploy in vite dev server |
| `7a0b508` | fix(glass): preserve accent top rim above ::before highlight |
| `30cc90a` | feat(overview): retrofit body to glass + multi-accent (Sub-stage 3) |
| `5574347` | Design Refresh Sub-stage 2: header + tab bar glass treatment |
| `8e4bb62` | Design Refresh Sub-stage 1: foundation (tokens, glass primitive, density toggle) |
| `668c827` | Phase 1 Stage B2: dashboard account-aware retrofit |
| `c57acc5` | Phase 1 Stage B1: backend account-aware retrofit |
| `b61788d` | fix: remove chat_messages MANUAL APPLY block from sql/008 |

Code distribution: `marketing-bot-dashboard.jsx` is 4,527 LOC (60% of frontend). The 23 API routes total ~3,400 LOC. Tests cover 250 cases across 15 files. SQL migrations: 8 files, 005–008 introduced the multi-account schema in Stage A1.

---

## 2. Multi-tenant architecture audit

### 2.1 Database schema

| Table | Tenant column | Source | Classification |
|---|---|---|---|
| `accounts` | (is the tenant table) | `sql/005_accounts.sql:15-81` | **READY** |
| `ad_platform_connections` | `account_id` FK NOT NULL | `sql/006_ad_platform_connections.sql:29` | **READY** |
| `leads` | `account_id` NOT NULL FK + `client_key` legacy | `sql/008_account_id_backfill.sql:60-73` | **READY** |
| `action_outcomes` | `account_id` NOT NULL FK | `sql/008_account_id_backfill.sql:93-106` | **READY** |
| `campaign_daily_stats` | `account_id` NOT NULL FK + new unique idx leading with account_id | `sql/008_account_id_backfill.sql:111-131` | **READY** |
| `ai_analysis_runs` | `account_id` FK (ON DELETE SET NULL) | `sql/007_ai_analysis_runs.sql:21` | **READY** |
| `actions` | `account_id` NOT NULL FK — **MANUAL APPLY block, not in committed SQL** | `sql/008_account_id_backfill.sql:175-186` | **NOMINAL** |
| `automation_log` | `account_id` NULLABLE FK — **MANUAL APPLY block** | `sql/008_account_id_backfill.sql:188-196` | **NOMINAL** |
| `performance_snapshots` | `account_id` NULLABLE FK — **MANUAL APPLY block** | `sql/008_account_id_backfill.sql:198-206` | **NOMINAL** |
| `chat_messages` | does not exist in production | `sql/008_account_id_backfill.sql:208-213`, `api/chat.js:64-73` | **MISSING** |

**RLS:** No `CREATE POLICY` statements in any committed migration. RLS is **not enforced at the database**. The Supabase client (`api/lib/supabase.js:1-10`) uses the service role key which bypasses RLS regardless. Cross-tenant safety is enforced only by the API layer through `account_id` filters and ownership checks (e.g. `api/actions.js:63-69`, `api/leads.js:225-231`, `api/approve-action.js:87-93`).

**Critical inspection finding:** Three tables (`actions`, `automation_log`, `performance_snapshots`) have their `account_id` `ALTER TABLE` blocks commented out as MANUAL APPLY in `sql/008_account_id_backfill.sql:175-213`. Code in `api/analyze-ads.js:286,313,330`, `api/lib/execute-action-logic.js:48-58`, `api/cron-analyze.js:114`, and `api/automation-log.js:47` writes/reads `account_id` against these tables. If the manual blocks were not run in production, every cron analysis run would fail at the first INSERT. Since `/api/verify-safety` reportedly returns `overall_pass=true` and Stage B1 shipped, we infer the MANUAL APPLY blocks were applied to production — but no committed migration records this. Phase 0 should either (a) record application in a follow-up migration that converts these blocks to executable form with idempotency guards, or (b) verify against the live DB and document.

To reach READY for the three NOMINAL tables: commit a `sql/009_*.sql` that converts the MANUAL APPLY comment block into executable, idempotent statements (the `IF NOT EXISTS` guards already handle re-application). The `chat_messages` table needs a fresh migration if chat is to ship.

### 2.2 API routes

| Route | Method(s) | Tenant resolution | Classification |
|---|---|---|---|
| `/api/accounts` | GET | reads all accounts (tenant-list endpoint) | **READY** |
| `/api/account-budget` | GET | `resolveForRead` | **READY** |
| `/api/action-outcomes` | GET | `resolveForRead` | **READY** |
| `/api/actions` | GET/POST/PATCH | `resolveForRead`/`resolveForWrite` + ownership check on PATCH | **READY** |
| `/api/analyze-ads` | GET/POST | `resolveForWrite` + per-platform connection lookup | **READY** |
| `/api/approve-action` | POST | `resolveForWrite` + ownership check | **READY** (auth gap separate) |
| `/api/automation-log` | GET | `resolveForRead`; cron-level rows (account_id NULL) intentionally hidden | **READY** |
| `/api/chat` | GET/POST | `resolveForRead`/`resolveForWrite` + chat_messages preflight | **READY** (table missing) |
| `/api/cron-analyze` | GET | `ENABLE_MULTI_ACCOUNT_CRON` env flag — default false → FPB only | **NOMINAL** |
| `/api/evaluate-outcomes` | GET | same flag, same default | **NOMINAL** |
| `/api/execute-action` | POST | `resolveForWrite` + ownership check | **READY** |
| `/api/facebook-ads` | GET | `resolveForRead` + connection lookup | **READY** |
| `/api/google-ads` | GET | `resolveForRead` + connection lookup | **READY** |
| `/api/leads` | GET/POST/PATCH | account-scoped; PATCH ownership-checked | **READY** |
| `/api/meta-creative` | POST | `resolveForWrite` + connection lookup | **READY** |
| `/api/create-google-campaign` | POST | per `tests/account-isolation.test.js` it enforces resolveForWrite + connection | **READY** |
| `/api/create-facebook-campaign` | POST | same | **READY** |
| `/api/image-process` | POST | **no account scoping** — pure image transform; not tenant-relevant today | **N/A** |
| `/api/performance-snapshots` | GET | `resolveForRead` | **READY** |
| `/api/verify-safety` | GET | hardcoded to inspect FPB only (`api/verify-safety.js:111-126`) | **SINGLE-TENANT** |

**Tenant identification convention:** `?account=<slug>` query param wins, then `x-account-slug` header, defaults to `'fpb'` with a console warning (`api/lib/accounts.js:113-124`). This is consistent across all routes. The default fallback is the single biggest design risk for multi-tenant correctness — a forgotten parameter on a new client call silently writes to FPB. Tests do not currently exist for "what happens when slug is omitted" — the implicit default is the test.

`/api/verify-safety` is hardcoded to FPB by name (`FPB_DEFAULT_SLUG` in `api/verify-safety.js:111-140`). To reach READY it should iterate `listActiveAccounts()` and report per-account.

### 2.3 Background jobs / cron

Two cron entries in `vercel.json:17-25`:
- `/api/cron-analyze` daily 12:30 UTC
- `/api/evaluate-outcomes` daily 13:00 UTC

Both gated by `ENABLE_MULTI_ACCOUNT_CRON` (`api/cron-analyze.js:33-35`, `api/evaluate-outcomes.js:50-52`). When `false` (current production default per `.env.example:34`), they process FPB only. When `true`, they iterate `listActiveAccounts()` with per-account error isolation.

Classification: **NOMINAL**. The plumbing is there but the production flag is off; multi-tenant cron behavior has not been exercised against real load.

To reach READY: flip the env flag in production once Weld and FSC are live and have at least one connection. Add monitoring: per-account success/failure attestation in the cron's response and a daily digest somewhere visible.

### 2.4 Dashboard UI

`marketing-bot-dashboard.jsx:8-13` — `accountFetch(url, options, accountSlug='fpb')` injects `?account=<slug>` on every request. Used at 18 fetch sites confirmed by grep. The selected slug is held in React state (`marketing-bot-dashboard.jsx:2688`) and persisted via `localStorage.setItem('selected_account_slug', ...)` (`marketing-bot-dashboard.jsx:2698`). All tab-level fetch effects are keyed on `selectedAccountSlug` (lines 2777, 2867, 2881, 2903, 2918, 2928, 2961) — switching account triggers a full data refetch.

`AccountSelector` (`marketing-bot-dashboard.jsx:23-48`) renders a chip if 1 active account, a dropdown if 2+. Brand strings substitute the selected account's name (`marketing-bot-dashboard.jsx:3117`, `marketing-bot-dashboard.jsx:2943-2944`).

Classification: **READY** for selection + scoping. Cross-tenant data leakage would require the backend to misroute, not the UI. The dropdown's blind spot: if a user creates work for FPB, switches to Weld, then approves, the approval is correctly scoped to whichever tenant the approval action belongs to (server-side ownership check) — but the UX could mislead because the page state is now showing Weld while the approval is for FPB. No issue today (no cross-tenant approval surface), worth designing for as Prime grows.

### 2.5 AI / agent logging

`ai_analysis_runs` table (`sql/007_ai_analysis_runs.sql`) carries `account_id`. Both writers wire it correctly: `api/analyze-ads.js:107-122` and `api/chat.js:80-103`. `automation_log` rows from `analyze-ads`, `execute-action-logic`, `meta-creative` all include `account_id`; the cron-aggregate row in `cron-analyze.js:114-121` deliberately leaves it NULL because that row spans accounts.

Classification: **READY**. One nit: the `automation_log.account_id` filter in `api/automation-log.js:47` excludes the cron-aggregate rows from per-account dashboard views. That's intentional per the file's header comment but means there's no UI surface today for cross-account audit. Phase 4 ops will need it.

### 2.6 Action queue

`actions` table holds the queue. `api/actions.js` GET filters by `account_id` (`api/actions.js:29`). POST inserts with `account_id: account.id` (`api/actions.js:109`). PATCH and approve verify `current.account_id !== account.id → 403 ACCOUNT_MISMATCH` (`api/actions.js:63-69`, `api/approve-action.js:87-93`). `acquireLockAndExecute` re-asserts ownership as TOCTOU defense (`api/lib/execute-action-logic.js:365-367`).

Classification: **READY**, modulo the underlying schema confirmation noted in 2.1.

### 2.7 Performance snapshots / budget / leads

`performance_snapshots` writes carry `account_id` (`api/analyze-ads.js:330`) and reads filter by it (`api/performance-snapshots.js:78,90`). `account-budget` aggregates `campaign_daily_stats.spend` filtered by account (`api/account-budget.js:69`). Leads are fully account-scoped (`api/leads.js:71,94,140`).

Classification: **READY** subject to `performance_snapshots.account_id` actually existing in production (see 2.1).

---

## 3. Pillar capability audit

| Pillar | Status | Evidence |
|---|---|---|
| **Paid ads** | **PARTIAL** (mature for FPB Google + Meta, reusable per-account) | `api/google-ads.js`, `api/facebook-ads.js`, `api/create-*-campaign.js`, full execute path, AI analysis, outcome evaluation |
| **SEO blog content** | **MISSING** | No keyword research, no content generation, no draft storage table, no publishing integration. Zero infrastructure. |
| **Google Business Profile** | **MISSING** | No GBP API integration. No tables for posts, photos, Q&A, reviews. Zero infrastructure. |
| **Social media** | **MISSING** | No Instagram, Facebook organic, LinkedIn, TikTok integration. `meta-creative.js` only handles ad creatives, not organic posts. No image library, no video generation. |

**Detail on paid ads (the only existing pillar):**
- Read paths: 30-day campaign data from Google Ads API v23 (`api/google-ads.js:101`) and Meta Graph API v19.0 (`api/facebook-ads.js:53`)
- Write paths: campaign pause/enable, creative publish, campaign creation (Meta only) — all gated through approval queue
- Auto-execute: code supports `auto_execute=true` field but the prompt deliberately defaults it to `false` for everything except `flag_*` types (`api/lib/prompts/fpb.js:87`); so today every recommendation gates on human approval
- The whole pillar is paid-ads-shaped. Adding a new pillar means new tables, new API integrations, new action types in `EXECUTABLE_TYPES` (`api/lib/action-states.js:38-43`), new executors in `execute-action-logic.js`, new prompts.

**Phase 1 implication:** Three of the four Phase 1 pillars (blog, GBP, voice) are zero-infrastructure greenfield builds. Paid ads is mature for FPB but untested for Weld/FSC because no `ad_platform_connections` rows exist for them yet.

---

## 4. Agent loop audit

The Phase 1 Prime loop: **trigger → research → plan → generate → human review → execute → measure → log → learn**.

| Stage | Code today | Status |
|---|---|---|
| **Trigger** | Vercel cron (`vercel.json:17-25`), HTTP handlers (`api/analyze-ads.js:364`), chat-driven (`api/chat.js:231`). No event-driven triggers. | Partial |
| **Research** | None. The bot reads its own ad performance data but doesn't research keywords, competitors, market trends, or content topics. | Missing for Phase 1 work |
| **Plan** | Implicit in the system prompt — no separate planner step. Claude reads performance data and emits an action list in one shot. | Missing as discrete step |
| **Generate** | Claude Sonnet 4 call in `api/analyze-ads.js:67-101` produces JSON action array. Inputs: live ad data only. | Working for paid ads |
| **Human review** | Approval queue via `actions` table + `/api/approve-action` + dashboard Actions tab. State machine in `api/lib/action-states.js`. Rich. | Working |
| **Execute** | `api/lib/execute-action-logic.js` — atomic idempotency lock, per-action-type executors for pause/enable/publish/create, manual-type gating, TOCTOU defense, audit log. Production-grade for paid ads. | Working |
| **Measure** | `api/evaluate-outcomes.js` runs nightly — builds before/after windows, computes CPL/CPQL deltas, persists to `action_outcomes` with confidence rating. | Working |
| **Log** | `automation_log` (per-action audit) + `ai_analysis_runs` (model invocation lifecycle, latency, prompt version) + `action_outcomes` (post-window evaluation). | Working |
| **Learn** | **None.** No code reads `action_outcomes` or `ai_analysis_runs` to inform future analysis. Each Claude call sees only this run's performance snapshot. | Missing |

**Gaps to make the loop functional end-to-end for new pillars:**

1. **Research stage** does not exist. SEO blog work needs a keyword-research module + topic-ideation step before generation. GBP needs a Q&A/review monitor. The current paid-ads loop skips research because the data the bot needs is the ad performance itself.
2. **Soft-coordinator / cadence rules** do not exist (see Section 5).
3. **Learning** does not exist as a code path. `action_outcomes` is written but never read by a downstream agent. A learning step that summarizes recent outcomes into the next analysis prompt would be the minimum-viable feedback loop.
4. **Per-pillar action types** must be added to `EXECUTABLE_TYPES` and `execute-action-logic.js` for blog publish, GBP post, social post, etc.
5. **Triggers** beyond cron — event-driven triggers (a new lead, a negative review, a competitor price change) have no infrastructure.

---

## 5. Autonomy infrastructure audit

| Capability | Strategy doc requirement | Today |
|---|---|---|
| Two autonomy tiers (T1 approval, T2 full) | Per (tenant × pillar × action class), 20/95% graduation rule | `accounts.autonomy_level` text column with 6-level enum (`sql/005_accounts.sql:54-62`) — single dimension per account, no per-pillar/action-class breakdown. No graduation tracking. |
| Holdout list | 7 always-approval items + per-pillar additions | None. The system has `auto_execute` boolean per action (`api/lib/action-states.js`) but no policy layer that says "this action class is always-approval regardless of autonomy_level". |
| Escalation triggers | 5 triggers (anomaly, conflict, novel, external, low-confidence) | None. The agent confidence value exists in `ai_analysis_runs.input_summary_json` but no code raises/lowers approval gates based on it. |
| Soft coordinator (cadence rules) | Per-tenant per-day/week limits, topic diversity | None. No rate limiting at the action layer. Tests confirm no rule layer exists. |

**What exists today:** A single `autonomy_level` enum on the account row (`level_0_readonly` through `level_5_full`), defaulting to `level_1_diagnostics`. **The enum value is never read by any code.** Grep confirms it's a stored field with no consumer — the strategy doc's autonomy model has zero runtime effect today.

**What needs to be built for Phase 1:**

1. A per-tenant × pillar × action-class autonomy posture table. Schema sketch:
   ```
   autonomy_posture (
     account_id uuid, pillar text, action_class text,
     tier text check in ('recommend','full'),
     cycles_completed int, success_count int,
     last_evaluated_at timestamptz,
     primary key (account_id, pillar, action_class)
   )
   ```
2. A holdout-list table or static config consulted on every action evaluation.
3. A coordinator/rules layer that wraps `actions` insert and rejects if a cadence cap is exceeded for the account+pillar+window.
4. Confidence + escalation: `ai_analysis_runs.output_json` would need a confidence field, and the action-insert step would route low-confidence actions to T1 even when posture is T2.

Estimated build size: 300–500 LOC + a migration. Foundational; enables every later pillar autonomy decision.

---

## 6. Brand voice / tenant configuration audit

**Where tenant config lives today:**
- `accounts` table: name, slug, industry, website_domain, primary_location, service_area, reporting_timezone, monthly_budget, monthly_spend_cap, daily_spend_cap, three CPL targets, autonomy_level, three health scores
- `ad_platform_connections`: per-platform credentials and external IDs

**Brand voice today:**
- **Hardcoded into prompts.** `api/lib/prompts/fpb.js` is two ~100-line FPB-specific system prompts (analyze + chat). They contain FPB economics ($20-50K turnkey deals, 5% close rate, $50 CPL target), Florida market context (peak season, hurricane season), competitor names, and FPB-specific decision frameworks.
- The prompts file's own header comment (`api/lib/prompts/fpb.js:23-25`) acknowledges: *"Phase 4 will introduce per-account prompts (Weld, FSC) by extending this module. Until then, every account uses these FPB prompts."*
- Today, an `analyze-ads` run for Weld would feed Weld's ad performance data into the FPB system prompt, producing recommendations grounded in pole barn economics and Florida agricultural keywords — wrong for B2B gate fabrication.

**Path to "brand voice is data, not code" (architectural principle 10):**
1. New table: `brand_voices(account_id PK, voice_spec_json jsonb, version, updated_at)`
2. Refactor `getFpbSystemPrompt()` and `getFpbChatSystemPrompt()` into prompt-template functions that take a voice spec as argument and substitute economics, decision framework, market context, competitors, action thresholds.
3. Voice spec schema needs to capture: business economics (deal sizes, close rates, CPL targets), seasonality, competitors, intent keywords (high/low), platform-specific decision rules, action-type thresholds, hard rules.
4. `analyze-ads` and `chat` resolve the voice spec for the active account before each Claude call.
5. Phase 0 sub-task to extract voice for FPB (with FPB Kits product nuance), Weld Workx, FSC. Strategy doc Section 9 already calls out the methodology question.

This work is required before Phase 1 cron is enabled across multiple tenants — otherwise we'd be giving Weld FPB-flavored advice.

---

## 7. Cost ledger audit

**Today: no cost-tracking infrastructure exists.**

- No `costs` table, no `subscriptions` table, no `hours_log` table.
- No code captures Anthropic token usage. `ai_analysis_runs.latency_ms` is recorded but not token counts. The Anthropic API responses include `usage.input_tokens` and `usage.output_tokens` — neither is stored.
- API-call costs to Google Ads, Meta, OAuth refresh — not tracked.
- Vercel function invocation count, Supabase row reads — not tracked.
- Brian's hours: not tracked.

**What a Phase 0 cost ledger needs:**

1. **Tables:**
   ```
   cost_subscriptions (
     id, vendor, plan, monthly_amount_usd, started_at, ended_at, allocation_account_id (nullable for shared)
   )
   cost_api_events (
     id, vendor, event_type, account_id (nullable for shared), tokens_in, tokens_out, units, cost_usd, occurred_at, source_run_id (nullable)
   )
   cost_hours (
     id, hours, focus_area, category, log_date, notes
   )
   cost_rollups_monthly (
     account_id, year_month, build_total_usd, operating_total_usd, computed_at
   )
   ```
2. **Auto-logging hooks:**
   - Anthropic call wrapper that captures `usage` from response and writes to `cost_api_events` with the `account_id` of the originating account (already available in both call sites).
   - Google Ads / Meta API call wrappers similarly.
   - Vercel & Supabase costs are post-hoc CSV imports for now (no programmatic API for token-of-call billing).
3. **UI:** A new `Costs` tab in the dashboard with two sub-views: build-cumulative + operating-monthly. Manual subscription/hours entry form.
4. **Allocation:** Anthropic cost per call is per-account; Vercel/Supabase fixed costs split evenly across active tenants until usage telemetry exists.

Estimated build: 600–800 LOC + 1 migration + dashboard tab. Should land in Phase 0 since architectural principle 13 ("cost ledger sets pricing floor") is gated on it.

---

## 8. Voice interface audit

**Today: zero voice infrastructure.**
- `package.json:11-18` dependencies: React, Supabase, Sharp, lucide-react, node-fetch. No speech library.
- No microphone permission handling in `marketing-bot-dashboard.jsx`.
- No speech-to-text or text-to-speech endpoint.
- Chat is text-only via the existing `/api/chat` endpoint.

**Green-field shape for Phase 1 voice interface:**

1. **Browser-side STT:** Web Speech API (`SpeechRecognition`) is the zero-install path; OpenAI Realtime API or ElevenLabs TTS+STT are higher-quality, paid, latency-bound options. Strategy doc Section 9 lists this as Phase 0 must-resolve.
2. **Routing:** Voice transcript fed into the same `/api/chat` endpoint as text. **Critical:** transcripts that contain action requests must round-trip through the same `actions` insert + holdout check + approval gate. The strategy doc explicitly calls this out (Section 4 — voice honors same gates).
3. **Approval-by-voice:** Brian needs to be able to approve flagged actions verbally. This adds a new voice-only command mode: "approve action 42", "reject the FPB pause campaign". Routes to `/api/approve-action` with the same ownership/state-machine guarantees.
4. **TTS for responses:** Claude responses re-spoken so Brian can drive-time without a screen.

Recommended Phase 0 decision: pick the stack (Web Speech API for v0, OpenAI Realtime when budget allows). Then defer build to Phase 1.

---

## 9. Security posture audit

`KNOWN_SECURITY_GAPS.md` documents three high-priority gaps and one medium. All inspected and confirmed in code:

### 9.1 `/api/approve-action` has no authentication

**Confirmed.** `api/approve-action.js:60-65` — no auth check beyond the ownership gate. Anyone with a valid `actionId` and the URL can trigger ad mutations. Mitigations in place: idempotency lock (`api/lib/execute-action-logic.js:413-425`), state-machine `canExecute` gate (`api/approve-action.js:96-101`), ownership check (`api/approve-action.js:87-93`).
**Severity:** High in any external-facing context. Currently low because the dashboard is internal-only.
**Fix:** Add Supabase Auth session check before `resolveForWrite`. Required before Phase 4 (productization).

### 9.2 PATCH `/api/leads` has no authentication

**Confirmed.** `api/leads.js:162-242` — only ownership check, no caller identity. Anyone with a lead UUID can change `qualification_status`, `booked_revenue`, `gross_profit`. Same fix path as 9.1.

### 9.3 `/api/accounts` has no authentication

**Confirmed.** `api/accounts.js:65-83` — read-only listing of all accounts including budget, caps, targets, autonomy levels, health scores. Field whitelist in `api/accounts.js:40-63` correctly excludes credentials, but the configuration disclosure is itself sensitive once external tenants exist.
**Severity:** Low today (internal use), high once Weld/FSC have live data and certainly before any external tenant onboards.
**Fix:** Same admin-auth sprint as 9.1/9.2.

### 9.4 Hardcoded Google Ads customer IDs

**Status: resolved.** `KNOWN_SECURITY_GAPS.md:33-35` notes the fix landed in Stage A2. Inspection of `api/google-ads.js:76` confirms — IDs come from `connection.resolved_account_id_external`, no fallback to env. `api/lib/execute-action-logic.js:98-102` same pattern.

### 9.5 New findings during this audit

- **`EXECUTE_SECRET` warn-and-allow.** `api/execute-action.js:46-57`, `api/meta-creative.js:38-49`, the create-campaign endpoints — when `EXECUTE_SECRET` is unset, they log a warning and **proceed unprotected**. This is fail-open by design but is a fragile pattern: a deploy that drops the env var silently downgrades security. Stronger: fail closed with a 503 if the secret is unset in production. The test suite confirms this warn-and-allow behavior is exercised (250 tests pass with warnings printed).
- **`LEADS_INGEST_SECRET` same pattern.** `api/leads.js:40-51` — warn-and-allow on missing env. Same recommendation.
- **`accountFetch` default of `'fpb'`.** `marketing-bot-dashboard.jsx:8-13` and `api/lib/accounts.js:113-124` both default to FPB on missing slug. In a multi-tenant world this is a footgun: a forgotten slug parameter writes to FPB silently. Recommendation: in Phase 0 keep the default but add a `console.warn` already present at the API layer + add a test that asserts every dashboard fetch sends a slug.
- **No CORS origin restriction.** Every API route sets `Access-Control-Allow-Origin: '*'`. Fine for internal use; needs origin-locking before Phase 4.
- **No rate limiting** anywhere. Documented in `DEPLOY.md:179-181` as a "productization gap" but worth restating: a script could spam `/api/chat` and exhaust Anthropic budget for a tenant. Add Vercel rate-limiting before Phase 1 multi-tenant cron is enabled.
- **`api/image-process.js`** is unauthenticated and accepts arbitrary Base64. No size limit visible in the inspected lines (1-60). Risk: memory exhaustion via giant payloads. Worth adding a size cap and an auth gate.
- **`chat_messages` table missing in production** is not strictly a security finding but is a runtime defect: any POST to `/api/chat` returns 503 today. If "chat is broken" is news to anyone, that's a process gap.

---

## 10. Tooling / external integrations audit

| Service | Integration status | Code reference |
|---|---|---|
| **Supabase** | Working. Service-role client only (`api/lib/supabase.js:1-10`); supports legacy env name. | All API routes |
| **Anthropic Claude** | Working. Sonnet 4 (`claude-sonnet-4-20250514`) for analyze + chat; Haiku 4.5 (`claude-haiku-4-5-20251001`) for intent detection. Direct fetch — no SDK. | `api/analyze-ads.js:70`, `api/chat.js:46,165` |
| **Google Ads API v23** | Working for read; v19 for execute (`api/lib/execute-action-logic.js:113`). OAuth refresh-token flow. | `api/google-ads.js:101`, `api/lib/execute-action-logic.js:68-85` |
| **Meta Graph API v19.0** | Working for read, ad creative upload, campaign creation. | `api/facebook-ads.js:53`, `api/meta-creative.js`, `api/lib/execute-action-logic.js:135,162,250` |
| **Sharp (image library)** | Working. Used by `api/image-process.js` for ad creative resizing/overlay. | `api/image-process.js:1` |
| **Vercel cron** | Working. Two daily jobs. | `vercel.json:17-25` |
| **Resend** | **Not present** despite strategy doc mentioning email pillar is out of Y1 scope. Confirmed: no email integration code. | — |
| **Lovable** | **No code.** Site is hosted there for Weld (mentioned in CLAUDE.md global) but Prime has no integration. | — |
| **Perplexity** | **No code.** Approved per strategy doc; will need integration for research stage. | — |
| **Nano Banana** | **No code.** Approved per strategy doc; will need integration for image generation. | — |
| **OpenAI** | **No code.** Approved; possible voice-stack candidate. | — |
| **GBP API** | **No code.** Phase 1 must-build. | — |
| **GA4 / search console** | **No code.** Phase 1 may need for SEO measurement. | — |
| **CallRail / Gravity Forms webhooks** | Working (passive — they POST to `/api/leads`). | `api/lib/lead-ingest.js`, `DEPLOY.md:116-137` |

**Env vars expected** (`.env.example` + DEPLOY.md):

Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `EXECUTE_SECRET`, `LEADS_INGEST_SECRET`, `CRON_SECRET`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_PAGE_ID`, `ANTHROPIC_API_KEY`.

Optional: `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_MANAGER_ID` (now superseded by `ad_platform_connections` per Stage A2 fix), `OUTCOME_WINDOW_DAYS`, `ENABLE_MULTI_ACCOUNT_CRON`.

**Fragility flags:**
- `META_PAGE_ID` is global (`api/lib/execute-action-logic.js:189`). Per-account Page IDs need to land in `ad_platform_connections.metadata` or a sibling field before Weld/FSC ad creatives can publish.
- `GOOGLE_ADS_CLIENT_ID/SECRET/DEVELOPER_TOKEN` are global per-developer credentials, not per-account. Correct architecturally. But every account-level Google Ads call uses them, so a token rotation impacts every tenant.
- Three legacy env vars (`GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_MANAGER_ID`, `META_AD_ACCOUNT_ID`, `META_ACCESS_TOKEN`) survive in `.env.example` for FPB backward compatibility. Once `ad_platform_connections` is the sole source of truth, retire from `.env.example`.

---

## 11. Tenant readiness assessment

### 11.1 FPB Kits

- **Existing tenant?** Yes — but the row is "Florida Pole Barn" (slug `fpb`), not "Florida Pole Barn — Kits". Single tenant, no Kits-vs-turnkey distinction in data.
- **Path to making FPB Kits a distinct tenant:** Two viable shapes.
  - **Option A — sub-account on existing FPB row:** Add `parent_account_id` and `product_line` columns to `accounts`. FPB Kits becomes a child row sharing the FPB Google/Meta connections but with its own brand voice, autonomy posture, budget. Pro: minimal disruption to existing data. Con: two-level hierarchy is more code and more places where filters can leak.
  - **Option B — separate tenant rows:** Insert a new `accounts` row for FPB Kits with its own slug (`fpb-kits`), its own `ad_platform_connections`. Existing FPB row becomes "FPB Turnkey" or stays as the rolled-up parent. Pro: simpler model, every tenant is uniform. Con: existing FPB leads / outcomes / actions all belong to the legacy FPB account, none to FPB Kits — historical data doesn't migrate cleanly.
- **Recommendation:** Option A. The strategy doc explicitly says FPB has "two products" and treats FPB Turnkey as a Phase 3 deferred. A `parent_account_id` model captures that without forking historical attribution. Phase 0 adds the column; FPB Kits becomes an active child; FPB Turnkey stays inactive on the parent until Phase 3.

### 11.2 Weld Workx

- **Existing tenant?** Stub row exists (`sql/005_accounts.sql:106-113`): `slug='weld'`, status `inactive`, autonomy `level_0_readonly`, $1000 budget. No `ad_platform_connections` rows.
- **What's needed to add it for Phase 1:**
  - Flip status to `active`
  - Decide whether to keep Lovable site or migrate (Phase 0 must-resolve question 2). Lovable is a no-code site builder — likely no API for blog publish, which would block the SEO blog pipeline. Migration to a CMS-with-API (Next.js + headless CMS, or WordPress) is probably required.
  - Create Google Ads + Meta Ads accounts for Weld (or reuse Caleb's if existing) and seed `ad_platform_connections`
  - Author Weld brand voice spec (Section 6 dependency)
  - Update budget targets (strategy doc says $500/mo testing)
- **Lovable migration implication:** If Weld stays on Lovable, the SEO blog pillar can't auto-publish for Weld in Phase 1 — drafts can be generated and stored, but publishing is manual paste. Migrating to a CMS-with-API unblocks autonomy.

### 11.3 FSC

- **Existing tenant?** Stub row exists (`sql/005_accounts.sql:115-122`): `slug='fsc'`, status `inactive`, autonomy `level_0_readonly`. No budget set, no `ad_platform_connections`.
- **What's needed for Phase 1:**
  - Status → active
  - Investigate floridasecurityconcepts.com platform and publishing path (Phase 0 must-resolve question 3). The strategy doc states it's "TBD" and "the cleanest proving ground" precisely because there's no legacy. That makes platform choice an independent decision — pick whichever Prime can publish into easiest. Recommendation: same stack as the eventual external-tenant default to maximize productization learning.
  - Create Google + Meta accounts (or document they'll be created during Phase 1) and seed connections
  - Author FSC brand voice spec
  - Set monthly_budget = $500 per strategy doc
- **Web fetch:** I did not perform a live fetch of floridasecurityconcepts.com per the audit's read-only constraint. Recommend Phase 0 sub-task 2 do this to confirm the platform and publishing path.

---

## 12. Open-question status (vs strategy doc Section 9 Phase 0 list)

| Question | Audit-derived status |
|---|---|
| Keyword research tool (Ahrefs / SEMrush / DataForSEO API / other) | **Open.** No code today. Decision is pure tool-stack choice. |
| Weld Workx site migration (Lovable stays vs migrate) | **Lean toward migrate** based on publishing-API requirement for Phase 1 SEO blog. Confirm with a Lovable API check. |
| FSC site CMS/platform | **Open.** Audit could not verify without web fetch. Sub-task 2 should resolve. |
| GBP API access pattern | **Open.** Zero code today. Greenfield decision. |
| Voice tooling stack | **Open.** Recommend Web Speech API for v0 (zero subscription cost) + OpenAI Realtime as upgrade path. |
| Brand voice extraction methodology | **Open with structure.** Recommend: interview Brian + ingest existing collateral (FPB website copy, prior ad creatives, Joseph chatbot prompts), produce a structured spec per tenant. The shape is in Section 6 above. |
| KNOWN_SECURITY_GAPS resolution plan | **Mostly resolved here in Section 9.** All three high-priority gaps share the same fix (admin auth). Recommend bundling them into one auth sprint. Gaps not yet in KSGM (warn-and-allow secrets, missing rate limiting, image-process missing auth) should be added to KSGM as part of Phase 0. |
| Cost ledger schema | **Drafted in Section 7.** Tables, fields, auto-logging hooks specified. Ready to spec into a sub-task. |

---

## 13. Gap summary and Phase 0 next-sub-task recommendations

### 13.1 Top 5 critical gaps (block Phase 1 if not addressed)

1. **Brand voice is hardcoded for FPB.** `api/lib/prompts/fpb.js` is two ~100-line FPB-specific prompts. Running multi-account cron today gives every tenant FPB-flavored advice. Must be data-driven before Weld/FSC see real recommendations.
2. **Three production tables (`actions`, `automation_log`, `performance_snapshots`) have `account_id` columns added by uncommitted MANUAL APPLY blocks.** Production was almost certainly migrated by hand, but no migration file records it. A new install or recovery would silently fail. Convert to executable migration in Phase 0.
3. **No autonomy posture infrastructure.** `accounts.autonomy_level` exists as a column but is not consulted by any code path. The strategy doc's per-(tenant × pillar × action class) tier model needs a posture table, holdout list, escalation triggers, and a coordinator/cadence-rules layer before Phase 1 cron multiplies risk surface across three tenants.
4. **No cost ledger.** Architectural principle 13 is unfounded today. Anthropic token usage, API call counts, hours — none captured. Without a ledger Phase 4 pricing has no floor.
5. **`/api/verify-safety` is hardcoded to FPB.** It's the system's "is everything OK" endpoint. Today it would report PASS even with Weld and FSC fully misconfigured. Iterate over `listActiveAccounts()`.

### 13.2 Top 5 nice-to-have improvements (not blockers)

1. **Retire warn-and-allow secret behavior.** Fail closed in production for `EXECUTE_SECRET`, `LEADS_INGEST_SECRET`. A misconfigured deploy should not silently downgrade.
2. **Origin-lock CORS** on every route. `*` is wrong even today.
3. **Add basic rate limiting** at Vercel edge — at minimum on `/api/chat` (Anthropic cost), `/api/leads` POST (lead spam), `/api/image-process` (memory).
4. **Add a learning step** — even a thin one. Have `analyze-ads` read the last 30 days of `action_outcomes` for the tenant and prepend a "what worked / what didn't" summary to the Claude prompt. Closes the open loop the strategy doc names "learn".
5. **Cross-account audit surface in dashboard.** `automation_log.account_id IS NULL` rows (cron aggregates) are invisible today. A Brian-only "ops" view across all tenants would catch silent failures earlier.

### 13.3 Recommended Phase 0 sub-task sequencing

Dependencies surfaced by the audit:

- Brand voice infrastructure (Section 6) **blocks** multi-tenant cron enablement.
- Cost ledger (Section 7) **blocks** the architectural-principle-13 promise but doesn't block Phase 1 execution; it does need a UI surface that competes for dashboard real estate so earlier is better.
- Autonomy posture (Section 5) **blocks** anything graduating past Tier 1 for Weld/FSC.
- Tenant-row work (Section 11) **blocks** FPB Kits being distinct from FPB-as-a-whole.
- The MANUAL APPLY migration (Section 2.1) **blocks** disaster recovery and any new environment but isn't blocking current production behavior.
- KSGM auth fixes can run in parallel; not a Phase 1 cron blocker but a Phase 4 productization blocker.

Suggested sub-task ordering for Brian's review:

| # | Sub-task | Rationale |
|---|---|---|
| 2 | **Tenant model resolution + FSC platform discovery** | Unblocks 3, 4, 5. Decide FPB-Kits parent/child shape. Web-fetch FSC site. Decide Weld Lovable stay/migrate. |
| 3 | **Brand voice extraction methodology + per-tenant spec authoring** | Required before any multi-tenant cron run produces sane output. Includes refactoring `prompts/fpb.js` into a tenant-driven template. |
| 4 | **Cost ledger schema + dashboard tab** | Lands the data plumbing (4 tables, auto-logging hooks for Anthropic + ad APIs, manual entry for subs/hours). UI surface scoped, not necessarily polished. |
| 5 | **Autonomy posture infrastructure** | Posture table + holdout list + soft coordinator + escalation routing. Replaces the inert `autonomy_level` column. |
| 6 | **MANUAL APPLY migration → committed SQL** | Convert `sql/008` MANUAL APPLY blocks to an executable `sql/009_actions_automation_snapshots_account_id.sql` with `IF NOT EXISTS` guards. Document MANUAL APPLY runs that already happened. |
| 7 | **Multi-tenant cron enablement** | Flip `ENABLE_MULTI_ACCOUNT_CRON=true`, add per-account verify-safety, add per-account daily digest. Requires sub-tasks 3+5. |
| 8 | **Voice interface stack decision + KSGM auth sprint design (deferred build)** | Pick Web Speech vs OpenAI Realtime; design the admin auth approach to close `/api/approve-action`, PATCH `/api/leads`, `/api/accounts`. Build slips to Phase 1 (voice) and the dedicated security sprint (auth). |

This ordering frontloads the architectural choices (sub-tasks 2 and 3) so that subsequent sub-tasks build on a settled tenant model and prompt-template architecture. Sub-tasks 4 and 5 are independent of each other and could run in parallel if a second pair of hands shows up. Sub-task 6 is a small migration whose timing is flexible. Sub-task 7 is the gate that opens Phase 1.

---

End of audit. No file modifications beyond this report.
