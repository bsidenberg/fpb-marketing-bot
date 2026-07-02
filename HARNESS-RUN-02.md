# HARNESS-RUN-02 — Session 06 (Server-verified ACTION blocks + real budget data)

**Date:** 2026-07-02  
**Branch:** fix/production-triage  
**Autonomy class:** unattended  
**Session contract:** sessions/SESSION-06-action-verification.md

---

## 1. What was inspected

- `api/chat.js` — full file read; handler flow traced step by step
- `api/google-ads.js` — full file read; GAQL query and result mapping
- `api/lib/prompts/fpb.js` — full file read; ACTION block spec in CONVERSATIONAL INSTRUCTIONS
- `tests/chat.test.js` — full file read; mock shape, all existing describe blocks
- `tests/analyze-ads.test.js` — full file read; confirmed no mock updates needed (no assertion changes required by the additive shape change)
- `PRIME-STRATEGY.md` and `PRIME-AGENCY-ROADMAP.md` — read per CLAUDE.md mandate

Safety-reviewer also read (out-of-scope, read-only): `api/lib/execute-action-logic.js`, `api/lib/action-states.js`, `api/approve-action.js` to verify `requires_review` status is truly dead-end and spread fields don't propagate.

---

## 2. What changed (per file)

### `api/google-ads.js`
- Added `campaign_budget.amount_micros` to the GAQL SELECT (additive — no existing fields changed).
- Extracted `daily_budget` as `(result.campaignBudget?.amountMicros || 0) / 1_000_000).toFixed(2)` and added it to each campaign object in the returned array. Defaults to `"0.00"` when absent.

### `api/chat.js`
- Added exported pure helper `verifyAndEnrichAction(actionPayload, fetchedCampaigns)`:
  - Non-`google_ads` channel → passthrough unchanged.
  - `campaign_id` matches a live campaign → inject `budget_id` (live value only, never LLM fallback) and fill `current_value` from `daily_budget` if LLM left it blank.
  - `campaign_id` no match but `campaign_name` matches exactly one live campaign → correct `campaign_id` to the real one, inject `budget_id` (live value only), append correction note to `description`.
  - Neither matches → prefix `description` with `[UNVERIFIED - campaign not found in live data]`; status `'unverified'`.
- Step 3: declared `let fetchedGoogleCampaigns = null`; set it from `google?.campaigns` when `includeAdData` is true.
- Step 6.5: before the Supabase insert, if `channel === 'google_ads'`:
  - If `fetchedGoogleCampaigns` is null, fetches live data server-side via `fetchGoogleAdsData` (uses account + connection already in scope; non-fatal catch → unverified).
  - Calls `verifyAndEnrichAction`; uses enriched payload for all insert fields.
  - Adds `budget_id` to `execution_data`.
  - Sets `status: 'requires_review'` when unverified, `'pending'` otherwise.

### `api/lib/prompts/fpb.js`
- Updated ACTION block example to include `budget_id` field.
- Added note that `campaign_id` will be server-verified and `campaign_name` must always be included as fallback; `budget_id` should be included when visible in the data provided.

### `tests/chat.test.js`
- Updated `mockFetchGoogleAds` default return in `beforeEach` to include `budget_id: 'bgt-001'` and `daily_budget: '50.00'` on the mock campaign (matches the new real fetch shape).
- Updated existing test `inserts a pending action row...` to use `campaign_id: 'g-camp-1'` (matches mock) so verification succeeds and status stays `'pending'`; updated assertion accordingly.
- Added `import { verifyAndEnrichAction }` to the import block.
- Added `describe('verifyAndEnrichAction — server-side campaign verification')` — 8 unit tests:
  - passthrough for non-google_ads
  - id-match: budget_id injected, current_value from daily_budget
  - id-match: LLM current_value preserved when present
  - **Safety regression:** LLM-supplied budget_id is NOT used when live budget_id is null
  - name-match: campaign_id corrected, budget_id injected, correction note in description
  - no-match: UNVERIFIED prefix
  - empty campaigns: UNVERIFIED
  - daily_budget from fetch shape used as current_value
- Added `describe('chat — verifyAndEnrichAction wired into action save (Session-06)')` — 3 integration tests:
  - budget_id saved in execution_data from turn-fetched campaigns (includeAdData: true)
  - server-side fetch called for verification when no ad data in the turn
  - requires_review status when campaign unverified

---

## 3. Tests

| State    | Count |
|----------|-------|
| Before   | 446   |
| After    | 458   |
| Failures | 0     |
| Floor    | 443 (new floor: 458) |

All 27 test files passed.

---

## 4. Risks found

**In scope — addressed:**
- (Fixed by design) LLM hallucinated `campaign_id` `21541565583` in the live failure that motivated this session — now caught by the name-match fallback; row saved with corrected ID or flagged `requires_review`.

**In scope — safety-reviewer finding resolved:**
- `verifyAndEnrichAction` originally had `idMatch.budget_id || actionPayload.budget_id || null` in both match branches. If the live campaign's `budget_id` was falsy, the LLM-supplied value would reach `execute-action-logic.js`'s fast-path budget mutator, which trusts `execution_data.budget_id` blindly with no cross-check against `campaign_id`. Changed to `idMatch.budget_id || null` — null triggers the safe slow path that derives budget from the verified campaign_id. Regression test added.

**Out of scope — noted for Brian:**
- `execute-action-logic.js` trusts `execution_data.budget_id` blindly: it mutates `customers/X/campaignBudgets/{budgetId}` without verifying the budget belongs to the campaign. This pre-existed this session and is now partially mitigated (chat-originated actions will only ever carry a live-verified `budget_id`), but `analyze-ads.js`-originated actions do not go through `verifyAndEnrichAction`. Worth a dedicated hardening session.
- `requires_review` is a dead-end state (confirmed: `canExecute` in `action-states.js` does not include it; `approve-action.js` won't promote it). Manual DB intervention required to handle a `requires_review` row beyond reviewing it. No UI surface for this yet — Brian will see the row in Supabase but the dashboard may not surface it distinctly from `pending`.

---

## 5. Migrations proposed

None. No schema changes. `budget_id` in `execution_data` is a JSONB column field (already a free-form object); no migration needed.

---

## 6. Anything requiring Brian

- **No env vars, no secrets, no SQL to apply.**
- **Review the diff** before committing — key files: `api/chat.js`, `api/google-ads.js`, `api/lib/prompts/fpb.js`, `tests/chat.test.js`.
- **Dashboard UX gap:** `requires_review` actions will appear in the DB but may not be visually distinct from `pending` in the approval UI. Consider surfacing them with a warning indicator (icon + label, per color-blind convention) in a future session.
- **Out-of-scope risk above** (execute-action-logic budget_id blind trust) is worth scheduling as Phase B Session 08 hardening.
- **New test floor is 458.** Update CLAUDE.md when committing.
