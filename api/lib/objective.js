// ============================================================
// objective.js — the profitable-lead objective (SESSION-08A)
//
// "Maximize expected profitable qualified leads, subject to the budget cap."
//
// PURE. Zero imports, zero I/O, zero network, zero DB. Every function takes
// config + data as arguments and returns a value. This is what makes the
// learning gate (eval E7) and the gameability proofs unit-provable on plain
// fixtures. The caller (SESSION-08B, api/cron-optimize.js) does all fetching.
//
// ── The unit ─────────────────────────────────────────────────────────────────
// The objective is denominated in PROFITABLE LEADS — expected sold jobs:
//
//     profitable_leads = qualified_leads x sold_rate
//
// Not clicks. Not impressions. Not raw leads. Not CPL.
//
// CPL IS NEVER A REWARD TERM. It appears only as (a) a band label for evidence
// and risk and (b) the budget constraint.
//
// ── THE TRUST BOUNDARY (read this before changing anything) ──────────────────
// An adversarial review of the first draft of this module (2026-07-13) found
// that "CPL is never a reward" is worthless on its own, because the module
// accepted the SOLD RATES as caller-supplied numbers. An upstream LLM that
// wants its recommendation approved simply understates the baseline sold rate:
//
//     delta = qA*srA - qB*srB   =>   d(delta)/d(srB) = -qB < 0
//
// The score was STRICTLY DECREASING in the reported baseline. Understating it
// was rewarded, and the same lie suppressed the quality-drag alarm (which only
// fires when srA < srB). Starving a genuine winner scored -16 honestly and +19
// with an understated baseline. The defense in estimateSoldRate() was real but
// DEAD — nothing in the scoring path called it.
//
// So: THIS MODULE DOES NOT ACCEPT SOLD RATES. It derives them from terminal
// lead counts ({ booked, lost }) via estimateSoldRate(). A caller cannot assert
// a rate; it can only report counts, which come from the CRM.
//
// The one rate a caller may still propose is the PROJECTED post-action rate,
// and it is governed by the asymmetric clamp below.
//
// ── THE CORE INVARIANT ───────────────────────────────────────────────────────
//
//     You can NEVER claim credit for improving lead quality.
//     You ALWAYS pay full price for degrading it.
//
// Concretely (evaluateObjective): srA is clamped to <= srB. A claimed quality
// improvement is ignored (we score it as "quality held"); a claimed quality
// degradation is honoured in full. Pessimism is always free; optimism is never
// available. This makes the score monotone non-increasing in every direction an
// attacker can push, and it is why the junk-traffic attack cannot pay.
//
// The cost is conservatism: a move that genuinely improves the mix is
// under-credited on the quality axis. That is the correct trade — mix
// improvement is the province of waste-removal, which is valued separately and
// on evidence (evaluateReallocation).
//
// ── Sold-rate denominator (the exact definition) ─────────────────────────────
//     sold_rate = booked / (booked + lost)
//
// TERMINAL OUTCOMES ONLY. A lead at qualification_status='qualified' has not
// resolved — it is in flight. Including in-flight leads in the denominator would
// deflate every sold rate toward zero (a lead that has not lost YET would count
// as a non-sale), making every recent campaign look worse than an old one purely
// because its leads are younger. Leads at 'new' / 'qualified' / 'unqualified' /
// 'unknown' are EXCLUDED from both numerator and denominator. Only 'booked' and
// 'lost' resolve.
//
// Consequence the caller must respect: a segment with zero terminal leads has NO
// measured sold rate. It does NOT have a sold rate of 0. Treating "no data" as
// "never sells" is what makes a waste-removal action look like pure upside.
//
// ── GAMEABILITY (adversarial review, SESSION-08A) ────────────────────────────
// A1 Junk-traffic flood — lower CPL by buying cheap, low-intent leads.
//    delta is Dqualified x the sold rate OF THE AFFECTED COHORT (derived from
//    CRM counts), not the account average. Volume at a 0.02 sold rate is worth
//    almost nothing, and the quality term charges the mix damage against the
//    campaign's WHOLE post-change volume.
// A2 Unknown-segment optimism. estimateSoldRate is now actually WIRED IN:
//    below sold_rate_min_sample the estimate is capped at the prior
//    (min(shrunk, prior)) — an UNMEASURED segment can never rate ABOVE an
//    average one — and dataSufficiency() gates it to 0 below min volume.
// A3 Understated baseline (the blocker above). srB is DERIVED from counts and
//    cannot be asserted. srA is clamped to <= srB.
// A4 Fabricated lift — clamped to max_projected_lift_pct...
// A9 ...including from a ZERO baseline, where a percentage clamp is vacuous
//    (0 x anything = 0). We refuse to project from no baseline at all.
// A5 Waste removal scoring <= 0 forever (negative keywords only REMOVE traffic,
//    so under a naive volume formula E1 could never fire). Valued via freed
//    spend redeployed at the host's marginal efficiency.
// A10 ...but the host object is caller-supplied, so an INFLATED host (spend $1,
//    50 qualified leads) manufactured a 1747x score. The removed cohort must now
//    be a genuine SUBSET of the host campaign, and the host's efficiency is
//    capped. The subset check also catches the innocent unit-mismatch bug
//    (Google returns cost_micros; mixing micros and dollars across the two
//    objects).
// A11 "This traffic never sells" with no evidence. An unmeasured removed cohort
//    is priced at the PRIOR, not at zero. To claim traffic is worthless you must
//    show terminal outcomes proving it.
// A14 ...and A10 still checked spend and leads INDEPENDENTLY, never jointly. Since
//    reallocated is linear in removed.spend and forgone is ~0 for a provably-dead
//    cohort, simply OVERSTATING removed.spend scaled the score without bound (18x in
//    review) while passing every subset check. Spend is now bounded by the cohort it
//    describes — see evaluateReallocation. The zero-lead pure-waste case (the ideal
//    negative keyword, and the one E1 needs) is carried by PROVENANCE instead:
//    server-fetched cost is a measurement, not a claim.
// ============================================================

// ── Code defaults ────────────────────────────────────────────────────────────
// Band + min-data keys MUST stay numerically identical to budget-guards.js
// GUARD_DEFAULTS. They are duplicated here rather than imported because
// budget-guards.js constructs a Supabase client at module load; importing it
// would force every consumer of this pure module (and every unit test) to mock
// the DB, destroying the purity the E7 proof depends on. The duplication is held
// honest by a drift-guard test that imports GUARD_DEFAULTS and asserts equality
// (tests/objective.test.js). Same precedent as sql/017.
export const OBJECTIVE_DEFAULTS = {
  // ← mirrors budget-guards GUARD_DEFAULTS (drift-guarded in tests)
  min_data_volume_conversions: 5,
  min_data_lookback_days:      14,
  protected_campaigns:         ['21613067518'],
  cpl_target:                  50,
  cpl_warn:                    75,
  cpl_emergency:               100,
};

