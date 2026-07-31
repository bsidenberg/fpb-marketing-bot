# HARNESS — Phase A: The Account Manager (Always-On Optimization + Watch)

**Owner:** Brian Sidenberg
**Author:** Claude (harness draft, pre-implementation)
**Date:** 2026-07-13
**Repo:** `bsidenberg/fpb-marketing-bot` @ `C:\Python\FPB Marketing Bot`
**References:** `PRIME-AGENCY-ROADMAP.md` (Phase A = Sessions 08–09), `PRIME-STRATEGY.md` §4–5, `CLAUDE.md` (workflow rules), `AUDIT-PHASE-0.md` (loop gaps §4)
**Status:** DRAFT — requires Owner Decisions (§9) resolved before Session 08A starts

This harness defines the system that makes Prime operate the way Brian stated it: **an always-on agent that constantly monitors the campaigns and autonomously optimizes to generate the most profitable leads possible within budget.** It builds directly on the live Buyer foundation (recommend→approve→execute, autonomy coordinator, budget guards, CRM outcome bridge, daily_stats, outcome evaluation). It adds nothing to the credential surface and introduces no new paid tool.

---

## 1. Objective & Success Criteria

### 1.1 The objective function (per account, per cycle)

**Maximize expected profitable qualified leads, subject to the budget cap.**

Because sold-job truth lags the sales cycle, the objective is layered:

- **Lagging truth (the real target):** cost-per-sold-job and gross-profit ROAS, sourced from the CRM→Prime bridge (`crm-bridge.js`, `agent_config` margins).
- **Leading proxy (what the loop acts on day-to-day):** qualified-lead volume at or below the account's CPL band (FPB: target $50 / warning $75 / emergency $100; per-account via `agent_config`).
- **Quality coupling:** a move that lowers CPL but degrades sold-rate must be penalized once outcome data exists. Never optimize to clicks, impressions, or cheap form fills. Lead quality (sold-rate from CRM) is a first-class term, not an afterthought.

**Scoring.** Every candidate action is scored:

```
score = expected_delta_profitable_leads
        × confidence                     (from analysis + historical outcome accuracy)
        × data_sufficiency_gate          (0 if below min-volume rule, else 1)
        − risk_penalty                   (holdout / near-cap / protected-campaign proximity)
```

Only actions above the **recommendation-quality threshold** reach the queue. The budget constraint is enforced upstream by existing budget guards; reallocations are zero-sum within the daily cap unless a "limited by budget" high-GP campaign justifies a *gated* increase proposal.

### 1.2 What "Phase A done" means

Phase A is accepted when, on FPB:

1. Brian wakes to a **short, evidenced approval queue** (≤ configured cap, default 10/day), each item carrying evidence + expected impact + rollback payload.
2. The daily loop **reads `action_outcomes`** and lets past results shape today's scoring (closes the "learn" gap named in `AUDIT-PHASE-0.md` §4).
3. An **hourly watch loop** is live and detects spend-pace breach, CPL spike, campaign-offline, and lead-volume crash, alerting exactly once per incident.
4. A **global kill-switch** verifiably halts all execution.
5. Every acceptance eval in §6 passes; test floor held at **710+**.

---

## 2. Scope

### 2.1 In scope (Phase A)

- Shared **objective/scoring module** (`objective.js`, `recommendation-score.js`).
- **Daily optimization loop** (Session 08): proactive, evidenced recommendation generation into the existing approval queue, with learning from outcomes and a quality threshold + volume cap.
- **Kill-switch + cost telemetry** (Session 09A): safety infrastructure, built before the watch loop.
- **Hourly watch loop** (Session 09B): continuous anomaly detection + alerting.
- **Live validation** (Session 10): controlled real-world proof on FPB with Brian approving each first-run action.

### 2.2 Out of scope (deferred, not this harness)

- Creative Studio (RSA copy, image gen) — roadmap Phase C.
- SEO/Content — roadmap Phase S.
- Multi-account cron enablement for Weld/FSC — blocked on their `ad_platform_connections` + data-driven brand voice; Phase A is validated FPB-only and written multi-tenant-clean so enablement is later config work, not a rewrite.
- Meta lifecycle modernization (Bug 19, Graph v19→current) — parallel track; Phase A targets Google lead-gen. The watch loop should *detect* a Meta campaign offline but need not *act* on Meta until Bug 19 clears.
- Level-5 full autonomy — remains not-built by decision.

### 2.3 Prerequisite to close first (blocks clean Phase A)

- **Session 07f** (negative-keyword multi-turn staging auto-fetch) should land before Session 08B, because the daily loop reuses the search-term→negative expansion path 07f is repairing. If 07f is already merged at Phase A start, note it in the ledger and proceed.

