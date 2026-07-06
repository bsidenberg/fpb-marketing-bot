-- ============================================================
-- Migration 017: seed agent_config row for spend-magnitude budget guards
--
-- WHY: SESSION-05. The autonomy coordinator caps action FREQUENCY
-- (cadence) but nothing caps MAGNITUDE — an approved action could
-- 10x a budget. api/lib/budget-guards.js enforces config-driven
-- magnitude/protection rules at staging (coordinator consult) and
-- execution (acquireLockAndExecute / executeTransient backstop).
-- This row is the single source for every threshold; the code holds
-- identical defaults only as a fallback when this row is absent.
--
-- WHAT: SEED-ONLY. agent_config already exists in production
-- (verified live 7/6: columns id, config_key text unique,
-- config_value jsonb, description text, updated_at). agent_config is
-- GLOBAL (no account_id column), so per-account overrides live inside
-- the jsonb under account_overrides keyed by accounts.id UUID, e.g.:
--   "account_overrides": { "<account-uuid>": { "max_budget_increase_pct_per_day": 10 } }
--
-- Field meanings (api/lib/budget-guards.js evaluateBudgetGuards):
--   max_budget_increase_pct_per_day  — increase above this % => require_approval
--   max_budget_decrease_pct_per_day  — decrease above this % => require_approval
--   major_change_pct                 — any change >= this % => require_approval
--                                      ALWAYS, regardless of autonomy tier
--   min_data_volume_conversions      — campaigns under this many conversions in
--                                      the lookback are "low data": aggressive
--                                      changes flagged, never auto-paused
--   min_data_lookback_days           — lookback window for the above (campaign_daily_stats)
--   aggressive_decrease_pct          — decrease above this % counts as aggressive
--                                      for the low-data rule
--   protected_campaigns              — pause/decrease on these IDs always requires
--                                      approval; excluded from the "lead-gen" set for
--                                      the last-enabled-campaign block rule.
--                                      21613067518 = LP Branded - Florida Pole Barn
--   cpl_target / cpl_warn / cpl_emergency — CPL bands recorded in guard reason strings
--
-- The absolute account daily-spend cap is NOT here — it reads
-- accounts.daily_spend_cap per account (block when projected spend exceeds it).
--
-- Run in Supabase SQL Editor (Dashboard -> SQL Editor -> New Query).
-- Production project: olpyqfuphiwdongzmazi
--
-- Idempotent: yes — ON CONFLICT (config_key) DO UPDATE upserts the
-- row, safe to re-run any number of times. NOTE: re-running resets
-- config_value to these seed values, including account_overrides.
-- ============================================================

INSERT INTO agent_config (config_key, config_value, description)
VALUES (
  'budget_guards',
  '{
    "defaults": {
      "max_budget_increase_pct_per_day": 15,
      "max_budget_decrease_pct_per_day": 20,
      "major_change_pct": 25,
      "min_data_volume_conversions": 5,
      "min_data_lookback_days": 14,
      "aggressive_decrease_pct": 10,
      "protected_campaigns": ["21613067518"],
      "cpl_target": 50,
      "cpl_warn": 75,
      "cpl_emergency": 100
    },
    "account_overrides": {}
  }'::jsonb,
  'Spend-magnitude budget guard thresholds read by api/lib/budget-guards.js. defaults apply to every account; account_overrides (keyed by accounts.id UUID) win per account. Account daily-spend cap comes from accounts.daily_spend_cap, not this row.'
)
ON CONFLICT (config_key) DO UPDATE
  SET config_value = EXCLUDED.config_value,
      description  = EXCLUDED.description,
      updated_at   = now();

-- ============================================================
-- Post-migration verification:
--
--   SELECT config_key, config_value->'defaults', updated_at
--     FROM agent_config
--    WHERE config_key = 'budget_guards';
--   -- expect: one row; defaults 15/20/25, protected ["21613067518"],
--   --         CPL bands 50/75/100
-- ============================================================
