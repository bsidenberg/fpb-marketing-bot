# PRIME — BUILD QUEUE (revised 2026-07-31, post D-11 review)

**Repo:** `C:\Python\FPB Marketing Bot` · branch `feat/phase-a-account-manager` (stay on it)
**Read first, in order:** `harness/REVIEW-D11-2026-07-31.md` → `harness/DECISIONS.md` (D-11 as re-affirmed, plus §S-08A.1a) → `harness/OVERNIGHT-2026-07-30.md` → `CLAUDE.md` → `harness/HARNESS.md` §4, §4.3, §5

**This supersedes `harness/BUILD-QUEUE-2026-08.md`.** The sequencing in that file is invalid: it parked S-07f.1 and made S-08A.1a.2 the main event. The D-11 review established S-07f.1 as a binding dependency of full closure.

---

## 1. North star

Prime is being built to become an extremely capable marketing operator that **takes action on the ad accounts and changes them**. Because Prime acts, the exploit surface *is* the product. A recommendation that scores wrongly moves real money in a live Google Ads account. The A14 lineage is the critical path, not a detour.

---

## 2. What the D-11 review changed

The W cap is **structurally unreachable** from the sanctioned entry point. `objective.js:1045` hard-codes `spendVerified: true` for every rows-derived cohort; the only path that could set it false is refused outright. Its ~10 tests pass because they exercise the cap directly, never through the path in use.

This is the original A14 defect repeated. The first cap shipped an attacker-settable opt-out. This one ships an unconditional one.

The root cause: **real row values conflated with a correct row set.** Every number honest, membership never checked — host side especially. SDR-7.

Two consequences govern this run:

- The fix belongs at **membership provenance**, not row-value provenance.
- `objective.js` is pure and zero-I/O, so it cannot verify membership itself. Full closure needs the persisted, unspoofable `fetchId` at the caller boundary — **S-07f.1** — which now sits in the sequencing as a hard prerequisite.

---

## 3. Standing constraints — non-negotiable

1. **Never fabricate a number.** A missing number recorded as missing is a good outcome. A plausible one is a defect.
2. **The model's only role in any action is naming WHICH row to act on. It never supplies that row's numbers.**
3. **Never copy `removed.spendVerified` or a spend value out of an LLM proposal.** Note what this session has just learned: hard-coding that field to a safe-looking value is the *same defect* as accepting it from a caller. Neither the caller nor the module may assert it.
4. **You do not commit, push, deploy, or run migrations.** The permission layer enforces this and it is correct. Do not work around a hook or permission block; record it and continue. Every session ends BUILT-NOT-COMMITTED.
5. **Builder is never sole verifier.** Money-path sessions end with a `safety-reviewer` subagent invoked cold — no prior context, no access to your notes or rationale. Cold review has now overturned three attempts that green suites and the original builder had both signed off on.
6. **Test floor is 888.** May rise, never fall. **Passing tests are not proof of reachability** — that is the whole finding of the D-11 review. When you add a test to a guard, state in your report how you confirmed the guard is reachable from the sanctioned entry point.
7. **A BLOCK verdict is not a completed session.** Do not mark blocked work done in `SESSIONS.md` or any tracker.
8. **Report token usage per session.** If budget runs short, drop a *build* session, never a review.

---

## 4. Pacing

The 2026-07-30 run did eleven sessions in 82 minutes and both money-path attempts were blocked. **This queue is four sessions, and S-08A.1a.2a should get the most careful time even though it is the smallest diff.** Finishing early on a money-path contract is a warning, not a win.

---

## 5. Sessions

### S-08A.1a.2a · discharge D-11 — FIRST, small diff, highest care

Read the re-affirmed D-11 in `DECISIONS.md` before writing anything. If no re-affirmed D-11 entry exists, **stop and report** — do not proceed.

Build:
- **`spendVerified` defaults to FALSE for rows-derived cohorts.** Remove the hard-coded `true` at `objective.js:1045`. Nothing inside the module may assert it.
- **The W bound applies to every rows-derived claim**, exactly as it applied to the old scalar shape. There is currently no path that legitimately bypasses it; do not invent one "for later."
- **Form change only.** W's level is untouched (DI-3).
- **Prove reachability.** A test that exercises the cap *through the sanctioned entry point*, not by calling it directly. The existing ~10 cap tests are the anti-pattern — they were green throughout the period the cap could never fire.

**Acceptance (from the review, and it fails today):** feed the module an honest full cohort and a caller-narrowed subset that drops converting host rows, with identical removed-side inputs. Assert the subset candidate scores ≤ W × the honest one, or is refused.

**Scope discipline:** A15, A17, A19 and the `conversions`-reads-as-favorable-zero finding are **not in this session.** They belong to S-08A.1a.2 in a later run. If you find yourself opening them, that is the bundling gravity this harness prohibits — new session ID, note it, move on.

