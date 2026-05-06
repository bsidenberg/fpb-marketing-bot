# Multi-Account AI Marketing Bot — Canonical Build Plan

**Owner:** Brian Sidenberg  
**Status:** Canonical working plan for Claude Code  
**Base repo:** `bsidenberg/fpb-marketing-bot` — extend, do not rebuild  
**Repo path:** `C:\Users\BrianSidenberg\Python\fpb-marketing-bot`  
**Primary proving ground:** FPB Kits / Florida Pole Barn  
**Additional internal accounts:** Weld Workx, FSC when ready  
**Last updated:** May 2026  

---

## 0. How to Use This Document

This is the canonical working plan for the multi-account AI marketing bot.

It merges:

- GPT v3 architecture and governance
- Claude v0.3 operational thresholds and checklists
- the agreed two-model workflow

Do not produce another planning version unless Phase 0B reveals a major repo constraint.

Operating model:

```text
Claude Code builds.
GPT reviews architecture, safety, and implementation prompts.
Brian approves.
```

Immediate next step after committing this document:

```text
Run Phase 0B technical repo inspection.
```

---

## 1. Executive Summary

Build an approval-safe AI marketing operations platform that manages Google Ads and Meta Ads across multiple business accounts.

The platform connects:

- ad spend
- tracking integrity
- raw leads
- deduplicated lead identities
- qualified leads
- booked jobs
- booked revenue
- gross profit
- recommendations
- approved actions
- execution results
- outcome evaluation
- offline conversion feedback

into one accountable closed-loop system.

This is not simply an AI ads manager, dashboard, or copy generator. The goal is to build a closed-loop AI marketing operator that identifies what is working, what is wasting money, what tracking is broken, and which actions should be taken next.

Core build philosophy:

```text
Measurement first.
Intelligence second.
Autonomy last.
Rules first.
AI second.
```

No optimization layer is trustworthy until tracking, attribution, lead quality, CRM hygiene, and revenue feedback are reliable.

---

## 2. North Star Product Statement

> A closed-loop AI marketing operator for trade and service businesses that connects ad spend to real leads, booked jobs, and profit, then safely recommends and executes optimizations with human approval and full auditability.

For internal use, it should help Brian manage paid acquisition across multiple businesses.

For future external use, it can become a sellable service for contractors, home service businesses, construction businesses, and local service companies that need better lead attribution and paid ad management.

---

## 3. Goals and Non-Goals

## 3.1 Goals for v1

- Single dashboard showing performance across multiple internal accounts.
- Account-level isolation for FPB Kits, Weld Workx, and future businesses.
- Real CPL, CPQL, CPBJ, revenue, and gross profit by account and campaign.
- Tracking health reports per account.
- Account health score combining tracking, CRM hygiene, attribution coverage, sync health, and safety status.
- Lead attribution using click IDs, UTMs, session data, call/chat source, and manual override.
- Lead deduplication before CPQL/CPBJ metrics.
- Spam/junk filtering before optimization metrics.
- Daily AI-generated recommendations with evidence and expected impact.
- Approval queue for medium/high-risk actions.
- Dashboard as canonical approval and audit interface.
- Telegram as convenience layer for fast approval, alerts, and kill switches.
- Hard account and campaign spend guardrails.
- Action logging and rollback support where technically possible.
- Outcome evaluation after actions are executed.
- Offline conversion sync only after data reliability thresholds are met.

## 3.2 Non-Goals for v1

- Public SaaS launch.
- Billing and subscription plans.
- Multi-user client auth beyond internal/admin needs.
- TikTok, LinkedIn, YouTube, or other ad platforms.
- Fully autonomous campaign management.
- Fully automated campaign creation.
- Advanced multi-touch attribution modeling.
- Replacing Google Ads, Meta Ads Manager, or GA4 dashboards.
- Predictive budget allocation across businesses.
- Fully automated creative/image/video generation.
- Cross-business budget shifting by the bot.

---

## 4. Core Principles

## 4.1 Attribution Before Optimization

The bot should not optimize campaigns blindly. It must understand where leads come from and whether those leads are valuable.

Bad optimization targets:

- more clicks
- more raw form fills
- lower platform-reported cost per conversion

Better optimization targets:

- more qualified leads
- more booked jobs
- lower cost per qualified lead
- lower cost per booked job
- higher attributed gross profit
- higher gross profit per ad dollar

## 4.2 Multi-Account From Day One

Every major table and workflow should be scoped by `account_id`.

Even if FPB is the first live use case, the system should support additional businesses without rewriting schema or dashboard logic.

## 4.3 Rules First, AI Second

Use deterministic rules for detection, safety, and execution constraints.

Use AI for:

- explanation
- synthesis
- prioritization
- drafting
- classification fallback
- summarization
- reasoning over evidence

AI must not be the sole enforcement mechanism for safety-critical decisions.

## 4.4 Approval-Safe Autonomy

The system should not have unbounded ad account control.

Every proposed action should be logged before execution. High-risk actions require approval. Spend caps and kill switches must be enforced by code, not by AI judgment.

## 4.5 Closed-Loop Learning

Every executed action should be evaluated later.

Example:

```text
Recommendation: Add negative keywords.
Action: Approved and executed.
Evaluation window: 7 days.
Outcome: Spend down 18%, cost per qualified lead improved from $214 to $143.
Result: Positive.
```

