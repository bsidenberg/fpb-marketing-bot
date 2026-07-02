# SESSION 06 — Server-verified ACTION blocks + real budget data
AUTONOMY: unattended

GOAL: Chat-created budget actions fail at execution because (a) the LLM
transcribes campaign IDs into ACTION blocks and can hallucinate digits
(live failure 7/2: staged campaign_id 21541565583 does not exist), and
(b) chat actions never carry budget_id, forcing the slow-path lookup.
Fix: the server, not the model, is the authority on IDs.

FILE SCOPE: api/chat.js, api/lib/prompts/fpb.js, api/google-ads.js
(GAQL addition only), tests/chat.test.js, tests/analyze-ads.test.js
(only if fetch-shape change requires mock updates). Nothing else.
Do NOT touch execute-action-logic.js — its fail-closed slow path stays
as the last line of defense.

CHANGES:
1. api/google-ads.js — extend the GAQL SELECT in fetchGoogleAdsData with
   campaign_budget.amount_micros; add daily_budget (USD, 2dp) to each
   campaign object. Additive only; existing fields unchanged.
2. api/chat.js — new pure helper verifyAndEnrichAction(actionPayload,
   fetchedCampaigns) applied before any google_ads action is saved:
   - campaign_id matches a fetched campaign -> inject that campaign's
     budget_id (and current daily_budget as current_value if the LLM's
     value was an estimate).
   - campaign_id matches nothing but campaign_name matches exactly one
     fetched campaign -> REPLACE campaign_id with the real one, inject
     budget_id, and append a note to description: "(campaign_id
     corrected from model output by server verification)".
   - neither matches -> save the action with status requiring manual
     review and description prefixed "[UNVERIFIED - campaign not found
     in live data]"; never silently save an unverifiable executable ID.
   - If the turn had no fetched ad data, fetch it server-side via the
     existing fetchGoogleAdsData import (account + connection already
     in scope) solely to run this verification.
3. api/lib/prompts/fpb.js — in the ACTION block spec, note that
   campaign_id will be server-verified and budget_id should be included
   when visible in the data. (Belt; the server is suspenders.)

TESTS (floor 446): id-match enrichment; name-match correction; no-match
flagged unverified; budget_id injected; daily_budget present in fetch
mock shape; non-google_ads actions pass through untouched.

PHASE C EXTRA: invoke safety-reviewer on the full diff (this constructs
execution payloads even though no money-path file is touched); include
its verdict verbatim in the report.
