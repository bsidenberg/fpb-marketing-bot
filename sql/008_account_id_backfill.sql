-- ============================================================
-- Migration 008: account_id backfill
--
-- Phase 1 Stage A1.
--
-- This migration adds account_id to the three tables represented in
-- committed SQL migrations (leads, action_outcomes, campaign_daily_stats),
-- backfills their rows to the FPB account, and prefixes existing
-- dedup_keys with 'fpb::'.
--
-- Apply ONLY AFTER:
--   * sql/005_accounts.sql has been applied
--   * sql/006_ad_platform_connections.sql has been applied
--   * sql/007_ai_analysis_runs.sql has been applied
--
-- Tables that exist in Supabase but were NOT in committed migration files
-- (actions, automation_log, performance_snapshots, chat_messages) have
-- their ALTER statements at the bottom of this file as commented MANUAL
-- APPLY blocks. Those should be applied immediately before Stage A2
-- begins, or during Stage A1 only if Brian explicitly approves.
--
-- This migration is intended to be applied ONCE. ADD COLUMN IF NOT EXISTS
-- and CREATE INDEX IF NOT EXISTS make most steps re-runnable, but the
-- ALTER TABLE ADD CONSTRAINT and CREATE UNIQUE INDEX statements will
-- error on a clean second run. That is acceptable for a one-shot migration.
--
-- The client_key columns on leads / action_outcomes / campaign_daily_stats
-- are intentionally preserved (not dropped) for rollback safety.
--
-- Run in Supabase SQL editor (Dashboard → SQL Editor → New Query).
-- ============================================================

-- ============================================================
-- Pre-migration verification
-- ============================================================
do $$
declare
  fpb_id uuid;
  pre_leads_count bigint;
  pre_outcomes_count bigint;
  pre_stats_count bigint;
begin
  select id into fpb_id from accounts where slug = 'fpb';
  if fpb_id is null then
    raise exception 'FPB account not found. Run sql/005_accounts.sql first.';
  end if;

  select count(*) into pre_leads_count    from leads;
  select count(*) into pre_outcomes_count from action_outcomes;
  select count(*) into pre_stats_count    from campaign_daily_stats;

  raise notice 'FPB account_id: %', fpb_id;
  raise notice 'Pre-migration row counts: leads=%, action_outcomes=%, campaign_daily_stats=%',
    pre_leads_count, pre_outcomes_count, pre_stats_count;
end $$;

-- ============================================================
-- Add account_id to leads (in committed migration)
-- ============================================================
alter table leads add column if not exists account_id uuid;

update leads
set account_id = (select id from accounts where slug = 'fpb')
where account_id is null;

alter table leads
  alter column account_id set not null;

alter table leads
  add constraint leads_account_id_fkey
  foreign key (account_id) references accounts(id) on delete restrict;

create index if not exists leads_account_id_idx on leads (account_id);

-- ============================================================
-- Backfill dedup_keys with fpb:: prefix
--
-- leads.dedup_key has NO uniqueness constraint anywhere in committed SQL
-- (only a non-unique partial index leads_dedup_key_idx). Stage A1 must
-- not introduce one — this UPDATE only rewrites values, never adds a
-- uniqueness rule.
-- ============================================================
update leads
set dedup_key = 'fpb::' || dedup_key
where dedup_key is not null
  and dedup_key not like 'fpb::%'
  and dedup_key not like 'weld::%'
  and dedup_key not like 'fsc::%';

-- ============================================================
-- Add account_id to action_outcomes (in committed migration)
-- ============================================================
alter table action_outcomes add column if not exists account_id uuid;

update action_outcomes
set account_id = (select id from accounts where slug = 'fpb')
where account_id is null;

alter table action_outcomes
  alter column account_id set not null;

alter table action_outcomes
  add constraint action_outcomes_account_id_fkey
  foreign key (account_id) references accounts(id) on delete restrict;

create index if not exists action_outcomes_account_id_idx on action_outcomes (account_id);

-- ============================================================
-- Add account_id to campaign_daily_stats (in committed migration)
-- ============================================================
alter table campaign_daily_stats add column if not exists account_id uuid;

update campaign_daily_stats
set account_id = (select id from accounts where slug = 'fpb')
where account_id is null;

alter table campaign_daily_stats
  alter column account_id set not null;

alter table campaign_daily_stats
  add constraint campaign_daily_stats_account_id_fkey
  foreign key (account_id) references accounts(id) on delete restrict;

