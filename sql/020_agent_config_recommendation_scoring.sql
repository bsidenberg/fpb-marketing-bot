-- ============================================================
-- Migration 020: seed agent_config row for recommendation scoring
--
-- WHY: SESSION-08A. api/lib/objective.js + api/lib/recommendation-score.js
-- score every candidate recommendation before it can reach Brian's approval
-- queue. Every knob they use is config-driven so it can be TUNED WITHOUT A
-- DEPLOY — which matters because the two most important numbers here
-- (min_score_threshold, daily_queue_cap) cannot be set correctly from first
-- principles. They get tuned off a week of real explain output.
--
-- WHAT: SEED-ONLY. NO SCHEMA CHANGE. agent_config already exists in production
-- (columns: id, config_key text unique, config_value jsonb, description,
-- updated_at). This migration adds ONE row. It creates no table, alters no
-- column, and adds no field to any existing table.
--
-- The modules hold identical defaults in code as a fallback, so they work
-- correctly whether or not this row is ever applied. Applying it only makes the
-- knobs tunable from the DB. Same precedent as sql/017.
--
-- agent_config is GLOBAL (no account_id column), so per-account overrides live
-- inside the jsonb under account_overrides keyed by accounts.id UUID:
--   "account_overrides": { "<account-uuid>": { "daily_queue_cap": 5 } }
--
-- ── OWNER DECISIONS RECORDED HERE (Brian, 2026-07-13) ───────────────────────
--
-- D-1 auto-execute posture: FULLY GATED at Phase A launch.
--   auto_execute_enabled = false, auto_execute_allowlist = [].
--   Nothing auto-fires on FPB. Every recommendation stages for approval.
--   Rationale: action_outcomes has ZERO rows today, so the learning gate has no
--   track record to judge the scorer by. Graduating an action class before we
--   can measure it is graduating on faith. Revisit after ~20 clean cycles.
--   NOTE: this flag is scoring-side only. It sets actions.auto_execute at
--   staging. It is NOT a safety control — the autonomy coordinator, the holdout
--   list and the budget guards remain the enforcement layer, and they are
--   consulted regardless of what this row says.
--
-- D-2 threshold + cap: daily_queue_cap = 10, min_score_threshold = 0.25 (SOFT).
--   The CAP does the real work at launch; the threshold is a placeholder to be
--   tuned from real explain output. Score is denominated in EXPECTED PROFITABLE
--   LEADS (expected sold jobs) over objective_window_days — so 0.25 means "this
--   action should be worth at least a quarter of a sold job."
--
-- ── FIELD MEANINGS ──────────────────────────────────────────────────────────
--   daily_queue_cap           — max recommendations queued per account per day
--   min_score_threshold       — score floor to reach the queue at all
--   max_per_campaign          — max queued items for one campaign (anti-flood)
--   max_per_action_class      — max queued items of one action type (anti-flood)
--   objective_window_days     — window the expected delta is denominated over
--   reallocation_efficiency   — spend freed by a negative keyword / pause is
--                               redeployed at the host campaign's marginal
--                               profitable-leads-per-dollar, DISCOUNTED by this
--                               factor for diminishing returns. Without this
--                               term, waste-removal actions can never score
--                               above zero (they only remove traffic) and eval
--                               E1 could never fire.
--   sold_rate_prior_strength  — shrinkage pseudo-count k. A segment's sold rate
--                               is pulled toward the account prior by k.
--   sold_rate_min_sample      — terminal outcomes needed before a segment's own
--                               sold rate is trusted. BELOW this, the estimate
--                               is CAPPED AT THE PRIOR — an unmeasured segment
--                               can never score above an average one.
--   max_projected_lift_pct    — no proposal may claim to lift qualified volume
--                               by more than this. Bounds a fabricated forecast.
--   learning_prior_*          — beta-binomial prior for the outcome-learning
--                               gate (eval E7). alpha=beta=2 => neutral 0.5,
--                               weak. Zero outcomes => weight exactly 1.0.
--   learning_weight_ceiling   — 1.0 = DOWN-WEIGHT ONLY. A clean track record
--                               restores an action class to neutral; it never
--                               buys a bonus multiplier. An inflatable weight is
--                               an attack surface. HARD-CAPPED at 1.0 in code:
--                               raising it here has no effect.
--   learning_missing_history_weight
--                             — applied when the caller does not supply outcome
--                               history at all. Pinned to learning_weight_floor
--                               so that STAYING SILENT can never score better
--                               than DISCLOSING a bad track record. Above the
--                               floor, a caller holding a failing action class
--                               profits by omitting its history.
--   volume_collapse_tolerance — an outcome whose efficiency "improved" only
--                               because volume cratered is not a success.
--   max_profitable_leads_per_dollar
--                             — sanity cap on a host campaign's efficiency in the
--                               waste-removal path. A caller-supplied host of
--                               "$1 spend, 50 qualified leads" manufactured a
--                               1747x score in adversarial review.
--   reallocation_max_waste_multiple
--                             — (A14) how many times its fair share of host spend an
--                               UNVERIFIED removed cohort may claim to have burned:
--                               cap = W x (removedLeads / hostLeads) x hostSpend.
--                               Independent review found removed.spend was trusted
--                               independently of the cohort's lead share, so a
--                               0-for-20 cohort holding 10% of a campaign's leads
--                               could claim 100% of its budget and score 18x honest
--                               value. W must be > 1 (real waste IS disproportionate)
--                               but bounded (unbounded was the exploit).
--                               DOES NOT APPLY to server-verified spend: a cohort
--                               whose cost came from the fetched search-term report
--                               is a MEASUREMENT, not a claim. That carve-out is what
--                               keeps eval E1 alive — the ideal negative keyword has
--                               ZERO qualified leads, so a lead-share cap alone would
--                               clamp it to $0 and E1 could never fire.
--   risk_penalties            — subtracted from the score, in profitable-lead
--                               units. Absolute (not a multiplier) so a risky
--                               action with a marginal benefit goes NEGATIVE and
--                               is dropped, rather than being scaled down and
--                               still queued.
--
-- CPL bands, min-data-volume rules and protected_campaigns are NOT here — they
-- live in agent_config 'budget_guards' (sql/017) and are read from there. Do not
-- duplicate them into this row.
--
-- Run in Supabase SQL Editor (Dashboard -> SQL Editor -> New Query).
-- Production project: olpyqfuphiwdongzmazi
--
-- Idempotent: yes — ON CONFLICT (config_key) DO UPDATE upserts the row, safe to
-- re-run. NOTE: re-running resets config_value to these seed values, including
-- account_overrides.
-- ============================================================

