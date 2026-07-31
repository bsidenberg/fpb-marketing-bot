// ============================================================
// tests/recommendation-score.test.js — SESSION-08A scoring + queue selection
//
// Pure module, pure tests: no mocks anywhere in this file.
//
// Headline proofs:
//   E7  — a historically-failing action class is down-weighted from fixtures
//   E6  — the queue cap drops the LOWEST-scoring above-threshold items, never pads
//   D-1 — nothing auto-executes at Phase A launch
//   A6  — the learning gate can never INFLATE a score above neutral
//   A12 — omitting outcome history COSTS you (it is not the same as a clean record)
//   A13 — renaming an action class does not escape its track record for free
//
// Where a proof matters, it is stated as a PROPERTY (monotonicity, bounds,
// invariance under a lie) rather than by recomputing the formula in the
// assertion — a test that re-implements the implementation agrees with it even
// when it is wrong.
// ============================================================

import { describe, it, expect } from 'vitest';

import { resolveObjectiveConfig } from '../api/lib/objective.js';
import {
  gradeOutcome,
  actionClassWeight,
  computeConfidence,
  computeRiskPenalty,
  scoreRecommendation,
  selectQueue,
  scoreAndSelect,
} from '../api/lib/recommendation-score.js';

const CFG = resolveObjectiveConfig({}, null);

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** A failed outcome, graded on CPQL: cost per qualified lead got worse. */
const failedOutcome = (actionType, i = 0) => ({
  action_id: `a-fail-${i}`,
  action_type: actionType,
  is_manual_action: false,
  confidence: 'medium',
  cost_per_qualified_lead_before: 50,
  cost_per_qualified_lead_after: 80,   // worse
  qualified_leads_before: 10,
  qualified_leads_after: 10,           // no collapse — the action simply did not work
});

/** A successful outcome, graded on the real target: gross profit. */
const successOutcome = (actionType, i = 0) => ({
  action_id: `a-win-${i}`,
  action_type: actionType,
  is_manual_action: false,
  confidence: 'high',
  gross_profit_before: 1000,
  gross_profit_after: 1400,
});

/**
 * A clean, well-evidenced candidate. Sold rates are DERIVED from terminal lead
 * counts — the candidate cannot assert them.
 *   before: 100 qualified, 20 booked / 80 lost => sold rate 0.2, measured
 *   after:  120 qualified, quality held        => delta = 20 x 0.2 = 4
 */
const candidate = (over = {}) => ({
  id: 'c-1',
  actionType: 'adjust_budget',
  campaignId: 'camp-1',
  shape: 'volume_change',
  accountSoldRatePrior: 0.2,
  before: { qualifiedLeads: 100, booked: 20, lost: 80 },
  after: { qualifiedLeads: 120 },
  segment: { conversions: 50, lookbackDays: 30 },
  analysisConfidence: 0.8,
  attributionConfidence: 'high',
  outcomes: [],
  ...over,
});

/**
 * S-08A.1a (2026-07-30) rows-based waste_removal candidate. Builds a two-row
 * fetch (the removed cohort's term + the rest of the host campaign) so
 * deriveRemovedCohort/deriveHostFromRows have real, bindable, cross-checkable
 * data — matching exactly what api/google-ads.js fetchSearchTerms returns
 * (post S-07f.0: rowId, campaignId, searchTerm, cost, conversions).
 */
function wasteRemovalCandidate({
  id = 'neg', campaignId = 'camp-1',
  removedTerm = 'junk term',
  removedCost, removedConversions, removedBooked, removedLost,
  otherTerm = 'other term', otherCost, otherConversions,
  hostBooked, hostLost,
  expectedSearchTerms,
  extraRows = [],
  over = {},
} = {}) {
  const rows = [
    { rowId: `row-removed-${id}`, campaignId, searchTerm: removedTerm, cost: removedCost, conversions: removedConversions },
    { rowId: `row-other-${id}`, campaignId, searchTerm: otherTerm, cost: otherCost, conversions: otherConversions },
    ...extraRows,
  ];
  return {
    id, actionType: 'add_negative_keyword', campaignId,
    shape: 'waste_removal',
    accountSoldRatePrior: 0.2,
    rows,
    hostCampaignId: campaignId,
    expectedSearchTerms: expectedSearchTerms || [removedTerm],
    fetchId: `fetch-${id}`,
    window: { startDate: '2026-07-01', endDate: '2026-07-30' },
    removedBooked, removedLost, hostBooked, hostLost,
    segment: { conversions: 40, lookbackDays: 30 },
    analysisConfidence: 0.8, attributionConfidence: 'high', outcomes: [],
    ...over,
  };
}

/** A pre-scored item, for selection tests. */
const scored = (id, score, over = {}) => ({
  id,
  score,
  actionType: 'adjust_budget',
  campaignId: `camp-${id}`,
  riskPenalty: 0,
  ...over,
});

