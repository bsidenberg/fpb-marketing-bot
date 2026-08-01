# Session Ledger — Prime (FPB Marketing Bot), Phase A

Work happens ONLY in dependency-ordered sessions. The full session packets (objective,
permitted files, acceptance criteria, review requirements, approval gate) are defined in
**[`HARNESS-PHASE-A.md`](./HARNESS-PHASE-A.md) §8** for the Phase A loop sessions and in
**[`HARNESS-CHAT-SURFACE.md`](./HARNESS-CHAT-SURFACE.md) §5** for the chat-surface sessions
(S-08A.1, S-07f.1, S-07g, S-07h) — those are the contracts. This file is the status board:
what is live, what it depends on, and where its evidence landed.

Statuses: NOT STARTED → IN PROGRESS → IN REVIEW → BLOCKED (why) → ACCEPTED

## Status Board

| ID | Objective | Owner role | Depends on | Status | Evidence |
|----|-----------|-----------|------------|--------|----------|
| S-HARNESS-P1 | Land the harness: fill `AGENTS.md` / `DECISIONS.md` / `ENVIRONMENT.md` (were blank installer templates), add the chat-surface amendment, close the verify-gate lint gap | orchestrator + staff architect | none | **IN REVIEW** | `evidence/S-HARNESS-P1-verify-2026-07-28_1043.log` (3/3, 838 tests) |
| **S-05B** | **Account monthly ad-spend pacing guard (D-12).** `sum(enabled daily budgets)` vs. days remaining vs. the **$2,500/mo** cap, evaluated **before any budget-increase executes**; month-to-date from `campaign_daily_stats`. Fails closed. Mandate is *maximum lead volume within the cap*, so **underspend is also a failure** | backend; **safety-reviewer** (touches `budget-guards.js`, protected) | none hard; precedes S-08B enabling | **READY — D-12 resolved** | — |
| S-09A-heartbeat | **SDR-1 liveness proofs.** Every check/cron/alert path gets a heartbeat or equivalent. Vercel provides no retries, no failure alerts, no overlap prevention (`HARNESS.md` §4.2), so every cron carries its own. Folded into S-09A | backend + security | none | NOT STARTED (in S-09A scope) | — |
| **S-AUTOLOG-1** *(new, discovered by S-OBS-1)* | **Fix `automation_log`'s write path.** Every one of 6 call sites passes an `event_type` value that violates the table's own CHECK constraint; every insert has always failed silently (no call site checks the returned error). One call site (`execute-action-logic.js` `writeLog()`) is a PROTECTED file — AMENDMENT + safety-reviewer required. | backend; **safety-reviewer** (protected file) | S-OBS-1 (finding) | **BUILT — cold review BLOCK (2026-07-31): the fix is correct in isolation, but deploying it activates a terminal `block` verdict in `autonomy-coordinator.js`'s `checkCap`/`getActiveCount` that has never once fired (no `event_type` filter on the automation_log read — every write becoming real for the first time changes that gate's behavior) and that also miscounts non-executions (manual-gate approval, guard deferral) as executed actions. NOT ACCEPTED — rework session S-AUTOLOG-1.2 required with a fresh reviewer. `table-expectations.js`'s `automation_log` entry reverted to BROKEN (was briefly, incorrectly set to EXPECTED_EMPTY mid-session) so the alert stays live while production is unchanged.** | `evidence/S-AUTOLOG-1-final-verify-2026-07-31_2009.log` |
| **S-AUTOLOG-1.2** *(new, discovered by S-AUTOLOG-1's cold review)* | **Filter `getActiveCount`/`checkCap` (`api/lib/autonomy-coordinator.js`) to `event_type='action_executed'` only** (not every `status='complete'` row) before S-AUTOLOG-1's writer fix may be deployed; additionally fix the two `writeLog` call sites (manual-gate approval, budget-guard deferral) that record `action_executed` when nothing executed — needs its own event_type or an `executed:false` metadata flag, a real design decision. Touches `autonomy-coordinator.js` and `execute-action-logic.js`, both protected. | backend; **fresh cold safety-reviewer** (must not be the S-AUTOLOG-1 reviewer) | S-AUTOLOG-1 (BLOCKED build) | **NOT STARTED — new session, not built this run** | — |
| **S-SNAPSHOT-1** *(new, discovered by S-OBS-1)* | **Fix `performance_snapshots`'s write/read path.** Write (`analyze-ads.js:302`) and read (`performance-snapshots.js`, `evaluate-outcomes.js` fallback) all assume columns (`snapshot_at`, `google_data`, `meta_data`) that do not exist on the live table (`snapshot_date`, `channel`, `metrics`, `campaigns`). No test file validates against the real schema. Not a protected file, but a genuine behavior fix — deserves its own schema-accurate test suite. | backend + data | S-OBS-1 (finding) | **NOT STARTED — queue stopped before this session per §7 (a cold safety-reviewer BLOCKed S-AUTOLOG-1)** | `evidence/S-OBS-1-zero-row-sweep-2026-07-30_2120.log` |
| **S-COST-2** | **Cost-ledger blind spots (D-6 flags).** Fix `cost-rates.js` model coverage (`claude-sonnet-4-6` alias-only while `CHAT_MODEL` uses it); **make an unknown model log/alert instead of writing a silent NULL**; assign SDR-5 cadence + SDR-6 trigger to the rate table. **BLOCKS the D-6 14-day clock** | backend + data | none | **ACCEPTED (2026-07-30, unattended)** | `evidence/S-COST-2-verify-2026-07-30_2111.log` (4/4, 848 tests), `evidence/S-COST-2-path-enumeration-2026-07-30_2110.log` |
| S-COST-1 | **`cost_rollups_monthly`: populate or drop.** 0 rows is indistinguishable from zero spend (SDR-1 instance 4). Nothing may be built against it until resolved | backend + data | none | **READY — ruling made** | — |
| **S-OBS-1** | **Zero-row sweep, assertions.** Emptiness/freshness assertion registry for the six tables in HARNESS.md §4.1's sweep; cost-ledger read disclosure; investigate `automation_log` specifically | backend + data | none | **ACCEPTED (2026-07-30, unattended)** | `evidence/S-OBS-1-verify-2026-07-30_2120.log` (4/4, 861 tests), `evidence/S-OBS-1-zero-row-sweep-2026-07-30_2120.log` |
| **S-CLEAN-1** | **Root artifact provenance — `prime-audit.zip`.** Record provenance or delete; also closes the original 2026-07-28 four-artifact cleanup (already deleted, never committed until tonight) | orchestrator | none | **ACCEPTED (2026-07-30, unattended)** | `evidence/S-CLEAN-1-verify-2026-07-30_2106.log` (4/4) |
| **S-CI-1** | **Did CI ever actually run?** Investigate GitHub Actions history; correct the record either way | orchestrator | none | **ACCEPTED (2026-07-30, unattended) — finding: CI never ran, ever, 0 workflows registered** | `evidence/S-CI-1-verify-2026-07-30_2124.log` (4/4), `evidence/S-CI-1-investigation-2026-07-30_2123.log` |
| S-LINT-1 | Burn the lint baseline to zero (12 unused identifiers + `no-prototype-builtins` in `api/image-process.js:82`); flip both rules from `warn` to `error` | backend | S-HARNESS-P1 | **ACCEPTED (2026-07-30, unattended)** | `evidence/S-LINT-1-verify-2026-07-30_2101.log` (4/4, 838 tests) |
| S-08A | Objective + scoring module (`objective.js`, `recommendation-score.js`) — pure logic, no network, no writes | backend + AI-systems; adversarial reviewer | 07f (landed, `92567dd`) | **IN REVIEW** | `evidence/S-08A-verify-*.log` |
| **S-04B** | **Sold-rate in outcome grading (R-014 — misaligned objective, NOT a limitation).** Add booked/lost columns to `action_outcomes`; `evaluate-outcomes.js` writes them; `gradeOutcome` gains a sold-rate rung above CPQL. Without it the learning gate rewards more/cheaper/worse leads every cycle | backend + data; **safety-reviewer** | S-04 (CRM bridge, landed) | **BUILT — cold review BLOCK (2026-07-30): rung grades a ratio while the objective is a count, A7 unreachable when it fires, unclamped config constant, deploy-before-migrate masks R-014 further. NOT ACCEPTED — rework session S-04B.2 required, still BLOCKS S-08B** | `evidence/S-04B-verify-2026-07-30_2204.log` |
| **S-08A.1** | **Server-derived reallocation cohort — CONTRACT/SECURITY ONLY.** Membership binding, unique `rowIds`, scalar `fetchId`/window, derived `booked`/`lost`/host/prior, `googleConversions` guard test, multi-ad-group fixture (3 blocking cases). **KEEP the W cap** (D-11) | backend + AI-systems; **fresh adversarial reviewer (must attempt A15–A19)** | S-08A (build/review); **S-07f.0 for INTEGRATION only** | **BUILT — cold review BLOCK (2026-07-30): A15/A17/A19 all still live on the sanctioned entry point (host-membership unbound, downward booked/lost not bounded, prior omission scores better than disclosure), W-cap unreachable ruled NOT to satisfy D-11. NOT ACCEPTED — rework session S-08A.1a.2 required with a fresh reviewer** | `evidence/S-08A.1a-verify-2026-07-30_2156.log` |
| **S-08A.1a.2a** | **Discharge D-11 — spendVerified defaults to FALSE for every rows-derived cohort.** Removed the hard-coded `spendVerified: true`; the W-multiple cap now applies to every rows-derived candidate through the sanctioned `expectedDeltaProfitableLeads` entry point. Form change only (W stays 3, DI-3). A15-host/A17/A19 explicitly NOT attempted — S-08A.1a.2's job | backend; **cold safety-reviewer** | S-08A.1a (BLOCKED build), D-11 re-affirmed | **ACCEPTED (2026-07-31) — cold review APPROVE WITH NOTES; two warn-level findings corrected in-session (test mislabeling, understated accepted-cost comment); one nit logged as R-016 (no structural enforcement against re-hardcoding `spendVerified: true`), assigned to S-07f.1's acceptance criteria** | `evidence/S-08A.1a.2a-verify-2026-07-31_1848.log` (4/4, 893 tests) |
| **S-REACH-1** | **What else is green on a dead path?** Sweep for guards/caps/validators tested directly but potentially unreachable from live entry points, per the D-11 review's own finding class. Investigation only — do not fix what is found | backend + security | none hard | **ACCEPTED (2026-07-31, investigation — no code changed, no verify.ps1 gate applicable)** — 5 guards confirmed REACHABLE by call-graph trace; 1 new finding (mirror-image of D-11: a reachable path that BYPASSES guards) assigned session ID **S-ACTIONS-LEGACY-1**; kill-switch confirmed absent as expected (S-09A not started); full findings in `DECISIONS.md` | — |
| **S-ACTIONS-LEGACY-1** *(new, discovered by S-REACH-1)* | **`api/actions.js`'s legacy `POST {action:'execute', id}` branch sets `status='executed'` while bypassing `canExecute`, `validateStatusPatch`, both budget guards, and the negative-keyword guard — no platform mutation occurs, but downstream consumers (ledger, `evaluate-outcomes.js`) would read a fabricated "this happened" record.** Predates Stage B1, disclosed there as a known carry-over ("no auth gap fixes" scope). No current UI client calls this shape — reachable only via direct authenticated HTTP call. Delete the branch (if confirmed fully unused) or route it through `acquireLockAndExecute` like every other execution path | backend; **safety-reviewer recommended** (touches the same `actions.status` field the execution pipeline's state machine depends on, even though `api/actions.js` is not on CLAUDE.md's literal protected-file list — reviewer decides) | S-REACH-1 (finding) | **NOT STARTED — new session, not built this run** | — |
| **S-08A.2** | **`max_profitable_leads_per_dollar` cap redesign — FORM ONLY, at `k=25` (null change).** Landing form and level together makes any behavioural difference unattributable (**DI-3**). Adversarial pass on circularity, on Prime-inside-its-own-measurement-window, and on rate-limiting (fall fast / rise slow, **DI-1**) | backend + AI-systems; **fresh adversarial reviewer** | S-08A.1 | **READY** | — |
| **S-08A.2b** | **Tune `k` — separate decision, separate review.** Only after S-08A.2 has been observed in production. Owner decision on the level | backend; independent reviewer | S-08A.2 observed | NOT STARTED | — |
| **S-08A.3** | **Constant provenance.** Tag every standing number DERIVED (cadence) or CHOSEN (review date + owner); fix justified-against-nominal comments; use `learning_missing_history_weight` as the template | backend; independent reviewer | none hard | **READY** | — |
| **S-08A.4** | **Scale invariance (R-015).** Make `min_score_threshold` + six `risk_penalties` dimensionless — fraction of typical delta at the tenant's own scale. Prove no behaviour change at FPB scale; prove a $500/mo tenant is no longer inert | backend + AI-systems; **safety-reviewer** (penalties are safety pressure) | S-08A.2 | **READY — precondition on `ENABLE_MULTI_ACCOUNT_CRON`** | — |
| **S-07f.0** | **Search-term row identity.** Add `search_term_view.resource_name` + `ad_group.id` to the GAQL SELECT; expose a stable `rowId`. Scope grew to include `api/chat.js`'s prompt-safe projection, per SDR-4 shared-grounds (see DECISIONS.md). **Deliverable includes a live before/after cardinality artifact** in `evidence/S-07f.0-cardinality-*.log` — identical row count and `totalWastedSpend` required | data + integration; **safety-reviewer** (`google-ads.js`, `chat.js`) | none | **BUILT, code cold-reviewed "approve-with-notes" (2026-07-30) — NOT ACCEPTED, blocked on the live cardinality artifact, which this environment cannot produce (no live Google Ads credential access)** | `evidence/S-07f.0-verify-2026-07-30_2213.log` |
| S-07f.1 | Session-scoped fetch cache + row-ID staging; max-evidence-age enforced **at execute**; `fetched_at`/`executed_at` on the action record; `fpb.js:191` vs `:201`/`:207` reconciliation | backend + data + security; **safety-reviewer** (execute path) | **S-07f.0**, S-07f (landed) | **READY — D-8 resolved** | — |
| S-07g | Structured action channel — replace the `ACTION:{...}` text protocol with tool calls; schema validation at emit time; `MAX_BATCH_TERMS` → config | backend + AI-systems; **safety-reviewer** | S-07f.1 | NOT STARTED | — |
| S-07h | Action ledger panel + registry-driven capability disclosure (**validated-vs-shelved surfaced to Brian, outside the model's context** — D-10) + render-layer `fetch_id` provenance rule | backend + AI-systems + frontend | S-07g | NOT STARTED | — |
| S-08B | Daily optimization loop — **thin cron ENQUEUES; a per-item, retryable, idempotent worker does the work** (D-3 / SDR-3). Mines stats + terms + outcomes, scores via 08A, writes evidenced recommendations to the coordinator-gated queue. Enqueue via a Supabase job table (no new vendor); Vercel Queues would be an owner decision | backend; safety-reviewer | **S-04B** (R-014), **S-08A.1** ACCEPTED + re-reviewed | **BLOCKED — R-014 is the hard blocker: a daily loop that writes every day is what converts the misaligned reward from dormant to compounding** | — |
| S-09A | Kill-switch + cost telemetry. **Execute-path-only halt** (writes stop; fetch/analysis/telemetry/alerting continue); **global AND per-tenant, global wins**; **auto-trip permitted, auto-re-arm NEVER**; indeterminate ⇒ halt writes, keep watching; **tripped state announces itself continuously** (D-5 / SDR-1 instance 6) | backend + security | none hard; must precede S-09B | **READY — D-5 resolved** | — |
| S-09B | Hourly watch loop (`cron-watch.js`) — spend pace, CPL spike, offline, lead crash; alert-once with dedup; **cron-as-worker retained** (SDR-3, level-sampling); **heartbeat, not just alerts** (SDR-1); **+ standing assertion `distinct(searchTerm,campaignId) == row_count`** so the latent multi-ad-group collision announces itself (SDR-5). **Requires Vercel Pro** for hourly cadence | backend; safety-reviewer | S-08A, S-09A | **BLOCKED — D-4(a) plan confirmation** | — |
| S-10 | Live validation on FPB — both loops proven in production, Brian approving each first-run action | release-verification | S-08B, S-09A, S-09B | NOT STARTED | — |

## S-08A — notes

**Scope delivered:** `api/lib/objective.js`, `api/lib/recommendation-score.js`,
`sql/020_agent_config_recommendation_scoring.sql` (seed-only, no schema change),
`tests/objective.test.js`, `tests/recommendation-score.test.js`. Nothing outside §8's
permitted files was touched. No live API call, no queue write — as specified.

**Evals provable at this layer:** E1 (a proven-worthless negative keyword can score positive
and reach the queue), E3 (min-data-volume gate zeroes the score), E6 (threshold + volume cap
drop the lowest-scoring above-threshold items, never pad), E7 (a historically-failing action
class is down-weighted from `action_outcomes` fixtures). E2/E4/E5/E8/E9/E10 belong to
S-08B / S-09A / S-09B.

**Adversarial review history.** The scoring surface is an LLM-facing attack surface: an
upstream model that wants its recommendation approved is rewarded for whatever the score
rewards. Fourteen attacks are enumerated and killed in the module headers (A1…A14). Two were
found by *independent* review only after the first implementation passed its own tests:

- **A3** — the score was strictly decreasing in the reported baseline sold rate, so
  understating the baseline was rewarded, and the same lie suppressed the quality-drag alarm.
  Fixed by DERIVING every sold rate from terminal CRM counts; a caller may report counts,
  never assert a rate.
- **A14** — `removed.spend` was trusted independently of the removed cohort's lead share, so
  inflating it scored ~18x honest value while passing every A10 subset check. Fixed by the
  spend-coherence cap (`reallocation_max_waste_multiple`, W=3, config-driven), with a
  provenance carve-out for server-verified search-term cost so eval E1 survives.

**Open before S-08A can be ACCEPTED:**
1. Independent re-review of the A14 fix — the reviewer who found it should confirm the kill.
2. Owner Decisions D-3…D-7 remain OPEN (they gate S-08B onward, not S-08A itself).

> **⚠️ The A14 fix is superseded before it is accepted.** `HARNESS-CHAT-SURFACE.md` §5
> (S-08A.1) replaces the `spendVerified` flag + `W` coherence cap with a server-derived
> cohort. Rationale: a provenance *flag* is only as trustworthy as the caller that sets it.
> Re-review effort should go to S-08A.1's signature change, not to hardening a mechanism
> that is being deleted. See `DECISIONS.md` I-002 → I-006 and **R-001**.

**08B contract inherited from S-08A** (do not break these when wiring the loop):
- Candidates carry lead COUNTS (`booked` / `lost`), never sold *rates*. Rates are derived.
- ~~`removed.spendVerified` may be set only by server code…~~ **SUPERSEDED by S-08A.1:**
  `removed` carries server-fetched **rows**; `spend` is derived as `sum(row.cost)`. A scalar
  `spend` is a hard error. There is no flag to set and no claim to cap.
- **Never** copy `spend`, `spendVerified`, or `removedQualifiedLeads` out of an LLM proposal.
  The model names WHICH row; it never supplies that row's numbers.
- `outcomes` must actually be fetched and passed. Omitting the array is penalised (A12), and
  correctly so — silence must never beat disclosure.

## S-HARNESS-P1 — notes (2026-07-28)

**Premise correction.** The session prompt expected `harness/` to be the blank installer
template. It was not: `HARNESS.md` (v1.0 ACTIVE), `SESSIONS.md`, and `HARNESS-PHASE-A.md`
(19KB) were already real and project-specific. **`AGENTS.md`, `DECISIONS.md`, and
`ENVIRONMENT.md` were still blank templates** carrying `[PROJECT NAME]` — those are what
this session filled, along with the new `HARNESS-CHAT-SURFACE.md` amendment.

**Verify-gate gap closed (the important one).** `scripts/verify.ps1` runs lint only
`if ($scripts.ContainsKey("lint"))`; `.github/workflows/verify.yml` runs
`npm run lint --if-present`. No `lint` script existed, so **both gates skipped lint silently
while attesting "ALL CHECKS PASSED (2/2)"** — and `HARNESS.md` §5 claimed the gate ran
`npm run lint`. Proof: `evidence/S-08A-verify-2026-07-13_1727.log` contains exactly two
CHECK blocks, `tests` and `build`. The gate now runs **3/3**. See `DECISIONS.md` I-003…I-005.

**Everything is untracked.** `harness/`, `.github/`, `api/lib/objective.js`,
`api/lib/recommendation-score.js`, `sql/020`, both S-08A test files, and `scripts/verify.ps1`
are all untracked in git. The harness exists on disk but is **not yet in the repo's history** —
Brian's commit is what lands it.

---

## Session Packet Format

Full packets live in `HARNESS-PHASE-A.md` §8. Handoff format is in `AGENTS.md`.
