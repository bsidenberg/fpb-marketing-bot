# SESSION 06B — Execution hardening: snapshots, rollback, dry-run, audit identity
AUTONOMY: gated
# MONEY PATH — safety-reviewer mandatory before Phase C.

GOAL: Close the four execution-integrity gaps the audit and live testing
surfaced, so every real ad mutation is reversible, attributable, and
inspectable before it fires:
  1. before/after snapshots — capture platform state around every mutation
  2. rollback_payload — store exactly what undoes each executed change
  3. execution_mode + dry-run — a real "simulate, don't mutate" path
  4. reviewed_by / reviewed_at — record WHO approved (currently always null)

VERIFIED FACTS (live schema + code, 7/6 — do not re-derive):
- actions table HAS reviewed_by (text), reviewed_at (timestamptz), but
  they are never written. It does NOT have before_snapshot, after_snapshot,
  rollback_payload, or execution_mode — sql/018 must ADD these (nullable).
- evaluate-outcomes.js already implements a dry_run query-param pattern
  (lines ~323, 148, 226) — mirror its shape for consistency; do not import
  from it.
- Google executors live in execute-action-logic.js (executeGoogleAdjust
  Budget, pause/resume, negative keyword). Budget adjust already does a
  GET-campaign lookup when budget_id absent — that GET is the natural
  before-snapshot source.
- acquireLockAndExecute is the single choke point for DB-backed executions
  (Session 05 guard sits at the top of its try). executeTransient is the
  chat path.

SCOPE: api/lib/execute-action-logic.js (snapshot/rollback/mode wiring —
MINIMAL, additive; do not disturb the Session-05 guard gate or the
dispatch branches), api/approve-action.js and api/execute-action.js (pass
an approver identity + dry-run flag through), sql/018_action_execution_
audit.sql (ADD 4 nullable columns + optional index; file only, NOT
applied), tests/execute-action.test.js + new tests/execution-hardening.
test.js, .env.example if a flag is added. Do NOT touch budget-guards.js,
autonomy-coordinator.js, or the auth perimeter.

DESIGN (Phase A refines; do not reopen direction):
1. SNAPSHOTS: before executing a mutating action, capture a before_snapshot
   (the current platform state the action changes — e.g. current daily
   budget for adjust_budget, current status for pause/resume). After a
   successful mutation, capture after_snapshot. Both jsonb, written to the
   action row. For adjust_budget reuse the existing GET-campaign lookup so
   this adds no extra API call where one already happens; where it doesn't,
   one read is acceptable and must be cost-ledger recorded.
2. ROLLBACK: derive rollback_payload from the before_snapshot at execution
   time — the exact inverse action (e.g. {action_type:'adjust_budget',
   budget_id, amount: <old value>}). Stored, NOT executed. This session
   builds the payload only; an apply-rollback endpoint is a future session
   (note it, don't build it).
3. DRY-RUN: execution_mode column = 'live' | 'dry_run'. When dry-run is
   requested (query param dry_run=true on approve/execute, mirroring
   evaluate-outcomes), run everything — guards, snapshot capture, rollback
   derivation — but SKIP the platform mutate call, write execution_mode=
   'dry_run', result reflecting the simulated outcome, and return what
   WOULD have happened. Dry-run must be impossible to confuse with a live
   execution in the row (mode column is authoritative).
4. REVIEWED_BY: approve-action and execute-action must record who approved.
   Source the identity from the authenticated admin session (the
   requireAdmin cookie context from S0-A) — pass a stable identifier
   (e.g. 'admin' or the session subject if available) into the execution
   as reviewed_by, with reviewed_at=now(), on the human-approve path.
   Auto-executed (cron) rows record reviewed_by='system:auto' so the
   distinction is queryable. NEVER leave reviewed_by null on an executed
   row again.

SAFETY INVARIANTS (safety-reviewer will verify verbatim):
- Dry-run NEVER calls a platform mutate endpoint. Prove it (test asserts
  the mutate fetch is never invoked in dry-run).
- Snapshot/rollback capture failure must NOT silently allow a live mutation
  with no audit trail: if before_snapshot cannot be captured for a live
  mutating action, fail closed (do not execute; finalize with a clear
  reason). Dry-run may proceed with a noted-null snapshot.
- The Session-05 budget guard gate remains first and unaltered; hardening
  wraps around it, never before it. A 'block' still short-circuits before
  any snapshot or mutation.
- reviewed_by is set on the SAME update that finalizes the row — no window
  where an executed row has a null approver.

PHASE A (STOP): present the exact snapshot shapes per action_type, the
rollback-payload derivation per action_type, the dry-run control flow
(where the mutate call is bypassed), the identity-threading path from
requireAdmin → row, and sql/018. Confirm no extra API calls on the
adjust_budget path.
PHASE B: implement. PHASE C: floor 630+; tests cover each action_type's
snapshot+rollback, dry-run-skips-mutate (assert zero mutate calls),
fail-closed-on-snapshot-failure, reviewed_by set on both human and auto
paths, and that a Session-05 block still precedes all of it. Safety-
reviewer on the full diff, verdict verbatim, with explicit confirmation
of the three "NEVER" invariants above.

DoD: an executed action row carries before/after snapshots, a rollback
payload, execution_mode, and a non-null reviewed_by; a dry-run request
mutates nothing on-platform yet produces a full simulated row; a snapshot-
capture failure blocks the live mutation rather than firing blind.