The bot should use prior outcomes to improve future recommendations.

## 4.6 Cold-Start Discipline

The bot must not make confident recommendations on insufficient data.

Every recommendation and auto-execution rule must include minimum data thresholds.

Tracking-issue and policy-flag detections can fire immediately. Optimization actions cannot.

---

## 5. Architecture Overview

```text
Business Accounts
      ↓
Google Ads / Meta Ads / Website / Forms / Calls / CRM / Chat
      ↓
Tracking Integrity Layer
      ↓
Unified Marketing Data Warehouse
      ↓
Lead Attribution + Lead Quality Layer
      ↓
Deduplication + Spam Filtering
      ↓
Rules Engine + AI Analyst
      ↓
Recommendations
      ↓
Approval-Safe Action Engine
      ↓
Ad Platform Execution
      ↓
Outcome Evaluation
      ↓
Offline Conversion Feedback Loop
      ↓
Learning Loop
```

---

## 6. Phased Build Sequence

```text
Phase 0A — Business Prerequisites
Phase 0B — Technical Repo Inspection
Phase 1 — Multi-Account Foundation
Phase 2 — Tracking Health v1
Phase 3 — Lead Attribution + Lead Quality
Phase 4 — Read-Only Recommendation Engine
Phase 5 — Approval-Based Execution
Phase 6 — Outcome Evaluation
Phase 7 — Offline Conversion Feedback Loop
Phase 8 — Guardrailed Auto-Execution
Future / Not Scheduled — SaaS Prep
```

Reason for this order:

- Do not mutate production ad accounts before account scoping, tracking, attribution, and approval safety are reliable.
- Do not send offline conversions back to platforms until source data is reliable.
- Do not enable auto-execution until approved-action outcomes prove the system is safe.

---

## 7. Phase 0A — Business Prerequisites Checklist

Phase 1 cannot begin until this checklist is complete or explicitly deferred by Brian.

```text
PHASE 0A READINESS CHECKLIST

Meta Platform
[ ] Meta app switched to Live mode at developers.facebook.com
[ ] Meta Marketing API access confirmed
[ ] Meta Conversions API access confirmed

Spend Caps (numbers required, not TBD)
[ ] FPB Kits: daily cap $___, monthly cap $___
[ ] Weld Workx: daily cap $___, monthly cap $___
[ ] FSC: confirmed in or out of v1 scope

Account Scope Confirmed
[ ] FPB Kits in scope
[ ] Weld Workx in scope
[ ] FSC decision made: in / deferred

CRM Hygiene Commitment
[ ] Michelle confirmed as owner of lead status updates
[ ] Target SLA: lead qualified or marked unqualified within 7 days of creation
[ ] Target SLA: booked jobs have revenue and gross profit within 14 days of close
[ ] Aging-lead dashboard agreed as enforcement mechanism

Approval Channel
[ ] Default channel chosen: Dashboard canonical + Telegram convenience
[ ] Telegram bot created and approval webhook target confirmed
[ ] Brian's Telegram chat ID captured

Existing Tracking Audit, Informal Before Formal Phase 2
[ ] Confirmed FPB website is capturing gclid on form submissions
[ ] Confirmed FPB website is capturing fbclid on form submissions
[ ] Confirmed UTM parameters persist through form submission to CRM
[ ] Identified call tracking provider for Phase 2: CallRail / alternative / TBD
[ ] Identified chat lead source treatment: Joseph chatbot / other / deferred

Repo Readiness
[ ] Existing fpb-marketing-bot is on a known-good commit
[ ] Vercel auto-deploy confirmed working from main branch
[ ] Supabase project connection verified
[ ] Anthropic API key available with sufficient quota
[ ] Google Ads OAuth tokens not expired
[ ] Facebook Ads OAuth tokens not expired
```

---

## 8. Phase 0B — Technical Repo Inspection

Owner: Claude Code  
Editing allowed: No  

No migrations, schema changes, or feature work should happen before this inspection.

## Phase 0B Prompt for Claude Code

```text
We are adopting the Multi-Account AI Marketing Bot canonical plan as the product direction, but before implementation we need a technical Phase 0B inspection.

Repo:
C:\Users\BrianSidenberg\Python\fpb-marketing-bot

Do not edit files yet.

Inspect the existing marketing bot infrastructure and report:

1. Current database schema and migrations.
2. Current Supabase tables used by the app.
3. Current lead ingestion flow.
4. Current Google Ads OAuth/API integration status.
5. Current Meta/Facebook Ads API integration status.
6. Current AI analysis loop and how it writes to Supabase.
7. Current approval/action/execution safety logic.
8. Current dashboard pages/components.
9. Current cron/scheduled jobs.
10. Existing tests and test coverage.
11. Any hardcoded FPB/single-business assumptions.
12. What tables/routes/components need account_id for multi-account support.
13. Risks of migrating to account-scoped data.
14. Recommended Phase 1 implementation plan.
15. Rollback strategy for the Phase 1 migration.

Constraints:
- Do not modify files.
- Do not run destructive commands.
- Do not change Supabase production data.
- Preserve existing FPB functionality.
- Preserve approval safety.
- Preserve lead ingestion.
- Do not introduce autonomous ad execution.

Return:
- Inspection report.
- Proposed Phase 1 implementation plan.
- Risks and open questions.
```

