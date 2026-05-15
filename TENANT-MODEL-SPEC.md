# Prime — Tenant Model Spec (Phase 0 Sub-Task 2A)

Owner: Brian Sidenberg
Author: Claude Code
Date: 2026-05-14
Status: **Draft for review** — Phase 2B implementation gated on Brian's approval
References: `PRIME-STRATEGY.md` v1.0, `AUDIT-PHASE-0.md` Section 11

This spec encodes the tenant-model design that will be implemented in Phase 2B. The decisions Brian locked before drafting are encoded as-is and not re-debated. Open questions Brian must answer before Phase 2B runs are listed in Section 6.

---

## 1. Tenant model — schema design

### 1.1 New columns on `accounts`

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| `parent_account_id` | `uuid` | yes | `null` | Child accounts point to parent; parent rows have `null` |
| `product_line` | `text` | yes | `null` | e.g. `'kits'`, `'turnkey'`; `null` for parent rows that represent the brand at large |

### 1.2 Foreign key + indexes

- FK `accounts_parent_account_id_fkey`: `parent_account_id REFERENCES accounts(id) ON DELETE RESTRICT`
  - `RESTRICT` not `CASCADE`: deleting a parent that still has children is a strong signal of operator error and should fail loudly. Children must be removed or re-parented first.
- Index `accounts_parent_account_id_idx` on `(parent_account_id)`: enables "list children of FPB" queries in O(log n) without a sequential scan.
- No index on `product_line` — low cardinality (`null`, `'kits'`, `'turnkey'`, eventually a handful more), unlikely to drive a query pattern that needs an index.

### 1.3 One-level-deep constraint

A child cannot itself be a parent. Two invariants:
- Inserting/updating a row to set `parent_account_id` to an account that itself has a non-null `parent_account_id` is rejected.
- Setting `parent_account_id` on a row that already has children is rejected.

**Implementation: trigger.** A check constraint can't reference other rows in the same table, so the cleanest enforcement is a `BEFORE INSERT OR UPDATE OF parent_account_id` trigger. Sketch:

```sql
CREATE OR REPLACE FUNCTION accounts_enforce_one_level_hierarchy()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_account_id IS NOT NULL THEN
    -- Reject pointing at a row that itself has a parent
    IF EXISTS (
      SELECT 1 FROM accounts
      WHERE id = NEW.parent_account_id AND parent_account_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION
        'parent_account_id (%) refers to an account that itself has a parent — only one level of hierarchy allowed',
        NEW.parent_account_id;
    END IF;

    -- Reject becoming a child if this row already has children
    IF EXISTS (
      SELECT 1 FROM accounts WHERE parent_account_id = NEW.id
    ) THEN
      RAISE EXCEPTION
        'Cannot set parent_account_id on account % — it already has child accounts',
        NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Rationale: triggers in Postgres are cheap, reliable, and produce loud errors on violation. Application-layer-only enforcement would invariably drift over time. A check constraint is technically possible via a stable function but the trigger is more legible.

### 1.4 Migration filename + idempotency

- Filename: `sql/009_parent_account_id.sql`
- Idempotent: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER`
- Re-runnable: yes — the file should be safe to copy-paste into Supabase SQL Editor twice without error
- The data inserts and updates in Section 3 ship in the same migration file — one atomic unit per Sub-Task

---

## 2. Tenant model — semantic rules

These behaviors lock against future sub-tasks (Sub-Task 3 brand voice, Sub-Task 5 autonomy posture). Each rule is followed by its rationale.

### 2.1 Account selector UI

**Recommendation: flat list with hyphen-suffix names.** No visual indentation, no expand/collapse.

The data model already encodes hierarchy in the `name` field — "Florida Pole Barn" vs "Florida Pole Barn — Kits". The dashboard's existing `AccountSelector` (`marketing-bot-dashboard.jsx:23-48`) is a `<select>` for 2+ accounts. Keep that pattern and rely on naming to convey relationship.