**Cold `safety-reviewer` sign-off mandatory.** If it returns BLOCK, stop the queue and report. Do not rework and re-review in the same session; a reviewer that has seen your fix is no longer cold.

### S-REACH-1 · what else is green on a dead path?

The D-11 review found ~10 passing tests on a guard nothing could reach. That is a class, not an incident — and it has the same shape as the zero-row table sweep, which found six empty tables and two live write-path defects.

Sweep the codebase for guards, caps, validators and refusal paths that are tested directly but may be unreachable from the entry points actually in use. For each: state whether it is reachable, and **how you determined that** — a call-graph trace, not an assertion.

Investigation session. Findings go in `DECISIONS.md` and get new session IDs. **Do not fix what you find** beyond documenting it; a reachability fix is a money-path change in disguise.

### S-AUTOLOG-1 · the flight recorder has never worked

All six `automation_log` writer call sites pass an `event_type` violating the table's own CHECK constraint. None check the returned error. Every insert has always failed, silently, since the feature was built. One is the money path: `execute-action-logic.js`.

- Read the CHECK constraint **from the live database.** Do not infer it from the code.
- Every write checks its returned error and surfaces failure loudly. A write path that cannot report its own failure is worse than none — its existence stops anyone asking whether it works.
- A test that fails if any writer emits an `event_type` outside the constraint. If the list is hand-maintained rather than derived, **say so in the test comment.** Last run shipped a coverage guard described as stronger than it was.
- Backfill is out of scope; the rows do not exist.

**Also record in `DECISIONS.md`:** what the claim "real Google Ads budget changes proven end-to-end against the live API" actually rested on, given that no `automation_log` row has ever existed. If no artifact can be identified, mark the claim unsubstantiated. Do not soften it.

`execute-action-logic.js` is protected → cold `safety-reviewer` sign-off mandatory.

### S-SNAPSHOT-1 · schema mismatch

`performance_snapshots`' writer inserts `snapshot_at` / `google_data` / `meta_data`. The live table has `snapshot_date` / `channel` / `metrics` / `campaigns`. Reader and writer agree with each other and not with the table. No test file exists.

Reconcile both against the live schema, read from the database. Add the missing test. Same loud-failure requirement.

---

## 6. Not in this run

**S-07f.1** — the persisted, unspoofable `fetchId` at the caller boundary. This is now the binding dependency for lifting `spendVerified`'s default-false, and it touches `execute-action-logic.js`, `execute-action.js` and `google-ads.js` — three protected money-path files. It gets **its own run and its own fresh reviewer**, who must confirm that stale-evidence refusal survives re-staging. Do not start it, do not prepare it.

Also not in this run: S-08A.1a.2 proper (A15/A17/A19, `conversions`-as-zero), S-04B.2, S-07g, S-07h, S-05B, S-08B, S-09/S-09B, S-08A.2/.1c/.1d.

`sql/025` stays unapplied until S-04B.2 lands. The S-07f.0 live cardinality artifact cannot be produced here (no Google Ads credential access, `.env` reads hook-blocked) — do not attempt it; S-07f.0 stays BUILT, not ACCEPTED.

If everything above lands accepted and time remains, **stop.**

---

## 7. Stopping rules

- No re-affirmed D-11 entry in `DECISIONS.md` when S-08A.1a.2a comes up.
- A cold `safety-reviewer` returns BLOCK on a money-path session.
- `verify.ps1` drops below 4/4, or tests fall below 888.
- You are about to add scope to a frozen session.
- You would have to assume a number you cannot obtain.
- A hook or permission block fires. Record it; never engineer around it.

**An intention to build is not a build, and this harness has rules for everything except when to stop harnessing.** Drafting new rules instead of shipping code is the stopping condition.

---

## 8. Report — `harness/BUILD-<date>.md`

1. Sessions: **ACCEPTED / BUILT-NOT-ACCEPTED / BLOCKED / NOT-STARTED.** A BLOCK is never done.
2. Test count per boundary, and **every test deleted or renamed, by name**, regardless of the count.
3. For every guard touched or added: **how reachability was confirmed.**
4. `verify.ps1` result per session with evidence paths.
5. Cold review verdicts quoted in full, including objections you resolved and how.
6. What the "validated live" claim actually rested on (S-AUTOLOG-1).
7. S-REACH-1's findings, each with the method used to determine reachability.
8. Discoveries given new session IDs rather than absorbed.
9. Token usage, subagent and main thread separately. State what you cannot measure rather than estimating.
10. **Limitations and deviations, plainly.** What you could not verify, what you assumed, what a reviewer should look at hardest.

Nothing committed. Nothing pushed. Nothing deployed.
