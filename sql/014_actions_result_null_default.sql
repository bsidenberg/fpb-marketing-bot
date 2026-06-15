-- ============================================================
-- Migration 014: actions.result — drop '{}' default, backfill pending rows to NULL
--
-- Root cause: the actions table was created with result DEFAULT '{}'::jsonb.
-- Every INSERT that omits result lands a row with result = '{}'::jsonb rather
-- than NULL. The canExecute() guard treats any non-null result as "already
-- executed", so every newly-created action immediately returns 409 on approve.
--
-- Changes:
--   1. ALTER TABLE actions ALTER COLUMN result DROP DEFAULT
--      Removes the '{}' default so future INSERTs without an explicit result
--      value receive NULL (PostgreSQL column default becomes NULL when no
--      default is defined).
--
--   2. UPDATE actions SET result = NULL
--        WHERE result = '{}'::jsonb AND status = 'pending'
--      Repairs existing pending rows that were born with the bad default.
--      Rows already in a final state (approved/rejected with a real result
--      value) are left untouched.
--
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query).
-- Production project: olpyqfuphiwdongzmazi
--
-- Idempotent — safe to re-run:
--   DROP DEFAULT is naturally idempotent (no-op when no default exists).
--   The UPDATE becomes a no-op after the first run (no more '{}' pending rows).
--
-- Post-migration verification queries at the bottom of this file.
-- ============================================================

DO $$
DECLARE
  col_default text;
  bad_pending_count bigint;
BEGIN
  SELECT column_default
    INTO col_default
    FROM information_schema.columns
   WHERE table_name = 'actions'
     AND column_name = 'result'
     AND table_schema = 'public';

  SELECT COUNT(*)
    INTO bad_pending_count
    FROM actions
   WHERE result = '{}'::jsonb
     AND status = 'pending';

  RAISE NOTICE 'Migration 014 pre-check: actions.result current default = %, pending rows with result = ''{}'' = %',
    COALESCE(col_default, '(none)'),
    bad_pending_count;
END $$;

-- ── 1. Remove the bad column default ─────────────────────────────────────────
ALTER TABLE actions ALTER COLUMN result DROP DEFAULT;

-- ── 2. Repair existing pending rows ──────────────────────────────────────────
UPDATE actions
   SET result = NULL
 WHERE result = '{}'::jsonb
   AND status = 'pending';

-- ============================================================
-- Post-migration verification:
--
-- Confirm default is gone:
--   SELECT column_default
--     FROM information_schema.columns
--    WHERE table_name = 'actions'
--      AND column_name = 'result'
--      AND table_schema = 'public';
--   -- expect: (null row) or column_default IS NULL
--
-- Confirm no bad pending rows remain:
--   SELECT COUNT(*) FROM actions
--    WHERE result = '{}'::jsonb AND status = 'pending';
--   -- expect: 0
--
-- Confirm a test insert lands NULL (run then rollback):
--   BEGIN;
--   INSERT INTO actions (account_id, channel, action_type, title, status)
--     VALUES (
--       (SELECT id FROM accounts LIMIT 1),
--       'google_ads', 'pause_campaign', 'test', 'pending'
--     )
--   RETURNING result;
--   -- expect: result = NULL
--   ROLLBACK;
-- ============================================================