// Scoring knobs — agent_config key 'recommendation_scoring'. Tunable without a
// deploy (sql/020 is seed-only; these are the fallback when the row is absent).
export const SCORING_DEFAULTS = {
  // D-1 (Brian, 2026-07-13): fully gated at Phase A launch. Nothing auto-fires.
  auto_execute_enabled:     false,
  auto_execute_allowlist:   [],

  // D-2 (Brian, 2026-07-13): the cap does the work; the threshold is soft and
  // gets tuned off a week of real explain output.
  daily_queue_cap:          10,
  min_score_threshold:      0.25,
  max_per_campaign:         2,
  max_per_action_class:     5,

  // Objective math
  objective_window_days:    30,
  reallocation_efficiency:  0.7,  // freed spend is worth less at the margin
  sold_rate_prior_strength: 10,   // shrinkage pseudo-count k
  sold_rate_min_sample:     5,    // terminal leads needed to be "measured"
  max_projected_lift_pct:   100,  // no proposal may claim to more than double volume
  max_profitable_leads_per_dollar: 0.1, // sanity cap on host efficiency (A10). FPB
                                        // reality is ~0.004 (a $50 CPL at a 20%
                                        // sold rate), so this is ~25x headroom.
  // A14 — how many times its fair share of host spend an UNVERIFIED removed cohort
  // may claim to have burned. A genuinely wasteful keyword IS disproportionate
  // (that is the whole point of cutting it), so this must be >1; but it is not
  // unbounded, which is what the exploit relied on. 3 = "this cohort may claim up to
  // 3x the spend its lead share implies". Only applies to caller-ASSERTED spend —
  // server-verified spend is not a claim, it is a measurement.
  reallocation_max_waste_multiple: 3,

  // Learning gate (E7) — beta-binomial over action_outcomes
  learning_prior_alpha:     2,
  learning_prior_beta:      2,
  learning_weight_floor:    0.25,
  learning_weight_ceiling:  1.0,  // DOWN-WEIGHT ONLY, and HARD-CAPPED at 1.0 in
                                  // code — config may lower it, never raise it.
  // Omitting outcomes must COST you, or "didn't fetch history" is
  // indistinguishable from "spotless record" (both n=0 => weight 1.0).
  // It is pinned to the WORST case — learning_weight_floor — deliberately: at any
  // value above the floor, a caller holding a BAD action class still profits by
  // staying silent (at 0.6 vs a floor of 0.25, omission scored 2.4 against an
  // honest 1.6). Silence must never beat disclosure, for any track record.
  learning_missing_history_weight: 0.25,
  volume_collapse_tolerance: 0.5, // an efficiency "win" bought by losing >50% of
                                  // volume is not a win

  // Confidence
  default_analysis_confidence: 0.6, // when the model reports none
  unmeasured_sample_factor:    0.6,
  attribution_factors: { high: 1.0, medium: 0.85, low: 0.6, none: 0.4 },

  // The actions.action_type CHECK enum. An action class not on this list cannot
  // be scored: renaming your action must not be a way to escape your own track
  // record (E7), and the DB would reject the insert anyway.
  known_action_types: [
    'pause_campaign', 'enable_campaign', 'pause_keyword', 'enable_keyword',
    'adjust_budget', 'adjust_bid', 'create_ad', 'update_ad', 'create_campaign',
    'flag_performance', 'publish_content', 'update_seo', 'post_gbp',
    'add_negative_keyword', 'create_meta_campaign', 'publish_creative', 'other',
  ],

  // Risk penalties, in profitable-lead units (absolute — a risky action with a
  // marginal benefit goes NEGATIVE and is dropped outright, which is intended)
  risk_penalties: {
    holdout:            0.5,
    protected_campaign: 1.0,
    near_major_change:  0.3,
    low_attribution:    0.2,
    unmeasured_segment: 0.3,
    unknown_action_type: 1.0,
  },
};

/** The full resolved default config. Use THIS as a default param, never
 *  SCORING_DEFAULTS alone — that one has no protected_campaigns, so a caller
 *  who forgot resolveObjectiveConfig() would silently lose branded protection. */
export const DEFAULTS = { ...OBJECTIVE_DEFAULTS, ...SCORING_DEFAULTS };

// ── Small pure helpers ───────────────────────────────────────────────────────

