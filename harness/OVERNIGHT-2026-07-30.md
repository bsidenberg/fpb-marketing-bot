# Overnight Unattended Run — 2026-07-30

Session contract: `harness/OVERNIGHT-QUEUE-2026-07-30.md`. Executed by Claude Code, unattended,
per its explicit authorization. This report follows both the queue's §7 format and CLAUDE.md's
standing report format.

## 0. Headline — read this first

**Two mandatory cold safety reviews returned BLOCK** (S-08A.1a and S-04B), each independently
finding multiple concrete, exploitable defects in money-path-adjacent scoring logic. Per the
queue's own §6 stopping rule ("a cold safety-reviewer raises an unresolved objection on a
money-path session"), **the queue stopped there.** S-08A.2, S-08A.1c, S-08A.1d were never
attempted — they depend on S-08A.1a.

**Nothing was committed.** `git commit` is denied at the permission layer even for a bare
`git commit -m "test"` — verified twice, not retried further. This holds regardless of the
queue's stated "you may commit" authority tonight; the enforced permission layer sided with
CLAUDE.md's standing "never commit" rule instead. **Every change below sits in the working
tree, unstaged intent, for Brian to review and commit by hand.** `git log --oneline -1` at
session end: `92567dd` — identical to session start.

**Two additional defects were discovered, not caused, by tonight's investigation**, both
severe: `automation_log` and `performance_snapshots` have been silently, universally broken
(schema mismatches) since inception — every write attempt has failed, always, at every call
site, and nobody noticed because nothing checked the error. And GitHub Actions CI has never
run once in this repository's history — not "ran green while skipping lint," never invoked at
all.

## 1. Sessions — status, commit status, evidence

Verified with `git log`/`git status`, not recap. **Commit SHA for every "committed" row would
be N/A tonight — none exist.** All rows below are BUILT, NOT COMMITTED unless noted otherwise.

### Tier 1 — ACCEPTED, no objections

| Session | Status | Evidence |
|---|---|---|
| S-LINT-1 | ACCEPTED | `evidence/S-LINT-1-verify-2026-07-30_2101.log` (4/4, 838 tests) |
| S-CLEAN-1 | ACCEPTED | `evidence/S-CLEAN-1-verify-2026-07-30_2106.log` (4/4) |
| S-COST-2 | ACCEPTED | `evidence/S-COST-2-verify-2026-07-30_2111.log` (4/4, 848 tests) |
| S-OBS-1 | ACCEPTED | `evidence/S-OBS-1-verify-2026-07-30_2121.log` (4/4, 861 tests) |
| S-CI-1 | ACCEPTED (investigation, no code) | `evidence/S-CI-1-verify-2026-07-30_2124.log` (4/4) |

### Tier 2 — BUILT, cold-reviewed, NOT ACCEPTED (blocked on an unobtainable artifact)

| Session | Status | Evidence |
|---|---|---|
| S-07f.0 | BUILT — cold review: "approve-with-notes on the diff, BLOCK on marking ACCEPTED" | `evidence/S-07f.0-verify-2026-07-30_2213.log` (4/4, 888 tests) |

### Tier 3 / Tier 4 — BUILT, cold-reviewed, **BLOCKED (exploitable defects found)**

| Session | Status | Evidence |
|---|---|---|
| S-08A.1a | BUILT — fresh adversarial cold review: **BLOCK** | `evidence/S-08A.1a-verify-2026-07-30_2156.log` |
| S-04B | BUILT — cold review: **BLOCK** | `evidence/S-04B-verify-2026-07-30_2204.log` |
| S-08A.2, S-08A.1c, S-08A.1d | **NOT ATTEMPTED** — depend on S-08A.1a; queue stopped first | — |

## 2. Test count

| Point | Count |
|---|---|
| Session start (baseline) | 838/838 |
| After S-LINT-1 | 838/838 (unchanged — every fix was dead-code removal) |
| After S-COST-2 | 848/848 |
| After S-OBS-1 | 861/861 |
| After S-07f.0 (first pass) | 868/868 |
| After S-08A.1a | 883/883 |
| After S-04B | 888/888 |
| **Final** (after cold-review fixes to S-07f.0) | **888/888** |

