-- ============================================================
-- Migration 006: ad_platform_connections table
--
-- One row per (account, ad platform) pairing. Stores the external
-- account identifier the bot uses for that platform, plus references
-- to credentials needed to call the platform's API on the account's
-- behalf.
--
-- Phase 1 Stage A1: schema only. The accounts helper module
-- (api/lib/accounts.js) resolves env: references at runtime; no route
-- behavior changes in this stage.
--
-- Run in Supabase SQL editor after sql/005_accounts.sql.
-- ============================================================

-- Convention:
--   * Non-secret IDs (Google customer/manager IDs, Meta ad account IDs that are widely known)
--     should be stored as plain values when possible.
--   * Secret IDs and tokens are stored as env references like 'env:VAR_NAME'.
--     The accounts helper module resolves these at runtime via process.env.
--
-- TODO: replace 'env:META_AD_ACCOUNT_ID' with the plain Meta ad account ID
-- once the value is confirmed and not considered sensitive.

create table if not exists ad_platform_connections (
  id                          uuid primary key default gen_random_uuid(),

  -- Linkage
  account_id                  uuid not null references accounts(id) on delete restrict,
  platform                    text not null,

  -- External identity on the platform
  account_id_external         text,
  account_name                text,
  manager_account_id          text,

  -- Connection state
  connection_status           text not null default 'pending',
  access_token_reference      text,
  refresh_token_reference     text,
  permissions_json            jsonb,
  last_sync_at                timestamptz,
  last_error                  text,

  -- Lifecycle
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  -- Named constraints
  constraint ad_platform_connections_platform_check
    check (platform in ('google_ads','meta_ads')),
  constraint ad_platform_connections_status_check
    check (connection_status in ('pending','active','error','disconnected'))
);

-- Unique index: one connection per (account, platform)
create unique index if not exists ad_platform_connections_account_platform_uidx
  on ad_platform_connections (account_id, platform);

-- Lookup index for "all connections for this account"
create index if not exists ad_platform_connections_account_id_idx
  on ad_platform_connections (account_id);

-- ============================================================
-- Seed connections for Florida Pole Barn (idempotent)
-- ============================================================

-- FPB → Google Ads
-- Customer ID 8325311811 and manager ID 5435219372 are FPB Builders'
-- production identifiers; both are non-secret and stored as plain values.
-- The OAuth refresh token lives in env:GOOGLE_ADS_REFRESH_TOKEN; the
-- runtime exchanges it for short-lived access tokens, so both
-- access_token_reference and refresh_token_reference point at the same
-- env var here.
insert into ad_platform_connections (
  account_id,
  platform,
  account_id_external,
  manager_account_id,
  connection_status,
  access_token_reference,
  refresh_token_reference
)
values (
  (select id from accounts where slug = 'fpb'),
  'google_ads',
  '8325311811',
  '5435219372',
  'active',
  'env:GOOGLE_ADS_REFRESH_TOKEN',
  'env:GOOGLE_ADS_REFRESH_TOKEN'
)
on conflict (account_id, platform) do nothing;

-- FPB → Meta Ads
-- account_id_external is currently an env reference; see TODO at top
-- of file to replace with a plain value once confirmed non-sensitive.
insert into ad_platform_connections (
  account_id,
  platform,
  account_id_external,
  connection_status,
  access_token_reference
)
values (
  (select id from accounts where slug = 'fpb'),
  'meta_ads',
  'env:META_AD_ACCOUNT_ID',
  'active',
  'env:META_ACCESS_TOKEN'
)
on conflict (account_id, platform) do nothing;

comment on table ad_platform_connections is 'Per-(account, platform) external identity and credential references. One row per platform per account.';
comment on column ad_platform_connections.account_id_external is 'Platform-side account identifier (Google Ads customer ID, Meta ad account ID). Plain value when non-secret; otherwise env: reference.';
comment on column ad_platform_connections.manager_account_id is 'Optional MCC / business manager ID required by some platforms (e.g. Google Ads login-customer-id).';
comment on column ad_platform_connections.access_token_reference is 'Either an env: reference (resolved at runtime) or a placeholder for future encrypted-vault storage. Never store raw tokens here.';
comment on column ad_platform_connections.refresh_token_reference is 'Same convention as access_token_reference. May point at the same env var when the platform refresh token is the long-lived credential.';

-- ============================================================
-- Post-migration verification:
-- SELECT count(*) FROM ad_platform_connections;  -- expect 2 (FPB google + meta)
-- SELECT a.slug, c.platform, c.connection_status
--   FROM ad_platform_connections c
--   JOIN accounts a ON a.id = c.account_id
--   ORDER BY a.slug, c.platform;
-- ============================================================
