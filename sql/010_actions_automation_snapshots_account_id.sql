-- ============================================================
-- Migration 010: account_id on actions, automation_log, performance_snapshots
--
-- Converts the three MANUAL APPLY comment blocks at the bottom of
-- sql/008_account_id_backfill.sql into an executable, idempotent
-- migration. Those blocks added account_id to three tables that exist
-- in production Supabase but were never recorded in committed SQL.
--
-- Tables covered: actions, automation_log, performance_snapshots.
-- Code reads/writes account_id on all three (api/analyze-ads.js,
-- api/lib/execute-action-logic.js, api/cron-analyze.js,
-- api/automation-log.js, api/performance-snapshots.js).
--
-- In PRODUCTION these columns ALREADY EXIST — they were applied by hand
-- from the sql/008 MANUAL APPLY blocks before Stage A2. There, this
-- migration is a no-op confirmation: ADD COLUMN IF NOT EXISTS and
-- CREATE INDEX IF NOT EXISTS skip work that is already done.
--
-- In a fresh staging / recovery environment the columns do not exist —
-- there this migration adds them.
--
-- Run in Supabase SQL Editor (Dashboard -> SQL Editor -> New Query).
-- Production project: olpyqfuphiwdongzmazi
--
-- Idempotent -- safe to re-run:
--   ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
--
-- Pre-migration check below RAISE NOTICEs whether each table already
-- has account_id. Post-migration verification query at the bottom.
--
-- This migration file is fully executable. It does NOT use the MANUAL
-- APPLY comment-block pattern that sql/008 introduced -- that pattern is
-- retired (see AUDIT-PHASE-0.md Section 13.1.2 and
-- TENANT-MODEL-SPEC.md Section 8).
--
-- CONSTRAINT NOTE: the FK is declared ON DELETE SET NULL and the column
-- is left NULLABLE. In production, actions.account_id was originally
-- added NOT NULL with an ON DELETE RESTRICT FK by the sql/008 manual
-- block; ADD COLUMN IF NOT EXISTS does not alter an existing column, so
-- production keeps its original stricter constraints untouched. This
-- file only governs how the columns are created in a fresh environment,
-- where SET NULL is the safe default (a deleted account should not
-- cascade-delete historical actions/log/snapshot rows).
-- ============================================================

-- -- Pre-migration check --------------------------------------------------
do $$
declare
  has_actions   boolean;
  has_autolog   boolean;
  has_snapshots boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_name = 'actions' and column_name = 'account_id'
  ) into has_actions;
  select exists (
    select 1 from information_schema.columns
    where table_name = 'automation_log' and column_name = 'account_id'
  ) into has_autolog;
  select exists (
    select 1 from information_schema.columns
    where table_name = 'performance_snapshots' and column_name = 'account_id'
  ) into has_snapshots;

  raise notice 'Pre-migration account_id presence:';
  raise notice '  actions.account_id               : %',
    case when has_actions   then 'present (no-op confirmation)' else 'missing (will be added)' end;
  raise notice '  automation_log.account_id        : %',
    case when has_autolog   then 'present (no-op confirmation)' else 'missing (will be added)' end;
  raise notice '  performance_snapshots.account_id : %',
    case when has_snapshots then 'present (no-op confirmation)' else 'missing (will be added)' end;
end $$;

-- -- actions -------------------------------------------------------------
alter table actions
  add column if not exists account_id uuid
    references accounts(id) on delete set null;

create index if not exists actions_account_id_idx
  on actions (account_id);

-- -- automation_log ------------------------------------------------------
alter table automation_log
  add column if not exists account_id uuid
    references accounts(id) on delete set null;

create index if not exists automation_log_account_id_idx
  on automation_log (account_id);

-- -- performance_snapshots -----------------------------------------------
alter table performance_snapshots
  add column if not exists account_id uuid
    references accounts(id) on delete set null;

create index if not exists performance_snapshots_account_id_idx
  on performance_snapshots (account_id);

-- ============================================================
-- Post-migration verification (run after applying this file):
--
-- -- 1. All three account_id columns should exist:
-- SELECT table_name, column_name, is_nullable, data_type
--   FROM information_schema.columns
--  WHERE column_name = 'account_id'
--    AND table_name IN ('actions', 'automation_log', 'performance_snapshots')
--  ORDER BY table_name;
-- -- expect 3 rows.
--
-- -- 2. All three account_id indexes should exist:
-- SELECT tablename, indexname
--   FROM pg_indexes
--  WHERE indexname IN (
--    'actions_account_id_idx',
--    'automation_log_account_id_idx',
--    'performance_snapshots_account_id_idx'
--  )
--  ORDER BY tablename;
-- -- expect 3 rows.
--
-- -- 3. Foreign keys to accounts should exist on all three tables:
-- SELECT tc.table_name, tc.constraint_name
--   FROM information_schema.table_constraints tc
--  WHERE tc.constraint_type = 'FOREIGN KEY'
--    AND tc.table_name IN ('actions', 'automation_log', 'performance_snapshots')
--  ORDER BY tc.table_name;
-- ============================================================
