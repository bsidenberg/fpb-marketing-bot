-- ============================================================
-- sql/024_cost_ledger_diagnostics_readonly.sql
--
-- READ-ONLY DIAGNOSTICS — NOT A MIGRATION. No DDL, no writes.
--
-- PURPOSE: resolve the three flags raised from sql/023's output before the
-- D-6 14-day re-derivation clock starts. Brian's instruction: "verify
-- coverage of PATHS before the 14-day clock starts, or the re-derivation
-- inherits the blind spot."
--
-- sql/023 returned: 456 events / 8 weeks / 400 priced (87.7%) / $2.24 total.
--
-- FLAG 1 — two calendar weeks (06-08, 06-22) with ZERO events while daily
--          crons were configured. SDR-1: a dead cron is silent.
-- FLAG 2 — 56 unpriced events, exactly 28 + 28.
-- FLAG 3 — $2.24 / 400 priced = ~$0.0056 per call. Suspiciously low.
--
-- CODE-GROUNDED HYPOTHESES (verified by reading, NOT by querying — these
-- queries are what test them. SDR-2: they are hypotheses until confirmed):
--
--   FLAG 2 -> NOT A DEFECT, and not "one event_type never priced".
--     api/lib/api-cost.js writes cost_usd = NULL **by design** for every
--     ad-platform call ("ad platforms charge per spend, not per call").
--     So ALL google_ads/meta_ads events are unpriced, correctly.
--     The 28 + 28 shape is almost certainly api/google-ads.js:280-281,
--     which emits 'campaigns_search' AND 'campaigns_roster' back-to-back
--     on every campaign fetch — identical counts by construction.
--     Query 2 confirms or kills this.
--
--   FLAG 3 -> LIKELY A REAL BLIND SPOT, and it is a SILENT NULL.
--     api/lib/anthropic-cost.js prices via computeAnthropicCost(model,...)
--     using the model returned in the API RESPONSE (claudeResponse.model),
--     not the requested alias. cost-rates.js returns **null** for any model
--     not in its table, and the row is then written with cost_usd = NULL
--     and NOBODY IS TOLD.
--     The table (api/lib/cost-rates.js) contains BOTH an alias and a dated
--     id for haiku ('claude-haiku-4-5' and 'claude-haiku-4-5-20251001') --
--     someone already hit this and patched it for haiku. But
--     'claude-sonnet-4-6' (api/chat.js:57, CHAT_MODEL -- the MAIN chat
--     call) and 'claude-opus-4-7' are present as ALIASES ONLY.
--     If the API returns a dated sonnet id, EVERY main chat call is
--     unpriced -- which would explain both the low average and part of the
--     56. Query 3 settles it.
--
-- Production project: olpyqfuphiwdongzmazi
-- Run in: Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================


-- ── FLAG 2: what exactly is unpriced, and is it by design? ──────────────────

SELECT
  vendor,
  event_type,
  COUNT(*)                                   AS events,
  COUNT(cost_usd)                            AS priced,
  COUNT(*) - COUNT(cost_usd)                 AS unpriced,
  ROUND(SUM(cost_usd)::numeric, 4)           AS total_usd
FROM cost_api_events
GROUP BY 1, 2
ORDER BY unpriced DESC, events DESC;

-- EXPECT if the hypothesis holds: every google_ads/meta_ads row unpriced
-- (correct, by design), every anthropic row priced. Two google_ads
-- event_types at exactly 28 each.
--
-- IF ANY 'anthropic' ROW IS UNPRICED -> that is the real defect. Go to query 3.


-- ── FLAG 3: which models are being recorded, and are they priced? ───────────
-- THE CRITICAL QUERY. metadata->>'model' is the model the API RESPONSE
-- returned. Anything appearing here that is NOT in cost-rates.js
-- ANTHROPIC_RATES is silently costing $0 in the ledger.

SELECT
  metadata->>'model'                         AS model_returned_by_api,
  event_type,
  COUNT(*)                                   AS events,
  COUNT(cost_usd)                            AS priced,
  COUNT(*) - COUNT(cost_usd)                 AS unpriced,
  SUM(tokens_in)                             AS tokens_in,
  SUM(tokens_out)                            AS tokens_out,
  ROUND(SUM(cost_usd)::numeric, 4)           AS total_usd