function toFiniteOrNull(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toNonNegativeOrNull(value) {
  const n = toFiniteOrNull(value);
  return n !== null && n >= 0 ? n : null;
}

/**
 * A sold rate is a PROBABILITY. Anything outside [0,1] is not a sold rate, it is
 * a bug or an attack (a rate of 5 inflated a delta 5x; a rate of -1 made a no-op
 * look historic). Out of range => null => the gate closes.
 */
export function toSoldRate(value) {
  const n = toFiniteOrNull(value);
  if (n === null || n < 0 || n > 1) return null;
  return n;
}

export function clamp(value, min, max) {
  const n = toFiniteOrNull(value);
  if (n === null) return min; // NaN fails closed to the floor
  return Math.min(max, Math.max(min, n));
}

/** Round to 6dp so fixture equality is not hostage to float dust. */
export function round6(value) {
  const n = toFiniteOrNull(value);
  return n === null ? null : Math.round(n * 1e6) / 1e6;
}

// ── Config ───────────────────────────────────────────────────────────────────

function mergeRow(rawConfigValue, accountId, codeDefaults) {
  const defaults = rawConfigValue?.defaults && typeof rawConfigValue.defaults === 'object'
    ? rawConfigValue.defaults
    : {};
  const overrideSource = accountId ? rawConfigValue?.account_overrides?.[accountId] : null;
  const overrides = overrideSource && typeof overrideSource === 'object' ? overrideSource : {};
  return { ...codeDefaults, ...defaults, ...overrides };
}

/**
 * Merge the agent_config rows into one flat resolved config.
 *
 * agent_config is GLOBAL (no account_id column) — per-account overrides live
 * inside the jsonb under account_overrides[accounts.id]. Merge order per row:
 * code defaults <- config_value.defaults <- account_overrides[accountId].
 *
 * NOTE the shape difference: 'budget_guards' and 'recommendation_scoring' use
 * the { defaults, account_overrides } envelope; 'crm_bridge_margins' is a FLAT
 * object ({"kit":0.20,...}) — see sql/016. Do not "fix" that; match production.
 *
 * SAFETY INVARIANTS ENFORCED HERE (config is an attack surface — a DB row, not a
 * deploy, and nobody reviews a DB row):
 *   - learning_weight_ceiling is hard-capped at 1.0. Config may lower it. A
 *     ceiling of 3 would turn the down-weight-only learning gate into a score
 *     multiplier, breaking the A6 invariant.
 *   - every risk penalty is forced non-negative. A penalty of -5 would turn risk
 *     into a BONUS.
 */
export function resolveObjectiveConfig(rows = {}, accountId = null) {
  const bands   = mergeRow(rows.budgetGuards, accountId, OBJECTIVE_DEFAULTS);
  const scoring = mergeRow(rows.scoring, accountId, SCORING_DEFAULTS);

  const cfg = { ...bands, ...scoring };

  cfg.protected_campaigns = Array.isArray(cfg.protected_campaigns)
    ? cfg.protected_campaigns.map(String)
    : [...OBJECTIVE_DEFAULTS.protected_campaigns];

  cfg.auto_execute_allowlist = Array.isArray(cfg.auto_execute_allowlist)
    ? cfg.auto_execute_allowlist.map(String)
    : [];

  cfg.known_action_types = Array.isArray(cfg.known_action_types) && cfg.known_action_types.length
    ? cfg.known_action_types.map(String)
    : [...SCORING_DEFAULTS.known_action_types];

  // INVARIANT: down-weight only. Config can never buy a multiplier.
  const ceiling = toFiniteOrNull(cfg.learning_weight_ceiling);
  cfg.learning_weight_ceiling = ceiling === null ? 1.0 : Math.min(1.0, Math.max(0, ceiling));

  // INVARIANT: risk is never a reward.
  const rawPenalties = {
    ...SCORING_DEFAULTS.risk_penalties,
    ...(scoring.risk_penalties && typeof scoring.risk_penalties === 'object' ? scoring.risk_penalties : {}),
  };
  cfg.risk_penalties = {};
  for (const [key, value] of Object.entries(rawPenalties)) {
    const n = toFiniteOrNull(value);
    cfg.risk_penalties[key] = n === null || n < 0
      ? Number(SCORING_DEFAULTS.risk_penalties[key] ?? 0)  // corrupt => code default
      : n;
  }

  cfg.attribution_factors = {
    ...SCORING_DEFAULTS.attribution_factors,
    ...(scoring.attribution_factors && typeof scoring.attribution_factors === 'object' ? scoring.attribution_factors : {}),
  };

  // crm_bridge_margins is flat. Never invent a margin: a missing/zero margin
  // means "don't estimate profit" (sql/016), so we keep null rather than 0.
  const rawMargins = rows.crmMargins && typeof rows.crmMargins === 'object' ? rows.crmMargins : {};
  cfg.margins = { ...rawMargins };

  return cfg;
}

/**
 * Gross-profit margin for a project type. Returns null (never 0, never a guess)
 * when no usable margin exists — matching crm-bridge.js, which leaves
 * gross_profit NULL rather than inventing a profit figure.
 */
export function marginFor(projectType, cfg = DEFAULTS) {
  const margins = cfg?.margins || {};
  const direct = toFiniteOrNull(margins[projectType]);
  if (direct !== null && direct > 0) return direct;
  const fallback = toFiniteOrNull(margins.default);
  return fallback !== null && fallback > 0 ? fallback : null;
}

// ── CPL bands ────────────────────────────────────────────────────────────────

/**
 * CPL band label. Mirrors budget-guards.js classifyCpl EXACTLY — same vocabulary,
 * same boundaries ('target' | 'above_target' | 'warn' | 'emergency' | 'unknown').
 * Behavioural agreement is drift-guarded in tests.
 *
 * A band is a LABEL used for evidence and risk. It is never a reward: nothing in
 * this module scores an action higher because CPL went down.
 */
export function cplBand(cpl, cfg = DEFAULTS) {
  const value = toFiniteOrNull(cpl);
  if (value === null) return 'unknown';
  if (value >= cfg.cpl_emergency) return 'emergency';
  if (value >= cfg.cpl_warn)      return 'warn';
  if (value <= cfg.cpl_target)    return 'target';
  return 'above_target';
}

// ── Sold rate ────────────────────────────────────────────────────────────────

/**
 * Measured sold rate over TERMINAL outcomes only: booked / (booked + lost).
 * In-flight leads are excluded from BOTH numerator and denominator — see header.
 *
 * @returns {{ rate: number|null, terminal, booked, lost }}
 *          rate is null when there are no terminal outcomes. Null means UNKNOWN,
 *          NOT zero.
 */
export function soldRate(segment = {}) {
  const booked = toNonNegativeOrNull(segment.booked) ?? 0;
  const lost   = toNonNegativeOrNull(segment.lost) ?? 0;
  const terminal = booked + lost;
  return {
    rate: terminal > 0 ? booked / terminal : null,
    terminal,
    booked,
    lost,
  };
}

/**
 * Sold rate with shrinkage toward a prior — THE function the scorer uses to
 * derive every rate it works with. Callers supply counts; they never supply a
 * rate.
 *
 * Below sold_rate_min_sample terminal outcomes the estimate is CAPPED at the
 * prior: min(shrunk, prior). An unmeasured segment can never look BETTER than an
 * average one (A2). Above the floor the shrunk estimate stands on its own and may
 * legitimately exceed the prior.
 */
export function estimateSoldRate(segment = {}, prior = null, cfg = DEFAULTS) {
  const { rate: raw, terminal, booked } = soldRate(segment);
  const k         = toFiniteOrNull(cfg.sold_rate_prior_strength) ?? SCORING_DEFAULTS.sold_rate_prior_strength;
  const minSample = toFiniteOrNull(cfg.sold_rate_min_sample) ?? SCORING_DEFAULTS.sold_rate_min_sample;
  const p         = toSoldRate(prior); // a prior outside [0,1] is not a prior

  // No terminal data at all: the prior is all we have. No prior => UNKNOWN, and
  // dataSufficiency() gates it to 0. We do not manufacture a sold rate.
  if (terminal === 0) {
    return {
      rate: p,
      measured: false,
      terminal: 0,
      shrunk: p !== null,
      cappedAtPrior: false,
      reason: p === null ? 'no_sold_rate_prior' : 'no_terminal_outcomes_using_prior',
    };
  }

  // Terminal data but no prior to shrink toward: use the raw measured rate.
  if (p === null) {
    const measured = terminal >= minSample;
    return {
      rate: raw,
      measured,
      terminal,
      shrunk: false,
      cappedAtPrior: false,
      reason: measured ? null : 'below_sold_rate_min_sample_no_prior',
    };
  }

  const shrunk = (booked + p * k) / (terminal + k);

  if (terminal < minSample) {
    const capped = Math.min(shrunk, p);
    return {
      rate: capped,
      measured: false,
      terminal,
      shrunk: true,
      cappedAtPrior: capped < shrunk,
      reason: 'below_sold_rate_min_sample_capped_at_prior',
    };
  }

  return { rate: shrunk, measured: true, terminal, shrunk: true, cappedAtPrior: false, reason: null };
}

// ── The objective ────────────────────────────────────────────────────────────

/** Expected sold jobs from a segment: qualified_leads x sold_rate. */
export function profitableLeads(segment = {}) {
  const qualified = toNonNegativeOrNull(segment.qualifiedLeads);
  const rate      = toSoldRate(segment.soldRate);
  if (qualified === null || rate === null) return null;
  return qualified * rate;
}

/** Profitable leads produced per dollar of spend. null when spend is unusable. */
export function profitableLeadsPerDollar(segment = {}) {
  const spend = toNonNegativeOrNull(segment.spend);
  const p     = profitableLeads(segment);
  if (spend === null || spend <= 0 || p === null) return null;
  return p / spend;
}

/**
 * The core before/after objective delta, with an EXACT decomposition:
 *
 *   delta = qA*srA - qB*srB
 *         = (qA - qB) * srB      <- volume effect, held at the OLD quality
 *         + qA * (srA - srB)     <- quality effect, on the NEW volume
 *
 * The two terms sum to delta exactly, so qualityDrag is a diagnostic, never a
 * second subtraction (double-penalising would be as wrong as ignoring it).
 *
 * THE ASYMMETRIC QUALITY CLAMP (the core invariant): srA is clamped to <= srB.
 * A claimed quality IMPROVEMENT is ignored; a claimed quality DEGRADATION is
 * honoured in full. Optimism is never available; pessimism is always free.
 *
 * Both rates must already be derived (srB from terminal counts). Both are
 * re-validated to [0,1] here so this function is safe called directly.
 */
export function evaluateObjective(before = {}, after = {}, cfg = DEFAULTS) {
  const qB  = toNonNegativeOrNull(before.qualifiedLeads);
  const qA  = toNonNegativeOrNull(after.qualifiedLeads);
  const srB = toSoldRate(before.soldRate);
  const reasons = [];

  const nullResult = (why) => ({
    delta: null,
    profitableBefore: null,
    profitableAfter: null,
    volumeEffect: null,
    qualityEffect: null,
    qualityDrag: null,
    clamped: false,
    qualityClamped: false,
    reasons: [why],
  });

  if (qB === null || qA === null || srB === null) return nullResult('insufficient_objective_inputs');

  // THE INVARIANT: you may not claim credit for improving quality.
  const srAClaimed = toSoldRate(after.soldRate);
  let srA = srAClaimed === null ? srB : srAClaimed; // silence = "quality holds"
  let qualityClamped = false;
  if (srA > srB) {
    srA = srB;
    qualityClamped = true;
    reasons.push('projected_quality_improvement_not_credited');
  }

  // A9: the ZERO-BASELINE hole. A percentage clamp is vacuous against a baseline
  // of zero (0 x anything = 0), so "this campaign has 0 qualified leads today and
  // will have 10,000 tomorrow" sailed through unclamped and dominated the queue.
  // We have NO elasticity evidence from a zero base — there is no observed
  // lead-per-dollar behaviour to extrapolate. So we refuse to project rather than
  // clamp to an arbitrary number.
  //
  // This does NOT block acting on a dead campaign: cutting or pausing one is a
  // 'waste_removal' candidate, valued by evaluateReallocation(), not here.
  if (qB <= 0 && qA > 0) return nullResult('no_baseline_volume_cannot_project_lift');

  // A4: bound fabricated lift.
  const maxLiftPct = toFiniteOrNull(cfg.max_projected_lift_pct) ?? SCORING_DEFAULTS.max_projected_lift_pct;
  const ceiling    = qB * (1 + maxLiftPct / 100);
  let qAdj = qA;
  let clamped = false;
  if (qA > ceiling) {
    qAdj = ceiling;
    clamped = true;
    reasons.push(`projected_lift_clamped_to_${maxLiftPct}pct`);
  }

  const profitableBefore = qB * srB;
  const profitableAfter  = qAdj * srA;
  const volumeEffect     = (qAdj - qB) * srB;
  const qualityEffect    = qAdj * (srA - srB);
  const delta            = profitableAfter - profitableBefore;
  const qualityDrag      = Math.max(0, -qualityEffect);

  if (qualityDrag > 0) reasons.push('sold_rate_degraded_by_action');

  return {
    delta: round6(delta),
    profitableBefore: round6(profitableBefore),
    profitableAfter: round6(profitableAfter),
    volumeEffect: round6(volumeEffect),
    qualityEffect: round6(qualityEffect),
    qualityDrag: round6(qualityDrag),
    clamped,
    qualityClamped,
    reasons,
  };
}

/**
 * Waste-removal valuation (A5) — negative keywords, pausing a wasteful segment.
 * These actions only ever REMOVE traffic, so a naive volume formula scores them
 * <= 0 forever and eval E1 could never fire.
 *
 * Their value is the spend they free. Within the daily cap the objective is
 * zero-sum (harness §1.1), so freed spend is redeployed into the host campaign's
 * remaining traffic at that campaign's marginal profitable-leads-per-dollar,
 * discounted by reallocation_efficiency (default 0.7) for diminishing returns:
 *
 *   delta = removed.spend * pl_per_dollar(host) * efficiency   <- redeployed
 *         - removed.qualifiedLeads * removed.soldRate           <- forgone
 *
 * A10 — THE SUBSET CHECK. The host object is caller-supplied, and an inflated
 * host (spend $1, 50 qualified leads => 5 sold jobs per dollar) manufactured a
 * 1747x score in review. The removed cohort must be a genuine SUBSET of the host
 * campaign it is being cut from: you cannot remove more spend, or more leads,
 * than the host has. This single check also catches the innocent unit-mismatch
 * bug — Google Ads returns cost_micros, and a caller mixing micros (removed) with
 * dollars (host) produces removed.spend >> host.spend and is refused.
 *
 * The host's efficiency is additionally capped at max_profitable_leads_per_dollar.
 *
 * A14 — THE SPEND-COHERENCE CAP (independent review, 2026-07-13). A10 validated
 * spend and leads INDEPENDENTLY (spend <= spend, leads <= leads) but never
 * JOINTLY, and `reallocated` is LINEAR in removed.spend while `forgone` is pinned
 * to ~0 by a provably-worthless cohort. So overstating removed.spend scaled the
 * score without bound up to hostSpend: a 0-for-20 cohort holding 10% of the host's
 * leads could claim 100% of its budget and score 18x honest value — while passing
 * every subset check. The claim is arithmetically incoherent (the host's other 90%
 * of leads would have been generated on $0), and it displaced real work from the
 * queue.
 *
 * The fix turns on PROVENANCE, because the cap is only needed for a number the
 * caller can lie about:
 *
 *   removed.spendVerified === true  — the spend's MEMBERSHIP is independently
 *     verified: the SET of rows summed into it is known-complete and
 *     known-correct, not merely built from real fetched numbers. No coherence
 *     cap applies once this holds.
 *
 *     D-11 (re-affirmed 2026-07-31), correcting this comment's own prior
 *     claim: "every number is server-fetched" is NOT the same thing as "the
 *     set of rows summed is the right set" (SDR-7 — a true defence against
 *     row-VALUE fabrication was being read as coverage for row-MEMBERSHIP
 *     inflation, which it was never built to answer). The rows-derived
 *     'waste_removal' path in expectedDeltaProfitableLeads therefore NEVER
 *     sets this flag — see its comment at the removed-cohort construction
 *     site. It defaults to false until a real membership-provenance signal
 *     (the persisted, unspoofable fetchId — S-07f.1) exists at the caller
 *     boundary and is wired through to this function. No caller today may
 *     set this true; a future one may, only from that signal, never by
 *     copying it off an LLM proposal or inferring it from row contents alone.
 *
 *   otherwise — the spend is a CLAIM, and is clamped to
 *       W x (removedQualified / hostQualified) x hostSpend
 *     i.e. a cohort may claim at most W times the spend its lead share implies.
 *     W > 1 because real waste IS disproportionate; W bounded because unbounded is
 *     the exploit.
 *
 * E1 IS ELIMINATED, NOT MERELY UNDER-CREDITED, UNTIL MEMBERSHIP PROVENANCE
 * EXISTS, AND THIS IS DELIBERATE (D-11, re-affirmed 2026-07-31; corrected by
 * cold re-review, 2026-07-31 — the first pass understated this cost as
 * generic "under-crediting"). A zero-conversion term (the exact shape
 * api/google-ads.js's own topWaste filter selects: `conversions === 0 &&
 * cost > 0` — every candidate this surface can ever produce) has lead share
 * EXACTLY 0. With spendVerified now defaulting to false, its reclaimable
 * spend clamps to W x 0 x hostSpend = $0 exactly — not reduced, ELIMINATED.
 * Measured: score -0.3, does not queue, full stop. A term with real tracked
 * conversions that simply never converted to a booked/lost outcome (e.g. a
 * 0-for-20 cohort) is unaffected and still queues identically to before —
 * only the true zero-platform-conversions class is zeroed. Accepted
 * explicitly: under-crediting (or here, full elimination) is safe,
 * over-crediting is the attack, and this module cannot itself supply the
 * membership signal that would restore E1 without re-opening the hole
 * (see the removed-cohort comment above for why).
 *
 * Both sold rates arrive DERIVED (see expectedDeltaProfitableLeads). In
 * particular an unmeasured removed cohort is priced at the PRIOR, not at zero
 * (A11): claiming "this traffic never sells" requires terminal evidence.
 */
export function evaluateReallocation({ removed = {}, host = {} } = {}, cfg = DEFAULTS) {
  const reasons = [];
  const efficiency = clamp(
    toFiniteOrNull(cfg.reallocation_efficiency) ?? SCORING_DEFAULTS.reallocation_efficiency,
    0,
    1,
  );

  const nullResult = (why) => ({
    delta: null, reallocated: null, forgone: null, reclaimableSpend: null,
    spendClamped: false, efficiency, reasons: [why],
  });

  const removedSpend = toNonNegativeOrNull(removed.spend);
  const removedQ     = toNonNegativeOrNull(removed.qualifiedLeads);
  const hostSpend    = toNonNegativeOrNull(host.spend);
  const hostQ        = toNonNegativeOrNull(host.qualifiedLeads);
  const forgone      = profitableLeads(removed);

  if (removedSpend === null || removedQ === null || forgone === null) {
    return nullResult('insufficient_reallocation_inputs');
  }
  if (hostSpend === null || hostQ === null) {
    return nullResult('insufficient_host_inputs');
  }

  // A10: the removed cohort must be a real subset of the host campaign. This runs
  // BEFORE the A14 cap — provenance relaxes the coherence cap, never the subset
  // invariant, so verified spend is still refused if it exceeds the host.
  if (removedSpend > hostSpend) {
    return nullResult('removed_spend_exceeds_host_spend_not_a_subset');
  }
  if (removedQ > hostQ) {
    return nullResult('removed_leads_exceed_host_leads_not_a_subset');
  }

  // A14: bound a spend CLAIM to the cohort it describes. A spend MEASUREMENT
  // (server-fetched, per the 08B contract above) is not a claim and is not capped.
  const spendVerified = removed.spendVerified === true;
  let reclaimableSpend = removedSpend;
  let spendClamped = false;

  if (spendVerified) {
    reasons.push('removed_spend_server_verified');
  } else {
    const wasteMultiple = Math.max(
      0,
      toFiniteOrNull(cfg.reallocation_max_waste_multiple)
        ?? SCORING_DEFAULTS.reallocation_max_waste_multiple,
    );
    // hostQ === 0 => no lead share is definable => an unverified claim earns nothing.
    const leadShare = hostQ > 0 ? removedQ / hostQ : 0;
    const shareCap  = wasteMultiple * leadShare * hostSpend;

    if (removedSpend > shareCap) {
      reclaimableSpend = shareCap;
      spendClamped = true;
      reasons.push('removed_spend_clamped_to_waste_multiple');
    }
  }

  const rawHostRate = profitableLeadsPerDollar(host);

  // No usable host efficiency (e.g. the host has no resolvable sold rate): we
  // cannot claim any redeployment value. Fail conservative — the action is then
  // worth only the harm it avoids, which is never positive, so it will not queue.
  if (rawHostRate === null) {
    reasons.push('no_host_efficiency_reallocation_credited_zero');
    return {
      delta: round6(-forgone),
      reallocated: 0,
      forgone: round6(forgone),
      reclaimableSpend: round6(reclaimableSpend),
      spendClamped,
      efficiency,
      reasons,
    };
  }

  const rateCap = toFiniteOrNull(cfg.max_profitable_leads_per_dollar)
    ?? SCORING_DEFAULTS.max_profitable_leads_per_dollar;
  let hostRate = rawHostRate;
  if (hostRate > rateCap) {
    hostRate = rateCap;
    reasons.push('host_efficiency_capped');
  }

  const reallocated = reclaimableSpend * hostRate * efficiency;
  if (forgone > 0) reasons.push('removal_forgoes_some_selling_traffic');

  return {
    delta: round6(reallocated - forgone),
    reallocated: round6(reallocated),
    forgone: round6(forgone),
    reclaimableSpend: round6(reclaimableSpend),
    spendClamped,
    efficiency,
    hostRate: round6(hostRate),
    reasons,
  };
}

// ── S-08A.1a (2026-07-30) — server-derived reallocation cohort ───────────────
//
// SUPERSEDES the `candidate.removed` / `candidate.host` scalar shape below for
// the 'waste_removal' branch of expectedDeltaProfitableLeads. That shape let a
// caller ASSERT `spend` and `qualifiedLeads` directly, and independent review
// found the assertion path permitted 167x inflation (A15) — WORSE than the 18x
// A14 was built to stop — because deriving row CONTENTS is worthless while the
// caller still chooses row MEMBERSHIP. `fetchSearchTerms` (api/google-ads.js)
// makes the campaign filter optional and the one live call site passes none,
// so every fetch is account-wide; attaching every account row to a one-term
// negative turned an honest 0.084 into 14.0, with every number "server-fetched"
// and passing every A10 subset check that existed at the time.
//
// The fix binds MEMBERSHIP, not just contents:
//   1. Every row must carry a unique rowId (S-07f.0's resource_name-derived
//      identity — NOT (searchTerm, campaignId), which collides across ad
//      groups).
//   2. Every row must belong to the declared host campaign (campaignId match).
//   3. Every row's searchTerm must be in the action's OWN expectedSearchTerms
//      — the terms the action's execution_data actually claims to target.
//      This is what stops "attach every account row" even within one
//      campaign: only rows matching the term(s) the action names count.
//   4. host and removed derive from the SAME rows array and the SAME scalar
//      fetchId/window (D-9's "share one fetch and one unit").
//   5. D-9: `platformConversions` (Google's own conversion count on the rows)
//      is derived and named DISTINCTLY from `qualifiedLeads` (CRM-qualified).
//      The caller supplies removedBooked/removedLost/hostBooked/hostLost —
//      real terminal CRM counts — and this module refuses to substitute
//      platformConversions for them. A coherence check (below) additionally
//      refuses a terminal-lead claim that EXCEEDS the cohort's own platform
//      conversions: a CRM-qualified lead cannot exist without first
//      registering as a platform conversion event in any realistic
//      attribution model, so claiming MORE terminal leads than the rows'
//      combined platformConversions is refused as incoherent — the same
//      "subset, not independent" principle as A10, applied one level deeper.
//
// D-11 (Brian, re-affirmed 2026-07-31 after cold review): the
// reallocation_max_waste_multiple (W) cap in evaluateReallocation is
// RETAINED, not deleted, as defence in depth — the deletion instruction was
// formally withdrawn after this exact contract's first draft was found to
// permit A15.
//
// CORRECTION to this comment's original claim (left visible rather than
// erased, per this project's own SDR-2 standard applied to itself): this
// module does NOT mark a row-derived cohort's spend as spendVerified. The
// first draft did, unconditionally, which made the cap's else branch
// structurally unreachable from this — the sanctioned — entry point: every
// candidate that could reach evaluateReallocation did so already flagged
// exempt. That is the original A14 defect repeated one layer up (an
// attacker-settable opt-out replaced by an unconditional one), and cold
// review (harness/REVIEW-D11-2026-07-31.md) found it. Root cause: row-VALUE
// provenance ("every number here came from a real fetch") was conflated with
// cohort-MEMBERSHIP provenance ("the set of rows summed is the right set") —
// SDR-7. This module cannot verify membership itself (pure, zero-I/O); until
// an unspoofable membership signal exists at the caller boundary (S-07f.1),
// spendVerified is never set here, so the W-cap now applies to EVERY
// rows-derived claim on this path too — not just to a caller reaching
// evaluateReallocation directly with an unverified scalar (which is what the
// extensive A14 test suite in tests/objective.test.js already covered, and
// still does, unchanged by this session). Belt and braces, now actually
// live on both paths.
//
// Fixture-only tonight (2026-07-30): no live caller of expectedDeltaProfitableLeads
// exists anywhere in api/ yet (S-08B, the daily loop, is not built — see
// SESSIONS.md). This module is reviewed and accepted as the CONTRACT a future
// caller must satisfy; integration against real fetched rows is additionally
// gated on S-07f.0's row-identity fix having a live cardinality measurement,
// which this environment could not produce tonight (no live Google Ads
// credential access — see harness/DECISIONS.md S-07f.0).

function rowsHaveDuplicateRowIds(rows) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.rowId)) return true;
    seen.add(row.rowId);
  }
  return false;
}