create index if not exists campaign_daily_stats_account_id_idx on campaign_daily_stats (account_id);

-- Rebuild unique index to include account_id as the leading column.
-- Existing index name verified at sql/003_campaign_daily_stats.sql:40-41.
drop index if exists campaign_daily_stats_platform_campaign_date_uidx;

create unique index campaign_daily_stats_account_platform_campaign_date_uidx
  on campaign_daily_stats (account_id, platform, campaign_id, date);

-- ============================================================
-- Post-migration verification (run in psql / SQL Editor after apply)
-- ============================================================
-- SELECT count(*) FROM leads                 WHERE account_id IS NULL;  -- expect 0
-- SELECT count(*) FROM action_outcomes       WHERE account_id IS NULL;  -- expect 0
-- SELECT count(*) FROM campaign_daily_stats  WHERE account_id IS NULL;  -- expect 0
--
-- SELECT count(*) FROM leads
--   WHERE dedup_key IS NOT NULL
--     AND dedup_key NOT LIKE 'fpb::%'
--     AND dedup_key NOT LIKE 'weld::%'
--     AND dedup_key NOT LIKE 'fsc::%';
-- -- expect 0
--
-- -- Confirm the new unique index exists and the old one is gone:
-- SELECT indexname FROM pg_indexes
--  WHERE tablename = 'campaign_daily_stats'
--    AND indexname IN (
--      'campaign_daily_stats_platform_campaign_date_uidx',
--      'campaign_daily_stats_account_platform_campaign_date_uidx'
--    );
-- -- expect exactly one row: campaign_daily_stats_account_platform_campaign_date_uidx

-- ============================================================
-- MANUAL APPLY BLOCKS (NOT auto-applied in Stage A1)
--
-- The following ALTER statements MUST be run manually in Supabase SQL
-- Editor. They target tables that exist in Supabase but were not in
-- committed migration files. Apply these immediately before Stage A2
-- begins, or during Stage A1 only if Brian explicitly approves.
--
-- Nullability rationale:
--   * actions               → NOT NULL (operational, every action has an
--                             owning account)
--   * automation_log        → NULLABLE (system events without an account
--                             context, e.g. cron-level failures, are
--                             allowed)
--   * performance_snapshots → NULLABLE (preserves history regardless of
--                             account presence; some early snapshots
--                             pre-date account scoping)
--   * chat_messages         → NULLABLE (chat sessions may not always be
--                             tied to a single account)
-- ============================================================

/*
-- actions (NOT NULL)
alter table actions add column if not exists account_id uuid;
update actions
  set account_id = (select id from accounts where slug = 'fpb')
  where account_id is null;
alter table actions
  alter column account_id set not null;
alter table actions
  add constraint actions_account_id_fkey
  foreign key (account_id) references accounts(id) on delete restrict;
create index if not exists actions_account_id_idx on actions (account_id);

-- automation_log (NULLABLE — system events without account context allowed)
alter table automation_log add column if not exists account_id uuid;
update automation_log
  set account_id = (select id from accounts where slug = 'fpb')
  where account_id is null;
alter table automation_log
  add constraint automation_log_account_id_fkey
  foreign key (account_id) references accounts(id) on delete restrict;
create index if not exists automation_log_account_id_idx on automation_log (account_id);

-- performance_snapshots (NULLABLE)
alter table performance_snapshots add column if not exists account_id uuid;
update performance_snapshots
  set account_id = (select id from accounts where slug = 'fpb')
  where account_id is null;
alter table performance_snapshots
  add constraint performance_snapshots_account_id_fkey
  foreign key (account_id) references accounts(id) on delete restrict;
create index if not exists performance_snapshots_account_id_idx on performance_snapshots (account_id);

-- chat_messages (NULLABLE)
alter table chat_messages add column if not exists account_id uuid;
update chat_messages
  set account_id = (select id from accounts where slug = 'fpb')
  where account_id is null;
alter table chat_messages
  add constraint chat_messages_account_id_fkey
  foreign key (account_id) references accounts(id) on delete restrict;
create index if not exists chat_messages_account_id_idx on chat_messages (account_id);
*/