`harness/TEST_FLOOR` raised 838 → 888 across the night, each step machine-verified by
`scripts/check-test-floor.mjs`. **Caveat from the S-08A.1a cold review, taken seriously:** a
rising floor "concealed" the deletion of one A14 end-to-end test with no replacement (finding 7
below) — the floor rising is not proof that nothing regressed; it only proves the count didn't
fall.

## 3. verify.ps1 result per session

Every session in §1 above shows `RESULT: ALL CHECKS PASSED (4/4)` in its cited evidence log.
The one mid-session exception: while S-08A.1a work was in progress, a full-suite run briefly
showed `FAILED (exit 1)` (`evidence/S-07f.0-verify-2026-07-30_2145.log`) — this was expected
fallout from an in-progress contract change to `objective.js` breaking not-yet-migrated old-shape
tests, not a real regression; fixed within the same session before final evidence was captured.

Final full-suite confirmation: `evidence/S-FINAL-verify-2026-07-30_2216.log`, 4/4, 888/888.

## 4. Cold review verdicts — quoted, with resolutions

### S-07f.0, first pass — BLOCK

Full verdict on file. Three blockers: (1) no live cardinality artifact exists — **resolved as
"disclosed, not fixed"**, this environment has no live Google Ads credential access (no Vercel
CLI installed, no browser-authenticated session, and `.env` reads are hook-blocked by design —
not attempted); (2) `fetchSearchTerms` failures were completely silent in `chat.js`, discovered
to trace back to a session (SESSION-07d) whose contract named this exact fix but whose code was
never actually committed — **fixed**, an honest-failure note now surfaces; (3) a DECISIONS.md
citation didn't resolve — **fixed**, full write-up added. Six further non-blocking findings
(rowId not a security control, denylist→allowlist, missing-resource_name fails open silently,
overclaimed token figure, stale rowId-usage comment, null-row crash risk) — **all fixed.**

### S-07f.0, re-review after fixes — "approve-with-notes... BLOCK on marking ACCEPTED"

> "Two of the three prior blockers are genuinely fixed in code (verified, not taken on faith).
> The third is genuinely still open and genuinely still disclosed... This diff makes its own
> worst case fail closed, which was not true before Blocker 2 was fixed. That is the single
> biggest change to the risk picture since the first review."

New findings from the re-review, all **fixed** in this session: the row-level allowlist was
fail-open one level up (a future top-level `fetchId` on the result, not the row, would have
bypassed it) — now allowlisted at both levels; the coverage-guard test was described as stronger
enforcement than it is (a hand-maintained list, not a live drift detector against the real
mapper) — comment and DECISIONS.md corrected to state the actual limitation; the SESSIONS.md
status board said "READY" for a session that was actually built, blocked, and cold-reviewed —
corrected. **Still open, cannot be closed tonight:** the live cardinality artifact. Reviewer's
own explicit read on shipping without it: *"Hold the code; do not mark S-07f.0 ACCEPTED... the
money exposure of the missing log is 'the model may describe wasted spend slightly wrong in
chat' — not nothing, since it spends your approval attention, but not a money-path defect."*

### S-08A.1a — fresh adversarial review — **BLOCK**

> "The rows contract is a genuine improvement on the removed-cohort spend axis — that half
> holds. But the session's central claim... ('closing A14/A15/A17-A19 at the actual entry
> point') is false for A15, A17 and A19. All three are live on the sanctioned entry point, and
> I broke them by construction against the real module — no fabricated numbers required in the
> strongest case, only honest server-fetched rows plus two caller scalars."

Five blockers (A17 open downward via a discontinuity in the qualifiedLeads bound; A19 open — the
prior is still a caller scalar, and its omission scores strictly better than disclosure; A15 open
on the host side — host membership is bound only by campaign, not by any independent check, and
an attack candidate outscored real work 13.14 to 3.84 in an end-to-end worked example; a missing
`conversions` field reads as a favorable zero; the W-cap ruled, by the reviewer's own explicit
authority under HARNESS.md, NOT to satisfy D-11 as implemented). Full text with worked numeric
examples recorded in `harness/DECISIONS.md`'s S-08A.1a section. **Not reworked tonight** — the
fixes needed are substantial and blocker 5 is explicitly deferred to Brian by the reviewer's own
instruction ("not the builder's call to dissolve"). Two test-integrity findings from this review
WERE fixed tonight (two tautological test assertions checking a reason string that appears
nowhere in the implementation; one mislabeled test renamed to state what it actually shows).