/**
 * Derive a verified removed cohort from server-fetched search-term rows.
 *
 * `rows` is expected to be the WHOLE relevant fetch — potentially spanning
 * multiple campaigns and many terms, exactly like an account-wide
 * fetchSearchTerms call. This function FILTERS it down to the rows that are
 * BOTH in the host campaign AND named by expectedSearchTerms — rows outside
 * that intersection are simply not part of the removed cohort (benign,
 * matching how a real multi-campaign fetch works), not an attack to reject
 * the whole candidate over. The security property is that nothing OUTSIDE
 * the intersection can ever be summed in, however many extra rows are
 * present in `rows` — this is what closes A15 (membership inflation):
 * attaching every account row to a one-term negative has zero effect, because
 * only rows matching the declared term, in the declared campaign, are ever
 * counted.
 *
 * Returns { valid: true, spend, platformConversions, booked, lost,
 * qualifiedLeads, rowCount, rowIds } or { valid: false, reason }.
 *
 * qualifiedLeads = booked + lost (the caller's REAL terminal CRM counts for
 * this exact cohort — never platformConversions, which is reported
 * separately). If the caller has no CRM-term attribution, it must pass
 * booked: 0, lost: 0 explicitly — an honestly-unmeasured cohort, priced at
 * the account prior by estimateSoldRate() upstream, NOT a manufactured zero.
 */