Rationale:
- Three to six tenants in Phase 1 doesn't justify hierarchical UI complexity.
- Each account is operated independently most of the time. The selector picks one focus.
- Hierarchical UI implies parent rollup behavior. Phase 0 doesn't ship rollup (see 2.5).
- If/when 20+ tenants exist, revisit. Until then, flat list keeps the selector glanceable.

### 2.2 Default account on dashboard load

**Recommendation: keep current behavior unchanged.** First-load default = `'fpb'` if no localStorage; otherwise the previously-selected slug (`marketing-bot-dashboard.jsx:2688-2700`).

Rationale:
- No reason to re-default to "parent" on every load — Brian works on whichever tenant has active work.
- The localStorage persistence is the right primitive. New tenants don't disrupt it.
- If the persisted slug points at a tenant that has been archived or removed, fall back to FPB. (Adds one validation step in the existing fetch effect — minor change, worth doing as part of Sub-Task 7.)

### 2.3 Brand voice inheritance

**Recommendation: inherit-with-overrides (parent → child).**

When FPB Kits has its own voice spec, that spec inherits FPB parent's spec field-by-field, then applies child-specific overrides. Override semantics: any field present in the child spec replaces the parent field; any field absent in the child spec falls through to the parent.

Schema sketch (locked here so Sub-Task 3 builds against it):

```sql
CREATE TABLE brand_voices (
  account_id    uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  spec_json     jsonb NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
```

Resolution function (Sub-Task 3 will build this):
1. Look up `brand_voices` row for `account_id`.
2. If the account has `parent_account_id`, look up parent's `brand_voices` row.
3. Deep-merge parent spec under child spec (child wins on every field; child can also explicitly null out a parent field by setting it to `null`).

Rationale:
- FPB Turnkey and FPB Kits share Florida market context, competitor list, hurricane-rated framing, AG-exemption framing, FPB CRM economics.
- They differ on: deal size ($20–50K vs $10K), audience (small business / farmers vs DIY homeowners / landowners), creative direction (turnkey project pride vs DIY satisfaction), priority intent keywords.
- Stand-alone specs would duplicate ~80% of content and drift apart silently. Inherit-with-overrides keeps both honest.
- For Weld and FSC (no parent), the resolution is just "load child spec" — parent path is skipped. Same code path, no special case.

### 2.4 Cost allocation

**Recommendation: caller-account wins. Always tag the cost row with the `account_id` that initiated the work.**

When the bot makes an Anthropic call to analyze FPB Kits' ad performance, the cost row gets `account_id = FPB Kits`. If a future cross-tenant analysis explicitly compares Weld to FSC, the agent that initiated it tags both — log two cost rows, one per tenant, splitting the call's tokens 50/50, OR tag a single row with the parent of the comparison context.

Rationale:
- 99% of agent work is per-tenant. The simple rule covers 99% of cases.
- "Shared infrastructure" costs (Vercel, Supabase fixed) are not Anthropic-call costs — those flow into Sub-Task 4's `cost_subscriptions` table and are split evenly across active tenants in the rollup, not at write time.
- Parent vs child for shared work: today there is no shared work that crosses parent/child within a single brand. When/if a future "analyze all FPB" view runs, that's a parent-tagged Anthropic call. The system supports this naturally.
- Avoid splitting at write time: it muddies the audit trail. Each row should have one owning account. Allocation logic lives in the rollup, not the row.

### 2.5 Cross-account aggregation queries

**Recommendation: explicit-only. Selection in the dashboard is per-row; selecting FPB does NOT include FPB Kits unless the user explicitly opts into a "parent rollup" view.**

Phase 0 ships only the schema columns. The "show me all FPB activity" rollup is a future sub-task (Phase 1 or Phase 2 once the value is real).

Rationale:
- Default behavior should match the existing single-account semantics so the multi-tenant retrofit doesn't change historical numbers.
- Implicit aggregation creates measurement ambiguity ("are these CPL numbers FPB-only or FPB+Kits combined?"). Strategy doc Section 5 is firm that metrics are per-tenant.
- A parent-rollup view, when it ships, must be visually distinct (e.g. a dedicated "FPB Family" tab) so there's no ambiguity about scope.

