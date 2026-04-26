-- ============================================================
-- Migration 002: action_outcomes table
--
-- Records before/after performance windows for executed actions.
-- Populated by the evaluate-outcomes endpoint/cron.
-- Does NOT claim causality — results are directional only.
-- Run in Supabase SQL editor after 001_leads.sql.
-- ============================================================

create table if not exists action_outcomes (
  id                              uuid primary key default gen_random_uuid(),

  -- Linked action
  action_id                       uuid not null,    -- FK to actions.id (not enforced to stay flexible)
  client_key                      text not null default 'fpb',
  platform                        text not null,    -- 'google_ads' | 'meta_ads'
  campaign_id                     text,
  campaign_name                   text,
  action_type                     text not null,

  -- Measurement windows
  metric_window_before_start      date not null,
  metric_window_before_end        date not null,
  metric_window_after_start       date not null,
  metric_window_after_end         date not null,
  window_days                     int not null default 7,   -- days in each window

  -- Spend
  spend_before                    numeric(12,2),
  spend_after                     numeric(12,2),

  -- Leads (from leads table, if available)
  leads_before                    int,
  leads_after                     int,
  qualified_leads_before          int,
  qualified_leads_after           int,

  -- CPL (spend / leads)
  cpl_before                      numeric(12,2),
  cpl_after                       numeric(12,2),
  cost_per_qualified_lead_before  numeric(12,2),
  cost_per_qualified_lead_after   numeric(12,2),

  -- Revenue (from leads table, if booked revenue exists)
  revenue_before                  numeric(12,2),
  revenue_after                   numeric(12,2),
  gross_profit_before             numeric(12,2),
  gross_profit_after              numeric(12,2),

  -- Evaluation
  conclusion                      text,             -- human-readable directional summary
  confidence                      text not null default 'low'
                                    check (confidence in ('high','medium','low','insufficient_data')),
  evaluation_notes                text,             -- why confidence is what it is
  is_manual_action                boolean not null default false,  -- true = adjust_budget/bid, cannot be auto-verified

  -- Metadata
  created_at                      timestamptz not null default now(),
  evaluated_at                    timestamptz not null default now()
);

-- Unique constraint: one outcome row per action per evaluation run
-- (prevents double-writes from the cron)
create unique index if not exists action_outcomes_action_id_window_uidx
  on action_outcomes (action_id, metric_window_after_start);

create index if not exists action_outcomes_action_id_idx   on action_outcomes (action_id);
create index if not exists action_outcomes_created_at_idx  on action_outcomes (created_at desc);
create index if not exists action_outcomes_platform_idx    on action_outcomes (platform);

comment on table action_outcomes is 'Before/after performance windows for executed actions. Directional only — not causal.';
comment on column action_outcomes.confidence is 'insufficient_data = post-window not yet complete or no lead data; low = ad platform data only; medium = lead data available; high = leads + revenue data';