FROM cost_api_events
WHERE vendor = 'anthropic'
GROUP BY 1, 2
ORDER BY unpriced DESC, events DESC;

-- Cross-check every model_returned_by_api against api/lib/cost-rates.js:
--   claude-sonnet-4-20250514, claude-haiku-4-5-20251001, claude-haiku-4-5,
--   claude-sonnet-4-6, claude-opus-4-7
-- Any value NOT on that list is an unpriced path.


-- ── FLAG 3b: what WOULD the spend have been if nothing were unpriced? ───────
-- Recomputes cost from recorded tokens at current sonnet-4-6 rates for the
-- unpriced anthropic rows, to size the blind spot rather than just name it.

SELECT
  COUNT(*)                                                          AS unpriced_anthropic_events,
  SUM(tokens_in)                                                    AS tokens_in,
  SUM(tokens_out)                                                   AS tokens_out,
  ROUND(((SUM(tokens_in) * 3.00 + SUM(tokens_out) * 15.00) / 1000000)::numeric, 4)
                                                                    AS implied_usd_at_sonnet_rates
FROM cost_api_events
WHERE vendor = 'anthropic' AND cost_usd IS NULL;

-- Add this to the $2.24 to get the true 8-week spend. If it materially
-- changes the number, the D-6 re-derivation MUST NOT start until the rate
-- table is fixed -- otherwise the 14-day measurement inherits the blind spot.


-- ── FLAG 1: the gap weeks. Which days have NO events at all? ────────────────

WITH days AS (
  SELECT generate_series(
    (SELECT MIN(occurred_at)::date FROM cost_api_events),
    (SELECT MAX(occurred_at)::date FROM cost_api_events),
    '1 day'::interval
  )::date AS d
)
SELECT
  days.d                                     AS day,
  EXTRACT(DOW FROM days.d)                   AS day_of_week,
  COUNT(e.id)                                AS events
FROM days
LEFT JOIN cost_api_events e ON e.occurred_at::date = days.d
GROUP BY 1, 2
HAVING COUNT(e.id) = 0
ORDER BY 1;

-- Daily crons are configured (cron-crm-sync 11:15, cron-daily-stats 11:45,
-- cron-analyze 12:30, evaluate-outcomes 13:00 UTC). A day with zero events
-- means either the crons did not run, or they ran and recorded nothing.
-- BOTH are SDR-1 failures: neither announced itself.
--
-- Cross-check the gap days against Vercel cron execution logs. If the crons
-- DID run, the ledger is dropping writes (see the [COST-LEDGER-FAILURE]
-- grep marker in api/lib/api-cost.js:28 and anthropic-cost.js:42).


-- ── FLAG 1b: per-day event counts, to see the shape of the gaps ─────────────

SELECT
  occurred_at::date                          AS day,
  COUNT(*)                                   AS events,
  COUNT(DISTINCT event_type)                 AS distinct_event_types,
  ROUND(SUM(cost_usd)::numeric, 4)           AS usd
FROM cost_api_events
GROUP BY 1
ORDER BY 1;


-- ============================================================
-- WHAT TO DO WITH THE RESULTS
--
-- If query 3 shows ANY unpriced anthropic model:
--   -> api/lib/cost-rates.js is missing that model id. Fix the table AND
--      make the null non-silent: computeAnthropicCost returning null must
--      log/alert, not just write a NULL row (SDR-1). Today an unknown model
--      is indistinguishable from a free call.
--   -> The D-6 14-day clock does NOT start until this lands. Otherwise the
--      re-derived ceiling is calibrated on a ledger that undercounts.
--
-- If query 1's gap days coincide with cron non-execution:
--   -> SDR-1 instance. Folded into S-09A's heartbeat work.
--
-- NOTE (SDR-5 + SDR-6, both firing on cost-rates.js):
--   Its header says "Source: verified 2026-05-19" -- a snapshot with no
--   re-derivation cadence, now ~10 weeks stale -- and "Update this file when
--   Anthropic changes pricing", an intention with no date, trigger, or
--   ratchet. Both need assigning.
-- ============================================================
