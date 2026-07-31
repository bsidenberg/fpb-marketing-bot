# PRIME — OVERNIGHT UNATTENDED BUILD

**Repo:** `bsidenberg/fpb-marketing-bot` @ `C:\Python\FPB Marketing Bot`
**Branch:** `feat/phase-a-account-manager` — you stay on it. You do not create branches. You do not touch `main`.
**Mode:** unattended. Brian is asleep. He reviews in the morning.

Read in this order before you write anything: `PRIME-AGENCY-ROADMAP.md` → `CLAUDE.md` → `PRIME-STRATEGY.md` → `harness/HARNESS.md` (§4 substitution taxonomy, §4.3 design invariants, §5 claims→checks) → `harness/DECISIONS.md` (D-1…D-12) → `harness/SESSIONS.md`.

---

## 1. Authority for tonight — read this carefully, it changed

- **You may commit.** On this branch only, one commit per session, message naming the session ID.
- **You may not push.** `git push` stays denied. Brian pushes.
- **You may not deploy.** `vercel` stays denied. Nothing you build reaches production tonight.
- **You may not merge to main.** Commit & Merge Authority to main remains HELD until S-08A.1 lands and passes independent adversarial re-review.
- **You may not run migrations against production.** Write SQL files. Do not execute them.

Commit authority is granted *because* nothing can deploy. If you find yourself reasoning that something is safe to push because it is well-tested, stop — that reasoning is out of scope for you tonight.

---

## 2. Standing constraints — non-negotiable, unchanged

1. **Never fabricate a number.** If you cannot fetch it, say you cannot fetch it. A missing number recorded as missing is a good outcome. A plausible number is a defect.
2. **The model's only role in any action is naming WHICH row to act on. It never supplies that row's numbers.** No code path may trust a model-supplied spend value or verification flag. If one does, the A14 reallocation exploit reopens.
3. **Never copy `removed.spendVerified` or a spend value out of an LLM proposal.** Standing contract, applies to every session below.
4. **Builder is never sole verifier.** Every money-path session ends with a `safety-reviewer` subagent invoked with **no prior context** — it reads the diff cold, does not read your session notes, and does not see your rationale. A fresh cold reviewer has already killed a fix that 838 green tests and the original builder both signed off on. Tests are not evidence of correctness, only of consistency.
5. **Test floor is 838.** It may rise. It may never fall. `scripts/check-test-floor.mjs` is the arbiter, not your recap line.
6. **Level-5 autonomy stays unbuilt.** Medium-risk and above (≥25% budget change, pause, new campaign, bidding change) remains human-approved by design. Nothing tonight touches that boundary.
7. **Verify your own claims with the tool, not your summary.** `git log` for commits. The verify log for the gate. The evidence file for the measurement.
8. **Report token usage at each session boundary.** Stay within the Max plan. If you approach a limit, stop cleanly at a session boundary rather than overflowing to API billing.

---

## 3. Scope freeze

Each session below has a fixed scope and permitted-file list. **Discoveries do not get added to an open session.** They get a new session ID in `SESSIONS.md` with a one-line justification and are left for Brian. The bar for adding to an open session is *shared grounds* — "a reviewer clearing the existing scope necessarily clears this too" — not shared files.

This project has repeatedly accreted scope onto open sessions because they were open. Tonight that is prohibited.

---

## 4. Session queue — strict dependency order

Run in order. If a session fails its acceptance criteria, **stop the queue** and record why. Do not skip ahead to the next one.

---

### TIER 1 — unblockers and observability (no money path)

#### S-LINT-1 · lint clean
Files: anything ESLint flags. Fix violations. Do not disable rules to pass. If a rule is genuinely wrong for this codebase, record it in `DECISIONS.md` and leave the violation.
**Accept:** `verify.ps1` still 4/4, test count ≥ 838.

#### S-CLEAN-1 · root artifact provenance
`prime-audit.zip` is now gitignored. Record its provenance in `DECISIONS.md` (what generated it, when, whether it is reproducible) or delete it.
**Accept:** no unexplained artifact at repo root.

#### S-COST-2 · the cost ledger is undercounting the expensive calls — BLOCKING the 14-day clock
`anthropic-cost.js:27` prices on the model string the API returns. `cost-rates.js:23` returns `null` for an unknown model. The row is then written NULL and **nobody is told**. `claude-sonnet-4-6` (CHAT_MODEL) is alias-only in the rate table, so chat turns — the expensive ones — are almost certainly going in unpriced. The $2.24 / 8-week figure undercounts the *current* workload.