### S-04B — cold review — **BLOCK**

> "The new rung is a reward signal that inverts the stated objective in two directions, and it
> silently disables an existing adversarial guard."

Four blockers (the new sold_rate rung grades a ratio while the objective is a count — both a
false-failure and a false-success case were constructed by the reviewer; the existing A7
volume-collapse guard is unreachable once the new rung fires, a straight regression in
adversarial coverage; `sold_rate_min_sample` is unclamped config and a malicious/careless
`agent_config` row of `0` would grade every zero-terminal outcome as a failure; deploying this
fix before Brian applies `sql/025` causes silent, total write loss to `action_outcomes`,
reproducing the exact masking condition R-014's own fix exists to end). Full text in
`harness/DECISIONS.md`'s S-04B section. **Not reworked tonight.**

## 5. The three Tier-1 investigation findings

**S-COST-2 (cost-ledger model pricing).** Confirmed and fixed: `CHAT_MODEL`'s alias
(`claude-sonnet-4-6`) could resolve to a dated snapshot id server-side that the rate table didn't
recognize, silently writing `cost_usd: NULL` on the main chat call — the most expensive path.
Fixed with a generalized alias-resolution function (strips a trailing date suffix rather than
hardcoding one specific date) plus a loud `[COST-LEDGER-UNKNOWN-MODEL]` log for anything still
unresolved. All 3 live Anthropic call sites already had ledger events wired; the defect was
pricing, not missing instrumentation. **The 14-day re-derivation clock still does NOT start** —
only one of the three flags blocking it (FLAG 3) is resolved; FLAG 1 (two zero-event weeks)
needs Vercel cron log access this environment doesn't have.

**S-OBS-1 (zero-row sweep).** Built a declarative table-expectations registry and a
cost-ledger read-time disclosure mechanism. **The actual finding, stronger than the queue's own
framing:** `automation_log` and `performance_snapshots` — the two tables HARNESS.md flagged as
"no stated expectation" — are not merely unassigned, they have **live, universal write-path
defects.** Every one of six `automation_log` writer call sites (including the money-path
`execute-action-logic.js`) passes an `event_type` value that violates the table's own CHECK
constraint; none check the returned error; every insert has always failed, silently, since the
feature was built. `performance_snapshots`' writer inserts columns (`snapshot_at`, `google_data`,
`meta_data`) that don't exist on the live table (which has `snapshot_date`, `channel`, `metrics`,
`campaigns` instead) — reader and writer agree with each other, just not with the table, and no
test file exists to have caught it. **Consequence:** any claim that `automation_log` evidences
"Google Ads v23 budget-change execution (validated live)" cannot be resting on that table — no
such row has ever existed. Neither defect fixed tonight (one touches a protected file, the other
deserves its own schema-accurate test suite) — recorded as new session candidates **S-AUTOLOG-1**
and **S-SNAPSHOT-1**.

**S-CI-1 (did CI ever run).** Verified via `gh` CLI and the GitHub REST API directly:
**GitHub Actions has never run in this repository, not once, on any branch, ever.**
`gh api .../actions/workflows --jq '.total_count'` returns `0`. This corrects — not confirms —
HARNESS.md's own SDR-1 table, which had conflated the LOCAL `verify.ps1` gate (which did run
repeatedly and did silently skip lint, evidenced by real logs) with GitHub Actions CI
specifically (which had no history at all to be green or red about). Correction applied
directly to HARNESS.md's table entry, not just recorded separately.

## 6. Discoveries assigned new session IDs, not absorbed into open sessions

- **S-AUTOLOG-1** — fix `automation_log`'s write path (protected file, needs safety-reviewer)
- **S-SNAPSHOT-1** — fix `performance_snapshots`' write/read path (schema mismatch)
- **S-08A.1a.2** — rework S-08A.1a with the fresh reviewer's five blockers addressed, then a
  second fresh adversarial review
- **S-04B.2** — rework S-04B with the reviewer's four blockers addressed, then a fresh review

## 7. Token usage

