-- ============================================================
-- Migration 016: seed agent_config row for the CRM profit bridge margins
--
-- WHY: The FPB CRM has no gross-profit column anywhere (verified live
-- schema inspection 7/2). SESSION-04's CRM -> Prime bridge
-- (api/cron-crm-sync.js, api/lib/crm-bridge.js) must ESTIMATE
-- gross_profit = booked_revenue * margin, keyed by project_type
-- ('kit' | 'turnkey') with a 'default' fallback. A 0 or missing
-- margin means "don't estimate" — gross_profit is left null rather
-- than inventing a profit figure.
--
-- WHAT: SEED-ONLY. The agent_config table ALREADY EXISTS in
-- production (verified live: columns id, config_key text unique,
-- config_value jsonb, description text, updated_at). This migration
-- does NOT create the table — it only upserts the crm_bridge_margins
-- config row that api/lib/crm-bridge.js's getMargins() reads.
--
-- Run in Supabase SQL Editor (Dashboard -> SQL Editor -> New Query).
-- Production project: olpyqfuphiwdongzmazi
--
-- Idempotent: yes — ON CONFLICT (config_key) DO UPDATE upserts the
-- row, safe to re-run any number of times.
-- ============================================================

INSERT INTO agent_config (config_key, config_value, description)
VALUES (
  'crm_bridge_margins',
  '{"kit":0.20,"turnkey":0.20,"default":0.20}'::jsonb,
  'Gross-profit margin estimates used by api/cron-crm-sync.js (CRM bridge). CRM has no GP column; GP = booked_revenue * margin by project_type. 0 or missing margin => GP left null (never invent profit).'
)
ON CONFLICT (config_key) DO UPDATE
  SET config_value = EXCLUDED.config_value,
      description  = EXCLUDED.description,
      updated_at   = now();

-- ============================================================
-- Post-migration verification:
--
--   SELECT config_key, config_value, description, updated_at
--     FROM agent_config
--    WHERE config_key = 'crm_bridge_margins';
--   -- expect: one row, config_value = {"kit":0.20,"turnkey":0.20,"default":0.20}
-- ============================================================