Exit criteria:

- All 15 inspection items addressed.
- Current repo reality is understood.
- Phase 1 plan is narrowed and safe.
- No files modified.

---

## 9. Phase 1 — Multi-Account Foundation

Goal:

Convert the existing single-business marketing bot into an account-scoped platform without breaking current FPB functionality.

Deliverables:

- Add `accounts` table.
- Add or confirm `ad_platform_connections` table.
- Add `account_id` to relevant existing tables based on Phase 0B inspection.
- Backfill existing FPB data to first account record.
- Add Weld Workx account stub only if it does not require credentials.
- Add account-scoped query helpers.
- Add dashboard account selector if feasible.
- Add basic account settings:
  - account name
  - website domain
  - reporting timezone
  - target CPL
  - target CPQL
  - target CPBJ
  - daily/monthly spend caps
  - autonomy level
- Preserve existing FPB functionality.
- Preserve lead ingestion.
- Preserve approval safety.
- Add tests for account isolation.

Move out of Phase 1:

- Deep tracking audits.
- Meta CAPI implementation.
- Google enhanced conversions.
- Offline conversion sync.
- CallRail integration.
- Chat attribution.
- Auto-execution.
- Ad platform mutation handlers.

Exit criteria:

- FPB regression tests pass.
- Existing FPB marketing bot still works.
- FPB data belongs to the FPB account.
- App can support at least two account records.
- Queries are account-scoped.
- No cross-account leakage.
- No autonomous ad execution added.
- Timezone normalization foundation exists.

---

## 10. Phase 2 — Tracking Health v1

Goal:

Make tracking reliability visible per account.

Deliverables:

- `tracking_health_checks` table.
- Tracking Health Score.
- Basic Google tag/GTM presence check where feasible.
- Basic Meta Pixel presence check where feasible.
- UTM presence checks on known ad URLs.
- GCLID/GBRAID/WBRAID capture checks from leads.
- FBCLID/FBP/FBC capture checks from leads.
- Lead webhook health checks.
- Call/chat attribution readiness checks.
- Tracking Health dashboard page or section.
- Critical/warning/healthy statuses.
- Tracking issue recommendations.

Exit criteria:

- Tracking health score computed correctly for all accounts.
- Critical tracking issues identified.
- Fix list generated.
- Tracking problems are distinguished from campaign performance problems.

---

## 11. Phase 3 — Lead Attribution + Lead Quality

Goal:

Make the leads table and attribution layer the source of truth for marketing performance.

Deliverables:

- `lead_attribution` table.
- Attribution resolver.
- Confidence scoring.
- Manual override workflow.
- Qualified/booked/revenue/gross profit fields.
- Source/medium/campaign reporting.
- Lead deduplication.
- Spam/junk filtering.
- CRM hygiene queue.
- Cross-platform conversion reconciliation report.
- Tracking completeness score.
- Attribution dashboard improvements.

Exit criteria:

- Attribution coverage >=60% on day one, trending toward 85%.
- Deduplication operating.
- Spam filtering operating with <5% false positive target.
- Dashboard shows cost per raw lead, unique lead, qualified lead, and booked job.
- Unknown/unattributed leads are visible as data quality issues.
- Platform-reported vs internal-attributed reconciliation report exists.
- Divergence >10% generates alert or investigation item.

---

## 12. Phase 4 — Read-Only Recommendation Engine

Goal:

Generate useful recommendations without executing them.

Deliverables:

- Rules engine.
- Cold-start guards.
- `ai_analysis_runs` table.
- Prompt versioning.
- `recommendations` table.
- AI-generated summaries and reasoning.
- Dashboard recommendation queue.
- Telegram digest.
- No platform mutations.

Exit criteria:

- Bot proposes daily recommendations for active accounts.
- Brian agrees with or marks useful >=70% of recommendations.
- Cold-start violations: zero.
- Recommendations align with what an experienced marketer would suggest.
- Auto-execute rules are defined but off.

---

## 13. Phase 5 — Approval-Based Execution

Goal:

Allow approved actions to execute safely.

Deliverables:

- `actions` table.
- `action_executions` table.
- Approval flow.
- Dashboard approval UI.
- Telegram approve/reject buttons.
- Google Ads mutation handlers.
- Meta Ads mutation handlers.
- Before/after snapshots where possible.
- Spend cap enforcement.
- Kill switches.
- Rollback UI where supported.

Exit criteria:

- At least 20 approved actions executed across both accounts.
- Zero spend cap violations.
- Approval rate >=75%.
- Every action is auditable.
- Failed actions are logged clearly.
- No high-risk action bypasses approval.

---

## 14. Phase 6 — Outcome Evaluation

Goal:

Measure whether approved actions improved performance.

Deliverables:

- `action_outcomes` table.
- Outcome evaluator job.
- Baseline metrics capture.
- Post-action metrics comparison.
- Outcome labels:
  - positive
  - neutral
  - negative
  - inconclusive
- Outcome dashboard.
- AI outcome summaries.
- Outcome signals available to future recommendation runs.

Exit criteria:

- 100% of executed actions have outcome evaluation within defined window.
- Outcome evaluation windows are action-type aware.
- Recommendation quality can be judged from outcomes.

Suggested evaluation windows:

