// scripts/preflight-b1-check.mjs
//
// Stage B1 preflight: verifies the FPB account row and ad_platform_connections
// rows resolve correctly BEFORE any code that depends on them is deployed.
//
// Prints presence/absence (yes/no) for each required field. Never prints
// secret values themselves.
//
// Usage (Windows PowerShell):
//   vercel env pull .env.local      # pulls production env into .env.local
//   node scripts/preflight-b1-check.mjs
//
// Exit codes:
//   0 — all checks passed
//   1 — at least one presence check failed (env var unset, row missing, etc.)
//   2 — script could not run (no SUPABASE_URL, DB query error, etc.)
//
// Deliberate deviations from the original plan, for portability:
//   - .mjs extension (package.json has no "type":"module")
//   - inline .env / .env.local reader (avoids dotenv dependency)
//   - inline env: reference resolver (mirrors api/lib/accounts.js exactly)

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const projectRoot  = resolve(__dirname, '..');

// ── Tiny .env loader (no dotenv dep) ─────────────────────────────────────
// Loads KEY=value lines into process.env without overriding values already
// set by the caller's shell. Strips surrounding single or double quotes.
function loadEnvFile(file) {
  if (!existsSync(file)) return false;
  const text = readFileSync(file, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
  return true;
}

const envLocalPath = resolve(projectRoot, '.env.local');
const envPath      = resolve(projectRoot, '.env');
const loadedLocal  = loadEnvFile(envLocalPath);
const loadedDotenv = loadEnvFile(envPath);

const envSourceLabel = loadedLocal
  ? '.env.local'
  : loadedDotenv
    ? '.env'
    : '(no .env file found — using process.env only)';

// ── Inline env: reference resolver (mirrors api/lib/accounts.js) ─────────
function resolveEnvRef(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  if (!value.startsWith('env:')) return value;
  const envValue = process.env[value.slice(4)];
  if (envValue == null || envValue === '') return null;
  return envValue;
}

// ── Supabase client ──────────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('\nFAIL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) must be set.');
  console.error(`Env source attempted: ${envSourceLabel}`);
  console.error('\nFix: from the project root, run');
  console.error('   vercel env pull .env.local');
  console.error('then re-run this script.\n');
  process.exit(2);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Checks ───────────────────────────────────────────────────────────────
const checks = [];
function add(label, ok) { checks.push([label, !!ok]); }

async function main() {
  console.log(`\nStage B1 Preflight Check`);
  console.log(`  env source: ${envSourceLabel}`);
  console.log(`  supabase:   ${supabaseUrl}\n`);

  // FPB account
  const { data: fpb, error: fpbErr } = await supabase
    .from('accounts')
    .select('id, slug, status')
    .eq('slug', 'fpb')
    .maybeSingle();

  if (fpbErr) {
    console.error(`accounts query failed: ${fpbErr.message}`);
    process.exit(2);
  }

  add('FPB account exists', !!fpb);
  if (!fpb) {
    print();
    process.exit(1);
  }
  add(`FPB status === active (got: ${fpb.status})`, fpb.status === 'active');

  // FPB Google Ads connection
  const { data: google, error: gErr } = await supabase
    .from('ad_platform_connections')
    .select('account_id_external, manager_account_id, refresh_token_reference, access_token_reference, connection_status')
    .eq('account_id', fpb.id)
    .eq('platform', 'google_ads')
    .maybeSingle();

  if (gErr) {
    console.error(`google_ads connection query failed: ${gErr.message}`);
    process.exit(2);
  }

  add('FPB google_ads connection exists', !!google);
  if (google) {
    add(`  google_ads connection_status === active (got: ${google.connection_status})`,
        google.connection_status === 'active');
    add('  resolved_account_id_external present', !!resolveEnvRef(google.account_id_external));
    add('  resolved_manager_account_id present',  !!resolveEnvRef(google.manager_account_id));
    add('  resolved_refresh_token present',       !!resolveEnvRef(google.refresh_token_reference));
  }

  // FPB Meta Ads connection
  const { data: meta, error: mErr } = await supabase
    .from('ad_platform_connections')
    .select('account_id_external, manager_account_id, refresh_token_reference, access_token_reference, connection_status')
    .eq('account_id', fpb.id)
    .eq('platform', 'meta_ads')
    .maybeSingle();

  if (mErr) {
    console.error(`meta_ads connection query failed: ${mErr.message}`);
    process.exit(2);
  }

  add('FPB meta_ads connection exists', !!meta);
  if (meta) {
    add(`  meta_ads connection_status === active (got: ${meta.connection_status})`,
        meta.connection_status === 'active');
    add('  resolved_account_id_external present', !!resolveEnvRef(meta.account_id_external));
    add('  resolved_access_token present',        !!resolveEnvRef(meta.access_token_reference));
  }

  // Legacy env vars (still used by code paths Stage B1 will replace)
  add('Legacy GOOGLE_ADS_REFRESH_TOKEN present', !!process.env.GOOGLE_ADS_REFRESH_TOKEN);
  add('Legacy GOOGLE_ADS_CUSTOMER_ID present',   !!process.env.GOOGLE_ADS_CUSTOMER_ID);
  add('Legacy GOOGLE_ADS_MANAGER_ID present',    !!process.env.GOOGLE_ADS_MANAGER_ID);
  add('Legacy GOOGLE_ADS_DEVELOPER_TOKEN present', !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN);
  add('Legacy GOOGLE_ADS_CLIENT_ID present',     !!process.env.GOOGLE_ADS_CLIENT_ID);
  add('Legacy GOOGLE_ADS_CLIENT_SECRET present', !!process.env.GOOGLE_ADS_CLIENT_SECRET);
  add('Legacy META_ACCESS_TOKEN present',        !!process.env.META_ACCESS_TOKEN);
  add('Legacy META_AD_ACCOUNT_ID present',       !!process.env.META_AD_ACCOUNT_ID);
  add('Legacy META_PAGE_ID present',             !!process.env.META_PAGE_ID);

  print();
  const allPass = checks.every(([, v]) => v);
  process.exit(allPass ? 0 : 1);
}

function print() {
  for (const [label, value] of checks) {
    console.log(`  ${value ? '✓' : '✗'} ${label}`);
  }
  console.log();
}

main().catch(err => {
  console.error(`\nPreflight crashed: ${err.message}`);
  process.exit(2);
});