export function deriveRemovedCohort({
  rows,
  hostCampaignId,
  expectedSearchTerms,
  fetchId,
  window = null,
  booked = 0,
  lost = 0,
} = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { valid: false, reason: 'removed_no_rows_supplied' };
  }
  if (hostCampaignId === undefined || hostCampaignId === null || String(hostCampaignId).trim() === '') {
    return { valid: false, reason: 'removed_no_host_campaign_id' };
  }
  if (fetchId === undefined || fetchId === null || String(fetchId).trim() === '') {
    return { valid: false, reason: 'removed_no_fetch_id' };
  }
  if (!Array.isArray(expectedSearchTerms) || expectedSearchTerms.length === 0) {
    // The A15 gap exactly: with no independent target to check membership
    // against, "every row I was handed" and "every row that belongs to this
    // action" are indistinguishable. Refuse rather than trust an unbounded
    // fetch.
    return { valid: false, reason: 'removed_no_expected_search_terms_to_cross_check' };
  }

  const expected = new Set(expectedSearchTerms.map((t) => String(t).trim().toLowerCase()));
  const matched = rows.filter(
    (r) => r
      && String(r.campaignId) === String(hostCampaignId)
      && expected.has(String(r.searchTerm || '').trim().toLowerCase()),
  );

  if (matched.length === 0) {
    return { valid: false, reason: 'removed_no_rows_match_host_and_expected_terms' };
  }
  if (matched.some((r) => typeof r.rowId !== 'string' || r.rowId.trim() === '')) {
    return { valid: false, reason: 'removed_row_missing_rowid' };
  }
  if (rowsHaveDuplicateRowIds(matched)) {
    // Honest multi-ad-group rows have DIFFERENT rowIds by construction
    // (S-07f.0) — a literal duplicate rowId is a replay/synthesis attack, not
    // a legitimate collision, and must never be silently deduped or averaged.
    return { valid: false, reason: 'removed_duplicate_row_id' };
  }

  const spend = round6(matched.reduce((sum, r) => sum + (toNonNegativeOrNull(r.cost) ?? 0), 0));
  const platformConversions = round6(
    matched.reduce((sum, r) => sum + (toNonNegativeOrNull(r.conversions) ?? 0), 0),
  );
  const bookedN = toNonNegativeOrNull(booked) ?? 0;
  const lostN   = toNonNegativeOrNull(lost) ?? 0;
  const terminal = bookedN + lostN;

  if (terminal > platformConversions) {
    // D-9 coherence check: a removed cohort cannot claim more terminal CRM
    // leads than its OWN rows' platform-tracked conversions. This is the A17
    // booked/lost-assertion attack closed the same way A10 closes spend/lead
    // inflation — a claim must be a genuine subset of what the evidence shows.
    return { valid: false, reason: 'removed_terminal_leads_exceed_platform_conversions' };
  }

  // A11, re-derived for the rows contract: qualifiedLeads for SCORING is
  // terminal (booked+lost) when something has actually resolved, but when
  // NOTHING has resolved yet (terminal===0) it falls back to
  // platformConversions — the most the cohort could plausibly still qualify,
  // bounded by its own tracked conversions, never asserted. Without this,
  // qualifiedLeads=0 whenever terminal=0 regardless of platformConversions,
  // and profitableLeads = qualifiedLeads x soldRate is 0 x anything = 0 —
  // silently re-opening A11 (an unmeasured cohort would forgo nothing,
  // scoring as pure upside, exactly the "this traffic never sells" claim
  // A11 exists to refuse). estimateSoldRate() still runs on the REAL
  // booked/lost (never this bound) — only the volume multiplier is bounded
  // here, not the rate.
  const qualifiedLeadsForScoring = terminal > 0 ? terminal : platformConversions;

  return {
    valid: true,
    spend,
    platformConversions,
    booked: bookedN,
    lost: lostN,
    qualifiedLeads: qualifiedLeadsForScoring,
    rowCount: matched.length,
    rowIds: matched.map((r) => r.rowId),
    fetchId,
    window,
  };
}

