-- ============================================================
-- Migration 018: execution-audit columns on actions
--
-- WHY: SESSION-06B execution hardening. Live testing and the audit
-- surfaced four execution-integrity gaps: no before/after platform
-- snapshots around mutations, no stored rollback payload, no way to
-- simulate an execution without mutating (dry-run), and reviewed_by
-- always null on executed rows. api/lib/execute-action-logic.js now
-- writes all four on the same update that finalizes each action row;
-- these columns are where they land.
--
-- WHAT: ADD 4 nullable columns to actions + one partial index.
-- reviewed_by (text) and reviewed_at (timestamptz) already exist in
-- production (verified live 7/6) — this migration does NOT touch them.
--   before_snapshot  jsonb — platform state the action changes, read
--                            BEFORE the mutation (e.g. current daily
--                            budget, current campaign status). A live
--                            mutation that cannot capture this fails
--                            closed and never fires.
--   after_snapshot   jsonb — state after a successful mutation
--                            (derived from the mutate, flagged
--                            derived:true; simulated:true on dry-run).
--   rollback_payload jsonb — the exact inverse action (stored, NEVER
--                            executed; an apply-rollback endpoint is a
--                            future session). Never derived from
--                            missing data — null when the before-
--                            snapshot was unavailable.
--   execution_mode   text  — 'live' | 'dry_run'. Authoritative marker:
--                            a dry-run row (result='dry_run_success',
--                            executed_at null) can never be confused
--                            with a live execution.
--
-- Run in Supabase SQL Editor (Dashboard -> SQL Editor -> New Query).
-- Production project: olpyqfuphiwdongzmazi
--
-- Idempotent: yes — ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS throughout; safe to re-run any number of times.
-- ============================================================

ALTER TABLE actions ADD COLUMN IF NOT EXISTS before_snapshot  jsonb;
ALTER TABLE actions ADD COLUMN IF NOT EXISTS after_snapshot   jsonb;
ALTER TABLE actions ADD COLUMN IF NOT EXISTS rollback_payload jsonb;
ALTER TABLE actions ADD COLUMN IF NOT EXISTS execution_mode   text
  CHECK (execution_mode IS NULL OR execution_mode IN ('live', 'dry_run'));

-- Partial index: "show me every dry-run / every live execution" without
-- scanning the (overwhelmingly execution_mode IS NULL) historical rows.
CREATE INDEX IF NOT EXISTS idx_actions_execution_mode
  ON actions (execution_mode)
  WHERE execution_mode IS NOT NULL;

-- ============================================================
-- Post-migration verification:
--
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_name = 'actions'
--      AND column_name IN ('before_snapshot','after_snapshot',
--                          'rollback_payload','execution_mode');
--   -- expect: 4 rows (3 jsonb, 1 text)
-- ============================================================
