# SESSION 07d — Fix search_term_view GAQL (invalid metrics-in-WHERE) + surface fetch failures
AUTONOMY: gated

GOAL: fetchSearchTerms silently fails, so waste/negative-keyword requests
get no data in context and the model either invents placeholder campaign
IDs or admits it's blind. ROOT CAUSE CONFIRMED by code read: the GAQL for
search_term_view has "AND metrics.cost_micros > 0" in the WHERE clause.
GAQL forbids filtering by metrics in WHERE (only segments/attributes are
allowed) — so Google rejects the query, fetchSearchTerms returns
{success:false}, and api/chat.js:449 silently pushes nothing to context.

FILE SCOPE: api/google-ads.js (fetchSearchTerms GAQL + post-filter),
api/chat.js (surface the failure reason at line ~447-451), tests/
google-ads.test.js, tests/chat.test.js. Nothing else. Do NOT touch the
executor, guards, verifyAndEnrichAction, or the S07c prompt schema.

FIXES:
1. GAQL: remove "AND metrics.cost_micros > 0" (and any other
   metrics.* predicate) from the WHERE clause entirely. Keep
   segments.date BETWEEN and campaign filters (those are legal). Apply
   the spend>0 / zero-conversion "waste" filtering in JS AFTER rows
   return — the waste-ranking summary logic already computes on the
   rows, so filter there. Verify the ORDER BY: GAQL allows ORDER BY
   metrics.cost_micros DESC (order is fine; only WHERE is restricted) —
   if ordering also errors in practice, move sort to JS too.
2. Surface failure: api/chat.js waste-trigger block — when
   fetchSearchTerms returns success:false, push a short note into
   dataParts like "SEARCH TERMS: fetch failed (<reason>) — do not
   fabricate terms or campaign IDs; tell the user the report could not
   be loaded." So the model degrades honestly instead of guessing.
   Include the API error reason if available (truncated).
3. While here, confirm fetchSearchTerms returns campaign_id on each row
   (or the campaign context) so staged negatives get the REAL id and
   pass S06 verification — the placeholder-id failure was downstream of
   this same empty-data problem.

PHASE A (STOP): show the corrected GAQL (before/after WHERE clause), the
JS post-filter for waste, and the chat.js failure-surface change. Confirm
no metrics predicate remains in any WHERE.
PHASE B implement. PHASE C: floor 688+; tests: fetchSearchTerms builds a
GAQL with NO metrics in WHERE (string assertion), waste filtering happens
in JS, a success:false path pushes the honest-failure note (not silence),
rows carry campaign_id. Live-validation runbook: Brian re-asks the waste
question and confirms real terms load + a negative stages with a real
campaign_id. Safety-reviewer: light (read-only fetch + prompt-context
note; no mutation path changed) — verdict verbatim.

DoD: asking "analyze my Location search terms and negate the carport
terms" loads real search-term data, stages negatives with real campaign
IDs that pass verification, and a fetch failure produces an honest
"couldn't load" message instead of fabricated data.
