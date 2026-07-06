# SESSION 07a — Guard removed-campaign fix + full campaign visibility
AUTONOMY: gated
# MONEY PATH — safety-reviewer mandatory.

GOAL: Two linked bugs found in live testing 7/6:
  1. Budget guard counts REMOVED/dead campaigns against the account cap,
     inflating projected spend (~$98 projected vs $73 real) and
     FALSE-BLOCKING legitimate scaling of winners.
  2. fetchGoogleAdsData returns only top-N-by-spend campaigns, so chat
     reasoning works from incomplete data and disagrees with the guard.
Both must see the SAME complete, correct, enabled-only campaign set.

VERIFIED (live, 7/6): Google Ads UI shows Total Account $73/day across 4
ENABLED campaigns (Location $30 [now trimmed], Kits $22, Pole Barns $6,
Branded $15) plus 6 REMOVED campaigns still carrying budget values
($3-$12 each). Guard's live-state GAQL uses status != 'REMOVED' but is
still summing dead budget — either the filter isn't applied to the
budget-sum path or it counts PAUSED. Cap is $90; real headroom ~$17.

FILE SCOPE: api/lib/budget-guards.js (the live-state fetch/sum only —
NOT the pure evaluator rules, which are correct), api/google-ads.js
(fetchGoogleAdsData campaign filter/limit), tests/budget-guards.test.js,
tests/execute-action.test.js if mock shapes change. Do NOT touch the
guard rule logic, the S05 gate placement, or execute-action-logic.js
dispatch.

DESIGN (Phase A refines):
1. Guard live-state fetch: the enabled-campaign budget sum MUST count
   only campaigns with status = 'ENABLED' (not just != REMOVED — PAUSED
   and REMOVED both excluded from the active-spend projection). Verify
   against the GAQL: filter campaign.status = 'ENABLED' for the cap-sum
   query. The campaign being changed is always included at its NEW value.
2. fetchGoogleAdsData: return ALL enabled campaigns (remove or raise the
   top-N limit; keep REMOVED excluded). Add campaign.status so chat can
   see enabled/paused. Keep daily_budget (from S03/S06 work).
3. Consistency invariant: after this session, the campaign set + budget
   sum the guard uses and the set fetchGoogleAdsData returns are derived
   from the same status filter, so chat and guard never disagree on
   what's active or what total spend is.

PHASE A (STOP): show the exact GAQL status filters before/after for both
the guard sum and fetchGoogleAdsData, and a worked example proving the
$73 real total is what the guard would now compute for this account.
PHASE B implement. PHASE C floor 653+; tests must include: removed
campaigns excluded from cap sum, paused excluded from cap sum, a
regression test reproducing the 7/6 false-block ($73 real not $98) that
now passes (allows the Kits->$25 move), fetchGoogleAdsData returns all
enabled campaigns. Safety-reviewer on the diff: confirm the guard still
BLOCKS real over-cap spend (only the phantom inflation is removed, not
the protection). Verdict verbatim.

DoD: guard computes $73 (not $98) for this account; a Kits increase to
$25 that was false-blocked now passes; chat and guard agree on the
active campaign set; guard still blocks a genuine over-$90 projection.