-- ============================================================
-- Schema inventory (provenance — recorded during Sub-Task 4 of
-- Phase 1 Stage A1. Sources cited inline.)
-- ============================================================
--
-- TABLES IN COMMITTED SQL MIGRATIONS
--
-- leads
--   Source: sql/001_leads.sql + sql/004_leads_schema_backfill.sql
--   Has client_key: yes (default 'fpb', 001_leads.sql:13)
--   Existing indexes (exact names from committed SQL):
--     leads_client_key_idx        on (client_key)                        001_leads.sql:74
--     leads_created_at_idx        on (created_at desc)                   001_leads.sql:75
--     leads_source_platform_idx   on (source_platform)                   001_leads.sql:76
--     leads_campaign_id_idx       on (campaign_id)                       001_leads.sql:77
--     leads_qualification_idx     on (qualification_status)              001_leads.sql:78
--     leads_dedup_key_idx         on (dedup_key) where … is not null     001_leads.sql:79  [NON-UNIQUE]
--     leads_gclid_idx             on (gclid)  where … is not null        004_leads_schema_backfill.sql:26
--     leads_fbclid_idx            on (fbclid) where … is not null        004_leads_schema_backfill.sql:27
--   dedup_key uniqueness: NONE (only a non-unique partial index).
--     Stage A1 does NOT add a unique constraint on dedup_key.
--   Plan in this migration: ALTER + backfill + dedup_key prefix rewrite.
--
-- action_outcomes
--   Source: sql/002_action_outcomes.sql
--   Has client_key: yes (default 'fpb', 002_action_outcomes.sql:15)
--   Existing indexes (exact names):
--     action_outcomes_action_id_window_uidx  UNIQUE on (action_id, metric_window_after_start)
--                                                                       002_action_outcomes.sql:64-65
--     action_outcomes_action_id_idx          on (action_id)             002_action_outcomes.sql:67
--     action_outcomes_created_at_idx         on (created_at desc)       002_action_outcomes.sql:68
--     action_outcomes_platform_idx           on (platform)              002_action_outcomes.sql:69
--   Plan in this migration: ALTER + backfill. Existing unique index preserved as-is.
--
-- campaign_daily_stats
--   Source: sql/003_campaign_daily_stats.sql
--   Has client_key: yes (default 'fpb', 003_campaign_daily_stats.sql:14)
--   Existing indexes (exact names):
--     campaign_daily_stats_platform_campaign_date_uidx  UNIQUE on (platform, campaign_id, date)
--                                                                       003_campaign_daily_stats.sql:40-41
--     campaign_daily_stats_client_idx        on (client_key)            003_campaign_daily_stats.sql:43
--     campaign_daily_stats_date_idx          on (date desc)             003_campaign_daily_stats.sql:44
--     campaign_daily_stats_campaign_idx      on (campaign_id)           003_campaign_daily_stats.sql:45
--     campaign_daily_stats_platform_idx      on (platform)              003_campaign_daily_stats.sql:46
--   Plan in this migration: ALTER + backfill, drop the existing unique
--   index by exact name, recreate as
--   campaign_daily_stats_account_platform_campaign_date_uidx with
--   account_id as the leading column.
--
-- TABLES IN SUPABASE BUT NOT IN COMMITTED SQL (MANUAL APPLY only)
--
-- actions  (NOT IN COMMITTED SQL)
--   Inferred columns:
--     id, status, action_type, execution_result, execution_data,
--     execution_error, reviewed_at, executed_at, created_at, channel,
--     title, description, priority, auto_execute
--                                       (DEPLOY.md:70-74)
--     campaign_id, campaign_name        (api/analyze-ads.js:187,192,208)
--   Plan: MANUAL APPLY block above (account_id NOT NULL).
--
-- automation_log  (NOT IN COMMITTED SQL)
--   Inferred columns:
--     id (assumed PK), event_type, platform, status, description,
--     metadata (jsonb), created_at, action_id     (DEPLOY.md:75 +
--     api/lib/execute-action-logic.js:30-42)
--   Plan: MANUAL APPLY block above (account_id NULLABLE).
--
-- performance_snapshots  (NOT IN COMMITTED SQL)
--   Inferred columns:
--     id (assumed PK), snapshot_at, google_data (jsonb), meta_data (jsonb),
--     actions_created, created_at
--                                       (api/analyze-ads.js:232-237,
--                                        api/performance-snapshots.js:80-90)
--   Plan: MANUAL APPLY block above (account_id NULLABLE).
--
-- chat_messages  (NOT IN COMMITTED SQL)
--   Inferred columns:
--     id (assumed PK), role, content, message_type, session_id,
--     image_data, action_payload, created_at (assumed)
--                                       (api/chat.js:274-279, 345-360)
--   Plan: MANUAL APPLY block above (account_id NULLABLE).
-- ============================================================
