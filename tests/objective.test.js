// ============================================================
// tests/objective.test.js — SESSION-08A profitable-lead objective
//
// objective.js is PURE and imports NOTHING, so every test here runs on plain
// objects with no mocks.
//
// The ONE exception is the defaults-drift guard, which imports GUARD_DEFAULTS
// from budget-guards.js to prove objective.js's fallback bands have not drifted
// from the canonical ones. budget-guards.js builds a Supabase client at module
// load, so that import (and only that import) needs the standard mock. The
// module under test still imports nothing.
//
// Where possible these assert PROPERTIES (monotonicity, bounds, invariance)
// rather than recomputing the formula — a test that re-implements the
// implementation agrees with it even when it is wrong.
// ============================================================

import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/lib/supabase.js', () => ({ default: { from: () => ({}) } }));
vi.mock('../api/lib/api-cost.js', () => ({ recordApiCall: vi.fn(async () => {}) }));

import { GUARD_DEFAULTS, classifyCpl } from '../api/lib/budget-guards.js';

import {
  OBJECTIVE_DEFAULTS,
  DEFAULTS,
  resolveObjectiveConfig,
  marginFor,
  cplBand,
  toSoldRate,
  soldRate,
  estimateSoldRate,
  profitableLeads,
  profitableLeadsPerDollar,
  evaluateObjective,
  evaluateReallocation,
  expectedDeltaProfitableLeads,
  dataSufficiency,
  deriveRemovedCohort,
  deriveHostFromRows,
} from '../api/lib/objective.js';

const CFG = resolveObjectiveConfig({}, null);

// ── Defaults-drift guard ─────────────────────────────────────────────────────
describe('objective — defaults-drift guard vs canonical GUARD_DEFAULTS', () => {
  const SHARED_KEYS = [
    'cpl_target', 'cpl_warn', 'cpl_emergency',
    'min_data_volume_conversions', 'min_data_lookback_days', 'protected_campaigns',
  ];

  it('every shared fallback default equals budget-guards GUARD_DEFAULTS', () => {
    for (const key of SHARED_KEYS) {
      expect(GUARD_DEFAULTS).toHaveProperty(key);
      expect(OBJECTIVE_DEFAULTS[key]).toEqual(GUARD_DEFAULTS[key]);
    }
  });

  it('cplBand agrees with classifyCpl across the whole band range', () => {
    const sweep = [null, undefined, 0, 1, 25, 49.99, 50, 50.01, 74.99, 75, 75.01, 99.99, 100, 100.01, 250];
    for (const cpl of sweep) {
      expect(cplBand(cpl, CFG)).toBe(classifyCpl(cpl, GUARD_DEFAULTS));
    }
  });
});

// ── Config ───────────────────────────────────────────────────────────────────
describe('objective — resolveObjectiveConfig', () => {
  it('falls back to code defaults when no agent_config rows exist', () => {
    expect(CFG.cpl_target).toBe(50);
    expect(CFG.cpl_emergency).toBe(100);
    expect(CFG.min_data_volume_conversions).toBe(5);
    expect(CFG.min_data_lookback_days).toBe(14);
  });

  it('applies the D-1 / D-2 locked defaults', () => {
    expect(CFG.auto_execute_enabled).toBe(false);   // D-1: fully gated
    expect(CFG.auto_execute_allowlist).toEqual([]);
    expect(CFG.daily_queue_cap).toBe(10);           // D-2
    expect(CFG.min_score_threshold).toBe(0.25);
  });

  it('keeps the tunable knobs config-driven, not hardcoded', () => {
    expect(CFG.reallocation_efficiency).toBe(0.7);
    expect(CFG.sold_rate_prior_strength).toBe(10);
    expect(CFG.learning_prior_alpha).toBe(2);
  });

  it('merges defaults then account_overrides, keyed by account UUID', () => {
    const cfg = resolveObjectiveConfig(
      {
        budgetGuards: { defaults: { cpl_target: 60 }, account_overrides: { 'acct-1': { cpl_target: 40 } } },
        scoring: { defaults: { daily_queue_cap: 8 }, account_overrides: { 'acct-1': { daily_queue_cap: 3 } } },
      },
      'acct-1',
    );
    expect(cfg.cpl_target).toBe(40);
    expect(cfg.cpl_emergency).toBe(100);  // untouched code default
    expect(cfg.daily_queue_cap).toBe(3);
  });

  it('ignores overrides belonging to a different account', () => {
    const cfg = resolveObjectiveConfig(
      { budgetGuards: { defaults: { cpl_target: 60 }, account_overrides: { 'acct-1': { cpl_target: 40 } } } },
      'acct-2',
    );
    expect(cfg.cpl_target).toBe(60);
  });

  it('reads crm_bridge_margins as a FLAT object (sql/016 shape)', () => {
    const cfg = resolveObjectiveConfig({ crmMargins: { kit: 0.2, turnkey: 0.25, default: 0.2 } }, null);
    expect(marginFor('turnkey', cfg)).toBe(0.25);
    expect(marginFor('unheard_of', cfg)).toBe(0.2);
  });

  it('never invents a margin — missing or zero is null, not 0', () => {
    expect(marginFor('kit', CFG)).toBeNull();
    expect(marginFor('kit', resolveObjectiveConfig({ crmMargins: { kit: 0, default: 0 } }, null))).toBeNull();
  });

  // Config is an attack surface: a DB row, not a deploy, and nobody reviews a row.
  it('INVARIANT: learning_weight_ceiling is hard-capped at 1.0 — config may lower, never raise', () => {
    const cfg = resolveObjectiveConfig({ scoring: { defaults: { learning_weight_ceiling: 3 } } }, null);
    expect(cfg.learning_weight_ceiling).toBe(1.0);
    // Lowering is allowed.
    expect(resolveObjectiveConfig({ scoring: { defaults: { learning_weight_ceiling: 0.5 } } }, null).learning_weight_ceiling).toBe(0.5);
  });

  it('INVARIANT: a negative risk penalty cannot turn risk into a REWARD', () => {
    const cfg = resolveObjectiveConfig({ scoring: { defaults: { risk_penalties: { holdout: -5 } } } }, null);
    expect(cfg.risk_penalties.holdout).toBeGreaterThanOrEqual(0);
    expect(cfg.risk_penalties.holdout).toBe(0.5); // fell back to the code default
  });

  it('INVARIANT: a corrupt (non-numeric) risk penalty falls back to the code default', () => {
    const cfg = resolveObjectiveConfig({ scoring: { defaults: { risk_penalties: { holdout: 'oops' } } } }, null);
    expect(cfg.risk_penalties.holdout).toBe(0.5);
  });
});

