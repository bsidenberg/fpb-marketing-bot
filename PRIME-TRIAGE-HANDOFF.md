# Prime Production Triage — Session Handoff

**Last updated:** June 16, 2026 (continued from June 15 session)
**Branch:** `fix/production-triage`
**Repo:** `bsidenberg/fpb-marketing-bot` at `C:\Python\FPB Marketing Bot`
**Latest commit:** `8df0789` (Bug 18)
**Production commit:** `8df0789` (promoted June 16 ~16:00 UTC)
**`main` aligned with `fix/production-triage` as of June 16**
**Test floor:** 425 passing

## Project context

Brian Sidenberg runs FPB (Florida Pole Barn), Weld Workx, FSC (Florida Security Concepts). **Prime** is his autonomous multi-tenant marketing agent platform. The triage sprint's stated goal was to close the chat → recommend → approve → execute loop against real Google Ads, so Prime can act as an "actionable Google Ads consultant" — recommend changes, get approval, execute via API.

**As of June 16, 2026, that goal is met for budget changes.** Real Google Ads budget changes via chat have been validated end-to-end against the live API in both directions ($30 → $31 → $30 on LP Search - Location campaign `21613067659`). Same code path serves the other action types (pause/resume, negative keywords) — also bumped to v23 — but untested in production.

## Production state

**Live production URL:** https://fpb-marketing-bot.vercel.app
**Production commit:** `8df0789` — Bug 18 (Google Ads API v19 → v23)
**All bugs 1–18 (minus deferred items) live in production.**

## Bugs shipped during sprint

| # | Bug | Status |
|---|---|---|
| 1 | action INSERT 500 — channel CHECK violation from markdown-polluted channel names | ✅ Prod |
| 4 | Dashboard TDZ — `newHoursForm` before `selectedAccountSlug` | ✅ Prod |
| 5 | Chat "Action not found" — create-then-approve gating fixed | ✅ Prod |
| 6 | `chat_messages` table missing in prod Supabase | ✅ Prod |
| 7 | Anthropic model strings deprecated June 15 | ✅ Prod |
| 9 | `/api/approve-action` swallowing real DB errors as 404 | ✅ Prod |
| 10 | Schema drift — `execution_result` vs `result` column | ✅ Prod |
| 11 | `actions.result` default `'{}'::jsonb` made rows look pre-executed | ✅ Prod |
| 12A | acquireLockAndExecute UPDATE swallowed errors | ✅ Prod |
| 12B | `adjust_budget` MANUAL_TYPES misclass + new executors + safety gates | ✅ Prod |
| 13 | Chat clipboard paste handler for screenshots | ✅ Prod |
| 14 | `recommended_value` string coercion (`"31"` → 31, currency strings) | ✅ Prod |
| 15 | Campaign ID column in Live Data | ✅ Prod |
| 17 | `executeGoogleAdjustBudget` used campaign_id as budget_id — added GET-then-mutate slow path; added budget_id to dashboard via google-ads.js SELECT extension; added Budget ID column to Live Data | ✅ Prod |
| 18 | Google Ads API v19 → v23 (v19 sunset Feb 11, 2026 — 4 months dead) | ✅ Prod |

**Validation of Bug 17 + Bug 18 (June 16):** Real Google Ads budget change executed via chat with no `budget_id` in `execution_data`, forcing the slow path (GET campaign → resolve `campaignBudget` resource → mutate). Confirmed at $31 in Google Ads UI, then reverted to $30 via same chat pattern. Both transitions returned `status: 'approved'`, `result: 'success'`. Architecture proven end-to-end.

**Deferred:**
- Bug 8 (chat auto-fetch live Google Ads data) — Bug 13 + Bug 15 (paste + Campaign ID + Budget ID columns) provide an effective workaround.

## Remaining work