INSERT INTO agent_config (config_key, config_value, description)
VALUES (
  'recommendation_scoring',
  '{
    "defaults": {
      "auto_execute_enabled": false,
      "auto_execute_allowlist": [],

      "daily_queue_cap": 10,
      "min_score_threshold": 0.25,
      "max_per_campaign": 2,
      "max_per_action_class": 5,

      "objective_window_days": 30,
      "reallocation_efficiency": 0.7,
      "reallocation_max_waste_multiple": 3,
      "sold_rate_prior_strength": 10,
      "sold_rate_min_sample": 5,
      "max_projected_lift_pct": 100,
      "max_profitable_leads_per_dollar": 0.1,

      "learning_prior_alpha": 2,
      "learning_prior_beta": 2,
      "learning_weight_floor": 0.25,
      "learning_weight_ceiling": 1.0,
      "learning_missing_history_weight": 0.25,
      "volume_collapse_tolerance": 0.5,

      "default_analysis_confidence": 0.6,
      "unmeasured_sample_factor": 0.6,
      "attribution_factors": { "high": 1.0, "medium": 0.85, "low": 0.6, "none": 0.4 },

      "risk_penalties": {
        "holdout": 0.5,
        "protected_campaign": 1.0,
        "near_major_change": 0.3,
        "low_attribution": 0.2,
        "unmeasured_segment": 0.3,
        "unknown_action_type": 1.0
      }
    },
    "account_overrides": {}
  }'::jsonb,
  'Recommendation scoring knobs read by api/lib/objective.js and api/lib/recommendation-score.js (SESSION-08A). Score = expected_delta_profitable_leads x confidence x data_sufficiency_gate - risk_penalty, denominated in expected SOLD JOBS (never CPL). D-1: auto_execute_enabled=false — fully gated at Phase A launch. D-2: cap 10/day, threshold 0.25 (soft, tune from explain output). CPL bands and min-data rules live in the budget_guards row, not here.'
)
ON CONFLICT (config_key) DO UPDATE
  SET config_value = EXCLUDED.config_value,
      description  = EXCLUDED.description,
      updated_at   = now();

-- ============================================================
-- Post-migration verification:
--
--   SELECT config_key,
--          config_value->'defaults'->>'auto_execute_enabled'  AS auto_exec,
--          config_value->'defaults'->>'daily_queue_cap'       AS cap,
--          config_value->'defaults'->>'min_score_threshold'   AS threshold,
--          updated_at
--     FROM agent_config
--    WHERE config_key = 'recommendation_scoring';
--   -- expect: one row; auto_exec = false; cap = 10; threshold = 0.25
--
-- Rollback (reverts to the code defaults, which are identical):
--   DELETE FROM agent_config WHERE config_key = 'recommendation_scoring';
-- ============================================================