/**
 * Derive the host campaign's aggregate from the SAME fetched rows array
 * (D-9: host and removed share one fetch and one unit) — every row in the
 * fetch belonging to hostCampaignId, not just the removed subset.
 */
export function deriveHostFromRows({
  rows,
  hostCampaignId,
  fetchId,
  booked = 0,
  lost = 0,
} = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { valid: false, reason: 'host_no_rows_supplied' };
  }
  if (hostCampaignId === undefined || hostCampaignId === null || String(hostCampaignId).trim() === '') {
    return { valid: false, reason: 'host_no_campaign_id' };
  }
  if (fetchId === undefined || fetchId === null || String(fetchId).trim() === '') {
    return { valid: false, reason: 'host_no_fetch_id' };
  }
  const hostRows = rows.filter((r) => r && String(r.campaignId) === String(hostCampaignId));
  if (hostRows.length === 0) {
    return { valid: false, reason: 'host_no_rows_for_campaign' };
  }
  if (rowsHaveDuplicateRowIds(hostRows.filter((r) => typeof r.rowId === 'string' && r.rowId.trim() !== ''))) {
    return { valid: false, reason: 'host_duplicate_row_id' };
  }

  const spend = round6(hostRows.reduce((sum, r) => sum + (toNonNegativeOrNull(r.cost) ?? 0), 0));
  const platformConversions = round6(
    hostRows.reduce((sum, r) => sum + (toNonNegativeOrNull(r.conversions) ?? 0), 0),
  );
  const bookedN = toNonNegativeOrNull(booked) ?? 0;
  const lostN   = toNonNegativeOrNull(lost) ?? 0;
  const terminal = bookedN + lostN;

  if (terminal > platformConversions) {
    return { valid: false, reason: 'host_terminal_leads_exceed_platform_conversions' };
  }

  // Same A11 volume bound as deriveRemovedCohort — see its comment. A host
  // campaign in practice almost always has real terminal data, but the same
  // "unmeasured must not silently score as zero-value" principle applies.
  const qualifiedLeadsForScoring = terminal > 0 ? terminal : platformConversions;

  return {
    valid: true,
    spend,
    platformConversions,
    booked: bookedN,
    lost: lostN,
    qualifiedLeads: qualifiedLeadsForScoring,
    rowCount: hostRows.length,
    fetchId,
  };
}