// ── gradeOutcome ─────────────────────────────────────────────────────────────
describe('recommendation-score — gradeOutcome', () => {
  it('grades on gross profit when present (the real target)', () => {
    expect(gradeOutcome(successOutcome('adjust_budget'), CFG)).toEqual({ success: true, basis: 'gross_profit' });
    expect(gradeOutcome({ ...successOutcome('adjust_budget'), gross_profit_after: 800 }, CFG))
      .toEqual({ success: false, basis: 'gross_profit' });
  });

  it('falls back to cost-per-QUALIFIED-lead — the north-star metric', () => {
    const cpql = {
      action_type: 'adjust_budget', is_manual_action: false, confidence: 'medium',
      gross_profit_before: null, gross_profit_after: null,   // null in production today
      cost_per_qualified_lead_before: 100, cost_per_qualified_lead_after: 50,
      qualified_leads_before: 20, qualified_leads_after: 18,
    };
    expect(gradeOutcome(cpql, CFG)).toEqual({ success: true, basis: 'cost_per_qualified_lead' });
  });

  it('FINDING 6: there is NO CPL rung — CPL alone cannot certify success', () => {
    // The killer: gross_profit_* is NULL in production, so CPL would have been the
    // LIVE grading basis. An outcome where CPL fell, volume rose and sold-rate
    // collapsed grades success=true on CPL — the learning gate would have REWARDED
    // exactly the junk-traffic class the objective exists to reject.
    const cplOnly = {
      action_type: 'adjust_budget', is_manual_action: false, confidence: 'low',
      cpl_before: 50, cpl_after: 25,        // CPL halved! looks like a triumph
      leads_before: 100, leads_after: 300,  // and volume tripled!
      // ...but there is no qualified-lead or profit evidence at all.
    };
    expect(gradeOutcome(cplOnly, CFG)).toBeNull(); // ABSTAIN, never "success"
  });

  // ── S-04B (R-014): the sold-rate rung ────────────────────────────────────
  // The exact failure gradeOutcome used to be blind to: qualified-lead volume
  // rises, sold rate collapses, CPQL still improves (more qualified leads per
  // dollar) — and the CPQL-only ladder graded it a success, so E7 would have
  // up-weighted the action class producing more, cheaper, worse leads.
  it('R-014 KILLER: volume-up + sold-rate-down grades as FAILURE, even though CPQL improved', () => {
    const volumeUpSoldRateDown = {
      action_type: 'adjust_budget', is_manual_action: false, confidence: 'medium',
      gross_profit_before: null, gross_profit_after: null, // NULL in production today
      cost_per_qualified_lead_before: 100, cost_per_qualified_lead_after: 60, // CPQL "improved"
      qualified_leads_before: 20, qualified_leads_after: 40,                  // volume doubled
      booked_leads_before: 10, lost_leads_before: 10,   // 50% sold rate before
      booked_leads_after:   8, lost_leads_after:  32,   // 20% sold rate after — collapsed
    };
    const g = gradeOutcome(volumeUpSoldRateDown, CFG);
    expect(g.success).toBe(false);
    expect(g.basis).toBe('sold_rate');
  });

  it('sold_rate rung: an improved or held sold rate grades as success, ahead of CPQL', () => {
    const soldRateHeld = {
      action_type: 'adjust_budget', is_manual_action: false, confidence: 'medium',
      cost_per_qualified_lead_before: 100, cost_per_qualified_lead_after: 150, // CPQL "worsened"
      qualified_leads_before: 20, qualified_leads_after: 20,
      booked_leads_before: 10, lost_leads_before: 10,  // 50%
      booked_leads_after:  12, lost_leads_after:  8,   // 60% — improved
    };
    const g = gradeOutcome(soldRateHeld, CFG);
    // sold_rate rung fires FIRST and says success — CPQL's opinion never
    // gets a vote once sold-rate data is measured on both sides.
    expect(g.success).toBe(true);
    expect(g.basis).toBe('sold_rate');
  });

  it('sold_rate rung ABSTAINS below the minimum sample and falls through to CPQL', () => {
    const thinSample = {
      action_type: 'adjust_budget', is_manual_action: false, confidence: 'medium',
      cost_per_qualified_lead_before: 100, cost_per_qualified_lead_after: 50,
      qualified_leads_before: 20, qualified_leads_after: 18,
      booked_leads_before: 1, lost_leads_before: 1, // terminal=2, below default min sample of 5
      booked_leads_after:  1, lost_leads_after:  0,
    };
    const g = gradeOutcome(thinSample, CFG);
    expect(g.basis).toBe('cost_per_qualified_lead'); // fell through, not sold_rate
  });

  it('sold_rate rung ABSTAINS (falls through) when terminal data is missing on either side', () => {
    const missingAfter = {
      action_type: 'adjust_budget', is_manual_action: false, confidence: 'medium',
      cost_per_qualified_lead_before: 100, cost_per_qualified_lead_after: 50,
      qualified_leads_before: 20, qualified_leads_after: 18,
      booked_leads_before: 10, lost_leads_before: 10,
      booked_leads_after: null, lost_leads_after: null, // not yet measured
    };
    const g = gradeOutcome(missingAfter, CFG);
    expect(g.basis).toBe('cost_per_qualified_lead');
  });

  it('A7: an efficiency "win" bought by collapsing volume is NOT a success', () => {
    const collapsed = {
      action_type: 'adjust_budget', is_manual_action: false, confidence: 'medium',
      cost_per_qualified_lead_before: 100, cost_per_qualified_lead_after: 50,
      qualified_leads_before: 20, qualified_leads_after: 5,   // lost 75% of volume
    };
    const g = gradeOutcome(collapsed, CFG);
    expect(g.success).toBe(false);
    expect(g.basis).toBe('cost_per_qualified_lead_volume_collapsed');
  });

  it('excludes manual actions — Brian\'s own changes are not Prime\'s track record', () => {
    expect(gradeOutcome({ ...failedOutcome('adjust_budget'), is_manual_action: true }, CFG)).toBeNull();
  });

  it('excludes insufficient_data — a young action is not a failed action', () => {
    expect(gradeOutcome({ ...failedOutcome('adjust_budget'), confidence: 'insufficient_data' }, CFG)).toBeNull();
  });

  it('ignores the human-readable conclusion string entirely', () => {
    // conclusion is prose, not a grade. A glowing write-up cannot rescue a
    // numerically-failed outcome.
    expect(gradeOutcome({ ...failedOutcome('adjust_budget'), conclusion: 'Huge success, big win!' }, CFG).success).toBe(false);
  });
});

