-- ============================================================
-- Migration 013: chat_messages — conversational AI session history
--
-- Lands the chat_messages table required by api/chat.js.
-- Without this table the chat preflight returns 503
-- FEATURE_NOT_CONFIGURED and the Chat tab is non-functional.
--
-- Table created:
--   chat_messages — per-session conversation turns (user + assistant)
--
-- Indexes created:
--   chat_messages_session_id_idx — (session_id, created_at ASC)
--     fast load of a single conversation by session
--   chat_messages_account_idx    — (account_id, created_at DESC)
--     fast account-scoped history listing
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
  RAISE NOTICE 'Migration 013 pre-check: chat_messages exists = %',
    (SELECT to_regclass('public.chat_messages') IS NOT NULL);
END $$;

-- ============================================================
-- Table: chat_messages
-- One row per conversation turn. session_id groups turns into
-- a logical conversation. account_id enforces tenant isolation.
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_messages (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  account_id     uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role           text        NOT NULL,
  content        text        NOT NULL,
  message_type   text        NOT NULL DEFAULT 'text',
  action_payload jsonb       NULL,
  session_id     text        NOT NULL,
  image_data     text        NULL,

  CONSTRAINT chat_messages_role_check
    CHECK (role IN ('user', 'assistant', 'system')),
  CONSTRAINT chat_messages_message_type_check
    CHECK (message_type IN ('text', 'action_request', 'fetching'))
);

CREATE INDEX IF NOT EXISTS chat_messages_session_id_idx
  ON chat_messages (session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS chat_messages_account_idx
  ON chat_messages (account_id, created_at DESC);

-- ============================================================
-- Post-migration verification:
--
-- SELECT COUNT(*) FROM information_schema.columns
--   WHERE table_name = 'chat_messages';
-- -- expect 9 rows (id, created_at, account_id, role, content,
-- --                message_type, action_payload, session_id, image_data)
--
-- SELECT indexname FROM pg_indexes WHERE tablename = 'chat_messages';
-- -- expect: chat_messages_pkey
-- --         chat_messages_session_id_idx
-- --         chat_messages_account_idx
-- ============================================================