---

## 3. Architecture

### 3.1 Two loops on shared foundations

```
                 ┌──────────────────────────────────────────────┐
                 │  objective.js  +  recommendation-score.js     │  (Session 08A)
                 │  objective function · scoring · thresholds     │
                 └───────────────┬───────────────┬───────────────┘
                                 │               │
        ┌────────────────────────▼──┐        ┌───▼───────────────────────────┐
        │  DAILY OPTIMIZATION LOOP   │        │  HOURLY WATCH LOOP            │
        │  api/cron-optimize.js      │        │  api/cron-watch.js           │
        │  (Session 08B)             │        │  (Session 09B)               │
        │  mines daily_stats+terms+  │        │  spend pace · CPL spike ·    │
        │  outcomes → scores → queue │        │  offline · lead crash        │
        └───────────┬────────────────┘        └───────────┬──────────────────┘
                    │                                      │
                    ▼                                      ▼
        existing autonomy-coordinator ──────► approval queue / alerts
        existing budget-guards + kill-switch (Session 09A) gate every write
```

### 3.2 Where it plugs into existing code (reuse, don't rebuild)

| New/changed | Uses existing | Note |
|---|---|---|
| `api/lib/objective.js` (new) | `agent_config` (CPL bands, margins) | Pure logic. No network. |
| `api/lib/recommendation-score.js` (new) | `action_outcomes`, `ai_analysis_runs` | Reads outcomes for confidence + learning. |
| `api/cron-optimize.js` (new) | `daily-stats`, search-term fetch, `analyze-ads` primitives, coordinator, budget-guards | Daily. Writes to `actions` via the normal insert path (coordinator-gated). |
| `api/cron-watch.js` (new) | `google-ads.js` reads, `campaign_daily_stats`, `leads` | Hourly. Read-mostly; alert-first. |
| `api/lib/kill-switch.js` (new) | `execute-action-logic.js` | A single guard consulted by every executor. |
| `api/lib/cost-telemetry.js` (new) | `cost_api_events`, `anthropic-cost.js` | Rate alerting. |
| `sql/019_*` | — | Watch-incident + alert dedup table. |
| `sql/020_*` | — | Recommendation-score / outcome-learning fields if needed. |

### 3.3 Runtime changes (`vercel.json`)

Current: 4 daily crons (`cron-crm-sync` 11:15, `cron-daily-stats` 11:45, `cron-analyze` 12:30, `evaluate-outcomes` 13:00 UTC).

Add:
- `cron-optimize` — daily, **after** `evaluate-outcomes` (so it sees fresh outcomes). Proposed `30 13 * * *`. Decide vs. folding into `cron-analyze` (see §9 D-3).
- `cron-watch` — hourly. Proposed `0 * * * *`. Vercel Hobby/Pro cron-frequency limits must be confirmed (§9 D-4); if hourly isn't available on the plan, fall back to every-N-hours or an external scheduler hitting the endpoint with `CRON_SECRET`.

All new cron endpoints reuse the existing `x-vercel-cron` / `CRON_SECRET` auth pattern from `cron-analyze.js`.

---

## 4. Autonomy & Approval Model (Phase A)

Phase A **consumes** the existing autonomy coordinator; it does not weaken it.