```text
tracking/policy fixes: 3 days
negative keywords: 7-14 days
budget/pause actions: 7 days
larger strategy changes: 14-30 days
```

---

## 15. Phase 7 — Offline Conversion Feedback Loop

Goal:

Send qualified and booked lead data back to ad platforms only after source data is reliable.

Do not begin until:

```text
tracking health >= 85
CRM hygiene >= 85
attribution coverage >= 70
spam filtering active
deduplication active
qualified/booked statuses reliable
```

Deliverables:

- `offline_conversion_syncs` table.
- Google offline conversion upload support.
- Google enhanced conversions for leads where applicable.
- Meta Conversions API event support.
- Event matching diagnostics.
- Conversion sync logs.
- Sync failure alerts.

Initial events to send back:

- qualified lead
- booked job
- booked revenue if supported/appropriate

Exit criteria:

- Qualified leads and booked jobs flowing to Google and Meta.
- Sync failure rate <2%.
- Failures visible in dashboard/logs.
- Platform optimization receives better downstream lead-quality signals.

---

## 16. Phase 8 — Guardrailed Auto-Execution

Goal:

Enable limited autonomous action only after approval-based outcomes prove the system is safe.

Level 4 can only be enabled if the promotion criteria in Section 10 are met.

Deliverables:

- `auto_execute_rules` table.
- Auto-execution engine.
- Cooldown enforcement.
- Hard guardrail enforcement.
- Max auto-actions per account per 24 hours.
- Global kill switch.
- Account-level kill switch.
- Action-type kill switch.
- Auto-action review UI.
- Automatic demotion.
- Outcome evaluation integration.

Exit criteria:

- At least one account meets all Level 4 promotion criteria.
- Auto-action rollback rate <5% within 48 hours.
- Zero spend cap violations.
- No auto-actions occur outside defined rules.
- Automatic demotion works.

---

## 17. Future / Not Scheduled — SaaS Prep

Do not schedule until internal accounts prove value.

Future deliverables:

- multi-user auth
- account invites and roles
- Stripe billing
- per-tenant rate limiting
- public marketing site
- onboarding flow
- support/status tooling
- white-label client reporting

Trigger:

```text
Begin only when there is real external customer demand or Brian explicitly prioritizes SaaS packaging.
```

---

## 18. Data Model

## 18.1 Core Tables

```text
accounts
ad_platform_connections
ad_campaigns
ad_sets
ad_groups
ads
keywords
search_terms
ad_metrics_daily
ad_metrics_hourly
leads
lead_identities
lead_identity_events
lead_attribution
call_events
chat_events
tracking_health_checks
recommendations
actions
action_executions
action_outcomes
auto_execute_rules
spend_caps
sync_logs
ai_analysis_runs
offline_conversion_syncs
users
account_users
```

## 18.2 accounts

```text
accounts
- id
- name
- industry
- website_domain
- primary_location
- service_area
- reporting_timezone
- monthly_budget
- daily_spend_cap
- monthly_spend_cap
- target_cost_per_lead
- target_cost_per_qualified_lead
- target_cost_per_booked_job
- target_margin_goal
- autonomy_level
- tracking_health_score
- crm_hygiene_score
- account_health_score
- status
- created_at
- updated_at
```

Default `reporting_timezone` for Brian's businesses:

```text
America/New_York
```

## 18.3 ad_platform_connections

```text
ad_platform_connections
- id
- account_id
- platform: google_ads | meta_ads
- account_id_external
- account_name
- manager_account_id
- connection_status
- access_token_reference
- refresh_token_reference
- permissions_json
- last_sync_at
- last_error
- created_at
- updated_at
```

## 18.4 leads

```text
leads
- id
- account_id
- lead_identity_id
- created_at
- lead_name
- phone
- phone_hash
- email
- email_hash
- normalized_phone
- normalized_email
- source
- medium
- campaign
- content
- term
- platform
- landing_page
- referrer
- form_name
- call_tracking_number
- chat_source
- gclid
- gbraid
- wbraid
- fbclid
- fbp
- fbc
- ad_platform_account_id
- campaign_id
- ad_group_or_ad_set_id
- ad_id
- keyword
- status: new | contacted | qualified | unqualified | booked | lost | spam
- spam_score
- spam_reason
- spam_status: unknown | likely_spam | confirmed_spam | not_spam
- qualified_at
- booked_at
- booked_revenue
- gross_profit
- notes
- created_at
- updated_at
```

## 18.5 lead_identities

```text
lead_identities
- id
- account_id
- primary_lead_id
- email_hash
- phone_hash
- normalized_phone
- normalized_email
- first_seen_at
- last_seen_at
- created_at
- updated_at
```

## 18.6 lead_identity_events

```text
lead_identity_events
- id
- account_id
- lead_identity_id
- lead_id
- event_type: form | call | chat | manual | crm_update
- confidence_score
- created_at
```

## 18.7 lead_attribution

```text
lead_attribution
- id
- account_id
- lead_id
- lead_identity_id
- attributed_platform
- attributed_source
- attributed_medium
- attributed_campaign_id
- attributed_campaign_name
- attributed_ad_group_or_ad_set_id
- attributed_ad_id
- attributed_keyword
- attribution_method
- confidence_score
- evidence_json
- manual_override
- overridden_by
- overridden_at
- created_at
- updated_at
```

## 18.8 recommendations

A recommendation is an analytical finding.

