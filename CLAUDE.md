# CLAUDE.md — Prime (FPB Marketing Bot)

Standing rules for every Claude Code session in this repo. These override anything else except Brian's direct instructions in the session.

## Before any work
1. Read `PRIME-STRATEGY.md` (business context) and `PRIME-AGENCY-ROADMAP.md` (build plan).
2. If a `sessions/SESSION-XX-*.md` file is named in the prompt, it is the task contract: goal, file scope, phases, definition of done. Do not exceed its file scope.
3. Inspection first. Read every file you intend to change before proposing changes.

## Hard rules
- **Never commit. Never push.** Brian does both manually after reviewing diffs. Do not claim a commit happened — only `git log --oneline` is proof.
- **Windows/PowerShell only.** No bash/Linux syntax in anything Brian will run.
- **Phase gates:** Phase A = read + plan, then STOP for approval. Phase B = implement. Phase C = test + report. Never skip A on any session that writes code.
- **Test floor: 443.** `npx vitest run` must finish ≥443 passing, 0 failures, before a session may be reported complete. New features add tests; the floor rises and never falls.
- **File scope binding:** touch only files named in the session contract. Finding a problem outside scope → report it, don't fix it.
- **Database:** never apply migrations. Write SQL to `sql/NNN_name.sql` for Brian to review and apply. Supabase prod: `olpyqfuphiwdongzmazi`.
- **Secrets:** never print env values; never hardcode credentials or account IDs (resolve via `ad_platform_connections`).
- **No live ad mutations in any session** unless the session contract explicitly stages a validation action for Brian's approval. All execution flows through the existing action → approval → execute pipeline; never call platform mutate endpoints directly.

## Money-path files — extra care
`api/lib/execute-action-logic.js`, `api/execute-action.js`, `api/approve-action.js`, `api/lib/autonomy-coordinator.js`, `api/google-ads.js`, `api/facebook-ads.js` touch real ad spend. Changes here: minimal diffs, pure-motion refactors flagged as such, and always delegate a review to the `safety-reviewer` subagent before Phase C.

## Subagent routing (token discipline)
- `scout` (haiku) — all repo exploration, file inventories, grep surveys. Never explore in the main thread.
- `builder` (sonnet) — implementation within the session's file scope.
- `test-guard` (haiku) — runs the suite, reports counts and failures verbatim.
- `safety-reviewer` (opus) — read-only diff review of money-path changes; invoke before reporting any session touching those files.
Main thread orchestrates; it should stay small. Summarize subagent output, don't paste it.

## Conventions
- UI status indicators: icon + word + color, never color alone (Brian is color-blind).
- Existing patterns are the template: `require-secret.js` for auth gates, `action-states.js` for state machines, `cors.js` style headers. Match, don't reinvent.
- Errors: fail closed in production, warn-and-allow under NODE_ENV=test (established pattern).
- Vercel deploys on push to main; previews per branch. Current working branch: `fix/production-triage`.

## Report format (end of every session)
1. What was inspected. 2. What changed (per file). 3. Tests: count before/after, all passing y/n. 4. Risks found (in or out of scope). 5. Migrations proposed (never applied). 6. Anything requiring Brian: env vars, approvals, SQL to apply.