/**
 * THE ENTRY POINT. Derives every sold rate from terminal counts, then dispatches.
 *
 * Candidate contract (08B must satisfy this — sold rates are NOT accepted):
 *   accountSoldRatePrior : number|null  account-wide booked/(booked+lost)
 *   shape 'volume_change' | 'mix_shift':
 *     before : { qualifiedLeads, booked, lost }   counts from the CRM
 *     after  : { qualifiedLeads, soldRate? }      projection; soldRate is clamped
 *                                                 to <= the DERIVED before-rate
 *   shape 'waste_removal' (S-08A.1a contract — rows, never scalars):
 *     rows                 : array of server-fetched search-term rows, each
 *                            { rowId, campaignId, searchTerm, cost, conversions }
 *                            (exactly api/google-ads.js fetchSearchTerms output,
 *                            post S-07f.0). MUST include both the removed
 *                            cohort's rows and the rest of the host campaign's
 *                            rows from the SAME fetch.
 *     hostCampaignId       : the campaign the removed cohort is cut from
 *     expectedSearchTerms  : array of search-term strings this action's own
 *                            execution_data actually names — the membership
 *                            cross-check (closes A15)
 *     fetchId, window      : scalar identity of the fetch (D-9)
 *     removedBooked/removedLost, hostBooked/hostLost : real terminal CRM
 *                            counts, never platformConversions (D-9)
 *   `candidate.removed` / `candidate.host` (the pre-S-08A.1a scalar shape) are
 *   NO LONGER ACCEPTED — see deriveRemovedCohort/deriveHostFromRows above.
 *
 * Returns the delta plus `soldRateEstimate` — the AUTHORITATIVE measured-ness of
 * the baseline, which the scorer uses instead of trusting a caller boolean.
 */
