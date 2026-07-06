# SESSION 07b — Search terms visibility + negative keyword execution
AUTONOMY: gated
# MONEY PATH (adds a live mutating capability) — safety-reviewer mandatory.

GOAL: The highest-leverage lead-flow lever Prime lacks: it cannot see
search terms (the actual queries triggering ads) so it cannot find
wasted spend, and its negative-keyword executor is built but NEVER
validated live. Give Prime search-term sight + a guarded, validated
add-negative-keyword capability. This is how "more qualified leads at
the same budget" actually happens — negatives cut in-campaign waste
without touching the account cap.

VERIFIED: executeGoogleAddNegativeKeyword (or equiv) exists in
execute-action-logic.js, unvalidated in production. add_negative_keyword
is in EXECUTABLE_TYPES. S06B builds a rollback payload for it
(criterion_resource_name from mutate response). Guards: negatives are
low-risk (no spend increase) but must still flow recommendation ->
approval -> execute -> audit.

FILE SCOPE: api/google-ads.js (new fetchSearchTerms via GAQL
search_term_view), api/lib/prompts/fpb.js (teach the model it can now
request search-term data and stage add_negative_keyword with evidence),
api/chat.js (wire search-term fetch into the DATA path when the user
asks about waste/search terms), tests. Executor itself already exists —
do NOT rewrite it; add validation tests only. sql: none expected.

DESIGN (Phase A refines):
1. fetchSearchTerms(account, connection, {campaignId?, days=30}): GAQL on
   search_term_view — search_term, campaign, clicks, cost_micros,
   conversions, per query. Cost-ledger recorded. Returns worst-offender
   sort (high spend, zero conversions = waste).
2. Chat: when the user asks about waste / search terms / "what's junk",
   fetch search terms and present the zero-conversion spend sinks. Model
   stages add_negative_keyword actions with evidence (term, spend, 0
   conv) in the ACTION block. Server-verifies campaign_id like S06.
3. Execution: negatives run through the SAME guarded pipeline. A negative
   is not a spend increase, so budget guards pass it, but it still gets
   before/after snapshot (before: absence; after: criterion resource)
   and rollback payload (S06B already does this).
4. VALIDATION (the point of this session): Phase C includes a documented
   plan for Brian to approve ONE real negative keyword on an obvious junk
   term and confirm it lands in Google Ads — first live validation of
   this executor. Not auto-run; staged for Brian.

PHASE A (STOP): GAQL for search_term_view, the waste-ranking logic, the
chat trigger phrasing, and the field-mapping for the ACTION block.
PHASE B implement. PHASE C floor per 07a+; tests: search-term fetch
shape, waste ranking, negative staged with evidence, campaign_id
server-verified, executor validation test (mocked), rollback payload
present. Safety-reviewer verdict verbatim. Include the one-negative
live-validation runbook for Brian.

DoD: Prime can list zero-conversion spend sinks from live search terms;
stage evidenced negative-keyword actions; one real negative validated
live in Google Ads through the full audited pipeline.