// ── toSoldRate: a sold rate is a probability ─────────────────────────────────
describe('objective — toSoldRate bounds', () => {
  it('rejects anything outside [0,1] — a "sold rate" of 5 is not a sold rate', () => {
    expect(toSoldRate(5)).toBeNull();      // inflated a delta 5x in review
    expect(toSoldRate(-1)).toBeNull();     // made a no-op look historic
    expect(toSoldRate(1.0001)).toBeNull();
    expect(toSoldRate(NaN)).toBeNull();
    expect(toSoldRate('banana')).toBeNull();
    expect(toSoldRate(true)).toBeNull();
  });

  it('accepts the valid range including the endpoints', () => {
    expect(toSoldRate(0)).toBe(0);
    expect(toSoldRate(1)).toBe(1);
    expect(toSoldRate(0.2)).toBe(0.2);
  });
});

// ── Sold rate: the terminal denominator ──────────────────────────────────────
describe('objective — sold rate uses TERMINAL outcomes only', () => {
  it('denominator is booked + lost; in-flight qualified leads are excluded', () => {
    // 100 qualified leads: 2 booked, 2 lost, 96 still in flight.
    // Terminal sold rate is 2/(2+2) = 0.50 — NOT 2/100 = 0.02.
    const r = soldRate({ booked: 2, lost: 2, qualifiedLeads: 100 });
    expect(r.rate).toBe(0.5);
    expect(r.terminal).toBe(4);
  });

  it('a young segment is not punished for having unresolved leads', () => {
    const young = soldRate({ booked: 3, lost: 1, qualifiedLeads: 200 });
    const old   = soldRate({ booked: 30, lost: 10, qualifiedLeads: 40 });
    expect(young.rate).toBe(old.rate); // same quality reads the same, regardless of age
  });

  it('zero terminal outcomes is UNKNOWN (null), never a sold rate of 0', () => {
    expect(soldRate({ booked: 0, lost: 0, qualifiedLeads: 50 }).rate).toBeNull();
  });

  it('treats a segment with only losses as a real, measured 0', () => {
    expect(soldRate({ booked: 0, lost: 8 }).rate).toBe(0);
  });
});

