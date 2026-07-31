# Environment & Access Checklist — Prime (FPB Marketing Bot)

Brian supplies owner-only values. After values arrive, agents verify presence, safely test
connectivity, validate permissions, report ONLY what is missing or invalid, and continue
autonomously.

**Hard rules:** actual secret values are NEVER committed, never pasted into prompts, logs,
docs, screenshots, or evidence. **This file lists names and metadata only.** Agents never
print an env value, and `hooks/danger-guard.js` blocks reads of `.env` / `printenv` /
`gh secret set` at the tool layer.

Inventory below is derived from a live grep of `process.env.*` across `api/`, `src/`, and
`scripts/` on 2026-07-28 — it is what the code actually reads, not what documentation
claims. Statuses: MISSING → SUPPLIED → VERIFIED → INVALID (with reason).

## Variables & Credentials — in production today

| Variable | Purpose | Env(s) | Secret? | Cost | Safe validation method | Status |
|----------|---------|--------|---------|------|----------------------|--------|
| `SUPABASE_URL` | Prime project endpoint (`olpyqfuphiwdongzmazi`) | dev/prod | no | $0 | `GET /rest/v1/` returns 200 | VERIFIED (in use) |
| `SUPABASE_SERVICE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Service-role DB access. **Bypasses RLS** — see R-003 | dev/prod | **yes** | $0 | single-row `select` against `accounts` | VERIFIED (in use) |
| `CRM_SUPABASE_URL` | FPB CRM project (`flabvhdgqddbfitbqjqk`) for the lead-outcome bridge | prod | no | $0 | `GET /rest/v1/` returns 200 | VERIFIED (in use) |
| `CRM_SUPABASE_SERVICE_KEY` | CRM read access (sold status, booked_revenue, gross_profit) | prod | **yes** | $0 | single-row `select`, read-only | VERIFIED (in use) |
| `ANTHROPIC_API_KEY` | Chat + analysis model calls (`api/chat.js`, `analyze-ads.js`) | dev/prod | **yes** | **metered** — logged to `cost_api_events` | 1-token `messages` call | VERIFIED (in use) |
| `GOOGLE_ADS_CLIENT_ID` | OAuth client | dev/prod | no | $0 | token refresh round-trip | VERIFIED (in use) |
| `GOOGLE_ADS_CLIENT_SECRET` | OAuth client secret | dev/prod | **yes** | $0 | token refresh round-trip | VERIFIED (in use) |
| `GOOGLE_ADS_REFRESH_TOKEN` | Long-lived OAuth grant | dev/prod | **yes** | $0 | token refresh round-trip | VERIFIED (in use) |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API v23 developer token | dev/prod | **yes** | $0 | read-only GAQL `campaign` query | VERIFIED (in use) |
| `GOOGLE_ADS_CUSTOMER_ID` | Fallback customer ID. **Prefer `ad_platform_connections`** — CLAUDE.md forbids hardcoded account IDs | prod | no | $0 | read-only GAQL | VERIFIED (in use) |
| `GOOGLE_ADS_MANAGER_ID` | MCC / login-customer-id header | prod | no | $0 | read-only GAQL | VERIFIED (in use) |
| `META_ACCESS_TOKEN` | Meta Graph token (**deprecated v19 — Bug 19**) | prod | **yes** | $0 | `GET /me` | VERIFIED (in use, deprecated API) |
| `META_AD_ACCOUNT_ID` | Meta ad account | prod | no | $0 | read-only insights call | VERIFIED (in use) |
| `META_PAGE_ID` | Meta page for creative | prod | no | $0 | read-only page read | VERIFIED (in use) |
| `AUTH_SECRET` | Session/JWT signing for the admin perimeter | dev/prod | **yes** | $0 | sign+verify a throwaway token | VERIFIED (in use) |
| `ADMIN_PASSWORD` | Dashboard login | prod | **yes** | $0 | login round-trip | VERIFIED (in use) |
| `EXECUTE_SECRET` | `x-execute-secret` gate on execution + creative endpoints (`require-secret.js`) | prod | **yes** | $0 | 401 without / 200 with | VERIFIED (in use) |
| `CRON_SECRET` | `Bearer` auth for cron endpoints alongside `x-vercel-cron` | prod | **yes** | $0 | 401 without / 200 with | VERIFIED (in use) |
| `ALLOWED_ORIGINS` | CORS allowlist (`api/lib/cors.js`) | dev/prod | no | $0 | preflight from a disallowed origin is refused | VERIFIED (in use) |
| `ENABLE_MULTI_ACCOUNT_CRON` | Gates cron fan-out beyond FPB (L-003) | prod | no | $0 | unset ⇒ FPB-only | VERIFIED (in use) — **see preconditions below** |

> ### ⛔ `ENABLE_MULTI_ACCOUNT_CRON` preconditions — must ALL hold before enabling
>
> 1. **(R-015) Scale-invariant scoring.** `min_score_threshold` and the six `risk_penalties`
>    are absolute quantities in profitable-lead units, and deltas scale linearly with spend.
>    **At Weld Workx / FSC's stated $500/mo, a typical waste-removal action scores 0.224 —
>    below the 0.25 threshold.** The loop would propose **nothing, ever**, and an empty queue
>    is indistinguishable from "no opportunities found" (SDR-1). They must become
>    **dimensionless** — a fraction of typical delta at the **tenant's own** scale, the same
>    move as denominating D-12 in foregone leads. **Session S-08A.4.**
>
> ### 🔢 `TENANT_INERTNESS_FLOOR_USD` — a named, ENFORCED quantity
>
> **≈ $558/month** under current constants: `0.25 ÷ 1.12 × 2500`.
>
> Below this monthly budget, a typical waste-removal action scores under
> `min_score_threshold` and **the optimisation loop is inert by arithmetic** — not
> misconfigured, not unlucky: mathematically incapable of proposing routine work.
>
> **Onboarding a tenant below the floor MUST REFUSE, with the stated reason and the computed
> numbers. It must never enable and go quiet.** Enabling-and-silent is the SDR-1 failure in its
> purest form: a tenant that looks live, costs money, and cannot act.
>
> **This floor is itself an SDR-5 instance — it self-applies.** "Typical delta = 1.12" is
> derived from three moving inputs: an assumed $400 cohort, a *measured* host rate of 0.004, and
> a *chosen* efficiency of 0.7. Move any of them and the floor moves:
>
> | Condition | Typical delta | Floor |
> |---|---|---|
> | Baseline (`cpl_target` $50) | 1.120 | **$558/mo** |
> | At `cpl_emergency` $100 | 0.560 | **$1,116/mo** |
> | `reallocation_efficiency` 0.5 | 0.800 | $781/mo |
> | Typical cohort $250 | 0.700 | $893/mo |
>
> **At the emergency CPL band the floor doubles — and FPB's own $2,500 sits only 2.2x above
> it.** A floor that moves by 2x with a band the system already documents cannot be treated as
> a durable constant. Enforce it as a **computed** quantity, never a hardcoded $558, **and treat
> its volatility as the argument for landing dimensionless constants (S-08A.4) sooner rather
> than carrying a drifting floor.**
> 2. **Per-tenant `ad_platform_connections`** present and verified (L-003).
> 3. **Per-tenant CPL bands and monthly cap** tagged CHOSEN with Brian as owner (SDR-5) —
>    FPB's $50/$75/$100 and $2,500 must not be inherited by a $500/mo tenant by default.
>
> **The first non-FPB tenant otherwise onboards to a silently different safety system**: same
> code, same config keys, materially different behaviour — strictly more restrictive, to the
> point of inert. Nothing in the system would report this.
| `OUTCOME_WINDOW_DAYS` | Post-action measurement window for `evaluate-outcomes.js` | prod | no | $0 | read config, no side effect | VERIFIED (in use) |
| `NODE_ENV` | Fail-closed in production; warn-and-allow under `test` (established pattern) | all | no | $0 | n/a | VERIFIED (in use) |
| `IMAGE_PROCESS_SECRET` | Gate on `/api/image-process`; fail-closed in production | prod | **yes** | $0 | 503 when unset in prod (test-covered) | VERIFIED (in use) |
| `LEADS_INGEST_SECRET` | Gate on the lead-ingest endpoint (`require-secret.js`) | prod | **yes** | $0 | 401 without / 200 with | VERIFIED (in use) |

> Inventory method note: `EXECUTE_SECRET`, `IMAGE_PROCESS_SECRET` and `LEADS_INGEST_SECRET`
> are passed to `requireSecret({ envVar: '...' })` as **string literals**, so a
> `process.env.*` grep alone misses them. Any future inventory must grep both forms.

## Variables introduced by Phase A (not yet provisioned)

| Variable | Purpose | Secret? | Fail-safe behavior | Needed by session | Status |
|----------|---------|---------|--------------------|-------------------|--------|
| `PRIME_KILL_SWITCH` | Global execution halt consulted by every executor | no | **Unreadable ⇒ treat as ON (halt).** Matches the coordinator's fail-safe philosophy | S-09A | MISSING |
| `PRIME_OPTIMIZE_ENABLED` | Enables the daily optimization loop | no | Unset ⇒ loop does not run | S-08B | MISSING |
| `PRIME_WATCH_ENABLED` | Enables the hourly watch loop | no | Unset ⇒ loop does not run | S-09B | MISSING |
| `COST_ALERT_DAILY_USD` | **API/LLM** daily spend ceiling — Anthropic inference, not ad spend (D-6) | no | Unset ⇒ **fail loudly** per SDR-1; never silently unmonitored | S-09A | MISSING — interim **$25** |
| `COST_ALERT_MONTHLY_USD` | **API/LLM** monthly spend ceiling (D-6) | no | Unset ⇒ fail loudly (SDR-1) | S-09A | MISSING — interim **$250** |
| `COST_ALERT_WARN_PCT` | Warn threshold on either ceiling (D-6) | no | Defaults to 80 | S-09A | MISSING — **80** |

> **The two ceilings are different budgets belonging to different parties — never merge them.**
> `COST_ALERT_*` bounds **Prime's own operating cost** (Anthropic inference). The **$2,500/month
> Google Ads cap is FPB's ad spend**, lives in `agent_config` + `accounts.daily_spend_cap`, and
> is enforced by `budget-guards.js` — not by an env var. `PRIME-STRATEGY.md` §6 is explicit:
> *"Not tracked as Prime cost: Client ad spend. That's the client's money."* See D-6 and D-12.

**No new credentials and no new paid tool** are introduced by Phase A or by the
chat-surface amendment. S-07f.1 / S-07g / S-07h add no environment variables: the fetch
cache is a Supabase table and its limits live in `agent_config`, not in the environment.

## Vendor Accounts (owner-bound)

| Service | Purpose | Account owner | Recurring cost | Approved by Brian |
|---------|---------|--------------|----------------|-------------------|
| Anthropic | Chat + analysis inference | Brian | metered (tracked in `cost_api_events`) | yes |
| Supabase | Prime DB (`olpyqfuphiwdongzmazi`) + FPB CRM (`flabvhdgqddbfitbqjqk`) | Brian | subscription | yes |
| Vercel | Hosting, crons, preview deploys | Brian | subscription | yes |
| Google Ads API | Campaign read + mutate (v23) | Brian | $0 API; **ad spend is FPB's money, not a Prime cost** | yes |
| Meta Graph API | Meta read/creative (deprecated v19, Bug 19) | Brian | $0 API | yes |

## Environments

| Environment | Host | Deploy trigger | Who may deploy | Rollback method |
|-------------|------|---------------|----------------|-----------------|
| local dev | `vite` / `npm run dev` | manual | agents (autonomous) | n/a |
| preview | Vercel | push to a feature branch | agents may push **feature branches only** | delete the preview |
| production | Vercel | **push to `main`** — auto-deploy | **Brian only.** Agents never push to `main`; `hooks/git-guard.js` blocks it | Vercel rollback — Brian only |

**Because production auto-deploys on push to `main`, a merge is a deploy.** That is why
merge authority is held by Brian, `gh pr merge` is hook-blocked, and
`--dangerously-skip-permissions` is never used on FPB repos.

## Database change protocol

SQL is **always** written to `sql/NNN_name.sql` and applied manually by Brian in the
Supabase SQL editor. No agent applies a migration, ever. Migrations are idempotent
(`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO UPDATE`) and carry a post-migration
verification query. Current sequence: `001`–`018`, `020`. **`019` is unused** — it was
reserved in `HARNESS-PHASE-A.md` §3.2 for the S-09A watch-incident/alert-dedup table and
is still free; S-07f.1's fetch-cache table should therefore take `021`.