Build:
- Resolve model aliases so CHAT_MODEL prices correctly.
- **A null price must raise, not write silently.** SDR-1: silence read as health. Log at minimum, alert preferably. A ledger that can't tell you it failed to price something is worse than no ledger, because it closes the question.
- Tag the rate table per SDR-5/SDR-6: "verified 2026-05-19" has no cadence, "update when pricing changes" has no trigger. Give it a re-derivation date and a named owner, or convert it to a standing assertion that fails loudly on drift. A stale rate table undercounts in exactly the direction that makes a ceiling look safe.
- **Verify coverage of PATHS, not just rows.** $2.24 across 456 calls is ~$0.005/call. Enumerate every code path that spends money and assert each one writes a ledger event. If a path is unledgered, the 14-day re-derivation inherits the blind spot.

**Accept:** a test that fails if a priced call writes a null cost; an enumerated path list committed to `harness/evidence/`.

#### S-OBS-1 · zero-row sweep, assertions
Six empty tables were found; only two had a stated expectation. `automation_log` and `performance_snapshots` are empty with **no expectation at all** — not a wrong expectation, none, which is the condition the rule exists to make impossible.

Build:
- An emptiness/freshness assertion on every read-path table. Each declares expected-empty or expected-populated with a staleness bound.
- **Investigate `automation_log` specifically.** It being empty may contradict the recorded claim that real Google Ads budget changes were proven end-to-end. Determine whether the write path is broken or the table is vestigial. Record the finding either way — this is the kind of contradiction that gets rationalized away.
- `cost_hours` and `cost_subscriptions` are legitimately expected-empty, which means the cost ledger is knowingly incomplete and **the pricing floor in PRIME-STRATEGY §6 is currently unbacked.** Make every cost-ledger read disclose that rather than silently assume it.

#### S-CI-1 · did CI ever actually run?
`.github/` was entirely untracked until tonight's commit. The recorded claim that `--if-present` let lint go unrun "for months while CI showed green" may be false — there may never have been a CI run at all. Check the GitHub Actions history. **Correct the record in `DECISIONS.md` either way.** SDR-2 cuts both directions: agreeing with an incorrect premise is a defect, not deference.

---

### TIER 2 — row identity

#### S-07f.0 · row identity, `google-ads.js` only
`(searchTerm, campaignId)` is **not unique** — `search_term_view` is keyed campaign~adGroup~term, and `fetchSearchTerms` does a bare `results.map` with no dedupe. One term across three ad groups returns three colliding rows. Harmless today; fatal the moment identity derives from that pair.

Build:
- Add `resource_name` + `ad_group.id` to the mapper. Derive a stable `rowId`.
- **MEASURE, do not assume, that this doesn't change cardinality.** Evidence at `harness/evidence/S-07f.0-cardinality-<timestamp>.log`, with three metrics: row count, distinct (searchTerm, campaignId) pairs, distinct rowIds. The third metric is the point — it proves the premise, not the safety of the change. **If distinct-pairs equals row-count, the collision is LATENT, not absent.** The trigger is an ad-group split, invisible from the code side, with no deploy or migration on the day it breaks. Record that explicitly.
- **Option 3 is the decision, execute it:** `chat.js:715` does `JSON.stringify(searchTermsResult, null, 2)` and embeds ~200 rows into the prompt. Adding identity fields would inflate every waste-analysis turn by ~5,500–7,000 input tokens. Add a **prompt-safe projection** in `chat.js` that strips identity fields before they reach the model. The model does not need `rowId` at all. Shipping identity strings into the prompt is the opposite of this amendment's intent.
- This is one scope by the shared-grounds bar: a reviewer cannot clear "expose identity server-side" without deciding where identity must not go.

**Accept:** cardinality evidence log with all three metrics; a test asserting the projection strips identity; token-size assertion on the chat prompt payload.

---

### TIER 3 — S-08A.1, split four ways. Each is a separate session, separate commit, separate cold review.

**Rationale for the split:** these are approvable on different grounds. Bundled, the documentation pass would be the legible half providing cover for a money-path contract rewrite. SDR-4: the trivial half of a diff consumes the sharpest attention and launders the dangerous half.

