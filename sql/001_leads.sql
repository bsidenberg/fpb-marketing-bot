-- ============================================================
-- Migration 001: leads table
--
-- Records every inbound lead contact from any channel.
-- Source of truth for CPL and revenue attribution.
-- Run in Supabase SQL editor (Dashboard → SQL Editor → New Query).
-- ============================================================

create table if not exists leads (
  id                    uuid primary key default gen_random_uuid(),

  -- Tenant / business
  client_key            text not null default 'fpb',

  -- Timing
  created_at            timestamptz not null default now(),
  lead_date             date,          -- date of actual lead (may differ from insert)

  -- Attribution
  source_platform       text not null default 'unknown'
                          check (source_platform in ('google','meta','organic','referral','manual','unknown')),
  campaign_id           text,
  campaign_name         text,
  ad_id                 text,
  ad_name               text,
  ad_set_id             text,
  ad_set_name           text,
  keyword               text,          -- Google search term if available
  utm_source            text,
  utm_medium            text,
  utm_campaign          text,
  utm_content           text,

  -- Lead type
  lead_type             text not null default 'unknown'
                          check (lead_type in ('form','call','message','chat','manual','unknown')),

  -- Contact info (nullable — don't require PII to exist)
  contact_name          text,
  contact_email         text,
  contact_phone         text,
  contact_location      text,

  -- Qualification lifecycle
  qualification_status  text not null default 'new'
                          check (qualification_status in ('new','qualified','unqualified','booked','lost','unknown')),
  qualified_at          timestamptz,
  booked_at             timestamptz,
  lost_at               timestamptz,
  lost_reason           text,

  -- Revenue
  estimated_value       numeric(12,2),   -- Brian's estimate at lead time
  booked_revenue        numeric(12,2),   -- confirmed job value
  gross_profit          numeric(12,2),   -- after COGS

  -- Attribution confidence
  attribution_confidence text default 'low'
                          check (attribution_confidence in ('high','medium','low','none')),
  attribution_notes      text,

  -- Raw payload from form/CRM/webhook
  raw_payload           jsonb default '{}'::jsonb,

  -- Ingest metadata
  ingest_source         text,           -- 'gravity_forms' | 'callrail' | 'generic'
  dedup_key             text,           -- normalized dedup key (see lead-ingest.js)

  -- Notes
  notes                 text
);

-- Index for common query patterns
create index if not exists leads_client_key_idx        on leads (client_key);
create index if not exists leads_created_at_idx        on leads (created_at desc);
create index if not exists leads_source_platform_idx   on leads (source_platform);
create index if not exists leads_campaign_id_idx       on leads (campaign_id);
create index if not exists leads_qualification_idx     on leads (qualification_status);
create index if not exists leads_dedup_key_idx         on leads (dedup_key) where dedup_key is not null;

comment on table leads is 'Inbound lead contacts for Florida Pole Barn. One row per lead event.';
comment on column leads.attribution_confidence is 'high = direct click-through; medium = same-session; low = same-campaign inferred; none = no data';
