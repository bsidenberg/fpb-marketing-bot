-- ============================================================
-- sql/023_cost_actuals_readonly.sql
--
-- READ-ONLY ANALYSIS QUERY — NOT A MIGRATION.
-- No DDL, no INSERT, no UPDATE, no DELETE. Safe to run on production.
--
-- PURPOSE (Owner Decision D-6, harness/DECISIONS.md)
-- Derive the API/LLM cost ceiling from THREE MONTHS OF ACTUALS instead of
-- from a guess. Brian's instruction: "propose a number derived from
-- measurement."
--
-- WHY BRIAN RUNS THIS AND NOT AN AGENT
-- Claude Code has read-only Supabase MCP access (list_tables) but no
-- execute_sql tool, so it cannot pull these figures itself. Rather than
-- estimate a ceiling and present it as measured, the query is written here
-- and the numbers come from the database. (CLAUDE.md: SQL is always written
-- to files and run by Brian.)
--
-- LIVE STATE AT WRITING (verified via list_tables, 2026-07-28):
--   cost_api_events       456 rows   <- the data. Real.
--   cost_rollups_monthly    0 rows   <- INERT. The rollup that would make
--                                       this trivial has never been populated.
--   cost_subscriptions      0 rows
--   cost_hours              0 rows
--
-- Whether those 456 events actually span three months is UNKNOWN until
-- query 1 runs. If coverage is shorter, say so and set the ceiling from the
-- window that exists — do not annualise a two-week sample.
--
-- SCHEMA VERIFIED against sql/011_cost_ledger.sql. Real columns are:
--   vendor, event_type, account_id, tokens_in, tokens_out, units,
--   cost_usd, occurred_at, source_run_id, metadata
-- Note: the timestamp is occurred_at (NOT created_at), the operation column
-- is event_type (NOT operation), and there is NO model column — model, where
-- recorded at all, lives inside metadata jsonb.
--
-- Production project: olpyqfuphiwdongzmazi
-- Run in: Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================


-- ── 1. COVERAGE FIRST. Does three months of data even exist? ────────────────
-- Run this before anything else. Every number below is meaningless if the
-- window is short, and a ceiling extrapolated from a partial sample is exactly
-- the kind of asserted-not-derived figure this project keeps getting bitten by.

SELECT
  COUNT(*)                                            AS total_events,
  COUNT(cost_usd)                                     AS events_with_cost,
  MIN(occurred_at)                                    AS earliest_event,
  MAX(occurred_at)                                    AS latest_event,
  ROUND(EXTRACT(EPOCH FROM (MAX(occurred_at) - MIN(occurred_at))) / 86400.0, 1)
                                                      AS span_days,
  COUNT(DISTINCT DATE(occurred_at))                   AS distinct_days_with_activity
FROM cost_api_events;

-- cost_usd is NULLABLE. If events_with_cost << total_events, the ledger is
-- logging calls without pricing them and NO ceiling can be derived from it —
-- that is a finding, not a blocker to work around.


-- ── 2. MONTHLY TOTALS (the headline number for the monthly ceiling) ─────────

SELECT
  DATE_TRUNC('month', occurred_at)::date              AS month,
  COUNT(*)                                            AS events,
  ROUND(SUM(cost_usd)::numeric, 2)                    AS total_usd,
  COUNT(DISTINCT DATE(occurred_at))                   AS active_days,
  ROUND((SUM(cost_usd) / NULLIF(COUNT(DISTINCT DATE(occurred_at)), 0))::numeric, 2)
                                                      AS usd_per_active_day
FROM cost_api_events
WHERE occurred_at >= NOW() - INTERVAL '3 months'
GROUP BY 1
ORDER BY 1;


-- ── 3. DAILY DISTRIBUTION (the daily ceiling must survive the PEAK, ─────────
--     not the mean — a ceiling set at the average trips constantly)

SELECT
  ROUND(AVG(daily_usd)::numeric, 2)                                          AS mean_day,
  ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY daily_usd)::numeric, 2) AS p50,
  ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY daily_usd)::numeric, 2) AS p90,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY daily_usd)::numeric, 2) AS p95,
  ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY daily_usd)::numeric, 2) AS p99,
  ROUND(MAX(daily_usd)::numeric, 2)                                          AS max_day
FROM (
  SELECT DATE(occurred_at) AS d, SUM(cost_usd) AS daily_usd
  FROM cost_api_events
  WHERE occurred_at >= NOW() - INTERVAL '3 months'
  GROUP BY 1
) daily;


