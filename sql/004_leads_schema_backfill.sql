-- ============================================================
-- Migration 004: leads table schema backfill
--
-- Adds columns that the ingest pipeline writes but were missing
-- from the initial 001_leads.sql migration.
--
-- Safe to run on an existing database — uses ADD COLUMN IF NOT EXISTS.
-- Run in Supabase SQL editor (Dashboard → SQL Editor → New Query).
-- ============================================================

-- utm_term: search keyword term from UTM params (e.g. "pole barn kits florida")
alter table leads
  add column if not exists utm_term text;

-- gclid: Google Click ID — present on all Google Ads clicks
-- Preserved for click-level attribution and potential offline conversion import
alter table leads
  add column if not exists gclid text;

-- fbclid: Facebook Click ID — present on all Meta Ads clicks
-- Preserved for click-level attribution
alter table leads
  add column if not exists fbclid text;

-- Indexes for click ID lookups (dedup and attribution queries)
create index if not exists leads_gclid_idx  on leads (gclid)  where gclid  is not null;
create index if not exists leads_fbclid_idx on leads (fbclid) where fbclid is not null;

comment on column leads.utm_term is 'Search keyword from utm_term param or URL query string';
comment on column leads.gclid    is 'Google Click ID — auto-tagged on Google Ads clicks';
comment on column leads.fbclid   is 'Facebook Click ID — auto-tagged on Meta Ads clicks';