What this rules out for Phase 0:
- The Overview tab does NOT auto-roll-up parent + child stats.
- The selector shows parent and child as separate rows — selecting one shows that row's data only.

### 2.6 Autonomy posture inheritance (Sub-Task 5 lock)

**Recommendation: per-account-row, independent. No parent → child inheritance.**

Each account row has its own posture per pillar per action class. FPB Kits graduates independently of FPB Turnkey. Deleting a parent's posture has no effect on children.

Rationale:
- Parent and child are economically distinct. FPB Turnkey may already be at full autonomy on `pause_campaign` after a year of baseline. FPB Kits, brand-new, has zero history and starts at recommend-only.
- Inheritance would couple risk profiles that should stay independent.
- The graduation rule (20 cycles, 95% success) applies per (account × pillar × action class) — borrowed history from a sibling would break the 20-cycle invariant.

Sub-Task 5 schema sketch (informational, Sub-Task 5 will own):

```sql
autonomy_posture (
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  pillar text NOT NULL,
  action_class text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('recommend', 'full')),
  cycles_completed int NOT NULL DEFAULT 0,
  success_count int NOT NULL DEFAULT 0,
  last_evaluated_at timestamptz,
  PRIMARY KEY (account_id, pillar, action_class)
);
```

No `parent_account_id` reference. Each row is sovereign.

---

## 3. Data inserts — exact SQL (for Phase 2B)

All SQL below ships in `sql/009_parent_account_id.sql`. Brian applies the file once in Supabase SQL Editor.

### 3.1 FPB parent account update

