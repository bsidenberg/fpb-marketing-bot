-- ============================================================
-- Migration 005: accounts table
--
-- Defines the multi-account schema foundation. Each row represents a
-- business entity the marketing bot operates on behalf of (Florida
-- Pole Barn, Weld Workx, Florida Security Concepts).
--
-- Phase 1 Stage A1: schema only. No existing route behavior changes.
-- Backfill of account_id onto leads / action_outcomes /
-- campaign_daily_stats happens in sql/008_account_id_backfill.sql.
--
-- Run in Supabase SQL editor (Dashboard → SQL Editor → New Query).
-- ============================================================

create table if not exists accounts (
  id                                uuid primary key default gen_random_uuid(),

  -- Identity
  name                              text not null,
  slug                              text not null unique,
  industry                          text,
  website_domain                    text,
  primary_location                  text,
  service_area                      text,

  -- Reporting
  reporting_timezone                text not null default 'America/New_York',

  -- Budget and targets (all nullable — null = "not configured")
  monthly_budget                    numeric,
  daily_spend_cap                   numeric,
  monthly_spend_cap                 numeric,
  target_cost_per_lead              numeric,
  target_cost_per_qualified_lead    numeric,
  target_cost_per_booked_job        numeric,
  target_margin_goal                numeric,

  -- Operating posture
  autonomy_level                    text not null default 'level_1_diagnostics',

  -- Health rollups (computed elsewhere, stored here for fast read)
  tracking_health_score             integer not null default 0,
  crm_hygiene_score                 integer not null default 0,
  account_health_score              integer not null default 0,

  -- Lifecycle
  status                            text not null default 'active',
  created_at                        timestamptz not null default now(),
  updated_at                        timestamptz not null default now(),

  -- Named constraints
  constraint accounts_status_check
    check (status in ('active','inactive','archived')),
  constraint accounts_autonomy_level_check
    check (autonomy_level in (
      'level_0_readonly',
      'level_1_diagnostics',
      'level_2_drafts',
      'level_3_approval',
      'level_4_guardrailed',
      'level_5_full'
    )),
  constraint accounts_tracking_health_score_check
    check (tracking_health_score between 0 and 100),
  constraint accounts_crm_hygiene_score_check
    check (crm_hygiene_score between 0 and 100),
  constraint accounts_account_health_score_check
    check (account_health_score between 0 and 100),
  constraint accounts_monthly_budget_check
    check (monthly_budget is null or monthly_budget >= 0),
  constraint accounts_daily_spend_cap_check
    check (daily_spend_cap is null or daily_spend_cap >= 0),
  constraint accounts_monthly_spend_cap_check
    check (monthly_spend_cap is null or monthly_spend_cap >= 0),
  constraint accounts_target_cpl_check
    check (target_cost_per_lead is null or target_cost_per_lead >= 0),
  constraint accounts_target_cpql_check
    check (target_cost_per_qualified_lead is null or target_cost_per_qualified_lead >= 0),
  constraint accounts_target_cpbj_check
    check (target_cost_per_booked_job is null or target_cost_per_booked_job >= 0)
);

-- Indexes
-- Note: slug lookups are served by the implicit unique index from the
-- UNIQUE constraint; no separate slug index is created here.
create index if not exists accounts_status_idx on accounts (status);

-- ============================================================
-- Seed accounts (idempotent — won't overwrite existing rows)
-- ============================================================

-- Florida Pole Barn — primary active account
insert into accounts (
  name, slug, industry, website_domain, reporting_timezone,
  monthly_budget, monthly_spend_cap, target_cost_per_lead,
  autonomy_level, status
)
values (
  'Florida Pole Barn', 'fpb', 'Pole Barn Construction', 'floridapolebarn.com',
  'America/New_York',
  2500, 2500, 50,
  'level_1_diagnostics', 'active'
)
on conflict (slug) do nothing;

-- Weld Workx — stub for future activation
insert into accounts (
  name, slug, monthly_budget, autonomy_level, status
)
values (
  'Weld Workx', 'weld', 1000, 'level_0_readonly', 'inactive'
)
on conflict (slug) do nothing;

-- Florida Security Concepts — stub for future activation
insert into accounts (
  name, slug, autonomy_level, status
)
values (
  'Florida Security Concepts', 'fsc', 'level_0_readonly', 'inactive'
)
on conflict (slug) do nothing;

comment on table accounts is 'Marketing bot tenants. One row per business the bot operates on behalf of.';
comment on column accounts.autonomy_level is 'Operating posture from level_0_readonly (analyze only) to level_5_full (autonomous). Stage A1 default is level_1_diagnostics for FPB.';
comment on column accounts.tracking_health_score is 'Computed rollup 0-100 — quality of tracking pixels, conversion events, attribution coverage.';
comment on column accounts.crm_hygiene_score is 'Computed rollup 0-100 — quality of lead status updates, dedup, revenue attribution.';
comment on column accounts.account_health_score is 'Computed rollup 0-100 — combined health signal used to gate autonomous action.';

-- ============================================================
-- Post-migration verification:
-- SELECT count(*) FROM accounts;  -- expect 3
-- SELECT slug, name, status FROM accounts ORDER BY slug;
-- ============================================================