- Every action the daily loop produces is inserted through the normal path and receives a coordinator verdict (`allow_auto` / `require_approval` / `block`). The loop never bypasses the coordinator.
- **Standing constraints (never auto-execute), carried verbatim from the master spec:** campaign deletion; billing/conversion/tracking changes; new campaign launches; live publishing; pausing all campaigns or the last lead-gen campaign; removing branded coverage; ≥25% budget changes; bidding-strategy changes. The loop may *propose* these (gated), never auto-fire them.
- **What may auto-execute** (only where posture has graduated per the 20-cycle / 95% rule for that tenant×pillar×action-class): small in-band budget nudges and negative-keyword additions — the reversible, low-magnitude moves. Everything else stages for Brian.
- **Queue discipline:** the loop dedupes against open/recently-rejected actions (don't re-propose what Brian just declined), and enforces the daily volume cap by dropping lowest-scoring above-threshold items, not by queuing noise.
- **Watch loop autonomy:** alert-first. It may stage a *conservative* emergency action (e.g., flag or throttle a runaway) but only within holdout rules; anything on the standing-constraint list is alert-only.
- **Kill-switch supremacy:** when set, it overrides every verdict — no execution, period.

---

## 5. Security, Approvals & Environment

- **No new credentials.** Reuses Google Ads OAuth, Anthropic, Supabase service role already in production.
- **New env vars:** `PRIME_KILL_SWITCH` (bool, default off), `PRIME_WATCH_ENABLED` (bool), `PRIME_OPTIMIZE_ENABLED` (bool), `COST_ALERT_DAILY_USD` (rate ceiling). Fail-closed: if a loop's enable flag is unset, the loop does not run; if the kill-switch env is *unreadable*, treat as ON (halt), matching the coordinator's fail-safe philosophy.
- **Cron auth:** both new endpoints require valid `x-vercel-cron` or `Bearer CRON_SECRET`.
- **Admin perimeter:** any new dashboard surface (watch-incident view, kill-switch toggle) sits behind the existing `requireAdmin` middleware.
- **Brian approval gates (Owner Decisions):** enabling either loop in production; flipping any action-class posture to auto; the kill-switch default and scope; the cost-alert ceiling.

---

## 6. Testing & Machine-Verified Evals (completion gates)

Per the v2 standard, completion requires **verify-script evidence**, not narrative. Test floor **710+** maintained; safety-reviewer verdict verbatim on every money-path change.

**Unit:** objective math, scoring, threshold cutoff, volume-cap drop logic, spend-pace math, CPL-spike detection, dedup.

**Acceptance evals (must all pass, run against fixtures):**

| ID | Scenario | Expected |
|---|---|---|
| E1 | Fixture has a wasteful search term | Daily loop proposes a negative kw via server-authoritative expansion, real `campaign_id`, real `keyword_text` |
| E2 | "Limited by budget" high-GP campaign | Loop proposes a budget increase; because ≥ threshold it stages `require_approval`, never auto |
| E3 | Losing campaign below min-data-volume | Loop proposes nothing (min-volume gate holds) |
| E4 | Candidate action is on the holdout list | Coordinator never returns `allow_auto` |
| E5 | Over-limit budget change | Budget guards block with a clear reason |
| E6 | More than cap qualifying actions | Queue ≤ cap; lowest-scoring-above-threshold dropped, not queued |
| E7 | Action-class that failed historically | Recommendation is down-weighted (learning gate reads `action_outcomes`) |
| E8 | Induced CPL spike / spend-pace breach / offline campaign | Watch loop alerts exactly once per incident (dedup verified) |
| E9 | `PRIME_KILL_SWITCH` set | Every execute path returns halted; zero mutations |
| E10 | Simulated Anthropic spend over `COST_ALERT_DAILY_USD` | Cost-telemetry alert fires |

**Regression:** full suite green at ≥710. **Live-validation (Session 10):** each first-run real action approved by Brian individually; before/after snapshot + rollback recorded in `/harness/evidence/`.

---

## 7. Repository Authority

- **Authoritative repo/branch:** `bsidenberg/fpb-marketing-bot`; work on a Phase-A feature branch (e.g. `feat/phase-a-account-manager`). **Never `main`.**
- **Claude Code never commits or pushes.** Brian reviews the diff and commits/pushes manually; a commit is proven by `git log --oneline`, never by Claude Code's recap.
- **Single session at a time**, each naming the exact permitted files (below). No file touched outside its session's scope without a harness amendment.
- **Protected/behavioral files** (coordinator, budget-guards, execute-action-logic) are *consumed*; changes to them are AMENDMENTs requiring safety-reviewer sign-off.

---

## 8. Build Sessions (dependency-ordered)

### S-08A — Objective + Scoring Module
- **Objective:** Pure-logic objective function + recommendation scoring + threshold + volume-cap selection. No network, no writes.
- **Dependencies:** 07f landed (recommended).
- **Assigned role:** backend + AI-systems specialist; adversarial reviewer on scoring.
- **Permitted files:** `api/lib/objective.js` (new), `api/lib/recommendation-score.js` (new), `sql/020_*` (only if new fields needed), tests.
- **Inputs:** `agent_config` (CPL bands, margins), `action_outcomes` schema, `ai_analysis_runs` schema.
- **Outputs:** deterministic scoring given fixtures; documented objective.
- **Acceptance:** E7 logic unit-provable; threshold + cap selection deterministic; quality coupling (sold-rate penalty) implemented.
- **Tests/validation:** unit suite; `npm test` green.
- **Review:** independent code review + adversarial review of the scoring for gameability.
- **Approval gate:** orchestrator.
- **Out of scope:** any live API call, any queue write.

### S-08B — Daily Optimization Loop
- **Objective:** `cron-optimize.js` mines daily_stats + search terms + outcomes, scores via 08A, writes evidenced recommendations to the approval queue (coordinator-gated), capped and deduped.
- **Dependencies:** S-08A accepted.
- **Assigned role:** backend specialist; safety-reviewer (money-path adjacent).
- **Permitted files:** `api/cron-optimize.js` (new), `vercel.json` (add cron), reuse of existing fetch/coordinator/guard modules (import only, no edits), tests.
- **Inputs:** live-shaped fixtures for daily_stats, search terms, campaign roster, outcomes.
- **Outputs:** queue populated with ≤cap evidenced items each carrying expected impact + rollback.
- **Acceptance:** E1, E2, E3, E5, E6 pass; every proposal round-trips the coordinator; dedup vs. open/recently-rejected holds.
- **Tests/validation:** integration on fixtures; `npm test` ≥710.
- **Review:** safety-reviewer verbatim: no model-invented term or placeholder campaign_id can reach a mutation; no standing-constraint action auto-fires.
- **Approval gate:** Brian (enabling in production is an Owner Decision).
- **Out of scope:** hourly watch, kill-switch (separate sessions).

### S-09A — Kill-Switch + Cost Telemetry
- **Objective:** Global halt consulted by every executor; cost-rate alerting. Safety infra built *before* the watch loop.
- **Dependencies:** none hard (can run parallel to 08); must precede 09B.
- **Assigned role:** backend + security specialist.
- **Permitted files:** `api/lib/kill-switch.js` (new), `api/lib/cost-telemetry.js` (new), minimal guard insertion into `execute-action-logic.js` (AMENDMENT — safety-reviewer required), `sql/019_*` (incident/alert table), tests.
- **Acceptance:** E9, E10 pass; kill-switch fail-safe (unreadable ⇒ halt) proven.
- **Review:** security + safety-reviewer.
- **Approval gate:** Brian (kill-switch default/scope is an Owner Decision).

### S-09B — Hourly Watch Loop
- **Objective:** `cron-watch.js` — spend pacing, CPL spike, campaign offline/disapproved, lead-volume crash; alert-once with dedup; optional in-holdout conservative action.
- **Dependencies:** S-08A (scoring/thresholds), S-09A (kill-switch, incident table).
- **Assigned role:** backend specialist; safety-reviewer.
- **Permitted files:** `api/cron-watch.js` (new), `vercel.json` (add hourly cron), `sql/019_*` (dedup), tests.
- **Acceptance:** E8 passes; alerts idempotent per incident; watch respects kill-switch and holdouts.
- **Review:** safety-reviewer verbatim.
- **Approval gate:** Brian (enabling in production; cadence).

### S-10 — Live Validation (FPB)
- **Objective:** Prove both loops in production on FPB with Brian approving each first-run action; capture evidence.
- **Dependencies:** 08B, 09A, 09B accepted.
- **Assigned role:** release-verification specialist.
- **Acceptance:** a real evidenced daily queue appears; an induced anomaly triggers a real watch alert; kill-switch verifiably halts a real execution; before/after + rollback recorded in `/harness/evidence/`.
- **Approval gate:** Brian (final acceptance).

---

## 9. Owner Decisions (resolve before S-08A) & Open Questions

- **D-1 — Auto-execute posture:** at Phase A launch, does anything auto-execute, or is everything `require_approval` until you watch it run for a while? (Recommend: start 100% gated on FPB; graduate negatives/small nudges after ~20 clean cycles.)
- **D-2 — Daily queue cap & quality threshold:** confirm the ≤10/day cap and where the quality bar sits (how strong a proposal must be to make the cut).
- **D-3 — Daily loop placement:** separate `cron-optimize` endpoint vs. extending `cron-analyze`. (Recommend separate: cleaner scoping, its own auth/evidence, avoids the 60-second function limit stacking.)
- **D-4 — Watch cadence & alert channel:** true hourly vs. every-N-hours (Vercel plan cron limits), and where alerts land — Telegram (as OpenClaw uses), email, or dashboard-only.
- **D-5 — Kill-switch scope:** halt all execution across all accounts, or per-account? Default state?
- **D-6 — Cost ceiling:** the `COST_ALERT_DAILY_USD` value that should trip the telemetry alert.
- **D-7 — Meta in the watch loop:** detect-and-alert on Meta offline now (read-only) even though Bug 19 blocks Meta *action*? (Recommend yes — detection is safe, action waits.)

---

## 10. Definition of Done — Phase A

Accepted only when: all §6 evals pass; test floor ≥710; safety-reviewer verdicts recorded for every money-path change; §1.2 criteria demonstrated live on FPB; evidence (queue sample, anomaly alert, kill-switch halt, before/after + rollback) recorded in `/harness/evidence/`; known limitations and deferrals (Weld/FSC enablement, Meta Bug 19, Creative/SEO) disclosed; Brian's final acceptance logged. Owner Decisions D-1…D-7 recorded in `harness/DECISIONS.md`.

*End of Phase A harness draft. No code written. Owner Decisions §9 gate the first session.*