No row update needed. The existing FPB row (slug `'fpb'`) keeps `parent_account_id = NULL` and the new `product_line` column defaults to `NULL`. The parent row implicitly represents "FPB at large" (currently de facto FPB Turnkey since that's the only product getting ad spend) until Phase 3 introduces an explicit FPB Turnkey child.

**Rationale for not setting `product_line = 'turnkey'` on parent today:** Brian's locked decision (point 8) is that no Turnkey child row exists in Phase 0. If we set `product_line = 'turnkey'` on the parent now, then in Phase 3 when we add a Turnkey child, the parent would still claim to be Turnkey and the child would also be Turnkey — semantically muddled. Leaving the parent's `product_line` NULL keeps the parent as "the brand at large" while specific products (FPB Kits, eventually FPB Turnkey) live as children.

### 3.2 FPB Kits new account row

```sql
INSERT INTO accounts (
  name,                            slug,             industry,
  website_domain,                  primary_location, service_area,
  reporting_timezone,              monthly_budget,   monthly_spend_cap,
  daily_spend_cap,                 target_cost_per_lead,
  target_cost_per_qualified_lead,  target_cost_per_booked_job,
  autonomy_level,                  status,
  parent_account_id,               product_line
)
VALUES (
  'Florida Pole Barn — Kits',      'fpb-kits',       'Pole Barn Kits (DIY)',
  -- website_domain: OPEN — see Section 6.1
  NULL,                            'Central Florida','Florida statewide',
  'America/New_York',              500,              500,
  -- daily_spend_cap conservatively = monthly / 30, rounded:
  17,                              50,
  -- CPL targets — see Section 6.2:
  100,                             400,
  'level_1_diagnostics',           'active',
  (SELECT id FROM accounts WHERE slug = 'fpb'),
  'kits'
)
ON CONFLICT (slug) DO NOTHING;
```

Field-by-field commentary (and Brian's confirmations needed in Section 6):

| Field | Value | Source / Note |
|---|---|---|
| `slug` | `'fpb-kits'` | Locked. |
| `name` | `'Florida Pole Barn — Kits'` | Hyphen-suffix per 2.1. |
| `industry` | `'Pole Barn Kits (DIY)'` | Distinct from FPB parent's `'Pole Barn Construction'` to enable industry-specific analysis. |
| `parent_account_id` | FPB.id | Locked. |
| `product_line` | `'kits'` | Locked. |
| `monthly_budget` | `500` | Locked (decision 3). |
| `monthly_spend_cap` | `500` | Recommend equal to monthly_budget for new tenants. Hard cap = no overspend. |
| `daily_spend_cap` | `17` | Defensive default = monthly_budget / 30 rounded. Brian can adjust. |
| `target_cost_per_lead` | `100` | Conservative — kits are an under-marketed product, leads will be more expensive in early discovery. FPB parent target is $50; Kits at $100 is 2x that, reflecting the harder acquisition. |
| `target_cost_per_qualified_lead` | `400` | At ~25% qualification (4× CPL) — conservative until baseline data exists. |
| `target_cost_per_booked_job` | NOT SET | Kit close rate unknown until baseline; leave NULL until Phase 1 yields data. |
| `target_margin_goal` | NOT SET | Same reasoning. |
| `autonomy_level` | `'level_1_diagnostics'` | Same as FPB parent. Today this column is inert (audit Section 5 finding) so the value is conservative-by-default. |
| `status` | `'active'` | Locked. |
| `reporting_timezone` | `'America/New_York'` | Inherits FPB. |
| `primary_location` | `'Central Florida'` | Inherits FPB. |
| `service_area` | `'Florida statewide'` | Inherits FPB. |
| `website_domain` | NULL | OPEN — Brian needs to confirm whether kits.floridapolebarn.com is going to exist, whether there's a separate domain, or whether kits live under floridapolebarn.com/kits. See 6.1. |
| `tracking_health_score`, `crm_hygiene_score`, `account_health_score` | default 0 | Same as schema default. |

### 3.3 FPB Kits ad_platform_connections

```sql
-- Two stub connection rows. external IDs are placeholders — Brian will
-- create or assign the actual Google Ads sub-account / Meta ad account
-- separately and update these rows.
INSERT INTO ad_platform_connections (
  account_id, platform, account_id_external, manager_account_id,
  connection_status, access_token_reference, refresh_token_reference
)
VALUES (
  (SELECT id FROM accounts WHERE slug = 'fpb-kits'),
  'google_ads',
  NULL,                        -- TBD: separate Google Ads customer ID for Kits
  '5435219372',                -- shared MCC manager ID with FPB
  'pending',
  'env:GOOGLE_ADS_REFRESH_TOKEN',
  'env:GOOGLE_ADS_REFRESH_TOKEN'
)
ON CONFLICT (account_id, platform) DO NOTHING;

INSERT INTO ad_platform_connections (
  account_id, platform, account_id_external,
  connection_status, access_token_reference
)
VALUES (
  (SELECT id FROM accounts WHERE slug = 'fpb-kits'),
  'meta_ads',
  NULL,                        -- TBD: separate Meta ad account for Kits
  'pending',
  'env:META_ACCESS_TOKEN'
)
ON CONFLICT (account_id, platform) DO NOTHING;
```

Notes:
- `connection_status = 'pending'` because the external IDs are not yet known. The verify-safety endpoint (once retrofitted to multi-tenant per audit Section 13.1.5) will report Kits as not-yet-connected.
- The MCC manager ID is shared — assumes Brian's MCC owns both customer accounts. Confirm in 6.4.
- The refresh token + access token are env: references identical to FPB. If Brian creates separate OAuth flows for Kits, replace with separate env var references later. For now, sharing tokens is fine because they're MCC-level.

### 3.4 Weld Workx update

```sql
UPDATE accounts
SET status = 'active',
    monthly_budget = 500,        -- align to strategy doc testing budget
    monthly_spend_cap = 500,
    daily_spend_cap = 17,
    target_cost_per_lead = 200,  -- B2B lead — higher CPL expected
    industry = 'Welding & Gate Fabrication',
    primary_location = 'Central Florida',
    service_area = 'Florida statewide',
    website_domain = 'weldworkxfl.com',
    reporting_timezone = 'America/New_York'
WHERE slug = 'weld';
```

Confirmations required (Section 6):
- 6.5: Stay at $500 (per strategy doc) or keep $1000 (per existing seed)?
- 6.6: B2B CPL target — $200 is a starting guess for gate fabrication. Brian should sanity-check against Weld's existing close-rate intuition.

### 3.5 FSC update

```sql
UPDATE accounts
SET status = 'active',
    monthly_budget = 500,
    monthly_spend_cap = 500,
    daily_spend_cap = 17,
    target_cost_per_lead = 75,  -- Service business, residential + commercial mix
    industry = 'Security Systems Installation',
    primary_location = 'Central Florida',
    service_area = 'Florida statewide',
    website_domain = 'floridasecurityconcepts.com',
    reporting_timezone = 'America/New_York'
WHERE slug = 'fsc';
```

Confirmations required (Section 6):
- 6.7: $75 CPL is a starting guess for residential security install leads. Brian should sanity-check.
- 6.8: Service area — statewide vs Central Florida only?

### 3.6 Verification query (post-apply)

```sql
SELECT slug, name, status, parent_account_id, product_line, monthly_budget
  FROM accounts
  ORDER BY parent_account_id NULLS FIRST, slug;
```

Expected output (4 rows, parents first):

| slug | name | status | parent_account_id | product_line | monthly_budget |
|---|---|---|---|---|---|
| fpb | Florida Pole Barn | active | NULL | NULL | 2500 |
| fsc | Florida Security Concepts | active | NULL | NULL | 500 |
| weld | Weld Workx | active | NULL | NULL | 500 |
| fpb-kits | Florida Pole Barn — Kits | active | <FPB.id> | kits | 500 |

---

## 4. FSC platform investigation (web fetch findings)

**Site:** https://floridasecurityconcepts.com
**Fetched:** 2026-05-14

### 4.1 Findings

| Signal | Result |
|---|---|
| Generator meta tag | None visible |
| WordPress markers (`/wp-content/`, `/wp-json/`) | None |
| Next.js markers (`/_next/`) | None |
| Webflow / Wix / Squarespace asset patterns | URL pattern is clean and semantic (`/services/`, `/industries/`, `/service-areas/`), consistent with Webflow's URL builder |
| Footer attribution | "© 2026 Florida Security Concepts. All rights reserved" — no "Powered by" |
| Existing blog | None. A `/resources` page exists but is a static hub, not a CMS-driven blog |
| Form patterns | Site assessment form uses select dropdowns, consistent with Webflow's form builder or custom |

**Best assessment: Webflow, or a custom static / JAMstack site.** No definitive marker, but the URL hygiene + clean form patterns + lack of CMS bloat point at Webflow over WordPress.

### 4.2 Implication for Phase 1 SEO blog pillar

| If platform is | Programmatic publishing path |
|---|---|
| **Webflow** | Webflow CMS API supports per-Collection-Item POST. Blog Collection would need to be created in Webflow first (one-time setup), then Prime publishes via API. **Viable.** |
| **Custom static / JAMstack** | Depends on the build pipeline. If GitHub-backed, Prime can commit Markdown → trigger rebuild. If hand-rolled with no repo, blocker. |
| **Webflow with no CMS** | Add a Collection ($23/mo CMS plan if not already on it), then same as Webflow above. |

### 4.3 Recommendation

**Stay on current platform. Add a Webflow Blog Collection if it doesn't exist.** Migration to a different stack is unnecessary effort given Webflow's CMS API is well-documented and FSC has no legacy content to migrate.

Phase 0 needs: confirm with Brian that the platform is Webflow (a 30-second admin login check). If yes, schedule the Blog Collection creation as a Phase 1 prerequisite. If no — if it's a hand-rolled static site — recommend migrating to Webflow now (cheap, design-friendly) rather than incurring custom-build maintenance cost on the publishing side later.

---

## 5. Weld Workx Lovable investigation (research findings)

**Source:** docs.lovable.dev (welcome page, GitHub integration page, llms.txt index)
**Fetched:** 2026-05-14

### 5.1 What Lovable is

Lovable is an **AI-powered web application builder**, not a content platform. Projects produce a codebase that can be synced to a GitHub repo. The primary editing surface is Lovable's own UI; GitHub is a backup + collaboration layer.

### 5.2 Programmatic content publishing — capability check

| Question | Answer |
|---|---|
| Public API for blog post / content publishing? | **No.** No publishing endpoints documented. Lovable's "API" docs refer to building apps programmatically, not pushing content. |
| GitHub-backed (commit content via git, see it on the site)? | **One-way only.** Lovable → GitHub is supported. External commits sync back into Lovable's editor but **do NOT auto-redeploy the live Lovable-hosted site**. |
| Webhooks for content changes? | **No** explicit mention in the docs index. |
| Headless CMS integrations? | **Yes** — Contentful, Storyblok, WordPress.com, Notion are listed as supported integrations. These are integrations the Lovable site CAN consume, not native publishing endpoints. |
| Rebuild on external commit? | **No.** External pushes sync to the editor only. |

### 5.3 Migration target options

| Option | Cost | Phase 1 readiness | Notes |
|---|---|---|---|
| **Stay on Lovable, add a headless CMS (Contentful/Storyblok/WP.com)** | Cheap (Contentful free tier covers small blogs; Storyblok similar) | High — Prime publishes to the CMS API, Lovable site reads from it | Preserves Brian's existing Lovable design investment. Adds one third-party dependency. |
| **Migrate to Next.js + MDX (file-based)** | One-time rebuild cost; ongoing zero | Medium — Prime commits MDX files to the GitHub repo, Vercel auto-deploys | Cleanest long-term. Aligns with the FPB stack already in use. Adds rebuild work upfront. |
| **Migrate to Next.js + headless CMS (Contentful)** | One-time rebuild cost + Contentful subscription | High — same publishing flow as Option 1 | Same publishing path as Option 1 but on a stack Prime already knows. |
| **Migrate to WordPress + REST API** | One-time rebuild + ongoing WordPress maintenance | High — Prime POSTs to `/wp-json/wp/v2/posts` | Established pattern but adds WordPress maintenance overhead. |

### 5.4 Recommendation

**Add a headless CMS to the existing Lovable site (stay-on-Lovable variant).** Specifically: Contentful or Storyblok, integrated into the Lovable site's blog page.

Reasoning:
- Preserves the Weld site Brian and Caleb already invested design effort in.
- Unblocks Phase 1 SEO blog pillar without a site rebuild.
- Adds one third-party dependency (the CMS) but Prime needs a CMS API for FSC anyway, so this consolidates: pick one CMS Prime supports, use it for both Weld (via Lovable site embedding) and FSC (via Webflow site embedding).
- Migration off Lovable becomes a separate, lower-priority project — defer to Phase 2 or Phase 3 unless Lovable becomes a publishing pain point.

**Open question 6.9:** Brian needs to confirm comfort with adding Contentful (or Storyblok) as a Prime subscription. Strategy doc Section 6 lists "currently approved" tools — Contentful is not on the list, so this requires Brian's tool-approval protocol.

**Risk / fallback:** If Brian rejects adding a third-party CMS, the fallback is "Brian publishes Weld blog drafts manually from Prime-generated content." Prime stores the draft, surfaces it in the dashboard, Brian copy-pastes into Lovable. Still beats no blog pipeline; just removes the autonomy from publishing.

---

## 6. Open questions surfaced during the spec

Each question below blocks Phase 2B execution unless an explicit answer is provided. Recommendation column is Claude's default if Brian wants to defer specific calls.

| # | Question | Recommendation if Brian defers |
|---|---|---|
| 6.1 | FPB Kits `website_domain` — `kits.floridapolebarn.com`, `floridapolebarn.com/kits`, or a separate domain? | Default to `kits.floridapolebarn.com` (subdomain). Cleanest separation for tracking pixels and lead UTMs. |
| 6.2 | FPB Kits `target_cost_per_lead` — $100 starting guess? | Stay at $100 with explicit "review after Phase 1 month 1" ticket. |
| 6.3 | FPB Kits `target_cost_per_qualified_lead` — $400 starting guess? | Same. |
| 6.4 | Does FPB Kits' Google Ads share the existing MCC manager `5435219372`, or is Kits inside FPB's existing customer ID using campaign-level tagging only? | Confirm with Brian — affects whether `ad_platform_connections.account_id_external` for Kits is a separate customer ID (clean) or the same as FPB Turnkey (cheaper but harder to attribute). |
| 6.5 | Weld Workx monthly budget — $500 (strategy) or $1000 (existing seed)? | $500 per strategy doc — testing baseline. Seed value was a stub. |
| 6.6 | Weld B2B CPL target — $200 starting guess? | Stay at $200 with same review-after-month-1 ticket. |
| 6.7 | FSC residential security CPL target — $75 starting guess? | Stay at $75 with same ticket. |
| 6.8 | FSC service area — statewide or Central Florida only? | Statewide per the website's `/service-areas/` route which lists multiple regions. |
| 6.9 | Add Contentful or Storyblok to approved Prime subscriptions for Weld + FSC blog publishing? | Yes — Contentful free tier ($0/mo for under 25K records). If Brian declines, fallback is manual publishing pipeline. |
| 6.10 | Confirm FSC platform is Webflow (30-sec admin login check)? | Brian to confirm. Spec assumes Webflow throughout. |
| 6.11 | Migration application strategy (see Section 8) — Brian's preferred pattern going forward? | See Section 8 recommendation. |

---

## 7. Phase 2B execution checklist

Ordered ops Phase 2B will perform (only after Brian's explicit "approved, proceed"):

| # | Step | Dependency | Expected output |
|---|---|---|---|
| 1 | Write `sql/009_parent_account_id.sql` containing: ADD COLUMN x2, CREATE INDEX, CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE TRIGGER, FPB Kits INSERT, FPB Kits ad_platform_connections INSERTs (×2), Weld UPDATE, FSC UPDATE | None | A single committed SQL file, ~150 lines |
| 2 | Document MANUAL APPLY instructions in the migration's header comment per Section 8 pattern | Step 1 | Header comment with copy-paste instructions |
| 3 | Brian applies the migration in Supabase SQL Editor | Step 1+2; Brian's approval of Section 6 open questions | All 4 accounts visible; FPB Kits has parent_account_id set; Weld and FSC are active |
| 4 | Run the verification query from Section 3.6 | Step 3 | 4 rows matching the expected table |
| 5 | Re-run `npm test` | Step 3 | 250/250 still passing — no test changes expected since no code changes are part of Sub-Task 2 |
| 6 | Confirm `/api/accounts` returns 4 rows including FPB Kits | Step 3 | JSON response with 4 entries |
| 7 | Confirm dashboard `<AccountSelector>` shows 4 options after refresh | Step 6 | UI smoke test |
| 8 | Update `AUDIT-PHASE-0.md` Section 2.1 schema table with the new `accounts` columns and `parent_account_id` index | Step 1 | Documentation update |

**Code changes expected in Phase 2B: zero.** All API routes already filter by `account_id`. The `accounts` SELECT in `/api/accounts` returns whatever columns are in the whitelist (`api/accounts.js:40-63`); we'll add `parent_account_id` and `product_line` to that whitelist as part of Step 1's migration commit, in the same PR.

Actually — that's a code change. Revising:

**Code changes in Phase 2B: one small edit to `api/accounts.js` whitelist** to expose the two new columns. Plus `tests/accounts-api.test.js` may need an additional assertion that the new fields are returned. ~10 LOC + 1 test case.

---

## 8. Migration application strategy (locks pattern for Sub-Tasks 4, 5, 6)

The audit (Section 13.1.2) flagged that prior MANUAL APPLY blocks in `sql/008` were never converted to executable migrations. Sub-Task 2 must not repeat that pattern. Going forward:

### 8.1 Pattern recommendation: MANUAL APPLY documented but with idempotent executable SQL

Every migration file under `sql/NNN_*.sql`:
- Is plain executable SQL with `IF NOT EXISTS` / `OR REPLACE` guards everywhere.
- Has a header comment that includes:
  - Brief description of the change.
  - Apply instructions: "Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)."
  - A pre-migration check (DO block that `RAISE NOTICE`s the current state).
  - A post-migration verification query in the trailing comments.
- Contains zero `/* … */` blocks of "MANUAL APPLY" SQL that don't execute. Either the SQL is in the file and runs, or it's in a different file.

### 8.2 Why this over Supabase CLI auto-apply

| Option | Pros | Cons |
|---|---|---|
| (a) Supabase CLI auto-applied | Atomic, reviewable, branch-aware | Requires Supabase CLI configured locally; tooling overhead Brian hasn't adopted yet; introduces a new state Prime depends on |
| **(b) MANUAL APPLY documented but executable** | Matches existing pattern (sql/001-007); no new tooling; Brian copies once and runs | Brian must remember to run; CI doesn't enforce |

**Recommendation: (b).** Matches the existing repo, matches Brian's existing workflow (Supabase SQL Editor is already in his rotation), no new tool to adopt. The "MANUAL APPLY anti-pattern" specifically referred to commented-out code blocks — that's the pattern to abolish, not the manual-application-via-Supabase-Editor pattern.

If Brian later adopts Supabase CLI (worth doing in Phase 4 for productization-scale safety), migrate the existing `sql/NNN_*.sql` files into the CLI's migrations directory at that time.

### 8.3 Header template for `sql/009_parent_account_id.sql` (and all future Phase 0 migrations)

```sql
-- ============================================================
-- Migration 009: parent_account_id + Phase 1 tenant activation
--
-- Adds parent_account_id and product_line columns to accounts.
-- Adds one-level-deep hierarchy enforcement trigger.
-- Inserts FPB Kits as child of FPB.
-- Activates Weld Workx and Florida Security Concepts.
-- Inserts pending ad_platform_connections rows for FPB Kits.
--
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query).
-- Idempotent — safe to re-run; ADD COLUMN IF NOT EXISTS,
-- ON CONFLICT DO NOTHING, OR REPLACE FUNCTION, DROP+CREATE TRIGGER.
--
-- Pre-migration check below RAISES NOTICE with current account count.
-- Post-migration verification query at the bottom of this file.
--
-- This migration file is fully executable. Do NOT add MANUAL APPLY
-- comment blocks — that pattern is retired (see audit Section 13.1.2).
-- ============================================================
```

---

## 9. Summary of decisions Brian must make before Phase 2B runs

In rough priority order:

1. **6.10 — Confirm FSC platform is Webflow.** Quick admin login check. Affects 4.3 recommendation.
2. **6.9 — Approve Contentful (or Storyblok) as a Prime subscription** for Weld + FSC blog publishing. If declined, fallback is manual publishing.
3. **6.1 — FPB Kits `website_domain` decision.** Affects lead UTM strategy and tracking pixel placement.
4. **6.4 — FPB Kits Google Ads structure.** Same MCC + new customer ID, or same customer ID with campaign-level tagging?
5. **6.5 — Weld monthly budget.** $500 (strategy) or $1000 (existing seed)?
6. **6.11 — Confirm migration application strategy** (Section 8): pattern (b) — manual apply via Supabase SQL Editor with executable idempotent SQL.
7. **6.2, 6.3, 6.6, 6.7 — CPL target sanity-checks.** Defer-OK; defaults proposed are conservative.
8. **6.8 — FSC service area.** Defer-OK; statewide proposed.

After approval of items 1–6 (the gating decisions), Phase 2B can proceed end-to-end. Items 7–8 can ship with proposed defaults and adjusted in a follow-up.

---

End of spec. No file modifications beyond this document.