```text
recommendations
- id
- account_id
- platform
- recommendation_type
- severity
- title
- summary
- evidence_json
- recommended_action_type
- recommended_action_payload
- expected_impact
- risk_level
- requires_approval
- confidence
- status
- created_by_run_id
- created_at
- updated_at
```

## 18.9 actions

An action is an executable intent created from a recommendation or human request.

```text
actions
- id
- account_id
- recommendation_id
- platform
- action_type
- payload_json
- reason
- evidence_json
- risk_level
- approval_required
- approval_status
- status
- rollback_supported
- created_by
- approved_by
- approved_at
- created_at
- updated_at
```

## 18.10 action_executions

An execution is the actual API attempt.

```text
action_executions
- id
- action_id
- account_id
- platform
- execution_status
- before_state_json
- after_state_json
- api_request_json
- api_response_json
- error_message
- executed_at
- rolled_back_at
- created_at
```

## 18.11 action_outcomes

An outcome evaluates whether the executed action worked.

```text
action_outcomes
- id
- action_id
- account_id
- evaluation_window_start
- evaluation_window_end
- baseline_metrics_json
- post_action_metrics_json
- expected_impact
- actual_impact
- outcome: positive | neutral | negative | inconclusive
- summary
- created_at
```

## 18.12 ai_analysis_runs

The AI layer must be model-agnostic.

```text
ai_analysis_runs
- id
- account_id
- model_provider
- model_name
- prompt_version
- input_snapshot_id
- input_summary_json
- output_json
- status: pending | running | succeeded | failed
- error
- created_at
```

Purpose:

- compare Claude, GPT, Gemini, or future models
- track prompt versions
- debug bad recommendations
- re-run analysis from historical snapshots
- maintain provenance

## 18.13 offline_conversion_syncs

```text
offline_conversion_syncs
- id
- account_id
- platform
- lead_id
- lead_identity_id
- event_name
- event_time
- match_keys_present
- payload_json
- response_json
- status
- error_message
- created_at
```

---

## 19. Attribution Confidence Model

Use confidence bands instead of a single binary threshold.

```text
0.90 - 1.00 = verified click ID match
0.70 - 0.89 = strong UTM/session match
0.60 - 0.69 = probable attribution
below 0.60 = unattributed / unknown
```

Default reporting threshold:

```text
Treat confidence scores >= 0.60 as attributed, but visually separate verified, strong, and probable attribution.
```

Unknown and low-confidence leads should not be hidden. They should appear as tracking/data-quality issues.

---

## 20. Tracking Health Score

Suggested 100-point categories:

```text
Google tag / GTM installed: 10
Google Ads conversion actions configured: 10
Google enhanced/offline conversion readiness: 10
Meta Pixel installed: 10
Meta CAPI readiness/parity: 10
UTMs present on paid ads: 10
GCLID/GBRAID/WBRAID capture: 10
FBCLID/FBP/FBC capture: 10
Lead webhook health: 10
Call/chat attribution: 10
```

Gating:

```text
<50 = tracking unreliable; no optimization recommendations except tracking fixes
50-74 = diagnostics only; no execution
75-84 = recommendations allowed; approval required for all actions
85+ = eligible for approved execution and later guardrailed auto-execution
```

No auto-execution may occur when any critical tracking issue exists, even if the score is otherwise high.

---

## 21. CRM Hygiene Score

CRM hygiene must be explicit because CPQL/CPBJ are only trustworthy if lead statuses are maintained.

## 21.1 CRM Hygiene Formula

Score is 100 points:

```text
Lead status freshness: 30 points
- 30 = >=90% of new leads updated within 7 days
- 20 = 75-89%
- 10 = 50-74%
- 0 = <50%

Qualified/unqualified decision rate: 25 points
- 25 = >=90% of non-spam leads have qualified/unqualified/booked/lost decision within 7 days
- 18 = 75-89%
- 10 = 50-74%
- 0 = <50%

Booked revenue completeness: 20 points
- 20 = >=90% of booked jobs have booked_revenue
- 14 = 75-89%
- 7 = 50-74%
- 0 = <50%

Gross profit completeness: 15 points
- 15 = >=80% of booked jobs have gross_profit or margin estimate
- 10 = 60-79%
- 5 = 40-59%
- 0 = <40%

Spam/lost cleanup: 10 points
- 10 = spam/lost/unqualified statuses are regularly maintained and stale queue is under threshold
- 5 = partial maintenance
- 0 = stale queue materially distorts metrics
```

## 21.2 CRM Hygiene Gating

```text
<50 = CRM signal unreliable; no optimization toward CPQL/CPBJ
50-74 = diagnostics only; do not execute based on lead quality
75-84 = recommendations allowed; approval required
85+ = eligible for approved execution and later guardrailed auto-execution
```

## 21.3 CRM Hygiene Queue

Dashboard should show:

- leads with no status after 48 hours
- leads with no qualified/unqualified decision after 7 days
- booked jobs missing revenue
- booked jobs missing gross profit
- leads missing source/medium/campaign
- leads suspected as duplicates
- leads suspected as spam

---

## 22. Account Health Score

Account health score combines:

```text
tracking health
CRM hygiene
attribution coverage
lead dedup/spam filtering status
sync health
spend cap configuration
approval backlog
unresolved critical recommendations
```

Purpose:

