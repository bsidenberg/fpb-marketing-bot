# SESSION 02 — Chat honesty + auto-fetch (closes Bug 8 workaround)
AUTONOMY: unattended


GOAL: Two defects, one surface. (1) The system prompt tells users to export CSVs and claims capabilities with no executors (bid strategies, audience tightening, Quality Score work). (2) Affirmative follow-ups ("yes do it") after a data conversation don't trigger the live-data fetch, so the AI begs for uploads it doesn't need.

FILE SCOPE: api/lib/prompts/fpb.js, api/chat.js, tests/chat.test.js. Nothing else.

PHASE A (read-only): scout the intent-detection flow in chat.js (two-pass DATA_QUESTION design) and the full fpb.js prompt. Present: (a) rewritten capability section listing ONLY real capabilities - budget changes (proven), pause/resume + negative keywords (staged for approval; unvalidated live), live Google Ads data fetch; explicit "not yet" list; (b) removal of all export/CSV instructions, replaced with fetch-first behavior; (c) mechanism for affirmative follow-ups to trigger the data path (e.g., include a lightweight conversation-context check or classify follow-ups against prior-message intent) - prefer the smallest change that works with the existing two-pass design. Proceed directly to Phase B (unattended class); record the Phase A plan in the run report.
PHASE B: implement. PHASE C: tests (floor 443) + add coverage: affirmative follow-up triggers fetch; prompt no longer contains "export" instructions (string-level test is fine).

DoD: "yes do it" after a performance question produces live-data analysis, not an upload request; capability claims match executors.
