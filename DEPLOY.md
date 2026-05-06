# FPB Marketing Bot — Deployment Checklist

## Required Environment Variables

Set all of the following in the Vercel project settings before deploying to production.

### Supabase
| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — bypasses RLS; never expose to browser |
| `VITE_SUPABASE_URL` | Same URL — exposed to Vite frontend build |
| `VITE_SUPABASE_ANON_KEY` | Anon key — safe for client-side reads only |

### Execution Security
| Variable | Description |
|---|---|
| `EXECUTE_SECRET` | Random 32+ character secret. Guards `/api/execute-action`, `/api/meta-creative`, `/api/create-facebook-campaign`, `/api/create-google-campaign`. |
| `VITE_EXECUTE_SECRET` | **Removed from production** as of Attribution Sprint 1. The chat ActionCard now creates a DB action and uses `/api/approve-action` (no secret). Do not set this in Vercel. |

### Lead Ingestion
| Variable | Description |
|---|---|
| `LEADS_INGEST_SECRET` | Required. Secret sent as `x-leads-ingest-secret` header with every webhook POST to `/api/leads`. If not set, the endpoint warns in logs and accepts any POST — set before going live. |

> **Cross-project requirement:** This exact value must be set in **two places**:
> 1. **Vercel** — `LEADS_INGEST_SECRET` environment variable in the marketing bot project settings. Redeploy after changing.
> 2. **FPB website (WordPress)** — as the `x-leads-ingest-secret` request header value in each Gravity Forms webhook and in the CallRail webhook secret header. Update these before rotating the secret.
>
> If the values don't match, all form and call webhooks will be rejected with 401.

### Attribution
| Variable | Description |
|---|---|
| `OUTCOME_WINDOW_DAYS` | Optional. Number of days in each measurement window for `evaluate-outcomes`. Defaults to `7`. |
| `CRON_SECRET` | Bearer token for triggering cron endpoints manually (same value used by cron-analyze). |

### Google Ads
| Variable | Description |
|---|---|
| `GOOGLE_ADS_CLIENT_ID` | OAuth2 client ID from Google Cloud Console |
| `GOOGLE_ADS_CLIENT_SECRET` | OAuth2 client secret |
| `GOOGLE_ADS_REFRESH_TOKEN` | Long-lived refresh token for the Ads account |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API developer token |
| `GOOGLE_ADS_CUSTOMER_ID` | Ads customer account ID (dashes optional) |
| `GOOGLE_ADS_MANAGER_ID` | MCC/manager account ID if using a manager account (optional) |

### Meta / Facebook
| Variable | Description |
|---|---|
| `META_ACCESS_TOKEN` | Long-lived Meta system user token (never a short-lived user token) |
| `META_AD_ACCOUNT_ID` | Ad account ID — with or without `act_` prefix |
| `META_PAGE_ID` | Facebook Page ID used as the ad's page identity |

### Anthropic (AI)
| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude campaign analysis |

---

## Pre-Deploy Steps

1. **Run tests:** `npm install && npm test` — all tests must pass before deploying
2. **Check verify-safety:** After deploy, hit `GET /api/verify-safety` and confirm `overall: "PASS"`
3. **Run new migrations:** In Supabase SQL Editor, run in order:
   - `sql/001_leads.sql` — creates the `leads` table (includes `dedup_key`, `ingest_source` columns)
   - `sql/002_action_outcomes.sql` — creates the `action_outcomes` table
   - `sql/003_campaign_daily_stats.sql` — creates the `campaign_daily_stats` table
4. **Check Supabase schema:** Ensure the `actions` table has these columns:
   - `id` (uuid, PK), `status` (text), `action_type` (text), `execution_result` (text, nullable)
   - `execution_data` (jsonb), `execution_error` (text, nullable)
   - `reviewed_at` (timestamptz), `executed_at` (timestamptz), `created_at` (timestamptz)
   - `channel` (text), `title` (text), `description` (text), `priority` (text), `auto_execute` (boolean)
4. **Check `automation_log` table** has: `event_type`, `platform`, `status`, `description`, `metadata` (jsonb), `created_at`, `action_id`

---

## Secret Rotation

When rotating `EXECUTE_SECRET`:
1. Generate new value: `openssl rand -hex 32`
2. Set `EXECUTE_SECRET` in Vercel → Redeploy
3. Remove the old value from all scripts/cron triggers that send `x-execute-secret`
4. Update any internal API clients using the old secret

When rotating `META_ACCESS_TOKEN`:
- Use Meta Business Suite → System Users to generate a new non-expiring token
- Update in Vercel → Redeploy