- decide whether an account is ready for higher autonomy
- show operational readiness in one place
- block risky execution when account quality is poor

---

## 23. Timezone Normalization

Timezone handling must be explicit.

Requirements:

- Store raw timestamps in UTC.
- Add `reporting_timezone` to accounts.
- Default Brian's businesses to `America/New_York`.
- Compute reporting dates using account reporting timezone.
- Normalize daily ad metrics by account timezone.
- Do not compare “yesterday” across systems without timezone normalization.
- Sync jobs should record:
  - source timezone
  - account timezone
  - sync started_at
  - sync completed_at
  - data date range covered

This is required in Phase 1.

---

## 24. Lead Deduplication

Resolve in Phase 3.

Problem:

One person may submit a form, call a tracking number, and start a chat. Without deduplication, CPQL and CPBJ become distorted.

Required:

- `lead_identities`
- `lead_identity_events`
- dedup logic using phone/email hashes, normalized phone/email, click/session identifiers, and timestamp proximity
- manual merge/unmerge where needed
- deduped reporting views

Metrics should distinguish:

```text
raw lead events
unique lead identities
qualified unique leads
booked unique leads
```

Optimization should prefer unique qualified leads and booked jobs over raw lead events.

---

## 25. Spam/Junk Lead Filtering

Resolve in Phase 3.

Spam signals:

- invalid phone
- invalid email
- repeated form submissions
- suspicious message content
- known junk keywords
- impossible service area
- duplicate IP/session behavior
- bot-like form timing
- manual spam label

Spam leads should be visible but excluded from:

- CPQL
- CPBJ
- qualified lead rate
- booked job conversion rate
- action outcome evaluation

Do not silently delete spam. Preserve auditability.

Recommended approach:

```text
rules first
AI fallback for ambiguous cases
manual override always available
```

---

## 26. Recommendation Engine

## 26.1 Daily Run

Suggested schedule:

- daily recommendation run at 6 AM ET
- optional mid-day anomaly check
- daily outcome evaluation

Flow:

1. Pull last 7/14/30-day metrics by account.
2. Pull tracking health status.
3. Pull CRM hygiene status.
4. Pull dedup/spam status.
5. Pull lead attribution and quality data.
6. Pull spend caps and budget pacing.
7. Pull recent actions and quiet periods.
8. Run deterministic rule checks.
9. Apply cold-start guards.
10. Create structured input snapshot.
11. Send snapshot to AI analysis model.
12. Validate AI output against schema and safety rules.
13. Write recommendations.
14. Create proposed actions where applicable.
15. Send dashboard and/or Telegram digest.

## 26.2 Initial Deterministic Rules

Initial rules:

- high spend with zero raw leads
- high spend with zero qualified leads
- CPL spike above threshold
- CPQL spike above threshold
- CPBJ spike above threshold
- budget pacing too fast
- budget pacing too slow
- campaign/ad set with poor lead quality
- tracking data missing or degraded
- CRM hygiene issue
- ad fatigue
- search terms with irrelevant spend
- campaign with scaling opportunity
- campaign within quiet period after launch
- platform-reported conversions materially diverge from internal attributed leads

---

## 27. Cold-Start Guards

Every recommendation and auto-execution rule needs minimum data thresholds.

## 27.1 Default Cold-Start Floor

No optimization rule fires below all of:

```text
14 days since campaign launch
$200 cumulative spend on the entity being analyzed
30 clicks on the entity being analyzed
7 days of stable tracking
no tracking_health critical issues in the window
```

Tracking-issue and policy-flag detections are exempt and can fire immediately.

## 27.2 Ad / Ad Set / Ad Group Recommendations

```text
entity age >= 7 days
spend >= $50
clicks >= 20
not inside launch quiet period
```

## 27.3 Budget Increase Recommendations

```text
at least 14 days of stable tracking
CPQL below target
at least 3 qualified leads
account not within 20% of monthly spend cap
tracking health score >= 85
CRM hygiene score >= 80
```

## 27.4 Rule Schema Should Include

```text
minimum_age_days
minimum_spend
minimum_clicks
minimum_conversions
minimum_qualified_leads
minimum_tracking_health_score
minimum_crm_hygiene_score
quiet_period_required
rollback_required
```

---

## 28. Action and Approval System

## 28.1 Action Lifecycle

```text
recommendation created
      ↓
action proposed
      ↓
approval check
      ↓
approved / rejected / expired
      ↓
queued for execution
      ↓
executed / failed
      ↓
outcome evaluation after window
      ↓
learning loop
```

## 28.2 Dashboard and Telegram

Dashboard is the canonical approval and audit interface.

Telegram is a convenience interface.

```text
Dashboard = source of truth.
Telegram = fast approval/alert layer.
```

Dashboard should show:

- recommendation evidence
- risk level
- expected impact
- affected account/campaign/ad
- spend affected
- tracking health context
- CRM data completeness context
- approval status
- execution status
- before/after state
- rollback availability
- outcome evaluation

Telegram should call the same backend approval API.

Telegram should support:

```text
/pause_bot
/resume_bot
/pause_account [account]
/resume_account [account]
/pause_action [action_type]
/resume_action [action_type]
/pending_actions
/today_summary
```

---

## 29. Hard-Blocked Actions

The bot must never automatically:

