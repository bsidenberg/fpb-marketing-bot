-- ============================================================
-- Migration 007: ai_analysis_runs table
--
-- One row per AI analysis invocation (analyze-ads, chat, future
-- runners). Captures the model + prompt version used, a summary of
-- the input snapshot the model saw, and the structured output it
-- returned. Powers traceability, replay, and prompt-regression work.
--
-- Note: This table is created in Stage A1 but not yet wired into the
-- AI loop. Stage A2 will update analyze-ads.js and chat.js to
-- insert/update rows here.
--
-- Run in Supabase SQL editor after sql/005_accounts.sql.
-- ============================================================

create table if not exists ai_analysis_runs (
  id                       uuid primary key default gen_random_uuid(),

  -- Linkage
  -- ON DELETE SET NULL preserves audit history if an account is removed.
  account_id               uuid references accounts(id) on delete set null,

  -- Model identity
  model_provider           text not null,
  model_name               text not null,
  prompt_version           text not null,

  -- Input the model saw
  input_snapshot_id        uuid,
  input_summary_json       jsonb,

  -- Output the model returned
  output_json              jsonb,

  -- Run status
  status                   text not null default 'pending',
  error                    text,
  latency_ms               integer,

  -- Lifecycle
  created_at               timestamptz not null default now(),

  -- Named constraints
  constraint ai_analysis_runs_provider_check
    check (model_provider in ('anthropic','openai','google','other')),
  constraint ai_analysis_runs_status_check
    check (status in ('pending','running','succeeded','failed')),
  constraint ai_analysis_runs_latency_check
    check (latency_ms is null or latency_ms >= 0)
);

-- Indexes
-- Account timeline: most-recent-first listing per account
create index if not exists ai_analysis_runs_account_created_idx
  on ai_analysis_runs (account_id, created_at desc);

-- Status filter: find pending/running/failed runs across all accounts
create index if not exists ai_analysis_runs_status_idx
  on ai_analysis_runs (status);

comment on table ai_analysis_runs is 'AI analysis invocation log. One row per call to a model runner. Stage A2 begins populating this table; Stage A1 only creates the schema.';
comment on column ai_analysis_runs.input_snapshot_id is 'Optional pointer to a snapshot row (e.g. performance_snapshots.id) describing exactly what the model saw. Soft reference — not enforced as a foreign key because target tables vary by runner.';
comment on column ai_analysis_runs.input_summary_json is 'Compact summary of the inputs (campaign IDs, date windows, top-level metrics) for fast browsing without rehydrating full snapshots.';
comment on column ai_analysis_runs.output_json is 'Structured output returned by the model (recommended actions, conclusions, confidence). Free-form per runner; runner-specific schema lives in code.';

-- ============================================================
-- Post-migration verification:
-- SELECT count(*) FROM ai_analysis_runs;  -- expect 0 (no rows yet)
-- ============================================================