// ── E7: the learning gate ────────────────────────────────────────────────────
describe('recommendation-score — actionClassWeight (eval E7)', () => {
  it('COLD START: zero outcomes => weight EXACTLY 1.0 (no invented signal)', () => {
    // action_outcomes has 0 rows in production. The module must have no opinion,
    // rather than a fabricated one.
    const w = actionClassWeight('adjust_budget', [], CFG);
    expect(w.weight).toBe(1.0);
    expect(w.n).toBe(0);
    expect(w.provided).toBe(true);
  });

  it('E7: an action class that has failed 6 times is DOWN-WEIGHTED', () => {
    const outcomes = Array.from({ length: 6 }, (_, i) => failedOutcome('adjust_budget', i));
    const w = actionClassWeight('adjust_budget', outcomes, CFG);
    expect(w.weight).toBeLessThan(1);
    expect(w.n).toBe(6);
    expect(w.successes).toBe(0);
    expect(w.reason).toBe('down_weighted_by_outcome_history');
  });

  it('E7: the down-weight is scoped to the FAILING class only', () => {
    const outcomes = Array.from({ length: 6 }, (_, i) => failedOutcome('adjust_budget', i));
    expect(actionClassWeight('add_negative_keyword', outcomes, CFG).weight).toBe(1.0);
  });

  it('PROPERTY: the down-weight deepens monotonically as failures accumulate', () => {
    let prev = Infinity;
    for (const n of [0, 1, 2, 4, 8, 16]) {
      const outcomes = Array.from({ length: n }, (_, i) => failedOutcome('adjust_budget', i));
      const w = actionClassWeight('adjust_budget', outcomes, CFG).weight;
      expect(w).toBeLessThanOrEqual(prev);
      prev = w;
    }
  });

  it('A6: a perfect record is clamped to neutral — the gate NEVER inflates', () => {
    const outcomes = Array.from({ length: 6 }, (_, i) => successOutcome('adjust_budget', i));
    expect(actionClassWeight('adjust_budget', outcomes, CFG).weight).toBe(1.0);
  });

  it('A6: config CANNOT raise the ceiling to buy a multiplier', () => {
    // A DB row is not a deploy and nobody reviews a DB row. learning_weight_ceiling:3
    // would have turned the down-weight-only gate into a score multiplier.
    const cfg = resolveObjectiveConfig({ scoring: { defaults: { learning_weight_ceiling: 3 } } }, null);
    const outcomes = Array.from({ length: 6 }, (_, i) => successOutcome('adjust_budget', i));
    expect(actionClassWeight('adjust_budget', outcomes, cfg).weight).toBeLessThanOrEqual(1.0);
  });

  it('PROPERTY: the weight is always within [floor, 1.0], for any history', () => {
    const histories = [
      [], [successOutcome('adjust_budget')],
      Array.from({ length: 200 }, (_, i) => failedOutcome('adjust_budget', i)),
      Array.from({ length: 200 }, (_, i) => successOutcome('adjust_budget', i)),
    ];
    for (const h of histories) {
      const w = actionClassWeight('adjust_budget', h, CFG).weight;
      expect(w).toBeGreaterThanOrEqual(CFG.learning_weight_floor);
      expect(w).toBeLessThanOrEqual(1.0);
    }
  });

  it('A12: OMITTING the history costs you — it is not the same as a clean record', () => {
    // Both used to yield n=0 => weight 1.0, so "I didn't fetch history" was
    // indistinguishable from "this class has a spotless record", and free.
    const fetched = actionClassWeight('adjust_budget', [], CFG);
    const omitted = actionClassWeight('adjust_budget', undefined, CFG);
    expect(fetched.weight).toBe(1.0);
    expect(omitted.weight).toBeLessThan(1.0);
    expect(omitted.provided).toBe(false);
    expect(omitted.reason).toBe('outcome_history_not_provided');
  });

  it('A12: PROPERTY — silence never beats disclosure, for ANY track record', () => {
    // The subtler half. At any missing-history weight ABOVE the floor, a caller
    // holding a BAD class still profits by staying quiet (0.6 scored 2.4 against
    // an honest 1.6). Omission is pinned to the WORST honest case.
    const omitted = actionClassWeight('adjust_budget', undefined, CFG).weight;

    for (const n of [0, 1, 3, 6, 20, 100]) {
      const allFailed = Array.from({ length: n }, (_, i) => failedOutcome('adjust_budget', i));
      const disclosed = actionClassWeight('adjust_budget', allFailed, CFG).weight;
      expect(omitted).toBeLessThanOrEqual(disclosed);
    }
  });

  it('excluded rows (manual / insufficient_data) do not count as failures', () => {
    const outcomes = [
      { ...failedOutcome('adjust_budget', 1), is_manual_action: true },
      { ...failedOutcome('adjust_budget', 2), confidence: 'insufficient_data' },
    ];
    expect(actionClassWeight('adjust_budget', outcomes, CFG).weight).toBe(1.0);
  });

  it('foreign outcomes cannot be injected to shift another class\'s weight', () => {
    const foreign = Array.from({ length: 6 }, (_, i) => successOutcome('pause_campaign', i));
    expect(actionClassWeight('adjust_budget', foreign, CFG).n).toBe(0);
  });
});