describe('objective — estimateSoldRate shrinkage', () => {
  it('A2: an UNMEASURED segment is capped at the prior — never optimistic', () => {
    // 2-for-2 looks like a 100% sold rate. Sample (2) is below the floor (5), so
    // it is capped at the prior. A fluke can never beat an average segment.
    const r = estimateSoldRate({ booked: 2, lost: 0 }, 0.15, CFG);
    expect(r.rate).toBe(0.15);
    expect(r.cappedAtPrior).toBe(true);
    expect(r.measured).toBe(false);
  });

  it('a measured GOOD segment IS allowed to exceed the prior', () => {
    const r = estimateSoldRate({ booked: 18, lost: 2 }, 0.15, CFG);
    expect(r.rate).toBeGreaterThan(0.15);
    expect(r.measured).toBe(true);
  });

  it('a measured BAD segment is NOT rescued by the prior', () => {
    expect(estimateSoldRate({ booked: 1, lost: 19 }, 0.15, CFG).rate).toBeLessThan(0.15);
  });

  it('no terminal data and no prior => null (unknown), which the gate catches', () => {
    const r = estimateSoldRate({ booked: 0, lost: 0 }, null, CFG);
    expect(r.rate).toBeNull();
    expect(r.reason).toBe('no_sold_rate_prior');
  });

  it('an out-of-range prior is not a prior', () => {
    expect(estimateSoldRate({ booked: 0, lost: 0 }, 5, CFG).rate).toBeNull();
  });

  it('PROPERTY: the estimate is always a valid probability', () => {
    const cases = [
      [{ booked: 0, lost: 0 }, 0.2], [{ booked: 100, lost: 0 }, 0.2],
      [{ booked: 0, lost: 100 }, 0.2], [{ booked: 3, lost: 2 }, 0.9],
      [{ booked: 1, lost: 0 }, 0.01],
    ];
    for (const [seg, prior] of cases) {
      const { rate } = estimateSoldRate(seg, prior, CFG);
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });
});

// ── Profitable leads ─────────────────────────────────────────────────────────
describe('objective — profitable leads', () => {
  it('profitable leads = qualified x sold rate', () => {
    expect(profitableLeads({ qualifiedLeads: 100, soldRate: 0.2 })).toBe(20);
  });

  it('profitable leads per dollar', () => {
    expect(profitableLeadsPerDollar({ spend: 1000, qualifiedLeads: 50, soldRate: 0.2 })).toBe(0.01);
  });

  it('returns null rather than 0 when inputs are unknown or invalid', () => {
    expect(profitableLeads({ qualifiedLeads: 100, soldRate: null })).toBeNull();
    expect(profitableLeads({ qualifiedLeads: 100, soldRate: 5 })).toBeNull(); // out of range
    expect(profitableLeadsPerDollar({ spend: 0, qualifiedLeads: 50, soldRate: 0.2 })).toBeNull();
  });
});

// ── THE CORE INVARIANT ───────────────────────────────────────────────────────
describe('objective — THE INVARIANT: quality credit is never claimable, quality damage always is', () => {
  const before = { qualifiedLeads: 100, soldRate: 0.2 };

  it('a claimed quality IMPROVEMENT is NOT credited (clamped to the baseline)', () => {
    const honest   = evaluateObjective(before, { qualifiedLeads: 120, soldRate: 0.2 }, CFG);
    const inflated = evaluateObjective(before, { qualifiedLeads: 120, soldRate: 0.9 }, CFG);
    expect(inflated.delta).toBe(honest.delta);        // the lie buys nothing
    expect(inflated.qualityClamped).toBe(true);
    expect(inflated.reasons).toContain('projected_quality_improvement_not_credited');
  });

  it('a claimed quality DEGRADATION is honoured in full', () => {
    const r = evaluateObjective(before, { qualifiedLeads: 120, soldRate: 0.1 }, CFG);
    expect(r.delta).toBeLessThan(0);
    expect(r.qualityDrag).toBeGreaterThan(0);
    expect(r.reasons).toContain('sold_rate_degraded_by_action');
  });

  it('PROPERTY: score is MONOTONE NON-INCREASING as the projected sold rate falls', () => {
    let prev = Infinity;
    for (const sr of [1.0, 0.5, 0.2, 0.15, 0.1, 0.05, 0]) {
      const { delta } = evaluateObjective(before, { qualifiedLeads: 120, soldRate: sr }, CFG);
      expect(delta).toBeLessThanOrEqual(prev);
      prev = delta;
    }
  });

  it('PROPERTY: no projected sold rate, however high, beats simply holding quality', () => {
    const held = evaluateObjective(before, { qualifiedLeads: 120 }, CFG).delta; // silence = holds
    for (const sr of [0.3, 0.5, 0.99, 1]) {
      expect(evaluateObjective(before, { qualifiedLeads: 120, soldRate: sr }, CFG).delta).toBeLessThanOrEqual(held);
    }
  });

  it('volume effect + quality effect sum EXACTLY to delta', () => {
    const r = evaluateObjective(before, { qualifiedLeads: 150, soldRate: 0.1 }, CFG);
    expect(r.volumeEffect + r.qualityEffect).toBeCloseTo(r.delta, 6);
  });
});

// ── GAMEABILITY ──────────────────────────────────────────────────────────────
describe('objective — GAMEABILITY: the proxy cannot beat the truth', () => {
  it('A1: junk-traffic flood (more leads, worse sold rate) scores NEGATIVE', () => {
    const r = evaluateObjective(
      { qualifiedLeads: 100, soldRate: 0.20 },   // 20 sold jobs
      { qualifiedLeads: 150, soldRate: 0.10 },   // 15 sold jobs — CPL down, quality halved
      CFG,
    );
    expect(r.delta).toBeLessThan(0);
    expect(r.qualityDrag).toBeGreaterThan(0);
  });

  it('A1b: even a doubled volume cannot outrun a collapsed sold rate', () => {
    const r = evaluateObjective(
      { qualifiedLeads: 100, soldRate: 0.20 },
      { qualifiedLeads: 200, soldRate: 0.02 },
      CFG,
    );
    expect(r.delta).toBeLessThan(0);
  });

  it('A1c: quality coupling charges the WHOLE post-change volume, not just new leads', () => {
    const r = evaluateObjective(
      { qualifiedLeads: 100, soldRate: 0.20 },
      { qualifiedLeads: 150, soldRate: 0.10 },
      CFG,
    );
    expect(r.qualityEffect).toBe(150 * (0.10 - 0.20)); // all 150, not just the 50 added
  });

  it('A3: starving a high-sold-rate campaign to improve CPL scores NEGATIVE', () => {
    const r = evaluateObjective(
      { qualifiedLeads: 100, soldRate: 0.30 },
      { qualifiedLeads: 70,  soldRate: 0.30 },
      CFG,
    );
    expect(r.delta).toBeLessThan(0);
  });

  it('A4: a fabricated lift claim is clamped to max_projected_lift_pct', () => {
    const r = evaluateObjective(
      { qualifiedLeads: 100, soldRate: 0.2 },
      { qualifiedLeads: 500, soldRate: 0.2 },   // "this will 5x the campaign"
      CFG,
    );
    expect(r.clamped).toBe(true);
    expect(r.delta).toBe(20);                    // clamped to 2x, not 5x
  });

  it('A9: a ZERO baseline cannot be used to escape the lift clamp', () => {
    // A percentage ceiling is vacuous at zero (0 x anything = 0). In review this
    // produced delta 1500 with clamped:false and dominated the whole queue.
    const r = evaluateObjective(
      { qualifiedLeads: 0, soldRate: 0.15 },
      { qualifiedLeads: 10000, soldRate: 0.15 },
      CFG,
    );
    expect(r.delta).toBeNull();
    expect(r.reasons).toContain('no_baseline_volume_cannot_project_lift');
  });

  it('rejects a sold rate outside [0,1] instead of multiplying by it', () => {
    expect(evaluateObjective({ qualifiedLeads: 100, soldRate: -1 }, { qualifiedLeads: 100 }, CFG).delta).toBeNull();
    // An out-of-range AFTER rate is treated as "no claim" => quality holds.
    const r = evaluateObjective({ qualifiedLeads: 100, soldRate: 0.2 }, { qualifiedLeads: 120, soldRate: 5 }, CFG);
    expect(r.delta).toBe(4); // as if quality simply held — never 5x
  });
});

// ── A5 / A10 / A11: waste removal ────────────────────────────────────────────
describe('objective — evaluateReallocation (negative keywords, pauses)', () => {
  const host = { spend: 1000, qualifiedLeads: 50, soldRate: 0.20 }; // 0.01 sold jobs/$

  it('A5: cutting worthless traffic scores POSITIVE (E1 could never fire otherwise)', () => {
    const r = evaluateReallocation(
      { removed: { spend: 200, qualifiedLeads: 10, soldRate: 0 }, host },
      CFG,
    );
    expect(r.delta).toBeGreaterThan(0);
    expect(r.reallocated).toBeCloseTo(1.4, 6); // 200 x 0.01 x 0.7
  });

  it('cutting traffic that ACTUALLY SELLS scores negative', () => {
    const r = evaluateReallocation(
      { removed: { spend: 200, qualifiedLeads: 10, soldRate: 0.5 }, host },
      CFG,
    );
    expect(r.delta).toBeLessThan(0);
  });

  it('A10: an INFLATED host is refused — the removed cohort must be a real subset', () => {
    // In review, host {spend:$1, 10 qualified, 50% sold} manufactured a 1747x score.
    const r = evaluateReallocation(
      { removed: { spend: 500, qualifiedLeads: 10, soldRate: 0.3 }, host: { spend: 1, qualifiedLeads: 10, soldRate: 0.5 } },
      CFG,
    );
    expect(r.delta).toBeNull();
    expect(r.reasons).toContain('removed_spend_exceeds_host_spend_not_a_subset');
  });

  it('A10: the same check catches the innocent micros/dollars unit mismatch', () => {
    // Google Ads returns cost_micros. Mixing units across the two objects is a
    // bug, not an attack — and it scored 350,000 in review.
    const r = evaluateReallocation(
      { removed: { spend: 500_000_000, qualifiedLeads: 10, soldRate: 0 }, host: { spend: 10_000, qualifiedLeads: 50, soldRate: 0.2 } },
      CFG,
    );
    expect(r.delta).toBeNull();
    expect(r.reasons).toContain('removed_spend_exceeds_host_spend_not_a_subset');
  });

  it('A10: removing more leads than the host has is refused', () => {
    const r = evaluateReallocation(
      { removed: { spend: 100, qualifiedLeads: 999, soldRate: 0 }, host },
      CFG,
    );
    expect(r.delta).toBeNull();
    expect(r.reasons).toContain('removed_leads_exceed_host_leads_not_a_subset');
  });

  it('A10: an absurd host efficiency is capped', () => {
    const r = evaluateReallocation(
      { removed: { spend: 5, qualifiedLeads: 5, soldRate: 0 }, host: { spend: 10, qualifiedLeads: 100, soldRate: 0.5 } },
      CFG,
    );
    expect(r.reasons).toContain('host_efficiency_capped');
    expect(r.hostRate).toBe(CFG.max_profitable_leads_per_dollar);
  });

  it('credits ZERO reallocation when the host has no measurable efficiency', () => {
    const r = evaluateReallocation(
      { removed: { spend: 200, qualifiedLeads: 10, soldRate: 0 }, host: { spend: 1000, qualifiedLeads: 50, soldRate: null } },
      CFG,
    );
    expect(r.reallocated).toBe(0);
    expect(r.delta).toBeLessThanOrEqual(0);
  });

  it('reallocation_efficiency is config-driven and discounts the redeployed spend', () => {
    const full = evaluateReallocation(
      { removed: { spend: 200, qualifiedLeads: 10, soldRate: 0 }, host },
      { ...CFG, reallocation_efficiency: 1.0 },
    );
    const discounted = evaluateReallocation(
      { removed: { spend: 200, qualifiedLeads: 10, soldRate: 0 }, host },
      CFG,
    );
    expect(discounted.delta).toBeLessThan(full.delta);
  });
});

// ── A14: the spend-coherence cap ─────────────────────────────────────────────
// Independent review (2026-07-13) found removed.spend was trusted independently of
// the removed cohort's lead share. reallocated = removedSpend x hostRate x efficiency
// is LINEAR in removedSpend, and with a provably-worthless cohort forgone is pinned to
// 0 — so simply overstating removed.spend (while still passing every subset check)
// scaled the score without bound, up to ~18x honest value.
describe('objective — A14: removed.spend cannot be inflated past the cohort it describes', () => {
  // The review's exact fixture. 10 leads = 10% of the host's 100.
  const host = { spend: 2000, qualifiedLeads: 100, soldRate: 0.2 }; // 0.01 sold jobs/$
  const cohort = (spend, over = {}) => ({ spend, qualifiedLeads: 10, soldRate: 0, ...over });

  it('A14: an unverified spend claim is clamped to W x leadShare x hostSpend', () => {
    // leadShare = 10/100 = 0.1; W = 3; hostSpend = 2000 => cap = $600.
    const r = evaluateReallocation({ removed: cohort(2000), host }, CFG);
    expect(r.spendClamped).toBe(true);
    expect(r.reclaimableSpend).toBe(600);
    expect(r.reasons).toContain('removed_spend_clamped_to_waste_multiple');
  });

  it('A14 THE KILL: inflating removed.spend past the cap buys EXACTLY NOTHING', () => {
    // The invariance property, in the style of the A3 baseline proof: the lie must
    // be worth zero, not merely "less". Claiming $2000 scores identically to
    // claiming the $600 the evidence actually supports.
    const honest   = evaluateReallocation({ removed: cohort(600),  host }, CFG);
    const inflated = evaluateReallocation({ removed: cohort(2000), host }, CFG);
    expect(inflated.delta).toBe(honest.delta);
    expect(inflated.reallocated).toBe(honest.reallocated);
  });

  it('A14 PROPERTY: past the cap, the delta is FLAT in claimed spend', () => {
    // Pre-fix this was strictly increasing all the way to hostSpend.
    const deltas = [600, 900, 1200, 1600, 2000].map(
      (s) => evaluateReallocation({ removed: cohort(s), host }, CFG).delta,
    );
    expect(new Set(deltas).size).toBe(1);
  });

  it('a claim WITHIN the cap is untouched — an honest waste cohort is not penalised', () => {
    const r = evaluateReallocation({ removed: cohort(400), host }, CFG);
    expect(r.spendClamped).toBe(false);
    expect(r.reclaimableSpend).toBe(400);
    expect(r.delta).toBeGreaterThan(0);
  });

  it('A14: the waste multiple W is CONFIG-DRIVEN, not hardcoded', () => {
    const atW3 = evaluateReallocation({ removed: cohort(2000), host }, { ...CFG, reallocation_max_waste_multiple: 3 });
    const atW6 = evaluateReallocation({ removed: cohort(2000), host }, { ...CFG, reallocation_max_waste_multiple: 6 });
    expect(atW3.reclaimableSpend).toBe(600);   // 3 x 0.1 x 2000
    expect(atW6.reclaimableSpend).toBe(1200);  // 6 x 0.1 x 2000
    expect(atW6.delta).toBeGreaterThan(atW3.delta);
    expect(CFG.reallocation_max_waste_multiple).toBe(3); // the shipped default
  });

  // ── The E1 carve-out ───────────────────────────────────────────────────────
  // A zero-qualified-lead term is the IDEAL negative keyword: pure waste, nothing
  // forgone. leadShare is 0, so a lead-share cap would zero it out and E1 could
  // never fire. Provenance — not lead share — is what bounds it.
  it('E1 CARVE-OUT: a zero-lead cohort with SERVER-VERIFIED spend is NOT capped', () => {
    const r = evaluateReallocation(
      { removed: { spend: 400, qualifiedLeads: 0, soldRate: 0, spendVerified: true }, host },
      CFG,
    );
    expect(r.spendClamped).toBe(false);
    expect(r.reclaimableSpend).toBe(400);
    expect(r.delta).toBeGreaterThan(0);        // pure waste removal still pays
    expect(r.reasons).toContain('removed_spend_server_verified');
  });

  it('A14: a zero-lead cohort with UNVERIFIED spend gets ZERO credit', () => {
    // "This term burned $2000 and never sold" with no fetched cost behind it is the
    // A11 principle applied to spend: you cannot claim value without evidence.
    const r = evaluateReallocation(
      { removed: { spend: 2000, qualifiedLeads: 0, soldRate: 0 }, host },
      CFG,
    );
    expect(r.reclaimableSpend).toBe(0);
    expect(r.reallocated).toBe(0);
    expect(r.delta).toBeLessThanOrEqual(0);    // so it cannot queue
  });

  it('verified spend is still bounded by the A10 subset check', () => {
    // Provenance relaxes the coherence cap, never the subset invariant.
    const r = evaluateReallocation(
      { removed: { spend: 5000, qualifiedLeads: 0, soldRate: 0, spendVerified: true }, host },
      CFG,
    );
    expect(r.delta).toBeNull();
    expect(r.reasons).toContain('removed_spend_exceeds_host_spend_not_a_subset');
  });
});

// ── The entry point: rates are DERIVED, never asserted ───────────────────────
describe('objective — expectedDeltaProfitableLeads derives every sold rate', () => {
  const base = {
    shape: 'volume_change',
    accountSoldRatePrior: 0.2,
    before: { qualifiedLeads: 100, booked: 20, lost: 80 },  // terminal 100 => 0.2
    after: { qualifiedLeads: 120 },
  };

  it('derives the baseline rate from terminal counts', () => {
    const r = expectedDeltaProfitableLeads(base, CFG);
    expect(r.soldRateEstimate.measured).toBe(true);
    expect(r.soldRateEstimate.rate).toBeCloseTo(0.2, 6);
    expect(r.delta).toBeCloseTo(4, 6);  // (120 - 100) x 0.2
  });

  it('A3 BLOCKER: an asserted before.soldRate is IGNORED — understating it buys nothing', () => {
    // The original blocker: d(delta)/d(srB) = -qB < 0, so understating the
    // baseline inflated the score. Starving a winner scored -16 honestly and +19
    // with a lie. The baseline now comes from CRM counts and cannot be asserted.
    const honest = expectedDeltaProfitableLeads(base, CFG);
    const lying  = expectedDeltaProfitableLeads({ ...base, before: { ...base.before, soldRate: 0.001 } }, CFG);
    expect(lying.delta).toBe(honest.delta);
  });

  it('A3 BLOCKER: starving a real winner stays NEGATIVE and cannot be lied into positive', () => {
    const starve = {
      shape: 'volume_change',
      accountSoldRatePrior: 0.2,
      before: { qualifiedLeads: 100, booked: 40, lost: 60, soldRate: 0.05 }, // the lie
      after: { qualifiedLeads: 60 },
    };
    const r = expectedDeltaProfitableLeads(starve, CFG);
    expect(r.delta).toBeLessThan(0);  // was +19 with the lie in review
  });

  // S-08A.1a (2026-07-30): candidate.removed/candidate.host (caller-asserted
  // scalars) are superseded by a rows-based contract — see the section above
  // expectedDeltaProfitableLeads for the full rationale (A15 membership
  // inflation). This helper builds the two-row shape (removed term + rest of
  // the host campaign) the new contract requires.
  function wasteRemovalRowsCandidate({
    campaignId = 'camp-1', removedTerm = 'junk term', removedCost, removedConversions,
    removedBooked, removedLost, otherCost, otherConversions, hostBooked, hostLost,
    accountSoldRatePrior = 0.2,
  }) {
    return {
      shape: 'waste_removal',
      accountSoldRatePrior,
      rows: [
        { rowId: 'row-removed', campaignId, searchTerm: removedTerm, cost: removedCost, conversions: removedConversions },
        { rowId: 'row-other', campaignId, searchTerm: 'other term', cost: otherCost, conversions: otherConversions },
      ],
      hostCampaignId: campaignId,
      expectedSearchTerms: [removedTerm],
      fetchId: 'fetch-1',
      window: { startDate: '2026-07-01', endDate: '2026-07-30' },
      removedBooked, removedLost, hostBooked, hostLost,
    };
  }

  it('A11: an UNMEASURED removed cohort is priced at the PRIOR, not at zero', () => {
    // "This traffic never sells" with no terminal evidence is not a claim you can
    // make. Zero terminal outcomes => priced at the prior => the removal must
    // clear a real bar rather than being pure upside.
    const unmeasured = expectedDeltaProfitableLeads(
      wasteRemovalRowsCandidate({
        // platformConversions=10 (real tracked conversions) but NOTHING has
        // resolved yet (booked=0, lost=0) — exactly the case where a caller
        // could otherwise stay silent to make real volume disappear.
        removedCost: 200, removedConversions: 10, removedBooked: 0, removedLost: 0,
        otherCost: 800, otherConversions: 40,
        hostBooked: 10, hostLost: 40,
      }),
      CFG,
    );
    expect(unmeasured.soldRateEstimate.rate).toBe(0.2); // the prior, NOT 0
    expect(unmeasured.delta).toBeLessThan(0);           // so it does not queue

    // With real evidence that the traffic does not sell, it DOES queue.
    const proven = expectedDeltaProfitableLeads(
      wasteRemovalRowsCandidate({
        removedCost: 200, removedConversions: 20, removedBooked: 0, removedLost: 20, // 0-for-20
        otherCost: 800, otherConversions: 30,
        hostBooked: 10, hostLost: 40,
      }),
      CFG,
    );
    expect(proven.delta).toBeGreaterThan(0);
  });

  it('returns null delta on an unknown shape rather than guessing', () => {
    const r = expectedDeltaProfitableLeads({ shape: 'teleport' }, CFG);
    expect(r.delta).toBeNull();
  });

  // ── D-9 guard test — a googleConversions-shaped field must hard-error ──────
  it('D-9 GUARD: a row carrying a googleConversions-named field is refused outright, not silently ignored', () => {
    const candidate = {
      shape: 'waste_removal',
      accountSoldRatePrior: 0.2,
      rows: [
        { rowId: 'row-removed', campaignId: 'camp-1', searchTerm: 'junk term', cost: 200, conversions: 20, googleConversions: 20 },
        { rowId: 'row-other', campaignId: 'camp-1', searchTerm: 'other term', cost: 800, conversions: 30 },
      ],
      hostCampaignId: 'camp-1',
      expectedSearchTerms: ['junk term'],
      fetchId: 'fetch-1',
      window: {},
      removedBooked: 0, removedLost: 20, hostBooked: 10, hostLost: 40,
    };
    const r = expectedDeltaProfitableLeads(candidate, CFG);
    expect(r.delta).toBeNull();
    expect(r.reasons).toContain('row_carries_qualifiedLeads_or_googleConversions_field_refused');
  });

  it('D-9 GUARD: a row carrying a bare qualifiedLeads field is refused outright', () => {
    const candidate = {
      shape: 'waste_removal',
      accountSoldRatePrior: 0.2,
      rows: [
        { rowId: 'row-removed', campaignId: 'camp-1', searchTerm: 'junk term', cost: 200, conversions: 20, qualifiedLeads: 50 },
        { rowId: 'row-other', campaignId: 'camp-1', searchTerm: 'other term', cost: 800, conversions: 30 },
      ],
      hostCampaignId: 'camp-1',
      expectedSearchTerms: ['junk term'],
      fetchId: 'fetch-1',
      window: {},
      removedBooked: 0, removedLost: 20, hostBooked: 10, hostLost: 40,
    };
    const r = expectedDeltaProfitableLeads(candidate, CFG);
    expect(r.delta).toBeNull();
    expect(r.reasons).toContain('row_carries_qualifiedLeads_or_googleConversions_field_refused');
  });

  it('the pre-S-08A.1a scalar shape (candidate.removed/candidate.host) is refused outright', () => {
    const oldShape = {
      shape: 'waste_removal',
      accountSoldRatePrior: 0.2,
      removed: { spend: 400, qualifiedLeads: 0, booked: 0, lost: 0, spendVerified: true },
      host: { spend: 2000, qualifiedLeads: 100, booked: 20, lost: 80 },
    };
    const r = expectedDeltaProfitableLeads(oldShape, CFG);
    expect(r.delta).toBeNull();
    expect(r.reasons).toContain('removed_and_host_scalars_no_longer_accepted_use_rows_contract');
  });
});

// ── S-08A.1a: deriveRemovedCohort / deriveHostFromRows — the row-identity ────
// contract itself, tested directly. "Three blocking cases" per DECISIONS.md's
// S-08A.1a acceptance criteria, plus the multi-ad-group trap the same doc
// warns about: a uniqueness check broken by being TOO STRICT would reject
// honest multi-ad-group rows exactly like it rejects synthesized duplicates.
describe('objective — deriveRemovedCohort / deriveHostFromRows (S-08A.1a row-identity contract)', () => {
  const baseRows = () => ([
    { rowId: 'row-1', campaignId: 'camp-1', searchTerm: 'junk term', cost: 200, conversions: 10 },
    { rowId: 'row-2', campaignId: 'camp-1', searchTerm: 'other term', cost: 800, conversions: 40 },
  ]);

  // ── Blocking case 1: membership inflation (A15) — row outside the host campaign
  it('BLOCKING CASE 1 (A15): a row outside the host campaign is filtered out, not summed', () => {
    const rows = [...baseRows(), { rowId: 'row-outsider', campaignId: 'camp-OTHER', searchTerm: 'junk term', cost: 999_999, conversions: 0 }];
    const cohort = deriveRemovedCohort({
      rows, hostCampaignId: 'camp-1', expectedSearchTerms: ['junk term'], fetchId: 'f1', booked: 0, lost: 10,
    });
    expect(cohort.valid).toBe(true);
    expect(cohort.spend).toBe(200); // the $999,999 outsider row never counted
    expect(cohort.rowCount).toBe(1);
  });

  // ── Blocking case 2: no independent target to cross-check against (the A15 gap itself)
  it('BLOCKING CASE 2 (A15): no expectedSearchTerms supplied at all is refused — nothing to bind membership to', () => {
    const cohort = deriveRemovedCohort({
      rows: baseRows(), hostCampaignId: 'camp-1', expectedSearchTerms: [], fetchId: 'f1', booked: 0, lost: 0,
    });
    expect(cohort.valid).toBe(false);
    expect(cohort.reason).toBe('removed_no_expected_search_terms_to_cross_check');
  });

  // ── Blocking case 3: terminal leads exceed the cohort's own platform conversions (A17)
  it('BLOCKING CASE 3 (A17): claiming more terminal leads than the cohort\'s own platform conversions is refused', () => {
    const cohort = deriveRemovedCohort({
      rows: baseRows(), hostCampaignId: 'camp-1', expectedSearchTerms: ['junk term'], fetchId: 'f1',
      booked: 8, lost: 5, // terminal 13 > platformConversions 10
    });
    expect(cohort.valid).toBe(false);
    expect(cohort.reason).toBe('removed_terminal_leads_exceed_platform_conversions');
  });

  // ── The multi-ad-group trap — DECISIONS.md's explicit warning ──────────────
  it('does NOT reject honest multi-ad-group rows — same (searchTerm, campaignId), DIFFERENT rowId, is legitimate', () => {
    const rows = [
      { rowId: 'row-adgroup-1', campaignId: 'camp-1', searchTerm: 'junk term', cost: 100, conversions: 5 },
      { rowId: 'row-adgroup-2', campaignId: 'camp-1', searchTerm: 'junk term', cost: 100, conversions: 5 }, // same term, different ad group
      { rowId: 'row-other', campaignId: 'camp-1', searchTerm: 'other term', cost: 800, conversions: 30 },
    ];
    const cohort = deriveRemovedCohort({
      rows, hostCampaignId: 'camp-1', expectedSearchTerms: ['junk term'], fetchId: 'f1', booked: 0, lost: 10,
    });
    expect(cohort.valid).toBe(true);
    expect(cohort.spend).toBe(200); // both ad-group rows counted — 100 + 100
    expect(cohort.rowCount).toBe(2);
  });

  it('REJECTS a literal duplicate rowId — a replay/synthesis attack, not a legitimate collision', () => {
    const rows = [
      { rowId: 'row-1', campaignId: 'camp-1', searchTerm: 'junk term', cost: 200, conversions: 10 },
      { rowId: 'row-1', campaignId: 'camp-1', searchTerm: 'junk term', cost: 200, conversions: 10 }, // literal duplicate
    ];
    const cohort = deriveRemovedCohort({
      rows, hostCampaignId: 'camp-1', expectedSearchTerms: ['junk term'], fetchId: 'f1', booked: 0, lost: 10,
    });
    expect(cohort.valid).toBe(false);
    expect(cohort.reason).toBe('removed_duplicate_row_id');
  });

  it('deriveHostFromRows aggregates the WHOLE campaign, term-agnostic, from the same rows array', () => {
    const host = deriveHostFromRows({
      rows: baseRows(), hostCampaignId: 'camp-1', fetchId: 'f1', booked: 10, lost: 40,
    });
    expect(host.valid).toBe(true);
    expect(host.spend).toBe(1000);       // 200 + 800 — both rows, any term
    expect(host.platformConversions).toBe(50); // 10 + 40
  });

  it('deriveHostFromRows rejects a fetchId-less call — host and removed must share one fetch (D-9)', () => {
    const host = deriveHostFromRows({ rows: baseRows(), hostCampaignId: 'camp-1', fetchId: null });
    expect(host.valid).toBe(false);
    expect(host.reason).toBe('host_no_fetch_id');
  });

  it('unmeasured (terminal=0) cohort volume is bounded by platformConversions, not silently zero (A11)', () => {
    const cohort = deriveRemovedCohort({
      rows: baseRows(), hostCampaignId: 'camp-1', expectedSearchTerms: ['junk term'], fetchId: 'f1',
      booked: 0, lost: 0, // nothing resolved yet
    });
    expect(cohort.valid).toBe(true);
    expect(cohort.qualifiedLeads).toBe(10); // bounded at platformConversions, not 0
  });
});

// ── E3: data sufficiency gate ────────────────────────────────────────────────
describe('objective — dataSufficiency gate (eval E3)', () => {
  it('E3: a campaign below min-data-volume gates to 0', () => {
    const r = dataSufficiency({ conversions: 4, lookbackDays: 14, soldRateResolved: 0.2 }, CFG);
    expect(r.gate).toBe(0);
  });

  it('opens the gate exactly at the min-volume boundary (5)', () => {
    expect(dataSufficiency({ conversions: 5, lookbackDays: 14, soldRateResolved: 0.2 }, CFG).gate).toBe(1);
    expect(dataSufficiency({ conversions: 4.9, lookbackDays: 14, soldRateResolved: 0.2 }, CFG).gate).toBe(0);
  });

  it('gates to 0 on a short lookback window', () => {
    expect(dataSufficiency({ conversions: 50, lookbackDays: 7, soldRateResolved: 0.2 }, CFG).gate).toBe(0);
  });

  it('validity, not presence: NaN / garbage / out-of-range are all "no sold rate"', () => {
    // A presence check let NaN through with gate 1. NaN IS the unresolvable state.
    for (const bad of [null, undefined, NaN, 'banana', 1.5, -0.5]) {
      const r = dataSufficiency({ conversions: 50, lookbackDays: 30, soldRateResolved: bad }, CFG);
      expect(r.gate).toBe(0);
      expect(r.reasons).toContain('no_resolvable_sold_rate');
    }
  });

  it('a measured sold rate of exactly 0 is VALID data (it just means nothing sells)', () => {
    expect(dataSufficiency({ conversions: 50, lookbackDays: 30, soldRateResolved: 0 }, CFG).gate).toBe(1);
  });

  it('opens the gate when every condition is met', () => {
    const r = dataSufficiency({ conversions: 25, lookbackDays: 30, soldRateResolved: 0.18 }, CFG);
    expect(r.gate).toBe(1);
    expect(r.reasons).toEqual([]);
  });
});

// ── Purity ───────────────────────────────────────────────────────────────────
describe('objective — purity', () => {
  it('does not mutate its inputs', () => {
    const before = { qualifiedLeads: 100, soldRate: 0.2 };
    const after  = { qualifiedLeads: 150, soldRate: 0.1 };
    const b = { ...before }; const a = { ...after };
    evaluateObjective(before, after, CFG);
    expect(before).toEqual(b);
    expect(after).toEqual(a);
  });

  it('is deterministic — same inputs, same output, every time', () => {
    const run = () => evaluateObjective({ qualifiedLeads: 100, soldRate: 0.2 }, { qualifiedLeads: 137, soldRate: 0.17 }, CFG);
    expect(run()).toEqual(run());
  });

  it('DEFAULTS carries the band keys too — a caller who skips resolve() keeps protection', () => {
    expect(DEFAULTS.protected_campaigns).toEqual(GUARD_DEFAULTS.protected_campaigns);
  });
});