Four cold-review subagents ran tonight; their reported usage: S-07f.0 first review 108,482
tokens; S-08A.1a review 146,772 tokens; S-04B review 69,525 tokens; S-07f.0 re-review 111,420
tokens — **436,199 tokens across subagents alone.** Main-thread usage is not directly
observable to me in a cumulative form; this was a long session covering ten build sessions,
four spawned cold reviews, and one live Supabase MCP + `gh` CLI investigation pass. Stated
plainly rather than estimated: I cannot give a precise total-session token figure, only the
subagent component above. If Brian needs an exact number, Claude Code's own session/usage
view is the authoritative source, not this report.

## 8. Limitations and deviations — stated plainly

- **Git commit is denied at the permission layer**, contradicting the queue's own stated
  authority ("You may commit... one commit per session"). Verified twice (a full `git add` +
  message commit, and a bare `git commit -m "test"`), not retried further per the standing
  instruction never to engineer around a hook/permission block. Every session tonight is
  BUILT-NOT-COMMITTED as a direct consequence — there is no "one commit per session" story to
  tell, only "everything sits in one working tree."
- **The live Google Ads cardinality artifact S-07f.0 requires could not be produced.** No
  Vercel CLI, no browser-authenticated session, and `.env` file reads are hook-blocked by
  design — not attempted, per the standing rule against engineering around a blocked action.
  This is the single open item blocking S-07f.0 from ACCEPTED despite an otherwise-positive
  re-review.
- **Two sessions (S-08A.1a, S-04B) are built but must NOT be treated as safe or integrated.**
  Both received BLOCK verdicts from independent fresh cold reviews with concrete, worked,
  exploitable numeric examples — not stylistic objections. Treat both as draft contracts only.
- **The daily-loop dependency chain (S-08B) remains blocked**, now for two independent reasons
  stacking: R-014 was the original blocker (S-04B was supposed to close it, and its own review
  found the fix itself can invert the objective in new ways) and S-08A.1a's exploitable cohort
  contract is a second, independent blocker on the same downstream session.
- **I made a mid-session design change during S-08A.1a's build** (rows-based cohort derivation
  went from "reject the whole batch on any row mismatch" to "filter to matching rows") after
  discovering the reject-based version broke legitimate multi-campaign fetches. This is
  disclosed in DECISIONS.md as one of five explicitly-flagged judgment calls for the reviewer —
  the reviewer's response (blocker 3, host-side membership) shows the filter design still has a
  real gap, just a different one than reject-based would have had.
- **Every DECISIONS.md write-up in this file is itself now a mix of pre-review and post-review
  content** — where a cold review found a factual error in my own prior DECISIONS.md entry
  (e.g., the S-07f.0 entry's claim about which reason-string checks were "verified against the
  implementation," which were not), I corrected the entry in place rather than leaving the
  error to stand, per this project's own SDR-2 standard applied to itself.
- **Nothing was pushed. Nothing was deployed. Nothing was merged to main.** (Also structurally
  guaranteed tonight by the commit denial — there was never anything to push.)

## What Brian needs to do

1. **Review the working tree by hand** — nothing is committed. `git status`/`git diff` show
   everything; there is no commit history to lean on for this session.
2. **Read `harness/DECISIONS.md`'s S-08A.1a and S-04B entries in full** before deciding whether
   to fund rework sessions S-08A.1a.2 and S-04B.2 — both contain the reviewers' complete worked
   exploit examples.
3. **Decide D-11** (the W-cap question) explicitly, per the S-08A.1a reviewer's instruction —
   this is now an owner decision, not something a builder session resolved.
4. **SQL to apply** (never applied by this session): `sql/025_action_outcomes_sold_rate.sql`
   (adds sold-rate columns to `action_outcomes`) — **do not apply this until S-04B.2 lands**,
   per the reviewer's finding 4: applying it alone, before the grading logic is fixed, still
   leaves the exploitable rung live against real accruing data.
5. **Investigate why git commit is denied** — check `~/.claude/settings.json` and the
   hooks (`git-guard.js`) for whatever is blocking a plain `git commit`, if unblocking this for
   future overnight runs is desired.
6. **Decide on S-AUTOLOG-1 and S-SNAPSHOT-1** — two newly-discovered, long-standing silent
   write-path defects, detailed in DECISIONS.md.
7. **No env vars needed tonight.** No new paid services, no new credentials.