// ── Confidence ───────────────────────────────────────────────────────────────
describe('recommendation-score — computeConfidence', () => {
  it('PROPERTY: confidence is always within [0,1], for any input', () => {
    const wild = [
      { analysisConfidence: 5 }, { analysisConfidence: -3 }, { analysisConfidence: NaN },
      { analysisConfidence: 'yes' }, { analysisConfidence: true }, { analysisConfidence: Infinity },
      { attributionConfidence: 'nonsense' },
    ];
    for (const w of wild) {
      const c = computeConfidence({ actionType: 'adjust_budget', outcomes: [], ...w }, CFG);
      expect(c.confidence).toBeGreaterThanOrEqual(0);
      expect(c.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('a self-reported model confidence of 5 cannot exceed the bound', () => {
    const c = computeConfidence(
      { analysisConfidence: 5, actionType: 'adjust_budget', outcomes: [], attributionConfidence: 'high', soldRateMeasured: true },
      CFG,
    );
    expect(c.confidence).toBeLessThanOrEqual(1);
  });

  it('E7 flows into confidence: a failing class lowers it', () => {
    const outcomes = Array.from({ length: 6 }, (_, i) => failedOutcome('adjust_budget', i));
    const clean = computeConfidence({ analysisConfidence: 0.8, actionType: 'adjust_budget', outcomes: [], attributionConfidence: 'high', soldRateMeasured: true }, CFG);
    const dirty = computeConfidence({ analysisConfidence: 0.8, actionType: 'adjust_budget', outcomes, attributionConfidence: 'high', soldRateMeasured: true }, CFG);
    expect(dirty.confidence).toBeLessThan(clean.confidence);
  });

  it('weak attribution and an unmeasured sold rate both erode confidence', () => {
    const strong = computeConfidence({ analysisConfidence: 0.8, actionType: 'adjust_budget', outcomes: [], attributionConfidence: 'high', soldRateMeasured: true }, CFG);
    const weak   = computeConfidence({ analysisConfidence: 0.8, actionType: 'adjust_budget', outcomes: [], attributionConfidence: 'low', soldRateMeasured: false }, CFG);
    expect(weak.confidence).toBeLessThan(strong.confidence);
  });
});

// ── Risk ─────────────────────────────────────────────────────────────────────
describe('recommendation-score — computeRiskPenalty', () => {
  // A known action type + measured sold rate isolates the rule under test.
  const clean = { actionType: 'adjust_budget', soldRateMeasured: true };

  it('penalises a holdout class', () => {
    const r = computeRiskPenalty({ ...clean, isHoldoutClass: true }, CFG);
    expect(r.penalty).toBe(0.5);
    expect(r.reasons).toContain('holdout_class');
  });

  it('penalises reducing a protected campaign (the branded one)', () => {
    const r = computeRiskPenalty({ ...clean, campaignId: '21613067518', action: 'pause' }, CFG);
    expect(r.penalty).toBe(1.0);
  });

  it('does NOT penalise an increase on a protected campaign — protection is about cuts', () => {
    const r = computeRiskPenalty({ ...clean, campaignId: '21613067518', action: 'increase' }, CFG);
    expect(r.reasons).not.toContain('protected_campaign_reduction');
  });

  it('penalises approaching the 25% always-approval line', () => {
    expect(computeRiskPenalty({ ...clean, changePct: 22 }, CFG).reasons).toContain('near_major_change_pct');
    expect(computeRiskPenalty({ ...clean, changePct: 10 }, CFG).reasons).not.toContain('near_major_change_pct');
  });

  it('an ABSENT soldRateMeasured flag is treated as unmeasured — omission dodges nothing', () => {
    const r = computeRiskPenalty({ actionType: 'adjust_budget' }, CFG);
    expect(r.reasons).toContain('unmeasured_segment');
  });

  it('A13: an UNKNOWN action class is penalised — renaming is not a free escape', () => {
    // An LLM naming its action "adjust_budget_v2" escaped its own track record.
    const r = computeRiskPenalty({ ...clean, actionType: 'adjust_budget_v2' }, CFG);
    expect(r.reasons).toContain('unknown_action_type');
    expect(r.penalty).toBeGreaterThan(0);
  });

  it('every action type in the actions CHECK enum is recognised', () => {
    for (const t of ['adjust_budget', 'add_negative_keyword', 'pause_campaign', 'enable_campaign']) {
      expect(computeRiskPenalty({ ...clean, actionType: t }, CFG).reasons).not.toContain('unknown_action_type');
    }
  });

  it('FAILS CLOSED on a corrupt penalty config — the penalty must not vanish', () => {
    // round6(NaN) => null, and `score - null` is `score - 0`: every penalty
    // silently disappeared and riskPenalty reported as null, not an error.
    const corrupt = resolveObjectiveConfig({ scoring: { defaults: { risk_penalties: { holdout: 'oops' } } } }, null);
    const r = computeRiskPenalty({ ...clean, isHoldoutClass: true }, corrupt);
    expect(r.penalty).toBe(0.5);              // fell back to the code default
    expect(Number.isFinite(r.penalty)).toBe(true);
  });

  it('PROPERTY: the penalty is always finite and non-negative — risk is never a reward', () => {
    const configs = [
      CFG,
      resolveObjectiveConfig({ scoring: { defaults: { risk_penalties: { holdout: -99 } } } }, null),
      resolveObjectiveConfig({ scoring: { defaults: { risk_penalties: { holdout: NaN } } } }, null),
    ];
    for (const cfg of configs) {
      const r = computeRiskPenalty({ ...clean, isHoldoutClass: true }, cfg);
      expect(Number.isFinite(r.penalty)).toBe(true);
      expect(r.penalty).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── scoreRecommendation ──────────────────────────────────────────────────────
describe('recommendation-score — scoreRecommendation', () => {
  it('scores a clean candidate above the bar', () => {
    const r = scoreRecommendation(candidate(), CFG);
    expect(r.expectedDeltaProfitableLeads).toBeCloseTo(4, 6);
    expect(r.dataSufficiencyGate).toBe(1);
    expect(r.soldRateMeasured).toBe(true);
    expect(r.score).toBeGreaterThan(0);
    expect(r.aboveThreshold).toBe(true);
  });

  it('E7 end-to-end: the SAME candidate scores lower in a failing action class', () => {
    const outcomes = Array.from({ length: 6 }, (_, i) => failedOutcome('adjust_budget', i));
    const clean = scoreRecommendation(candidate(), CFG);
    const dirty = scoreRecommendation(candidate({ outcomes }), CFG);
    expect(dirty.score).toBeLessThan(clean.score);
    expect(dirty.explain.confidence.learningN).toBe(6);
  });

  it('E3: the data-sufficiency gate zeroes the positive term entirely', () => {
    const r = scoreRecommendation(candidate({ segment: { conversions: 3, lookbackDays: 30 } }), CFG);
    expect(r.dataSufficiencyGate).toBe(0);
    expect(r.score).toBeLessThanOrEqual(0);
    expect(r.aboveThreshold).toBe(false);
  });

  it('A1 end-to-end: the junk-traffic candidate scores NEGATIVE and is rejected', () => {
    const junk = scoreRecommendation(
      candidate({ after: { qualifiedLeads: 150, soldRate: 0.10 } }), // CPL down, quality halved
      CFG,
    );
    expect(junk.expectedDeltaProfitableLeads).toBeLessThan(0);
    expect(junk.score).toBeLessThan(0);
    expect(junk.aboveThreshold).toBe(false);
  });

  it('A3 end-to-end: an understated baseline cannot rescue a bad action', () => {
    const starve = candidate({
      before: { qualifiedLeads: 100, booked: 40, lost: 60, soldRate: 0.01 }, // the lie
      after: { qualifiedLeads: 60 },
    });
    expect(scoreRecommendation(starve, CFG).score).toBeLessThan(0);
  });

  it('A13: renaming an action class to escape its track record must NOT pay', () => {
    // The subtle one. A flat risk penalty was not enough: the learning down-weight
    // a rename dodges scales with the delta, so for a big enough delta renaming
    // still won (3.0 renamed vs 1.6 honest). An unknown class is now UNSCORABLE.
    const failures = Array.from({ length: 6 }, (_, i) => failedOutcome('adjust_budget', i));

    const honest  = scoreRecommendation(candidate({ outcomes: failures }), CFG);
    const renamed = scoreRecommendation(candidate({ outcomes: failures, actionType: 'adjust_budget_v2' }), CFG);

    expect(honest.score).toBeGreaterThan(0);            // down-weighted, but still viable
    expect(renamed.score).toBeLessThan(honest.score);   // the rename must never pay
    expect(renamed.score).toBeLessThan(0);              // and it is not scorable at all
    expect(renamed.dataSufficiencyGate).toBe(0);
    expect(renamed.explain.reasons).toContain('unknown_action_type_not_scorable');

    // And it never reaches the queue.
    expect(selectQueue([renamed], CFG).queued).toHaveLength(0);
  });

  it('PROPERTY: score is MONOTONE NON-INCREASING in the projected sold rate', () => {
    // The whole ballgame. If a lower projected quality could ever raise the score,
    // every other defense is theatre.
    let prev = Infinity;
    for (const sr of [1.0, 0.5, 0.2, 0.1, 0.05, 0]) {
      const s = scoreRecommendation(candidate({ after: { qualifiedLeads: 120, soldRate: sr } }), CFG).score;
      expect(s).toBeLessThanOrEqual(prev + 1e-9);
      prev = s;
    }
  });

  it('PROPERTY: no candidate can score above its own expected delta', () => {
    // confidence <= 1, gate <= 1, risk >= 0 => score <= delta, always. All the
    // leverage lives in delta, which is where the derivation happens.
    const cases = [
      candidate(),
      candidate({ analysisConfidence: 99 }),
      candidate({ attributionConfidence: 'bogus' }),
      candidate({ outcomes: undefined }),
    ];
    for (const c of cases) {
      const r = scoreRecommendation(c, CFG);
      expect(r.score).toBeLessThanOrEqual(r.expectedDeltaProfitableLeads + 1e-9);
    }
  });

  it('risk can sink a marginal-but-risky action outright (absolute penalty)', () => {
    const marginal = scoreRecommendation(
      candidate({ after: { qualifiedLeads: 101 }, isHoldoutClass: true }),
      CFG,
    );
    expect(marginal.score).toBeLessThan(0);
  });

  it('returns a full explain object — the point of the soft D-2 threshold', () => {
    const r = scoreRecommendation(candidate(), CFG);
    expect(r.explain).toHaveProperty('objective');
    expect(r.explain).toHaveProperty('confidence');
    expect(r.explain).toHaveProperty('risk');
    expect(r.explain.threshold).toBe(0.25);
  });

  it('aboveThreshold agrees with selectQueue at the boundary (same rounded number)', () => {
    const r = scoreRecommendation(candidate(), CFG);
    const { queued } = selectQueue([r], CFG);
    expect(r.aboveThreshold).toBe(queued.length === 1);
  });
});

// ── D-1: fully gated ─────────────────────────────────────────────────────────
describe('recommendation-score — D-1 auto-execute posture', () => {
  it('D-1: NOTHING auto-executes under the launch defaults', () => {
    for (const type of ['adjust_budget', 'add_negative_keyword', 'pause_campaign']) {
      expect(scoreRecommendation(candidate({ actionType: type }), CFG).autoExecute).toBe(false);
    }
  });

  it('stays gated even for an allowlisted class while the master flag is off', () => {
    const cfg = { ...CFG, auto_execute_enabled: false, auto_execute_allowlist: ['add_negative_keyword'] };
    expect(scoreRecommendation(candidate({ actionType: 'add_negative_keyword' }), cfg).autoExecute).toBe(false);
  });

  it('only auto-executes when BOTH the flag is on and the class is allowlisted', () => {
    const cfg = { ...CFG, auto_execute_enabled: true, auto_execute_allowlist: ['add_negative_keyword'] };
    expect(scoreRecommendation(candidate({ actionType: 'add_negative_keyword' }), cfg).autoExecute).toBe(true);
    expect(scoreRecommendation(candidate({ actionType: 'pause_campaign' }), cfg).autoExecute).toBe(false);
  });
});

// ── E6: threshold + volume cap ───────────────────────────────────────────────
describe('recommendation-score — selectQueue (eval E6)', () => {
  const OPEN = { ...CFG, max_per_campaign: 99, max_per_action_class: 99 }; // isolate the cap

  it('E6: with more than cap qualifying actions, the LOWEST-scoring are dropped', () => {
    const items = Array.from({ length: 12 }, (_, i) => scored(`i${i}`, 12 - i)); // scores 12..1
    const { queued, dropped } = selectQueue(items, OPEN);

    expect(queued).toHaveLength(10);
    expect(dropped).toHaveLength(2);
    expect(dropped.map((d) => d.score).sort((a, b) => a - b)).toEqual([1, 2]); // the weakest two
    expect(dropped.every((d) => d.dropReason === 'volume_cap')).toBe(true);
    expect(queued.map((q) => q.score)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  });

  it('never pads the queue with noise to fill the cap', () => {
    // Cap is 10, but only two items clear the bar. A short queue is correct.
    const items = [scored('a', 5), scored('b', 0.3), scored('c', 0.1), scored('d', -2)];
    const { queued, dropped } = selectQueue(items, OPEN);
    expect(queued.map((q) => q.id)).toEqual(['a', 'b']);
    expect(dropped.filter((d) => d.dropReason === 'below_threshold').map((d) => d.id)).toEqual(['c', 'd']);
  });

  it('drops exactly at the threshold boundary', () => {
    expect(selectQueue([scored('at', 0.25), scored('below', 0.249)], OPEN).queued.map((q) => q.id)).toEqual(['at']);
  });

  it('a NaN score fails closed (dropped, never queued)', () => {
    expect(selectQueue([scored('nan', NaN)], OPEN).queued).toHaveLength(0);
  });

  it('A8: one campaign cannot flood the queue (max_per_campaign)', () => {
    const items = Array.from({ length: 5 }, (_, i) => scored(`i${i}`, 10 - i, { campaignId: 'camp-hot' }));
    const { queued, dropped } = selectQueue(items, CFG); // max_per_campaign = 2
    expect(queued).toHaveLength(2);
    expect(queued.map((q) => q.score)).toEqual([10, 9]); // the best two survive
    expect(dropped.every((d) => d.dropReason === 'per_campaign_cap')).toBe(true);
  });

  it('A8: one action class cannot flood the queue (max_per_action_class)', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      scored(`i${i}`, 10 - i, { campaignId: `camp-${i}`, actionType: 'add_negative_keyword' }));
    const { queued } = selectQueue(items, CFG); // max_per_action_class = 5
    expect(queued).toHaveLength(5);
  });

  it('reports every dropped item with a reason — never silently truncates', () => {
    const items = Array.from({ length: 12 }, (_, i) => scored(`i${i}`, 12 - i));
    const { queued, dropped } = selectQueue(items, OPEN);
    expect(queued.length + dropped.length).toBe(items.length); // nothing vanishes
    expect(dropped.every((d) => typeof d.dropReason === 'string')).toBe(true);
  });

  it('is deterministic regardless of input order, INCLUDING under heavy ties', () => {
    // All-equal scores: the tie-break path, not the sort, decides the queue. If the
    // comparator were not total, the queue would reshuffle with the input order.
    const items = Array.from({ length: 12 }, (_, i) => scored(`i${String(i).padStart(2, '0')}`, 5));

    // A few genuine permutations (no duplicates — deduping candidates is 08B's job).
    const rotate = (arr, n) => [...arr.slice(n), ...arr.slice(0, n)];
    const orderings = [
      [...items],
      [...items].reverse(),
      rotate(items, 5),
      [...items].sort((a, b) => (a.id < b.id ? 1 : -1)),
    ];

    const expected = selectQueue(orderings[0], OPEN).queued.map((q) => q.id);
    for (const ordering of orderings) {
      expect(selectQueue(ordering, OPEN).queued.map((q) => q.id)).toEqual(expected);
    }
    expect(expected).toHaveLength(10);
  });

  it('breaks score ties by preferring the safer action', () => {
    const items = [scored('risky', 3, { riskPenalty: 0.5 }), scored('safe', 3, { riskPenalty: 0.0 })];
    expect(selectQueue(items, { ...OPEN, daily_queue_cap: 1 }).queued[0].id).toBe('safe');
  });

  it('respects a config-driven cap override', () => {
    const items = Array.from({ length: 12 }, (_, i) => scored(`i${i}`, 12 - i));
    expect(selectQueue(items, { ...OPEN, daily_queue_cap: 3 }).queued).toHaveLength(3);
  });

  it('handles an empty candidate list', () => {
    const { queued, dropped } = selectQueue([], CFG);
    expect(queued).toEqual([]);
    expect(dropped).toEqual([]);
  });
});

// ── End-to-end ───────────────────────────────────────────────────────────────
describe('recommendation-score — scoreAndSelect', () => {
  it('the junk, the thin and the unprojectable never reach the queue', () => {
    const good = candidate({ id: 'good', campaignId: 'camp-good' });

    const junk = candidate({
      id: 'junk', campaignId: 'camp-junk',
      after: { qualifiedLeads: 200, soldRate: 0.02 },        // cheap leads, no sales
    });
    const thin = candidate({
      id: 'thin', campaignId: 'camp-thin',
      segment: { conversions: 2, lookbackDays: 30 },          // below min volume
    });
    const zeroBase = candidate({
      id: 'zero', campaignId: 'camp-zero',
      before: { qualifiedLeads: 0, booked: 0, lost: 0 },
      after: { qualifiedLeads: 10000 },                       // unbounded lift claim
    });

    const { queued } = scoreAndSelect([good, junk, thin, zeroBase], CFG);
    expect(queued.map((q) => q.id)).toEqual(['good']);
  });

  it('a proven-worthless negative keyword DOES reach the queue (eval E1 can fire)', () => {
    const negative = wasteRemovalCandidate({
      id: 'neg', campaignId: 'camp-1',
      removedCost: 400, removedConversions: 20, removedBooked: 0, removedLost: 20, // 0-for-20: proven junk
      otherCost: 1600, otherConversions: 80,
      hostBooked: 20, hostLost: 80,
    });
    const { queued } = scoreAndSelect([negative], CFG);
    expect(queued.map((q) => q.id)).toEqual(['neg']);
  });
});

// ── S-08A.1a end-to-end: A15 membership inflation, and the E1 carve-out ──────
// S-08A.1a (2026-07-30) replaced candidate.removed/candidate.host (caller-
// asserted scalars) with a rows-based contract: spend/platformConversions are
// ALWAYS derived from server-fetched rows bound to the host campaign and
// cross-checked against the action's own expectedSearchTerms. The OLD A14
// spend-inflation tests (independent review, 2026-07-13) tested a claim vs.
// evidence gap that this contract closes structurally — you cannot inflate a
// derived sum without genuinely having more real, bound, cross-checked rows,
// which is not an attack, it is reality. The analogous, LIVE concern for the
// new contract is A15 (membership inflation, 2026-07-28 review): can an
// attacker attach an unrelated row to inflate the removed cohort's spend?
// That is what these tests now exercise end-to-end through scoreRecommendation.
describe('recommendation-score — S-08A.1a rows contract (A15 membership inflation, E1 carve-out)', () => {
  it('A15 REJECTED end-to-end: a same-term row from a DIFFERENT campaign has ZERO effect on the score', () => {
    // The A15 shape: attach every account row (any campaign) to a one-term
    // negative, hoping the cohort derivation sums them all in. The defence
    // is a FILTER, not a reject-the-whole-batch check: only rows that are
    // BOTH in the host campaign AND named by expectedSearchTerms are ever
    // summed. A row with the SAME term but a DIFFERENT campaignId must not
    // join either the removed cohort or the host aggregate — however many
    // such rows are bundled into `rows`, the derived cohort, and therefore
    // the score, must be byte-identical to the honest case with none at all.
    const honest = wasteRemovalCandidate({
      id: 'honest-cohort',
      removedCost: 400, removedConversions: 20, removedBooked: 0, removedLost: 20,
      otherCost: 1600, otherConversions: 80,
      hostBooked: 20, hostLost: 80,
    });
    const withExtraRow = wasteRemovalCandidate({
      id: 'honest-cohort', // same id so the two candidates are otherwise identical
      removedCost: 400, removedConversions: 20, removedBooked: 0, removedLost: 20,
      otherCost: 1600, otherConversions: 80,
      hostBooked: 20, hostLost: 80,
      extraRows: [
        { rowId: 'row-other-campaign', campaignId: 'camp-DIFFERENT', searchTerm: 'junk term', cost: 999_999, conversions: 0 },
      ],
    });

    const honestScore = scoreRecommendation(honest, CFG);
    const withExtraRowScore = scoreRecommendation(withExtraRow, CFG);

    expect(honestScore.expectedDeltaProfitableLeads).not.toBeNull();
    // Score identical — the extra row bought nothing, not "less", nothing.
    expect(withExtraRowScore.score).toBe(honestScore.score);
    expect(withExtraRowScore.expectedDeltaProfitableLeads).toBe(honestScore.expectedDeltaProfitableLeads);
  });

  it('A15 — an unclaimed term in the SAME host campaign correctly changes the HOST aggregate (not an exploit, real campaign data)', () => {
    // Distinguish "filtered out" (the case above) from "legitimately part of
    // the host campaign's own aggregate": a row for a DIFFERENT term but the
    // SAME campaign is real spend the host campaign actually has — it must
    // count toward host.spend/host.platformConversions (deriveHostFromRows is
    // campaign-scoped, not term-scoped), which is correct, not a bypass. It
    // must still NEVER join the removed cohort.
    const withRealCampaignSpend = wasteRemovalCandidate({
      id: 'real-spend',
      removedCost: 400, removedConversions: 20, removedBooked: 0, removedLost: 20,
      otherCost: 1600, otherConversions: 80,
      hostBooked: 20, hostLost: 80,
      extraRows: [
        { rowId: 'row-third-term', campaignId: 'camp-1', searchTerm: 'a third term', cost: 100, conversions: 5 },
      ],
    });
    const r = scoreRecommendation(withRealCampaignSpend, CFG);
    // host.spend now includes the extra $100 (400+1600+100=2100) — a real
    // increase in the host's own denominator, correctly lowering its
    // efficiency slightly. The removed cohort's spend is UNCHANGED at 400 —
    // the extra row's term is not in expectedSearchTerms. Correction (cold
    // review, 2026-07-30): the original assertion here checked for a reason
    // string ('removed_row_not_in_expected_search_terms') that does not
    // exist anywhere in the implementation — a tautology that always passes.
    // Asserting the real derived numbers instead.
    expect(r.explain.objective.hostCohort.spend).toBe(2100);
    expect(r.explain.objective.removedCohort.spend).toBe(400);
    expect(r.expectedDeltaProfitableLeads).not.toBeNull();
  });

  // Cold review (2026-07-30) correctly objected to this test's original name
  // ("A15 REJECTED") — it demonstrates the module summing BOTH rows into the
  // removed cohort when told to, which is A15 SUCCEEDING against a caller
  // that mis-declares expectedSearchTerms, not A15 being rejected. Renamed to
  // say what it actually shows: this module's guarantee stops at "sum only
  // what I'm told to sum" — it does NOT and cannot verify that
  // expectedSearchTerms itself was derived correctly from execution_data.
  // That verification is a caller-side trust boundary this pure function
  // cannot close, recorded explicitly in DECISIONS.md so a future integration
  // session does not assume it's already handled here.
  it('expectedSearchTerms is a CALLER trust boundary this module does not and cannot close', () => {
    const wideList = wasteRemovalCandidate({
      id: 'wide-list',
      removedCost: 400, removedConversions: 20, removedBooked: 0, removedLost: 20,
      otherCost: 1600, otherConversions: 80,
      hostBooked: 20, hostLost: 80,
      expectedSearchTerms: ['junk term', 'other term'], // caller (mis)declared BOTH terms as removed
    });
    const r = scoreRecommendation(wideList, CFG);
    // Both rows now legitimately match — the derived spend is the sum of BOTH
    // (400 + 1600 = 2000), exactly as (mis)declared. The module did its job
    // (bind to what it was told); a caller that gets expectedSearchTerms
    // wrong gets a wrong-but-internally-consistent cohort, not a rejection.
    expect(r.explain.objective.removedCohort.spend).toBe(2000);
  });

  it('E1-PRESERVED: a zero-lead pure-waste term with derived (server-verified) cost still queues', () => {
    // The ideal negative keyword: a search term with platformConversions=0
    // and cost>0. Its qualified-lead share is 0, so a lead-share cap alone
    // would zero it out and E1 could never fire. In the S-08A.1a contract,
    // ALL removed-cohort spend is server-derived (never a caller claim), so
    // the W-multiple cap never engages on this path at all — see
    // DECISIONS.md S-08A.1a for the belt-and-braces note on why the cap
    // remains live in evaluateReallocation's lower-level, direct-scalar path.
    const pureWaste = wasteRemovalCandidate({
      id: 'pure-waste',
      removedCost: 400, removedConversions: 0, removedBooked: 0, removedLost: 0,
      otherCost: 1600, otherConversions: 100,
      hostBooked: 20, hostLost: 80,
    });
    const r = scoreRecommendation(pureWaste, CFG);
    expect(r.explain.objective.spendClamped).toBe(false);
    expect(r.expectedDeltaProfitableLeads).toBeGreaterThan(0);
    expect(r.score).toBeGreaterThan(0);

    expect(scoreAndSelect([pureWaste], CFG).queued.map((q) => q.id)).toEqual(['pure-waste']);
  });

  it('A17 REJECTED: claiming more terminal leads than the cohort\'s own platform conversions show is refused, not scored as zero-credit', () => {
    // "This term burned $400 and booked 20 real jobs" while the term's OWN
    // platform-tracked conversions show 0 is incoherent — a CRM-qualified
    // lead cannot exist without first registering as a platform conversion
    // in any realistic attribution model. Refused outright (delta null),
    // not silently priced at zero — an incoherent claim is a different
    // failure mode than a zero-lead cohort with no claim at all.
    const incoherent = wasteRemovalCandidate({
      id: 'incoherent',
      removedCost: 400, removedConversions: 0, removedBooked: 15, removedLost: 5, // 20 terminal, 0 platform conversions
      otherCost: 1600, otherConversions: 100,
      hostBooked: 20, hostLost: 80,
    });
    const r = scoreRecommendation(incoherent, CFG);
    expect(r.explain.objective.reasons).toContain('removed_terminal_leads_exceed_platform_conversions');
    expect(r.expectedDeltaProfitableLeads).toBeNull();
    expect(scoreAndSelect([incoherent], CFG).queued).toHaveLength(0);
  });

  it('the old scalar shape (candidate.removed/candidate.host) is refused outright, end-to-end', () => {
    const oldShape = {
      id: 'old-shape', actionType: 'add_negative_keyword', campaignId: 'camp-1',
      shape: 'waste_removal',
      accountSoldRatePrior: 0.2,
      removed: { spend: 400, qualifiedLeads: 0, booked: 0, lost: 0, spendVerified: true },
      host: { spend: 2000, qualifiedLeads: 100, booked: 20, lost: 80 },
      segment: { conversions: 40, lookbackDays: 30 },
      analysisConfidence: 0.8, attributionConfidence: 'high', outcomes: [],
    };
    const r = scoreRecommendation(oldShape, CFG);
    expect(r.explain.objective.reasons).toContain('removed_and_host_scalars_no_longer_accepted_use_rows_contract');
    expect(r.expectedDeltaProfitableLeads).toBeNull();
    expect(scoreAndSelect([oldShape], CFG).queued).toHaveLength(0);
  });
});
