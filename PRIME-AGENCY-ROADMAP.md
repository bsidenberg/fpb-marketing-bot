# PRIME-AGENCY-ROADMAP.md — The AI Marketing Agency

**Owner:** Brian Sidenberg. **Written:** July 2, 2026.
**Read this before any session. It defines WHERE we're going. CLAUDE.md defines HOW we work. PRIME-STRATEGY.md defines the business.**

## Vision

Prime becomes FPB's marketing agency: Brian asks for outcomes ("improve lead flow," "cut waste," "launch Meta") and Prime — with access to platform APIs, live data, creative generation, and its own operating loops — analyzes, recommends, and (within autonomy rules) executes. Human approval gates everything medium-risk and above. The optimization target is **sold jobs and gross profit**, never clicks or cheap form fills. Target CPL $50, warning $75, emergency $100.

## The Five Departments

1. **Analyst** — live platform data, daily performance history, lead→revenue truth. *The foundation; everything else inherits its blindness or its sight.*
2. **Media Buyer** — executes changes through the recommendation → approval → execution → outcome pipeline with spend guards.
3. **Account Manager** — hourly/daily/weekly loops that proactively surface recommendations into the approval queue.
4. **Creative Studio** — ad copy, image/video generation, landing copy. All drafts; never auto-published.
5. **SEO/Content Arm** — GSC data, decay detection, blog/city-page drafts. All drafts; never auto-published.

## Current State (honest, as of July 2, 2026)

**Working & proven:** Google Ads v23 read + budget-change execution (validated live); action state machine with idempotency; autonomy coordinator (holdouts, cadence caps, fail-closed); cost ledger; 443 tests; RLS locked (17 tables); admin auth perimeter (16 routes gated).
**Built, unvalidated:** Google pause/resume + negative keywords; Meta paths (on deprecated Graph v19).
**Missing:** `campaign_daily_stats` ingestion (0 rows — outcome grading and learning loop are inert); CRM sold-job/GP feedback (Prime cannot see profitability); spend-magnitude budget guards (only frequency caps exist); dry-run/snapshot/rollback in execution path; operator loops beyond one daily cron; all creative/SEO tooling.
**Known bugs:** Bug 2 (/api/accounts 500), Bug 3 (chat GET — verify), Bug 8 (chat doesn't auto-fetch; prompt also overpromises capabilities), Bug 19 (Meta v19).

## Phases (each = one or more scoped sessions in /sessions; complete in order; a phase is done only when its Definition of Done passes and Brian has committed)

### Phase F — Foundation (Sessions 01–04)
- **01** Bug 2: fix /api/accounts 500.
- **02** Chat honesty + auto-fetch: system prompt claims only real capabilities; affirmative follow-ups fetch live data (closes Bug 8's workaround).
- **03** `campaign_daily_stats` nightly ingestion (Google) → wakes outcome grading. THE single highest-leverage task in this roadmap.
- **04** CRM→Prime lead-outcome bridge: sold status, booked_revenue, gross_profit flow from FPB CRM (`flabvhdgqddbfitbqjqk`) into Prime leads. Prime can finally compute cost-per-sold-job and GP-ROAS.
**DoD:** account switcher works; chat fetches instead of asking for CSVs; daily_stats accruing rows nightly; ≥1 lead with real revenue visible in Prime; outcome evaluator grades ≥1 action.

### Phase B — The Buyer (Sessions 05–07)
- **05** Spend-magnitude budget guards: config-driven (agent_config) ±% daily limits, CPL bands, min-data-volume rules, protected-campaign list (branded + last-active-lead-gen unpausable). Wired into approve/execute path AND coordinator.
- **06** Execution hardening: dry-run mode, before/after snapshots, rollback payloads, DB-level append-only on logs.
- **07** Live-validate pause/resume + negative keywords (small real actions, Brian approves each); Meta Graph v19→current + validate one Meta read.
**DoD:** an over-limit budget change is blocked with a clear reason; every execution writes snapshot + rollback; one negative keyword and one pause validated live on Google; Meta reads current API.

### Phase A — The Account Manager (Sessions 08–09)
- **08** Daily optimization loop: mines daily_stats + search terms → writes recommendations into the existing approval queue with evidence + expected impact. Recommendation-quality threshold so Brian's queue stays reviewable (<10/day).
- **09** Hourly watch loop (spend pacing, CPL spike, campaign offline, lead-volume crash) + cost-telemetry alerting and a global kill-switch env flag.
**DoD:** Brian wakes to a short, evidenced queue; an induced anomaly triggers the watch alert; kill switch verifiably halts all execution.

### Phase C — Creative Studio (Sessions 10+)
RSA copy agent, Meta creative briefs, image generation via API (drafts to a creative queue), compliance pass (claims/pricing/FL construction). Never auto-publishes.

### Phase S — SEO/Content (after C)
GSC connection, decay/opportunity detection, blog + city-page drafts routed to approval. Coordinates with fpb-website repo; publishes nothing autonomously.

## Standing Constraints (from the master spec — non-negotiable)
Never auto-execute: campaign deletion, billing/conversion/tracking changes, new campaign launches, live ad/blog/page publishing, pausing all campaigns or the last lead-gen campaign, removing branded coverage, major (≥25%) budget changes, bidding-strategy changes. Every live change: recommendation → risk check → approval → execution log → outcome. Level-5 full autonomy: not built, by decision.

## Sequencing Rationale
Data before decisions (F before B), guards before autonomy (B before A), attribution before creative (A before C). Creative without profit attribution produces prettier waste.
