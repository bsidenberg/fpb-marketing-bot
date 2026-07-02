# HARNESS-RUN-01 — Autonomous Session Run
**Date:** 2026-07-02
**Branch:** fix/production-triage
**Run authorization:** Brian Sidenberg (pre-authorized, no approval gates)
**Sessions executed:** SESSION-01, SESSION-02
**Decisions made without Brian:** documented below per session

---

## SESSION-01 — Bug 2: /api/accounts 500

### Files changed
| File | Change |
|---|---|
| `api/accounts.js` | Removed `'autonomy_level'` from `ACCOUNT_PUBLIC_COLUMNS` |
| `tests/accounts-api.test.js` | Removed `autonomy_level` from `makeAccountRow` fixture and `WHITELIST` constant |

### Root cause
Migration `sql/012_autonomy_posture.sql` intentionally dropped `accounts.autonomy_level` (replaced by the `autonomy_posture` table — see that file's comment: "Column was never read by any code (AUDIT-PHASE-0.md Section 5). Dropped via idempotent DO block."). The `ACCOUNT_PUBLIC_COLUMNS` whitelist in `api/accounts.js` was never updated, so every Supabase query to `/api/accounts` included a non-existent column → 500 in production.

Confirmed via live Supabase schema query (`information_schema.columns` on project `olpyqfuphiwdongzmazi`): 23 columns present, `autonomy_level` absent.

### Decision made without Brian
**No migration written.** The column was intentionally dropped by migration 012 (autonomy_posture is now authoritative). Writing a `sql/016` to re-add it would revert an intentional architectural decision. Conservative choice: remove the dead reference from the code.

### Tests
- Before: 443 passing (baseline on this branch)
- After: 443 passing, 0 failures
- Test floor met: yes

### Risks found
None within scope. Out-of-scope note: the `accounts-helper.test.js` security regression test at line 255 has its own mirror of `ACCOUNT_PUBLIC_COLUMNS` that already excluded `autonomy_level` before this session — it was ahead of the API code. No change needed there.

---

## SESSION-02 — Chat honesty + auto-fetch (Bug 8 workaround)

### Files changed
| File | Change |
|---|---|
| `api/lib/prompts/fpb.js` | Rewrote ACTION TYPES section in CHAT_PROMPT; added "NOT YET AVAILABLE" list; added fetch-first instruction to CONVERSATIONAL INSTRUCTIONS |
| `api/chat.js` | Updated `detectIntent` to accept `conversationHistory`, build context suffix from last assistant message, and use updated intent-classifier system prompt |
| `tests/chat.test.js` | Added import of `getFpbChatSystemPrompt`; added 3 new tests (affirmative follow-up triggers fetch; prompt no export/CSV; prompt no adjust_bid claim) |

### Prompt changes (fpb.js CHAT_PROMPT only)

**ACTION TYPES — before:**
- Listed `adjust_bid` as a real capability (no executor exists)
- No `add_negative_keyword` (executor staged/unvalidated)
- No "not yet available" list
- No fetch-first instruction

**ACTION TYPES — after:**
- `adjust_budget` and `pause_campaign`/`enable_campaign` marked PROVEN and STAGED respectively
- `add_negative_keyword` added as STAGED
- `adjust_bid` removed; added to NOT YET AVAILABLE section
- NOT YET AVAILABLE list added: bid strategy changes, audience targeting modifications, Quality Score optimization, Meta Ads write actions
- CONVERSATIONAL INSTRUCTIONS: added bullet "never ask the user to share, upload, or manually provide ad data in any form. Live data is fetched automatically when needed."

### Intent detection changes (chat.js)

`detectIntent(message, accountId)` → `detectIntent(message, conversationHistory, accountId)`:
- Finds last assistant message in `conversationHistory` (if any)
- Appends a 300-char excerpt as context suffix to the Haiku user message
- Updated Haiku system prompt adds: "If the message is a short affirmative ('yes', 'do it', 'go ahead', 'sounds good', 'proceed') following a prior data analysis in the conversation, classify as DATA_QUESTION."
- Call site updated: `detectIntent(message, conversationHistory, account.id)`

### Tests
- Before SESSION-02: 443 passing
- After SESSION-02: 446 passing (+3 new tests), 0 failures
- Test floor met: yes (446 > 443)

### New tests added
1. `chat — affirmative follow-up triggers data fetch` — verifies handler returns `{type:'fetching'}` when intent resolves DATA_QUESTION for a short affirmative with prior data history in conversationHistory
2. `chat — prompt honesty (Session-02)` — string-level check: prompt does not match `/export.*csv/`, `/csv.*export/`, or `/upload.*file/`; prompt does match fetch-first instruction
3. `chat — prompt honesty (Session-02)` — string-level check: `- adjust_bid:` does not appear as a listed action type

### Decisions made without Brian
1. **`add_negative_keyword` added to action types.** The handoff explicitly lists "negative keywords (staged for approval; unvalidated live)" as a real capability. Added as STAGED so Claude can recommend it but users understand it's unvalidated in production.
2. **`adjust_bid` moved to NOT YET AVAILABLE.** Session contract explicitly listed bid strategies as a "not yet" capability. Removed from ACTION TYPES to prevent misleading capability claims.
3. **Context suffix capped at 300 chars.** Intent detection Haiku call receives last-assistant excerpt trimmed to 300 characters to bound token cost and keep the intent signal tight.

### Risks found (out of scope — for Brian's review)
- The `ANALYZE_PROMPT` (used by `analyze-ads.js`) still lists `adjust_bid` in its ACTION TYPES. This session only changed `CHAT_PROMPT` per file-scope binding. Same honesty gap exists in the analyze endpoint; propose fixing in a future session.
- The prompt `FPB_SYSTEM_PROMPT_VERSION` remains `'fpb-v1'` despite the capability section being materially changed. Tests check for this version string. Consider bumping to `'fpb-v2'` in a future session (requires updating the test assertion at `chat.test.js:305`).

---

## What Brian must review before merging

1. **`api/accounts.js` diff** — confirm removing `autonomy_level` from the SELECT is the intended fix (vs. re-adding the column via migration).
2. **`api/lib/prompts/fpb.js` diff** — confirm the NOT YET AVAILABLE list is accurate; confirm `add_negative_keyword` is the correct action_type string expected by the executor.
3. **`api/chat.js` diff** — confirm the 300-char context suffix cap and the updated Haiku system prompt are acceptable.
4. **No migrations applied.** No SQL was written or applied in either session.
5. **No commits or pushes were made.** Run `git diff` to review all changes, then commit manually.