-- ── 4. WHERE THE MONEY GOES — by vendor and event_type ──────────────────────
-- Drives the SHED ORDER (D-6): proactive analysis first, then recommendation
-- generation, then the S-08B daily loop; the WATCH LOOP is preserved last.
-- If one event_type dominates, shedding it buys the most headroom — and if
-- the watch-loop-shaped work is already cheap, preserving it costs little.
--
-- Known event_type values (sql/011 header): 'analyze_ads', 'chat',
-- 'intent_detection', 'campaigns_search'.

SELECT
  vendor,
  event_type,
  COUNT(*)                                            AS events,
  ROUND(SUM(cost_usd)::numeric, 2)                    AS total_usd,
  ROUND((100.0 * SUM(cost_usd) / NULLIF(SUM(SUM(cost_usd)) OVER (), 0))::numeric, 1)
                                                      AS pct_of_spend
FROM cost_api_events
WHERE occurred_at >= NOW() - INTERVAL '3 months'
GROUP BY 1, 2
ORDER BY total_usd DESC NULLS LAST;


-- ── 5. Token volume by vendor (a model swap is the cheapest lever) ──────────
-- There is no `model` column. Where the model was recorded it is in metadata;
-- this surfaces it if present and returns '(not recorded)' if it was not,
-- rather than failing or silently grouping everything together.

SELECT
  vendor,
  COALESCE(metadata->>'model', '(not recorded)')      AS model,
  COUNT(*)                                            AS events,
  SUM(tokens_in)                                      AS tokens_in,
  SUM(tokens_out)                                     AS tokens_out,
  ROUND(SUM(cost_usd)::numeric, 2)                    AS total_usd,
  ROUND(AVG(cost_usd)::numeric, 4)                    AS avg_usd_per_call
FROM cost_api_events
WHERE occurred_at >= NOW() - INTERVAL '3 months'
GROUP BY 1, 2
ORDER BY total_usd DESC NULLS LAST;


-- ── 6. Trend — is spend accelerating? ───────────────────────────────────────
-- A ceiling set against a flat history is wrong if the trend is already rising.
-- Note that Phase A adds two always-on loops (S-08B daily, S-09B hourly) absent
-- from this data entirely — but do NOT pad the ceiling for them (see the
-- decision rule at the bottom of this file). Instrument those loops and
-- re-derive from measurement after 14 days.

SELECT
  DATE_TRUNC('week', occurred_at)::date               AS week,
  COUNT(*)                                            AS events,
  ROUND(SUM(cost_usd)::numeric, 2)                    AS total_usd
FROM cost_api_events
WHERE occurred_at >= NOW() - INTERVAL '3 months'
GROUP BY 1
ORDER BY 1;


-- ============================================================
-- HOW TO TURN THESE INTO THE CEILING
--
-- The decision rule is FIXED IN ADVANCE (harness/DECISIONS.md, "D-6 decision
-- rule"), recorded before this query was ever run so the result cannot be
-- rationalised after the fact. Read query 1, take the branch, apply it.
--
--   BRANCH A — events_with_cost < ~70% of total_events
--     -> PRODUCE NO NUMBER. The ledger cannot support a derived ceiling.
--        Keep the interim guard ($25/day, $250/month) and open a backfill
--        session. A ceiling derived from 60%-priced data is a guess wearing
--        a measurement's clothes.
--
--   BRANCH B — coverage fine, span_days < 60
--     -> Daily ceiling from query 3 p95. Monthly is PROVISIONAL.
--        Re-derive at 90 days.
--
--   BRANCH C — coverage fine, span_days >= 60
--     -> Daily ceiling from query 3 p95 (NOT the mean).
--        Monthly ceiling from query 2 MEASURED MONTHLY ACTUALS.
--        *** NOT daily x 30. *** Whichever trips first binds.
--
-- WHY MONTHLY IS NEVER daily x 30: it assumes every day is a peak day.
-- Multiplying a p95 daily figure by 30 yields a monthly ceiling far above
-- anything that will ever be spent, so the monthly guard never fires and the
-- daily guard becomes the only real control -- exactly the "guards do not
-- compose into a monthly total" error that D-12 exists to correct, reproduced
-- one layer up.
--
-- NO HEADROOM MULTIPLIER FOR PHASE A (Brian, 2026-07-28).
-- Do not pad this number for S-08B / S-09 load that does not exist yet. That
-- is an estimate dressed as a safety margin, and it makes the first ceiling
-- unfalsifiable -- too high to ever trip, therefore proving nothing. Instead:
-- instrument S-08B and S-09 cost events from their FIRST RUN, then re-derive
-- after 14 days of real loop data, as a scheduled decision with Brian's
-- sign-off. The ceiling is allowed to trip in the interim; a tripped ceiling
-- is information.
--
-- Record the chosen numbers, the branch taken, and the reasoning as the final
-- D-6 resolution in harness/DECISIONS.md, replacing the interim guard.
-- ============================================================