- delete campaigns
- delete ads
- remove tracking
- modify tracking code
- increase monthly spend caps
- connect new client accounts
- make large account restructures
- launch new campaigns
- launch new ads
- upload or replace creative
- change bid strategy
- change conversion goals
- shift budget across businesses
- pause a top-3 spending campaign
- make changes when tracking health is below threshold
- make changes when CRM hygiene is below threshold

These actions require explicit human authorization and should remain approval-required even at high autonomy levels.

---

## 30. Auto-Execute Rules

Auto-execution is Phase 8 only.

It can only occur when:

```text
account autonomy level >= 4
tracking health score >= 85
CRM hygiene score >= 85
deduplication active
spam filtering active
not inside launch quiet period
account not within 20% of monthly spend cap
no critical tracking issue exists
rollback support exists where required
```

## 30.1 Auto-Pause Ad

Allowed only if:

```text
account autonomy level >= 4
tracking health score >= 85
CRM hygiene score >= 85
campaign outside 14-day launch quiet period
ad age >= 7 days
ad spend >= $50 over last 7 days
clicks >= 20
0 attributed leads
0 qualified leads
CTR < 0.5%
ad is not in a top-3 spending campaign
ad is not the only active ad in its ad set/ad group
rollback_supported = true
account is not within 20% of monthly spend cap
```

Limits:

```text
max 1 auto-pause per ad per 30 days
max 3 total auto-actions per account per 24 hours
```

## 30.2 Auto-Pause Underperforming Ad Set / Ad Group

Allowed only if:

```text
account autonomy level >= 4
tracking health score >= 85
CRM hygiene score >= 85
entity age >= 14 days
entity spend >= $200
CPQL > 2x account 30-day average
at least 3 attributed leads OR sufficient spend with no qualified leads
not top-3 spending campaign
not inside quiet period
rollback_supported = true
```

Limit:

```text
max 1 per ad set/ad group per 14 days
max 3 total auto-actions per account per 24 hours
```

## 30.3 Auto-Add Negative Keyword

Allowed only if:

```text
Google Ads only
search term spend >= $50
0 conversions
0 qualified leads
AI/classifier marks term irrelevant with confidence >0.85
term is not brand/protected/service-critical
human-approved exclusion list checked
```

Limit:

```text
max 10 negative keywords per account per day
counts as 1 auto-action batch toward max 3 total auto-actions per account per 24 hours
```

## 30.4 Auto-Shift Budget Within Campaign

Auto-shift budget within campaign remains approval-required until the bot has substantial positive outcome history.

Definition of substantial positive outcome history:

```text
at least 50 approved budget/pause/negative-keyword actions executed
at least 30 of those have completed outcome evaluations
>=70% of completed outcomes positive or neutral
zero spend cap violations
zero unintended platform mutations
tracking health >=85 for prior 30 days
CRM hygiene >=85 for prior 30 days
Brian explicitly approves enabling budget-shift auto-rules
```

Until these conditions are met, budget shifts are recommendations only and require approval.

## 30.5 Consolidated Daily Auto-Action Limit

The global limit is:

```text
max 3 total auto-actions per account per 24 hours
```

This includes:

- auto-pauses
- negative keyword batches
- any future eligible auto-action

Do not define separate conflicting daily limits elsewhere.

---

## 31. Spend Caps

Spend caps should exist at multiple levels.

Required:

- account-level daily spend cap
- account-level monthly spend cap

Recommended:

- campaign-level daily cap
- campaign-level monthly cap
- action-level max spend affected
- per-action budget change percentage limit

Cross-account budget policy:

```text
The bot may recommend cross-business budget review.
The bot must never automatically move spend between businesses.
```

---

## 32. Creative Replacement Strategy

Creative fatigue cannot end with “refresh creative.”

## 32.1 v1 Workflow

When creative fatigue is detected, the bot should:

1. Identify fatigued creative.
2. Explain evidence:
   - frequency
   - CTR decline
   - CPL/CPQL change
   - spend trend
3. Recommend replacement type:
   - new image
   - new video
   - new headline
   - new primary text
   - new offer angle
   - new landing page angle
4. Draft copy or creative brief if useful.
5. Create a human task:
   - upload replacement creative
   - approve drafted copy
   - assign designer
6. Never auto-publish creative without approval.

Recommended v1 option:

```text
Bot drafts replacement copy / creative brief.
Brian reviews/approves copy and provides or approves visuals.
Bot does not auto-publish.
```

## 32.2 Later Workflow

Add:

- creative asset library
- creative performance history
- AI-generated copy variants with approval
- designer brief generator
- landing page test brief generator

---

## 33. Cross-Platform Conversion Reconciliation

Resolve in Phase 3.

Problem:

Google Ads, Meta Ads, GA4, and internal CRM will disagree.

Required:

- reconciliation report per account
- platform-reported conversions vs internal-attributed leads
- target reconciliation within 5%
- alert when divergence exceeds 10%
- internal attribution is canonical
- platform numbers are reference

---

## 34. Known Gaps to Track

These must be resolved during the phases listed, not ignored.

