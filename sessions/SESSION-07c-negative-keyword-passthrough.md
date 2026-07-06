# SESSION 07c — Fix negative-keyword field pass-through + fail-early validation
AUTONOMY: gated
# MONEY-PATH ADJACENT (feeds the executor) — safety-reviewer required.

GOAL: Live testing 7/6 proved negative-keyword actions reach the executor
with null keyword_text and fail ("executeGoogleAddNegativeKeyword requires
execution_data.keyword_text"). Root cause CONFIRMED by code trace:
verifyAndEnrichActionByCampaign (api/chat.js:259) rebuilds result.payload
field-by-field and only carries the BUDGET fields — it drops keyword_text,
match_type, and evidence. So the S07b whitelist at the insert (line 558)
receives an actionForInsert that no longer has them. The parse (line 213)
and insert (558) are both correct; the ENRICHMENT step in the middle is
where the fields die. S07b tests passed because they asserted the
match_type GATE on the input payload, never the round-trip output.

FILE SCOPE: api/chat.js (verifyAndEnrichActionByCampaign return payload,
and the empty-keyword_text guard), tests/chat.test.js. Nothing else. Do
NOT touch the executor, the guards, or the insert whitelist (which is
already correct).

FIXES:
1. PASS-THROUGH: in verifyAndEnrichActionByCampaign, ensure the returned
   result.payload carries keyword_text, match_type, and evidence through
   on every path (id-match, name-match, unverified) for
   add_negative_keyword actions — mirror how budget fields survive. The
   cleanest form is to spread the original actionPayload as the base of
   the returned payload rather than reconstructing a subset, so NO field
   is ever silently dropped again — but verify that spreading doesn't
   defeat the existing campaign_id correction/enrichment (the corrected
   id must still win over the original). If spread is unsafe, add the
   three fields explicitly.
2. FAIL EARLY + LEGIBLE: add a validation so an add_negative_keyword
   action with an empty/missing keyword_text is downgraded at STAGING to
   requires_review with a clear reason ("negative keyword action missing
   keyword_text"), NOT passed to the executor to fail cryptically. This
   is the staging-side guard the executor's runtime check should have had
   a partner for.

PHASE A (STOP): show the exact current return shape of
verifyAndEnrichActionByCampaign, the minimal change to carry the three
fields on all return paths, proof the campaign_id correction still wins,
and the empty-keyword_text staging guard placement.
PHASE B implement. PHASE C: floor 682+, tests MUST include a full
round-trip test (parse-shaped payload -> verifyAndEnrichAction ->
assert keyword_text/match_type/evidence survive on the output payload,
for id-match AND name-match AND unverified paths) — the exact gap that
let this ship. Plus: empty keyword_text -> requires_review. Safety-
reviewer on the diff, verdict verbatim, confirming the executor now
receives a populated keyword_text for a normal negative-keyword flow.

DoD: staging a negative keyword through chat produces an action whose
execution_data.keyword_text is populated; approving it executes and the
negative appears in Google Ads; an empty-keyword_text action is caught
at staging with a clear reason, never at the executor.
