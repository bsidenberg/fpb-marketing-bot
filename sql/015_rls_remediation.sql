-- ============================================================
-- sql/015_rls_remediation.sql — Row Level Security remediation
--
-- Prepared: July 2, 2026 (Phase 0 audit). REVIEW BEFORE APPLYING.
--
-- WHY THIS IS ZERO-BREAKAGE:
--   The frontend contains no direct Supabase calls (verified: zero
--   supabase-js usage in marketing-bot-dashboard.jsx / src/). Every
--   query goes through /api routes using the SERVICE ROLE key
--   (api/lib/supabase.js), and the service role BYPASSES RLS.
--   Therefore: enabling RLS on every table and removing all
--   anon/authenticated access changes nothing for the app, while
--   closing direct PostgREST access via the anon key.
--
-- END STATE:
--   • RLS enabled on all 17 public tables
--   • No policies for anon/authenticated (deny-by-default)
--   • Direct grants revoked from anon/authenticated (defense in depth)
--   • Misnamed "Service key full access" USING(true) ALL-roles
--     policies dropped (they granted anon, not just service)
--
-- HOW TO APPLY (Supabase Dashboard → SQL Editor → paste → Run),
-- or via CLI once migration tracking is adopted (audit §5).
--
-- ROLLBACK: each section's inverse is ALTER TABLE ... DISABLE ROW
-- LEVEL SECURITY / re-GRANT. Not recommended.
-- ============================================================

begin;

-- ── 1. Enable RLS on the 10 unprotected tables ──────────────
alter table public.accounts                 enable row level security;
alter table public.ad_platform_connections  enable row level security;
alter table public.ai_analysis_runs         enable row level security;
alter table public.cost_subscriptions       enable row level security;
alter table public.cost_api_events          enable row level security;
alter table public.cost_hours               enable row level security;
alter table public.cost_rollups_monthly     enable row level security;
alter table public.autonomy_posture         enable row level security;
alter table public.autonomy_holdout_classes enable row level security;
alter table public.chat_messages            enable row level security;

-- ── 2. Drop the misnamed permissive policies ────────────────
-- These were USING(true) WITH CHECK(true) for ALL roles — they
-- granted full read/write to anon, not just the service key.
-- Service role never needed a policy (it bypasses RLS).
drop policy if exists "Service key full access" on public.actions;
drop policy if exists "Service key full access" on public.agent_config;
drop policy if exists "Service key full access" on public.automation_log;
drop policy if exists "Service key full access" on public.performance_snapshots;

-- ── 3. Defense in depth: revoke direct role grants ──────────
-- Even with RLS deny-by-default, removing table grants from the
-- PostgREST roles makes the posture explicit and linter-clean.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

commit;

-- ── 4. VERIFY (run after commit) ────────────────────────────
-- Expect: 17 rows, all rls_enabled = true, zero policies listed.
--   select relname, relrowsecurity from pg_class
--     join pg_namespace n on n.oid = relnamespace
--     where n.nspname = 'public' and relkind = 'r' order by 1;
--   select tablename, policyname from pg_policies
--     where schemaname = 'public';
--
-- Then exercise the app: dashboard loads, chat works, Live Data
-- populates, an action can be listed. All should be unchanged
-- (service-role path). If ANYTHING breaks, it means a hidden
-- anon-key client exists — stop and report it.

-- ── 5. Separate follow-up (NOT in this migration) ───────────
-- Two functions have mutable search_path (linter WARN):
--   accounts_enforce_one_level_hierarchy, increment_posture_outcome
-- Fix requires exact signatures; run in SQL editor after checking
-- \df, e.g.:
--   alter function public.increment_posture_outcome(<args>)
--     set search_path = public, pg_temp;