| Gap | Resolution Phase |
|---|---|
| Timezone normalization | Phase 1 |
| Lead deduplication | Phase 3 |
| Spam/junk lead filtering | Phase 3 |
| Cross-platform conversion reconciliation | Phase 3 |
| Creative replacement workflow | Decide Phase 0A, implement Phase 5+ |
| CRM hygiene ownership | Phase 0A and ongoing |
| Call tracking provider decision | Phase 0A / Phase 2 |
| Chat lead attribution | Phase 2 / Phase 3 |
| Rollback limitations | Phase 5 |
| Model evaluation | Phase 4+ |

---

## 35. Per-Phase Exit Metrics

| Phase | Exit Metric | Target |
|---|---|---|
| 0A | Readiness checklist | 100% complete or explicitly deferred |
| 0B | Inspection report | All 15 items addressed |
| 1 | FPB regression tests | 100% pass; existing functionality intact |
| 1 | Account isolation tests | 100% pass; zero cross-account leakage |
| 2 | Tracking health score | Computed correctly for all accounts |
| 2 | Critical tracking issues | All identified; fix list generated |
| 3 | Attribution coverage | >=60% on day one, trending toward 85% |
| 3 | Dedup + spam filtering | Operating; <5% false positive on spam target |
| 4 | Recommendation usefulness | >=70% of recommendations Brian agrees with |
| 4 | Cold-start violations | Zero |
| 5 | Approved actions executed | >=20 across both accounts |
| 5 | Spend cap violations | Zero |
| 5 | Approval rate | >=75% |
| 6 | Outcome evaluations | 100% of executed actions have outcome within defined window |
| 7 | Offline conversion sync | Qualified leads + booked jobs flowing to Google + Meta |
| 7 | Sync failure rate | <2% |
| 8 | Auto-action rollback rate | <5% within 48 hours |
| 8 | Promotion criteria | All met for at least one account |

---

## 36. 90-Day Success Metrics After Phase 8 Launch

- Attribution coverage: 85%+ of leads have confidence >=0.60 source.
- CPQL change: 20-25%+ improvement versus pre-launch baseline where feasible.
- CPBJ change: 20%+ improvement versus pre-launch baseline where feasible.
- Hands-off time: Brian spends less than 30 minutes/week inside Google Ads and Meta Ads Manager.
- Approval rate: 70-85%.
- Auto-action accuracy: 95%+ of auto-actions are not rolled back within 48 hours.
- Action outcome positivity: 60%+ positive; neutral/negative/inconclusive tracked honestly.
- Spend cap violations: 0.
- Tracking health: 100% of critical events firing correctly.
- Lead qualification rate: 90%+ of raw leads get status updated within 7 days.

---

## 37. Working Conventions for Build Sessions

These conventions apply to Claude Code work.

- Windows / PowerShell workflow.
- Repo path: `C:\Users\BrianSidenberg\Python\fpb-marketing-bot`.
- Inspection-first always.
- Read and report before edits.
- Preserve existing FPB functionality.
- Do not hardcode secrets.
- Do not break existing lead ingestion.
- Do not remove approval logic.
- Do not create destructive migrations without rollback notes.
- Do not mutate ad accounts unless the phase explicitly allows it.
- Brian reviews tests, diffs, and file contents before commit/push.
- For implementation prompts, Claude may prepare commit commands, but Brian approves commit/push.
- Never use permission bypasses on repos with Vercel auto-deploy.
- UI must account for color blindness:
  - do not rely on color alone
  - use icons, labels, position, and text
  - FPB brand kit: red `#c0272d`, navy `#2b3a6b`, Inter font, no orange
- Use strongest available Claude reasoning model/mode for architecture, attribution, and auto-execution safety work.
- Use faster/default coding model for bounded implementation once architecture is stable.
- Phase 1, 3, 5, and 8 prompts should be reviewed by GPT before execution.

---

## 38. Phase 1 Claude Code Prompt

Use only after Phase 0B inspection is reviewed.

```text
You are working on the existing fpb-marketing-bot repo.

Goal:
Implement Phase 1 Multi-Account Foundation.

Requirements:
1. Add an accounts table.
2. Add or confirm an ad_platform_connections table.
3. Add account_id to relevant existing tables, based on the Phase 0B inspection.
4. Backfill existing Florida Pole Barn / FPB data to the first account record.
5. Add a Weld Workx account stub only if it does not require external credentials.
6. Add account-scoped query helpers.
7. Add dashboard account selector if feasible in this sprint.
8. Add basic account settings for targets, reporting timezone, and spend caps if feasible.
9. Preserve all existing FPB functionality.
10. Preserve existing lead ingestion.
11. Preserve existing approval safety.
12. Add tests for account isolation and existing lead ingestion behavior.
13. Provide rollback notes for migrations.

Safety:
- Do not delete existing data.
- Do not hardcode secrets.
- Do not modify production credentials.
- Do not remove approval logic.
- Do not enable any new autonomous ad actions.
- Do not mutate Google Ads or Meta Ads accounts.

Before coding:
- Summarize exact implementation steps.
- Identify files to change.
- Identify migrations to add.

After coding:
- Provide changed files.
- Provide migrations.
- Provide tests run and results.
- Provide remaining gaps.
- Provide any manual Supabase steps.
- Provide rollback instructions.
```

---

## 39. Final Instruction

This plan is sufficient.

Do not create v4.

After this document is committed or placed in the repo, run Phase 0B inspection.

The first real milestone is not a new feature. It is:

> A clean inspection report proving we understand the current repo and know how to migrate it safely to multi-account support without breaking FPB.