#### S-08A.1a · server-derived cohort — THE MONEY PATH
The module must not accept `removed.spend` or `removedQualifiedLeads` as caller or model inputs. Delete those inputs.

- Cohort built **server-side** from fetched search-term rows (`google-ads.js` ~408-419 yields `{searchTerm, clicks, cost, conversions}`, `cost = costMicros/1e6`).
- **Deriving row contents is worthless while the model chooses row membership.** `fetchSearchTerms` makes the campaign filter optional (`google-ads.js:363`) and the call site passes no options — so an honest one-term negative scoring 0.084 becomes 14.0 by attaching every row in the account. Every number server-fetched, A10 passes. 167x, worse than the 18x the W cap was built to stop. **Bind rows to the host campaign.**
- Require unique `rowId`s and a scalar `fetchId`/window.
- Cross-check the cohort against the action's own `execution_data`.
- Derive booked/lost, host, and the prior server-side.
- **D-11: the W coherence cap is RETAINED.** The earlier "delete, don't harden" position was formally withdrawn (I-006 → I-007). Do not re-propose deleting it.
- **D-9:** Google conversions and CRM-qualified leads separately named, both server-derived, host and removed from the same fetch. Hard-error if a googleConversions-shaped field reaches `expectedDeltaProfitableLeads` or `evaluateReallocation`. This guard test is a mandatory acceptance criterion.

**Fixture:** three blocking cases with real `resource_name` shapes. Note the trap the fixture already exposed — a uniqueness check that rejects both honest multi-ad-group rows and synthesised duplicates is broken by being **too strict**, and the resulting "no waste found" is indistinguishable from a healthy account.

**Depends on S-07f.0 for integration.** Build and test against fixtures regardless; integration is blocked until row identity lands.

**Accept:** exploit test fails before, passes after. E1 preserved — a zero-qualified-lead pure-waste term with verified cost still scores positive and still queues. W is config-driven (same cohort scores differently at W=3 vs W=6). Cold `safety-reviewer` sign-off, mandatory.

#### S-08A.2 · cap form change at k=25 — NULL CHANGE, per DI-3
`max_profitable_leads_per_dollar: 0.1` is justified at `objective.js:147-149` against "~25x headroom" at target — but `cpl_emergency: 100` sits 23 lines away, unreconciled. Verified: 25x at target, 38x at warn, **50x at emergency**. A cap calibrated against the best case and documented as if it were the worst isn't a bound.

Change the **form** to cap-as-multiple of measured leads-per-dollar. **Set k = 25 and nothing else.** k=25 reproduces today's target-band tightness exactly. DI-3: when a change has both a form and a level, land the form at a null-change level first, because once both move there is no clean before.

**Also build the rate limiter.** The strongest objection to cap-as-multiple is the feedback loop: Prime acts, then measures, so a trailing window contains Prime's own prior actions and the bound becomes a function of the outputs it bounds. Mitigation: bound the cap's rate of change, **fall fast, rise slow.** Tightening is always safe; loosening must earn it over time. Same ratchet shape as D-5's auto-trip/never-auto-re-arm and the test floor.

**Do NOT tune k. S-08A.2b is a separate session and requires observation that does not exist yet.**

#### S-08A.1c · constant provenance
Every standing number gets tagged **DERIVED** (with a re-derivation cadence) or **CHOSEN** (with a review date and a named owner). SDR-5: a measurement's scope is the moment it was taken. SDR-6: an intention to revisit is not a cadence; only a date, a trigger, or a ratchet is.

Specifically: `reallocation_efficiency: 0.7` justifies its direction but never its magnitude on a first-order multiplier. `sold_rate_prior_strength: 10` and `sold_rate_min_sample: 5` are mutually calibrated and neither says so.

**Positive control — keep it, do not touch it:** `learning_missing_history_weight: 0.25` is justified against behaviour with a worked counterexample. It proves the standard is achievable in this codebase, so the others have no excuse. Match that standard.

#### S-08A.1d · scale invariance
`min_score_threshold` and all six `risk_penalties` are **absolute quantities in profitable-lead units** on a system whose deltas scale linearly with spend. At $2.5k/mo typical delta is 1.12, the threshold filters 22.3%, the holdout penalty is 44.6% of delta. At 10x scale: delta 11.20, threshold filters 2.2%, holdout penalty 4.5%. Calibrated against $2,500/month implicitly, never stated. Raise the budget and the quality bar and every safety penalty go proportionally toothless, with **no code change and nothing detecting it.** Seven constants at once.

