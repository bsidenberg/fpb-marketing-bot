-- ============================================================
-- Migration 009: parent_account_id + Phase 1 tenant activation
--
-- Adds parent_account_id and product_line columns to accounts.
-- Adds one-level-deep hierarchy enforcement trigger.
-- Inserts FPB Kits as a child of FPB.
-- Activates Weld Workx and Florida Security Concepts.
--
-- FPB Kits inherits FPB's existing ad_platform_connections via the
-- shared Google Ads customer ID + campaign-level segmentation. No new
-- ad_platform_connections rows are inserted by this migration.
--
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query).
-- Production project: olpyqfuphiwdongzmazi
--
-- Idempotent — safe to re-run:
--   ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--   CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE TRIGGER,
--   INSERT ... ON CONFLICT (slug) DO NOTHING,
--   UPDATEs naturally idempotent for the values being set.
--
-- Pre-migration check below RAISE NOTICEs the current account count.
-- Post-migration verification query at the bottom of this file.
--
-- This migration file is fully executable. It does NOT use the MANUAL
-- APPLY comment-block pattern that sql/008 introduced — that pattern
-- is retired (see AUDIT-PHASE-0.md Section 13.1.2 and
-- TENANT-MODEL-SPEC.md Section 8).
-- ============================================================

-- ── Pre-migration check ──────────────────────────────────────────────
do $$
declare
  pre_count bigint;
begin
  select count(*) into pre_count from accounts;
  raise notice 'Pre-migration accounts count: %', pre_count;
end $$;

-- ── Schema additions ─────────────────────────────────────────────────
-- Self-referential FK declared inline so the IF NOT EXISTS guards both
-- the column and the constraint. ON DELETE RESTRICT — deleting a parent
-- that still has children should fail loudly (operator must remove or
-- re-parent children first).
alter table accounts
  add column if not exists parent_account_id uuid
    references accounts(id) on delete restrict;

alter table accounts
  add column if not exists product_line text;

create index if not exists accounts_parent_account_id_idx
  on accounts (parent_account_id);

-- ── One-level-deep hierarchy enforcement ─────────────────────────────
-- A check constraint can't reference other rows; trigger is the cleanest
-- enforcement.
--
-- Two invariants:
--   1. parent_account_id must point at a row whose own parent_account_id
--      is NULL (no grandparents).
--   2. A row that already has children cannot itself become a child.
create or replace function accounts_enforce_one_level_hierarchy()
returns trigger as $$
begin
  if NEW.parent_account_id is not null then
    if exists (
      select 1 from accounts
      where id = NEW.parent_account_id
        and parent_account_id is not null
    ) then
      raise exception
        'parent_account_id (%) refers to an account that itself has a parent — only one level of hierarchy allowed',
        NEW.parent_account_id;
    end if;

    if exists (
      select 1 from accounts where parent_account_id = NEW.id
    ) then
      raise exception
        'Cannot set parent_account_id on account % — it already has child accounts',
        NEW.id;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists accounts_one_level_hierarchy on accounts;
create trigger accounts_one_level_hierarchy
  before insert or update of parent_account_id on accounts
  for each row execute function accounts_enforce_one_level_hierarchy();

-- ── FPB Kits: insert child account ───────────────────────────────────
-- Locked values from Sub-Task 2B brief:
--   target_cost_per_lead = 75 (not the spec's $100 — Brian's revision)
--   website_domain = 'floridapolebarn.com' (parent domain, NOT a subdomain)
--   No separate ad_platform_connections — Kits inherits FPB's via shared
--   Google Ads customer ID + campaign-level segmentation
insert into accounts (
  name,                            slug,             industry,
  website_domain,                  primary_location, service_area,
  reporting_timezone,              monthly_budget,   monthly_spend_cap,
  daily_spend_cap,                 target_cost_per_lead,
  target_cost_per_qualified_lead,
  autonomy_level,                  status,
  parent_account_id,               product_line
)
values (
  'Florida Pole Barn — Kits',      'fpb-kits',       'Pole Barn Kits (DIY)',
  'floridapolebarn.com',           'Central Florida','Florida statewide',
  'America/New_York',              500,              500,
  17,                              75,
  400,
  'level_1_diagnostics',           'active',
  (select id from accounts where slug = 'fpb'),
  'kits'
)
on conflict (slug) do nothing;

-- ── Weld Workx: activate, set production budget + targets ────────────
update accounts
   set status                = 'active',
       monthly_budget        = 500,    -- strategy doc testing baseline (was $1000 stub)
       monthly_spend_cap     = 500,
       daily_spend_cap       = 17,
       target_cost_per_lead  = 200,    -- B2B gate fabrication starting target
       industry              = 'Welding & Gate Fabrication',
       primary_location      = 'Central Florida',
       service_area          = 'Florida statewide',
       website_domain        = 'weldworkxfl.com',
       reporting_timezone    = 'America/New_York'
 where slug = 'weld';

-- ── FSC: activate, set production budget + targets ──────────────────
update accounts
   set status                = 'active',
       monthly_budget        = 500,
       monthly_spend_cap     = 500,
       daily_spend_cap       = 17,
       target_cost_per_lead  = 75,     -- residential security install starting target
       industry              = 'Security Systems Installation',
       primary_location      = 'Central Florida',
       service_area          = 'Florida statewide',
       website_domain        = 'floridasecurityconcepts.com',
       reporting_timezone    = 'America/New_York'
 where slug = 'fsc';

-- ============================================================
-- Post-migration verification (run after applying this file):
--
-- SELECT slug, name, status, parent_account_id, product_line, monthly_budget
--   FROM accounts
--   ORDER BY parent_account_id NULLS FIRST, slug;
--
-- Expected — 4 rows, parents first, child last:
--
--   slug      | name                       | status | parent_account_id | product_line | monthly_budget
--   ----------+----------------------------+--------+-------------------+--------------+----------------
--   fpb       | Florida Pole Barn          | active | NULL              | NULL         | 2500
--   fsc       | Florida Security Concepts  | active | NULL              | NULL         |  500
--   weld      | Weld Workx                 | active | NULL              | NULL         |  500
--   fpb-kits  | Florida Pole Barn — Kits   | active | <FPB.id>          | kits         |  500
--
-- Trigger smoke tests (optional, do NOT run in production unless you want
-- to see the errors fire):
--
--   -- Should fail: trying to set fpb-kits as parent of itself (cycle)
--   UPDATE accounts SET parent_account_id = id WHERE slug = 'fpb-kits';
--
--   -- Should fail: trying to make a third-level descendant
--   UPDATE accounts SET parent_account_id = (SELECT id FROM accounts WHERE slug = 'fpb-kits')
--    WHERE slug = 'weld';
-- ============================================================