When rotating Google credentials:
- Revoke old refresh token in Google Cloud Console
- Re-run the OAuth flow to generate a new `GOOGLE_ADS_REFRESH_TOKEN`

---

## Post-Deploy Verification

```
# 1. Safety checks
curl https://your-app.vercel.app/api/verify-safety | jq .

# 2. Confirm pending actions load
curl https://your-app.vercel.app/api/actions?status=pending | jq .

# 3. Confirm mutation endpoints are protected (should return 401)
curl -X POST https://your-app.vercel.app/api/execute-action \
  -H "Content-Type: application/json" \
  -d '{"actionId":"test"}' | jq .
```

Expected: `{ "success": false, "error": "Unauthorized" }` for step 3.

---

## Wiring FPB Website Forms (Gravity Forms)

1. In WordPress Admin → Gravity Forms → select form → Settings → Webhooks → Add New
2. Set:
   - **Request URL:** `https://your-app.vercel.app/api/leads`
   - **Request Method:** POST
   - **Request Format:** JSON
   - **Request Headers:** `x-leads-ingest-secret: <LEADS_INGEST_SECRET value>`
3. Field mapping: leave blank (sends full entry payload). The normalizer handles all standard field names.
4. Enable "Send values from all fields."
5. Test: submit a test entry and check `/api/leads?limit=5` in the dashboard.

**UTM pass-through:** Add a hidden field in Gravity Forms populated by `gclid`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`. Map `source_url` to a hidden field with the full page URL. The normalizer parses UTMs from the landing page URL automatically.

## Wiring CallRail

1. In CallRail → Settings → Integrations → Webhooks → Add Webhook
2. Set:
   - **Post URL:** `https://your-app.vercel.app/api/leads`
   - **Secret header:** `x-leads-ingest-secret: <LEADS_INGEST_SECRET value>`
   - **Events:** `calls.completed` (to capture completed calls only)
3. CallRail sends `caller_number`, `tracking_source`, `utm_source`, `utm_campaign` automatically.

## Manually Qualifying Leads (Dashboard)

1. Open the Attribution tab
2. Find the lead in the Recent Leads table
3. Click **Edit** to open the inline form
4. Set **Status** to `qualified`, `booked`, or `lost`
5. If booked, enter **Booked Revenue** and **Gross Profit**
6. Click **Save**

The outcome evaluator will use `qualified` and `booked` lead counts for cost-per-qualified-lead calculations.

## campaign_daily_stats Behavior

- Written automatically every day when `cron-analyze` runs (daily 12:30 UTC)
- One row per platform × campaign × date
- Uses upsert — safe to run multiple times per day (last-write-wins)
- The outcome evaluator prefers this table over `performance_snapshots` for spend data
- `performance_snapshots` is kept as a fallback and for historical data

---

## Known Limitations and Productization Gaps

### Auth (High Priority)
- **`/api/approve-action` has no session auth.** Any caller who knows a valid `actionId` can trigger execution. Idempotency lock prevents double-execution, but the endpoint is not protected against unauthorized callers who can enumerate action IDs.
  - **Fix:** Add Supabase Auth or a session cookie check. Users must be authenticated before calling approve-action.

- **`VITE_EXECUTE_SECRET` has been removed** as of Lead Ingestion Sprint 1. The chat ActionCard now creates a DB action then calls `/api/approve-action`. No client secret is needed.

- **`/api/leads` PATCH is unauthenticated.** Any caller with a valid lead UUID can update qualification status or revenue.
  - **Fix:** Add Supabase Auth session check before PATCH.

### Multi-tenancy
- The system has no concept of users or organizations. All actions and logs are shared in a single Supabase table.
  - **Fix:** Add a `user_id` or `org_id` column to `actions` and `automation_log`; filter all queries by the authenticated user.

### Campaign Validation
- `create_meta_campaign` creates campaigns immediately on approval with no dry-run or preview step.
  - **Fix:** Add a `preview_only` flag to the execution flow; require a second confirmation for new campaign creation.

### Rate Limiting
- No per-endpoint rate limiting. A burst of browser requests could exhaust Meta/Google API quotas.
  - **Fix:** Add Vercel Edge middleware for rate limiting, or move execution to a queue (e.g., Inngest, Trigger.dev).

### Error Recovery
- Failed executions (execution_result = error string) have no retry mechanism in the dashboard. Users must re-create the action manually.
  - **Fix:** Add a "Retry" button in the Actions panel that resets `execution_result` to `null` for failed (non-final) actions.

### Tests
- Test coverage is minimal (state machine logic + behavioral mocks). There are no integration tests against a real Supabase instance or Meta/Google sandboxes.
  - **Fix:** Add CI integration tests with Supabase test project and Meta test ad accounts.
