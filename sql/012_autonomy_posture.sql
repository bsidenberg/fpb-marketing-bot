-- ============================================================
-- Migration 012: autonomy posture infrastructure
--
-- Builds the per-(account × pillar × action_class) autonomy posture
-- layer required by PRIME-STRATEGY.md Section 4.
--
-- Tables created:
--   autonomy_posture         — per-row tier, cadence caps, graduation tracking
--   autonomy_holdout_classes — static ref of always-approval action classes
--
-- Function created:
--   increment_posture_outcome — atomic upsert + counter increment (RPC)
--
-- accounts.autonomy_level deprecation:
--   Column was never read by any code (AUDIT-PHASE-0.md Section 5).
--   Dropped via idempotent DO block.
--
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query).
-- Production project: olpyqfuphiwdongzmazi
--
-- Idempotent — safe to re-run:
--   CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--   ON CONFLICT DO NOTHING for seed rows, DROP COLUMN IF EXISTS.
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 012 pre-check: autonomy_posture exists = %',
    (SELECT to_regclass('public.autonomy_posture') IS NOT NULL);
  RAISE NOTICE 'Migration 012 pre-check: autonomy_holdout_classes exists = %',
    (SELECT to_regclass('public.autonomy_holdout_classes') IS NOT NULL);
  RAISE NOTICE 'Migration 012 pre-check: accounts.autonomy_level exists = %',
    (SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'accounts' AND column_name = 'autonomy_level'
    ));
END $$;

-- ============================================================
-- Table: autonomy_posture
-- Per-(account × pillar × action_class) row. Each row is sovereign —
-- no parent → child inheritance (TENANT-MODEL-SPEC.md Section 2.6).
-- ============================================================

CREATE TABLE IF NOT EXISTS autonomy_posture (
  account_id              uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pillar                  text        NOT NULL,
  action_class            text        NOT NULL,
  tier                    text        NOT NULL DEFAULT 'recommend',
  cycles_completed        integer     NOT NULL DEFAULT 0,
  success_count           integer     NOT NULL DEFAULT 0,
  cap_per_window          integer     NULL,
  window_days             integer     NOT NULL DEFAULT 7,
  last_evaluated_at       timestamptz NULL,
  last_graduation_check_at timestamptz NULL,
  holdout                 boolean     NOT NULL DEFAULT false,
  notes                   text        NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (account_id, pillar, action_class),

  CONSTRAINT autonomy_posture_pillar_check
    CHECK (pillar IN ('paid_ads', 'seo_blog', 'gbp', 'social_media')),
  CONSTRAINT autonomy_posture_tier_check
    CHECK (tier IN ('recommend', 'full')),
  CONSTRAINT autonomy_posture_cycles_check
    CHECK (cycles_completed >= 0),
  CONSTRAINT autonomy_posture_success_check
    CHECK (success_count >= 0),
  CONSTRAINT autonomy_posture_success_lte_cycles_check
    CHECK (success_count <= cycles_completed),
  CONSTRAINT autonomy_posture_cap_check
    CHECK (cap_per_window IS NULL OR cap_per_window > 0),
  CONSTRAINT autonomy_posture_window_days_check
    CHECK (window_days > 0)
);

CREATE INDEX IF NOT EXISTS autonomy_posture_account_pillar_idx
  ON autonomy_posture (account_id, pillar);

-- ============================================================
-- Table: autonomy_holdout_classes
-- Static reference — action classes that ALWAYS require approval.
-- Seeded below. Never auto-graduates.
-- ============================================================

CREATE TABLE IF NOT EXISTS autonomy_holdout_classes (
  action_class  text        PRIMARY KEY,
  description   text        NOT NULL,
  added_at      timestamptz NOT NULL DEFAULT now()
);

-- Seed holdout classes (idempotent)
INSERT INTO autonomy_holdout_classes (action_class, description) VALUES
  ('publish_blog_post',       'Every blog publish requires human review (first 5 per tenant rule, Phase 0)'),
  ('create_campaign',         'New campaign creation — high-stakes, irreversible setup'),
  ('delete_campaign',         'Campaign deletion — irreversible, permanently destroys history'),
  ('modify_targeting',        'High-impact audience change — wrong targeting wastes full budget'),
  ('change_budget_significantly', 'Budget change > 50% delta — per-tenant spend threshold gate'),
  ('first_n_per_class',       'Placeholder: first 5 actions of any new type for any new tenant'),
  ('cross_tenant_change',     'Any change affecting more than one tenant — requires cross-account review')
ON CONFLICT (action_class) DO NOTHING;

-- ============================================================
-- Function: increment_posture_outcome
-- Atomic upsert + counter increment used by recordActionOutcome.
-- Avoids read-then-write race conditions.
-- ============================================================

CREATE OR REPLACE FUNCTION increment_posture_outcome(
  p_account_id  uuid,
  p_pillar      text,
  p_action_class text,
  p_succeeded   boolean,
  p_now         timestamptz DEFAULT now()
) RETURNS void AS $$
BEGIN
  INSERT INTO autonomy_posture (
    account_id, pillar, action_class, tier,
    cycles_completed, success_count, last_evaluated_at
  )
  VALUES (
    p_account_id, p_pillar, p_action_class, 'recommend',
    1, CASE WHEN p_succeeded THEN 1 ELSE 0 END, p_now
  )
  ON CONFLICT (account_id, pillar, action_class)
  DO UPDATE SET
    cycles_completed   = autonomy_posture.cycles_completed + 1,
    success_count      = autonomy_posture.success_count + CASE WHEN p_succeeded THEN 1 ELSE 0 END,
    last_evaluated_at  = p_now,
    updated_at         = p_now;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Deprecate accounts.autonomy_level
-- The column was never read by any code (AUDIT-PHASE-0.md Section 5).
-- autonomy_posture is now authoritative.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'accounts' AND column_name = 'autonomy_level'
  ) THEN
    -- Drop the named check constraint first if it exists
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
      WHERE tc.table_name = 'accounts'
        AND tc.constraint_type = 'CHECK'
        AND ccu.column_name = 'autonomy_level'
    ) THEN
      EXECUTE 'ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_autonomy_level_check';
    END IF;
    ALTER TABLE accounts DROP COLUMN IF EXISTS autonomy_level;
    RAISE NOTICE 'Migration 012: accounts.autonomy_level column dropped';
  ELSE
    RAISE NOTICE 'Migration 012: accounts.autonomy_level already absent — skipping drop';
  END IF;
END $$;

-- ============================================================
-- Post-migration verification:
--
-- SELECT * FROM autonomy_holdout_classes ORDER BY action_class;
-- -- expect 7 rows
--
-- SELECT COUNT(*) FROM autonomy_posture;
-- -- expect 0 (table empty until actions start flowing)
--
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'accounts' AND column_name = 'autonomy_level';
-- -- expect 0 rows (column dropped)
--
-- SELECT * FROM pg_proc WHERE proname = 'increment_posture_outcome';
-- -- expect 1 row
-- ============================================================
