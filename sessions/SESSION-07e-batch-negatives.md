# SESSION 07e — Reliable multi-term negative keywords + guard that actually catches empties
AUTONOMY: gated
# MONEY-PATH ADJACENT — safety-reviewer required.

GOAL: Single-term negatives work, but multi-term ("negate all the waste")
requests fail. Evidence from live failed rows 7/6: in batch/sequence mode
the model emits ACTION blocks with (a) keyword_text ABSENT and (b) a
REWORDED campaign_name ("Florida Pole Barn - Location" instead of the real
"LP Search - Location - Florida Pole Barn") — i.e. it writes from memory,
not from fetched data. Two defects: the S07c empty-keyword guard is NOT
catching these (they reach the executor and fail there), and there is no
reliable path to stage N negatives in one turn.

VERIFIED CONTEXT (do not re-derive): single-term negatives succeed and
land in Google Ads (row 588fb2bc, "carport", success). fetchSearchTerms
now works and returns rows WITH real campaign_id + spend + term. S06
verifyAndEnrichAction corrects campaign_id by name-match. S07c added a
match_type gate + (intended) empty-keyword_text downgrade in
verifyAndEnrichAction.

FILE SCOPE: api/chat.js (the empty-keyword guard placement, and the
multi-action staging path), api/lib/prompts/fpb.js (batch instruction),
tests/chat.test.js. Do NOT touch the executor, budget guards, fetch
functions, or verifyAndEnrichActionByCampaign's enrichment logic.

INVESTIGATE FIRST (Phase A must answer, with real code, before proposing):
1. WHY does the S07c empty-keyword_text guard NOT catch these? Trace: is
   the guard in verifyAndEnrichAction only reached on the DB-insert path
   but bypassed when the action is auto-executed / executed via a
   different path? Or does it check actionPayload.keyword_text while the
   executor reads execution_data.keyword_text after enrichment strips it?
   Find the exact reason the empty value reaches the executor. Do NOT
   propose a fix until this is explained.
2. HOW are multiple negatives currently staged? Is there a one-ACTION-
   per-turn assumption in parseActionBlock (single regex match) that
   makes "16 terms" impossible in one response? Confirm whether the
   handler can persist more than one action per turn today.

DESIGN DIRECTION (Phase A refines around the findings):
A. GUARD THAT WORKS: the empty/whitespace keyword_text check for
   add_negative_keyword must sit where it CANNOT be bypassed — at the
   same choke point that finalizes/executes the action, checking the
   SAME field the executor reads. An add_negative_keyword with no
   keyword_text must become requires_review (or be rejected pre-insert)
   on EVERY path, verified by a test that reproduces the 7/6 executor
   failure and shows it now stops at staging.
B. SERVER-AUTHORITATIVE TERMS: for multi-term requests, do NOT rely on
   the model to re-emit clean ACTION blocks per term. Prefer: the model
   emits the LIST of terms + the campaign once; the server expands that
   into one properly-formed action per term, each with keyword_text set
   from the list and campaign_id resolved from the FETCHED search-term
   data (not the model's reworded name). If that's too large for this
   session, fall back to: enforce one-term-per-turn with a guard so a
   malformed batch action is rejected legibly, and make the prompt loop
   reliably. State which approach in Phase A.
C. PROMPT: fpb.js batch instruction must forbid rewording campaign_name
   (use the exact name/id from fetched data) and require keyword_text on
   every negative action, one concrete term each.

PHASE A (STOP): answer the two INVESTIGATE questions with real code
citations, then propose the guard-placement fix and the multi-term
approach (server-expand vs enforced-loop) with tradeoffs. Recommend one.
PHASE B implement. PHASE C: floor 691+; tests MUST include a regression
that reproduces the 7/6 batch failure (absent keyword_text + reworded
campaign) and proves it now either stages correctly with server-resolved
data OR is caught at staging with a clear reason — never reaches the
executor with a null keyword_text. Safety-reviewer verdict verbatim,
confirming no path lets an unverified/placeholder campaign_id or empty
keyword_text reach a live mutation.

DoD: "negate all the carport/shed/competitor terms" stages N valid
actions (real campaign_id, populated keyword_text) that approve and land
in Google Ads; a malformed negative is caught at staging, never at the
executor.
