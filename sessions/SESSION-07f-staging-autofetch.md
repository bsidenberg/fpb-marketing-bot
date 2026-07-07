# SESSION 07f — Auto-fetch data on the action-staging turn (close the multi-turn state gap)
AUTONOMY: gated
# MONEY-PATH ADJACENT — safety-reviewer required.

GOAL: The negative-keyword pipeline works EXCEPT across turns. The analysis
turn auto-fetches search terms (WASTE_QUESTION_RE -> fetchSearchTerms ->
context), but the STAGING turn ("negate all", or "negate <list>") does NOT
auto-fetch, so the model has no current-turn data. Per the S07c/e safety
rules it then correctly REFUSES to guess campaign_name/keyword_text from a
prior turn — so the batch never stages. Result: user cannot complete a
batch negation in conversation. Fix: the staging turn must have the same
real data available so server-side expansion (S07e) can run.

VERIFIED TONIGHT (do not re-derive):
- "What search terms are wasting my spend?" -> real terms load, correct.
- "negate all" (next turn) -> model asks user to fetch again; refuses to
  invent terms/campaign per S07c/e rules. Rules are CORRECT; the gap is
  missing data on the staging turn.
- S07e server-side expansion + bypass-proof empty-keyword guard shipped
  (commit d0a1f0e). Executor sends keyword.text structured (safe).
- WASTE_QUESTION_RE = /waste|search term|junk|negative keyword|wasted
  spend/i (chat.js:60). Action phrasings like "negate all the carport
  terms" may NOT match it (no "waste"/"search term" token), so no fetch.

INVESTIGATE FIRST (Phase A must answer with real code before proposing):
1. On a "negate"/staging turn, what data (if any) is in context? Trace
   whether fetchSearchTerms and fetchGoogleAdsData run. Confirm the
   trigger-regex gap: does "negate the carport terms" fail WASTE_QUESTION_RE
   AND the ad-data trigger, so NEITHER fetch fires?
2. Where does S07e server-side expansion read its term list and campaign
   data FROM? If it expands from fetched search-term rows, then no-fetch =
   no expansion. Confirm the exact dependency.
3. Is there any conversation-history mechanism that could carry prior-turn
   fetched data forward? (If prior turns' data were available, the model
   wouldn't need to re-fetch.) Determine why it isn't.

DESIGN DIRECTION (Phase A refines around findings):
A. STAGING AUTO-FETCH: when the user's message is an ACTION/staging intent
   for negatives (negate/exclude/add negative keyword + terms or "all"),
   the server auto-fetches search terms (and campaign roster) BEFORE
   building the response, so the model+expansion have real data on THIS
   turn. Reuse the existing fetchSearchTerms path; do not duplicate.
   Widen the trigger so action-phrasings ("negate...", "exclude...",
   "add negative...") fetch too, not only question-phrasings.
B. SERVER-AUTHORITATIVE EXPANSION (must hold): terms the user named are
   matched against fetched search-term rows; campaign_id resolved from
   fetched campaign data by name; anything the user names that ISN'T in
   fetched data is either (i) still negatable if it's a plain literal term
   the user explicitly typed (a user-provided term is legitimate, unlike a
   model-invented one) with campaign_id resolved from fetched campaign
   roster, or (ii) flagged requires_review if the campaign can't be
   resolved. Decide and state which in Phase A — KEY DISTINCTION: a term
   the USER typed is trusted input; the rule against "terms from prior
   turn / from memory" was about the MODEL inventing them, not the user
   providing them. This distinction may be the cleanest fix.
C. Preserve all S07c/e guards: empty keyword_text -> requires_review;
   campaign_id must be real (from fetched roster) or requires_review;
   never a model-reworded campaign name.

PHASE A (STOP): answer the 3 investigate questions with code citations,
then propose the minimal change: (a) widen fetch trigger to action
phrasings, (b) auto-fetch on staging turns, (c) clarify user-typed-term
vs model-invented-term handling. Recommend the smallest change that lets
"negate <explicit list> from Location" AND "negate all the waste" both
stage clean.
PHASE B implement. PHASE C: floor 710+ (or current actual); tests: a
staging-intent message triggers the fetch; a batch of user-named terms
stages N clean actions with real campaign_id + keyword_text; an
unresolvable campaign -> requires_review; the analysis->negate two-turn
flow now completes without re-asking. Safety-reviewer verdict verbatim:
confirm no model-invented term or placeholder campaign_id can reach a
live mutation, and user-typed terms are handled as trusted input.

DoD: user asks "what's wasting my spend?", sees terms, says "negate all"
-> N valid actions stage for one-click approval and land in Google Ads.
Also: "negate <explicit list> from <campaign>" stages clean in one turn.
No manual Google Ads step anywhere.