Make them dimensionless.

**Then implement `TENANT_INERTNESS_FLOOR_USD` as a computed quantity — never a hardcoded $558.** Below the floor the loop is inert by *arithmetic*, not misconfiguration: mathematically incapable of proposing routine work, and an empty queue is indistinguishable from "no opportunities found." Onboarding below the floor must **refuse with the computed numbers**, never enable and go quiet. Note the volatility: baseline ~$558/mo, but $1,116/mo at `cpl_emergency: 100` and $781/mo at `reallocation_efficiency: 0.5`. FPB's own $2,500 sits only ~2.2x above the emergency-band floor.

Weld Workx / FSC at a stated $500/mo sit below it — a typical waste-removal action there scores 0.224 against a 0.25 threshold. Add the floor check to the `ENABLE_MULTI_ACCOUNT_CRON` preconditions, alongside per-tenant bands. FPB's $50/$75/$100 and $2,500 must not be inherited by a $500/mo tenant by default.

---

### TIER 4 — the misaligned objective

#### S-04B · R-014, sold rate in `gradeOutcome` — BLOCKS S-08B
Sold rate is invisible to `gradeOutcome`. Volume-up / sold-rate-down grades as **SUCCESS**, E7 up-weights that action class, and the loop selects for more of it. More, cheaper, worse, compounding. Currently masked only because `action_outcomes` has 0 rows.

The module header's own defence **does not apply** — it argues CPQL resists junk-traffic floods because junk never becomes qualified. True, and irrelevant: the failure is qualified leads that don't **close**, which the CPQL rung cannot see at all. This is SDR-7 — an adjacent defence read as coverage. Verifying the claim harder never catches it, because the claim is true and the *scope* is what's wrong.

Build: sold-rate columns on `action_outcomes`, wire sold rate into `gradeOutcome`, and a test that a volume-up/sold-rate-down outcome grades as failure.

---

## 5. Do NOT build tonight

- **S-08A.2b** (tune k) — requires observation that does not exist.
- **S-07f.1** (fetch cache + row-ID staging) — touches `execute-action-logic.js`, `execute-action.js`, `google-ads.js`. Three protected money-path files, and the reviewer must confirm stale-evidence refusal survives re-staging. Needs a live human.
- **S-05B** (budget-guards monthly dimension) — money path, D-12, safety-reviewer required with Brian awake.
- **S-08B, S-09, S-09B** — blocked on S-04B and on Tier 3 landing clean.
- **Bug 19** (Meta Graph v19) — record a trigger in `DECISIONS.md`, do not migrate.

If you finish Tier 4 with time and budget left: **stop.** Write the report.

---

## 6. Stopping rules

Stop the queue and write the report if any of these is true:

- A session fails its acceptance criteria.
- `verify.ps1` drops below 4/4, or the test count drops below 838.
- A cold `safety-reviewer` raises an unresolved objection on a money-path session.
- You are about to add scope to a frozen session.
- You cannot obtain a number a session requires and would have to assume it.
- Token budget approaches the plan limit.

**An intention to build is not a build, and this harness has rules for everything except when to stop harnessing.** Do not spend the night writing more rules. If you find yourself drafting a new SDR instead of shipping code, that is the stopping condition.

---

## 7. Morning report

Write `harness/OVERNIGHT-<date>.md` containing:

1. Sessions attempted, and for each: **committed / built-not-committed / not-started**, with the commit SHA. Verified with `git log`, not with your recap.
2. Test count at start and end.
3. `verify.ps1` result per session.
4. Every cold review verdict, quoted, including objections you resolved and how.
5. **The three findings from S-COST-2, S-OBS-1 and S-CI-1** — these are investigations, and their output is the finding, whatever it turned out to be. A finding that contradicts the recorded history is the most valuable thing you can produce tonight.
6. Every discovery that got a new session ID instead of being absorbed.
7. Token usage.
8. **Limitations and deviations, stated plainly.** Anything you could not verify. Anything you assumed. Anything you would want a reviewer to look at hardest.

Nothing pushed. Nothing deployed. Nothing merged to main. Brian promotes in the morning.