| # | Bug | Impact | Priority |
|---|---|---|---|
| 2 | `/api/accounts` 500 — references dropped/missing column | Account switcher dropdown errors; still appearing in prod logs as of June 16 | **NEXT** |
| 3 | `/api/chat` GET 500 — may be incidentally fixed by Bug 6's `chat_messages` table | Chat history doesn't load across refreshes | Verify-then-fix |
| 19 | Meta Graph API v19.0 — 6 hits across 4 files (`create-facebook-campaign.js`, `facebook-ads.js`, `meta-creative.js`, `execute-action-logic.js` lines 328, 369, 457) | Facebook lifecycle slower than Google's, but on a deprecated version. Separate platform/calendar from Bug 18. | Medium |
| — | `recordActionOutcome` test mock missing `.rpc` — all `[AUTONOMY-COORDINATOR-FAILURE]` test stderr lines flow through this gap. Prod path verified working via `[AUTONOMY] verdict=...` in Vercel logs. | Tests pass without exercising the outcome-logging path; hidden-failure-mode risk if RPC ever changes. | Medium |
| — | Cosmetic: `**` markdown leaking into campaign names in Live Data (e.g. `**LP Search - Location`) | Display layer; visible everywhere campaigns are listed | Low |

## Phase 1 observation (not triage)

Google Ads UI is flagging LP Search - Location as **"Limited by budget"** at both $30 and $31. This is exactly the signal Prime should detect from live data and proactively propose budget increases for. Belongs in the SEO blog / strategy work, not triage.

## Workflow rules (carried forward)

1. **Branch only.** Stay on `fix/production-triage`. Don't commit on `main`.
2. **Claude Code never commits or pushes.** Brian does both manually after reviewing the diff. **Claude Code's recap line is unreliable — only `git log --oneline` proves a commit.** Verified failure mode twice in June 16 session.
3. **Single bug at a time.** Diagnose first, propose fix, approve, then apply.
4. **File scope binding** — each prompt names exact files Claude Code may touch.
5. **Test floor: 425.** Tests must remain passing at this count or higher.
6. **Auto mode + Sonnet 4.6 + high effort** in Claude Code. Run from `C:\Python\FPB Marketing Bot` terminal.
7. **VS Code Claude Code plugin = no.** Terminal CLI only.

## Stored references

**Supabase production project:** `olpyqfuphiwdongzmazi`

**Tenant account UUIDs:**
- FPB: `95d6eb05-4a0c-4366-9f0b-25bd80e09225`
- FPB Kits: `c504fe5f-e1f1-450f-9bd6-4f4f276d4a34`
- FSC: `850fc3ec-604c-4a59-bdd5-a3d17376a991`
- Weld: `5b58e3b5-e5be-4887-b49d-a4b5d2d4c10e`

**Vercel Protection Bypass token:** Stored in PowerShell session as `$bypass`. Pass as `x-vercel-protection-bypass` header.

**Known real FPB Google Ads campaign IDs:**
- LP Search - Location - Florida Pole Barn: `21613067659` (validation campaign; budget_id `13855417392`)
- LP Search - Kits: `21613067653`
- LP Search - Pole Barns: `21613067662`
- LP Branded - Florida Pole Barn: `21613067518`

**Google Ads API:** Currently on **v23** (bumped from v19 in Bug 18). v19 sunset Feb 11, 2026. v23 supported through ~Jan 2027. URL pattern: `https://googleads.googleapis.com/v23/customers/{customerId}/{resource}:mutate`. Auth: OAuth bearer + `login-customer-id` header for MCC accounts.

**Slow-path GET-then-mutate pattern (Bug 17):** When `execution_data.budget_id` is absent, `executeGoogleAdjustBudget` runs a `googleAds:search` query (`SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = X LIMIT 1`), extracts `campaignBudget` resource name, splits the trailing numeric ID, then mutates that budget. Fast path skipped when `budget_id` is in `execution_data` (which the dashboard now populates).

## Resume sequence for next session

1. Confirm state: `cd "C:\Python\FPB Marketing Bot"; git log --oneline -5` should show `8df0789` at HEAD on `fix/production-triage`.
2. Start Claude Code: `claude` in terminal (drop `--dangerously-skip-permissions` — read-only auto-approval via `.claude/settings.json` is sufficient for FPB repos).
3. `/model claude-sonnet-4-6` and `/effort high`.
4. Pick next bug (Bug 2 is highest-priority) and write a scoped prompt.
5. Brian commits + pushes manually. Verify with `git log --oneline -3` before assuming Claude Code did it.