export function expectedDeltaProfitableLeads(candidate = {}, cfg = DEFAULTS) {
  const shape = candidate.shape || 'volume_change';
  const prior = toSoldRate(candidate.accountSoldRatePrior);

  if (shape === 'waste_removal') {
    // The pre-S-08A.1a scalar shape is refused outright — it is exactly what
    // let a caller assert spend/qualifiedLeads directly (A14/A15/A17-A19).
    if (candidate.removed !== undefined || candidate.host !== undefined) {
      return {
        delta: null, shape, qualityDrag: null, soldRateEstimate: null,
        reasons: ['removed_and_host_scalars_no_longer_accepted_use_rows_contract'],
      };
    }

    // D-9 paranoia guard: a row carrying a field literally named like a raw
    // platform-conversion count must never silently pass through as if it
    // were a qualified-lead count. deriveRemovedCohort/deriveHostFromRows
    // only ever read `.conversions` into `platformConversions` — never into
    // `qualifiedLeads` — but this rejects outright if a row is shaped to look
    // like it is trying to smuggle a conversions value under a
    // qualifiedLeads-sounding key.
    const rows = Array.isArray(candidate.rows) ? candidate.rows : [];
    if (rows.some((r) => r && (r.qualifiedLeads !== undefined || r.googleConversions !== undefined))) {
      return {
        delta: null, shape, qualityDrag: null, soldRateEstimate: null,
        reasons: ['row_carries_qualifiedLeads_or_googleConversions_field_refused'],
      };
    }

    const removedCohort = deriveRemovedCohort({
      rows,
      hostCampaignId: candidate.hostCampaignId,
      expectedSearchTerms: candidate.expectedSearchTerms,
      fetchId: candidate.fetchId,
      window: candidate.window,
      booked: candidate.removedBooked,
      lost: candidate.removedLost,
    });
    if (!removedCohort.valid) {
      return {
        delta: null, shape, qualityDrag: null, soldRateEstimate: null,
        reasons: [removedCohort.reason],
      };
    }

    const hostCohort = deriveHostFromRows({
      rows,
      hostCampaignId: candidate.hostCampaignId,
      fetchId: candidate.fetchId,
      booked: candidate.hostBooked,
      lost: candidate.hostLost,
    });
    if (!hostCohort.valid) {
      return {
        delta: null, shape, qualityDrag: null, soldRateEstimate: null,
        reasons: [hostCohort.reason],
      };
    }

    // A11: an unmeasured (terminal===0) cohort is priced at the PRIOR, never at zero.
    const removedEst = estimateSoldRate({ booked: removedCohort.booked, lost: removedCohort.lost }, prior, cfg);
    const hostEst    = estimateSoldRate({ booked: hostCohort.booked,    lost: hostCohort.lost },    prior, cfg);

    const r = evaluateReallocation(
      {
        removed: {
          spend: removedCohort.spend,
          qualifiedLeads: removedCohort.qualifiedLeads,
          soldRate: removedEst.rate,
          // D-11 (re-affirmed 2026-07-31): NOT spendVerified, and nothing in
          // this module may assert it. Row-VALUE provenance (every number
          // here is a real fetched measurement) is not cohort-MEMBERSHIP
          // provenance (that the SET of rows summed is the correct set) —
          // SDR-7, a true defence read as coverage for a threat it was never
          // built to answer. This module is pure/zero-I/O and cannot verify
          // membership itself; that requires the persisted, unspoofable
          // fetchId at the caller boundary (S-07f.1), which does not exist
          // yet. Until it does, spendVerified defaults to false (by simply
          // never being set here) and the W-multiple bound below applies to
          // every rows-derived claim, exactly as it applies to the retired
          // scalar shape. Accepted cost, corrected by cold re-review
          // (2026-07-31 — an earlier draft of this comment understated it
          // as generic "under-crediting"): a cohort with ZERO platform
          // conversions (lead share exactly 0 — the exact shape
          // api/google-ads.js's topWaste filter selects) is not merely
          // under-credited, its reclaimable spend clamps to exactly $0 and
          // it cannot queue at all until real membership provenance exists.
          // A cohort with real tracked conversions that simply never booked
          // is unaffected. Under-crediting/elimination is safe here;
          // over-crediting is the attack.
        },
        host: {
          spend: hostCohort.spend,
          qualifiedLeads: hostCohort.qualifiedLeads,
          soldRate: hostEst.rate,
        },
      },
      cfg,
    );
    return {
      ...r, shape, qualityDrag: 0,
      soldRateEstimate: removedEst, hostSoldRateEstimate: hostEst,
      removedCohort, hostCohort,
    };
  }

  if (shape === 'volume_change' || shape === 'mix_shift') {
    // srB is DERIVED from terminal counts. It cannot be asserted (A3).
    const beforeEst = estimateSoldRate(candidate.before || {}, prior, cfg);

    const r = evaluateObjective(
      { qualifiedLeads: candidate.before?.qualifiedLeads, soldRate: beforeEst.rate },
      { qualifiedLeads: candidate.after?.qualifiedLeads,  soldRate: candidate.after?.soldRate },
      cfg,
    );
    return { ...r, shape, soldRateEstimate: beforeEst };
  }

  return {
    delta: null,
    shape,
    reasons: [`unknown_candidate_shape_${shape}`],
    qualityDrag: null,
    soldRateEstimate: null,
  };
}

// ── Data sufficiency gate ────────────────────────────────────────────────────

/**
 * The 0/1 gate from the harness formula. Returns 0 — zeroing the whole positive
 * term of the score — when we do not have enough data to be making this call at
 * all (eval E3).
 *
 * Gates on:
 *   - conversions in the lookback below min_data_volume_conversions (5)
 *   - a lookback window shorter than min_data_lookback_days (14)
 *   - no VALID sold rate. Note this is a validity check, not a presence check:
 *     NaN, "banana" and 1.5 are all "no resolvable sold rate", which is exactly
 *     the state they represent. (A presence check let NaN through with gate 1.)
 */
export function dataSufficiency(segment = {}, cfg = DEFAULTS) {
  const reasons = [];
  const minConv     = toFiniteOrNull(cfg.min_data_volume_conversions) ?? OBJECTIVE_DEFAULTS.min_data_volume_conversions;
  const minDays     = toFiniteOrNull(cfg.min_data_lookback_days) ?? OBJECTIVE_DEFAULTS.min_data_lookback_days;
  const conversions = toNonNegativeOrNull(segment.conversions);
  const lookbackDays = toNonNegativeOrNull(segment.lookbackDays);

  if (conversions === null) {
    reasons.push('no_conversion_data');
  } else if (conversions < minConv) {
    reasons.push(`below_min_data_volume_conversions_${conversions}_lt_${minConv}`);
  }

  if (lookbackDays === null) {
    reasons.push('no_lookback_window');
  } else if (lookbackDays < minDays) {
    reasons.push(`below_min_data_lookback_days_${lookbackDays}_lt_${minDays}`);
  }

  if (toSoldRate(segment.soldRateResolved) === null) {
    reasons.push('no_resolvable_sold_rate');
  }

  return { gate: reasons.length === 0 ? 1 : 0, reasons };
}

export default {
  OBJECTIVE_DEFAULTS,
  SCORING_DEFAULTS,
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
  clamp,
  round6,
};
