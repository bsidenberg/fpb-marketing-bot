-- ============================================================
-- Migration 011: cost ledger — subscriptions, API events, hours, rollups
--
-- Lands four-table cost-tracking infrastructure required by
-- architectural principle 13 (cost ledger sets pricing floor).
--
-- Tables created:
--   cost_subscriptions   — recurring vendor subscriptions (manual entry)
--   cost_api_events      — auto-logged Anthropic + ad platform API calls
--   cost_hours           — manually logged Brian-hours per focus area
--   cost_rollups_monthly — materialized per-account monthly aggregates
--
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query).
-- Production project: olpyqfuphiwdongzmazi
--
-- Idempotent — safe to re-run:
--   CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
--
-- Post-migration verification query at the bottom of this file.
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 011 pre-check: cost_subscriptions exists = %',
    (SELECT to_regclass('public.cost_subscriptions') IS NOT NULL);
  RAISE NOTICE 'Migration 011 pre-check: cost_api_events exists = %',
    (SELECT to_regclass('public.cost_api_events') IS NOT NULL);
  RAISE NOTICE 'Migration 011 pre-check: cost_hours exists = %',
    (SELECT to_regclass('public.cost_hours') IS NOT NULL);
  RAISE NOTICE 'Migration 011 pre-check: cost_rollups_monthly exists = %',
    (SELECT to_regclass('public.cost_rollups_monthly') IS NOT NULL);
END $$;

-- ── cost_subscriptions ─────────────────────────────────────────────────────────
-- Manual-entry table for recurring vendor subscriptions.
-- allocation_account_id NULL = shared cost split evenly across active tenants
--   at rollup time (not at write time — avoids muddying the audit trail).
-- allocation_account_id NOT NULL = cost attributed entirely to that account.

CREATE TABLE IF NOT EXISTS cost_subscriptions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor                text        NOT NULL,
  plan                  text        NOT NULL,
  monthly_amount_usd    numeric     NOT NULL CHECK (monthly_amount_usd >= 0),
  started_at            timestamptz NOT NULL,
  ended_at              timestamptz NULL,
  allocation_account_id uuid        NULL REFERENCES accounts(id) ON DELETE SET NULL,
  notes                 text        NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cost_subscriptions_allocation_idx
  ON cost_subscriptions (allocation_account_id);

CREATE INDEX IF NOT EXISTS cost_subscriptions_dates_idx
  ON cost_subscriptions (started_at, ended_at);

-- ── cost_api_events ────────────────────────────────────────────────────────────
-- Auto-logged per-API-call events.
--   vendor:        'anthropic' | 'google_ads' | 'meta_ads'
--   event_type:    e.g. 'analyze_ads' | 'chat' | 'intent_detection' | 'campaigns_search'
--   tokens_in/out: LLM calls only; NULL for ad platform calls
--   units:         non-LLM call count (typically 1 per row); NULL for LLM calls
--   cost_usd:      computed for Anthropic (rates in cost-rates.js); NULL for ad platforms

CREATE TABLE IF NOT EXISTS cost_api_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor         text        NOT NULL,
  event_type     text        NOT NULL,
  account_id     uuid        NULL REFERENCES accounts(id) ON DELETE SET NULL,
  tokens_in      integer     NULL,
  tokens_out     integer     NULL,
  units          integer     NULL,
  cost_usd       numeric     NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  source_run_id  uuid        NULL REFERENCES ai_analysis_runs(id) ON DELETE SET NULL,
  metadata       jsonb       NULL
);

CREATE INDEX IF NOT EXISTS cost_api_events_account_time_idx
  ON cost_api_events (account_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS cost_api_events_vendor_time_idx
  ON cost_api_events (vendor, occurred_at DESC);

-- ── cost_hours ─────────────────────────────────────────────────────────────────
-- Manually logged Brian-hours per session.
-- focus_area maps to account slugs (e.g. 'fpb', 'weld', 'fsc') or
-- cross-cutting work ('prime-platform', 'cross-tenant').
-- category drives build vs operating cost classification in Phase 4 pricing.

CREATE TABLE IF NOT EXISTS cost_hours (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hours       numeric     NOT NULL CHECK (hours >= 0),
  focus_area  text        NOT NULL,
  category    text        NOT NULL CHECK (category IN ('build', 'operating', 'review', 'investigation', 'other')),
  log_date    date        NOT NULL DEFAULT current_date,
  notes       text        NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cost_hours_log_date_idx
  ON cost_hours (log_date DESC);

CREATE INDEX IF NOT EXISTS cost_hours_focus_date_idx
  ON cost_hours (focus_area, log_date DESC);

-- ── cost_rollups_monthly ───────────────────────────────────────────────────────
-- Materialized via upsert (not a view) — keeps dashboard queries fast.
-- Recomputed on-demand via GET /api/cost-rollup.
-- Subscription costs are split at rollup time (1/N active tenants for shared rows).

CREATE TABLE IF NOT EXISTS cost_rollups_monthly (
  account_id              uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  year_month              text        NOT NULL,
  build_total_usd         numeric     NOT NULL DEFAULT 0,
  operating_total_usd     numeric     NOT NULL DEFAULT 0,
  anthropic_input_tokens  bigint      NOT NULL DEFAULT 0,
  anthropic_output_tokens bigint      NOT NULL DEFAULT 0,
  anthropic_total_usd     numeric     NOT NULL DEFAULT 0,
  google_ads_calls        integer     NOT NULL DEFAULT 0,
  meta_ads_calls          integer     NOT NULL DEFAULT 0,
  subscription_share_usd  numeric     NOT NULL DEFAULT 0,
  hours_total             numeric     NOT NULL DEFAULT 0,
  last_computed_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, year_month)
);

-- ── Post-migration verification ────────────────────────────────────────────────
-- After applying, run this to confirm all four tables exist with expected columns:
--
-- SELECT table_name,
--   (SELECT count(*) FROM information_schema.columns
--    WHERE table_name = t.table_name AND table_schema = 'public') AS col_count
-- FROM (VALUES
--   ('cost_subscriptions'), ('cost_api_events'),
--   ('cost_hours'), ('cost_rollups_monthly')
-- ) AS t(table_name)
-- ORDER BY table_name;
--
-- Expected output (4 rows):
--   cost_api_events      | 11
--   cost_hours           |  7
--   cost_rollups_monthly | 12
--   cost_subscriptions   | 10
