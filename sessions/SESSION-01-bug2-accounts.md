# SESSION 01 — Bug 2: /api/accounts 500
AUTONOMY: unattended
CHAIN-NEXT: sessions/SESSION-02-chat-honesty-autofetch.md


GOAL: The account switcher errors because /api/accounts references a dropped or missing column (per PRIME-TRIAGE-HANDOFF.md; still in prod logs June 16). Diagnose and fix.

FILE SCOPE: api/accounts.js, api/lib/accounts.js, tests/accounts-api.test.js, tests/accounts-helper.test.js. Nothing else.

PHASE A (read-only): scout the two api files; identify every column named in SELECTs; compare against the live schema columns listed in MARKETING_AGENT_AUDIT.md section 4 (if a needed column genuinely doesn't exist in prod, the fix may require a sql/016 migration file - write it, never apply it). Present diagnosis + minimal fix plan. Proceed directly to Phase B (unattended class); record the Phase A plan in the run report.
PHASE B: implement per approved plan.
PHASE C: test-guard runs suite (floor 443); report.

NOTE: the field whitelist in accounts.js is a security control (tests verify token exclusion in three layers) - the fix must not widen it.

DoD: /api/accounts returns 200 shape the dashboard expects; whitelist tests still pass; floor holds.
