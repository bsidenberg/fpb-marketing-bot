-- ============================================================
-- Migration 003: campaign_daily_stats table
--
-- Stores per-campaign per-day spend and performance metrics.
-- Written by the daily analyze-ads run.
-- Used by evaluate-outcomes for precise before/after spend comparison.
--
-- Run in Supabase SQL editor after 001_leads.sql and 002_action_outcomes.sql.
-- ============================================================

create table if not exists campaign_daily_stats (
  id             uuid primary key default gen_random_uuid(),

  client_key     text not null default 'fpb',
  platform       text not null check (platform in ('google_ads','meta_ads')),
  campaign_id    text not null,
  campaign_name  text,

  -- Date this row covers (calendar day in UTC)
  date           date not null,

  -- Core metrics (all nullable — some platforms may not return all fields)
  spend          numeric(12,2),
  impressions    int,
  clicks         int,
  conversions    numeric(8,2),    -- platform-reported conversion count
  ctr            numeric(8,4),    -- click-through rate (0.0–100.0)
  cpc            numeric(12,2),   -- cost per click
  cpl            numeric(12,2),   -- cost per lead (platform-reported conversion)
  frequency      numeric(8,2),    -- Meta: ad frequency

  -- Raw API response for this campaign/day
  raw_payload    jsonb default '{}'::jsonb,

  created_at     timestamptz not null default now()
);

-- Unique constraint: one row per platform + campaign + day
-- Enables upsert (INSERT … ON CONFLICT DO UPDATE) from the cron job.
create unique index if not exists campaign_daily_stats_platform_campaign_date_uidx
  on campaign_daily_stats (platform, campaign_id, date);

create index if not exists campaign_daily_stats_client_idx    on campaign_daily_stats (client_key);
create index if not exists campaign_daily_stats_date_idx      on campaign_daily_stats (date desc);
create index if not exists campaign_daily_stats_campaign_idx  on campaign_daily_stats (campaign_id);
create index if not exists campaign_daily_stats_platform_idx  on campaign_daily_stats (platform);

comment on table campaign_daily_stats is 'Per-campaign per-day spend and performance. Source of truth for outcome evaluation.';
comment on column campaign_daily_stats.conversions is 'Platform-reported conversions — these are ad-platform conversions (forms/calls tracked via pixel), not necessarily real leads in the leads table.';
