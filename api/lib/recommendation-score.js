// ============================================================
// recommendation-score.js — candidate scoring + queue selection (SESSION-08A)
//
// PURE. Imports objective.js ONLY (itself pure, zero imports). No I/O, no
// network, no DB. The caller (SESSION-08B, api/cron-optimize.js) fetches
// action_outcomes / daily stats / config and passes them in.
//
// The harness §1.1 formula, kept literally:
//
//   score = expected_delta_profitable_leads   (objective.js — sold jobs, not CPL)
//         x confidence                        (analysis x LEARNING x data quality)
//         x data_sufficiency_gate             (0 or 1)
//         - risk_penalty                      (absolute, in profitable-lead units)
//
// Then: threshold cutoff, then volume-cap selection (drop the lowest-scoring
// items that clear the bar — never queue noise to fill the cap).
//
// ── The learning gate (eval E7) ──────────────────────────────────────────────
// Beta-binomial over action_outcomes, grouped by action_type.
//
// CRITICAL #1: action_outcomes.conclusion is a HUMAN-READABLE PROSE STRING, not
// a grade. There is no machine success/failure column on the table. Success is
// therefore derived from the NUMBERS (gradeOutcome), never by parsing prose.
//
// CRITICAL #2 — WHY THERE IS NO CPL RUNG. The first draft graded outcomes on a
// GP -> CPQL -> CPL ladder. Adversarial review killed the CPL rung, and it was
// right: gross_profit_* is written NULL by evaluate-outcomes.js today, so CPL
// would have been the LIVE grading basis — and an outcome where CPL fell, volume
// rose and SOLD-RATE COLLAPSED grades as {success: true} on CPL. The learning
// gate would then have REWARDED precisely the junk-traffic action class the
// objective exists to reject. The two halves of the module would have disagreed
// about what "good" means, and the proxy half would have won, because it is the
// half with data.
//
// The ladder is GP -> SOLD RATE -> CPQL:
//   - gross_profit_*: the real target.
//   - sold_rate (S-04B, 2026-07-30, closes R-014 below): booked/(booked+lost)
//     terminal-outcome comparison, before vs. after. Closer to the real
//     objective than CPQL — a qualified lead that never sells contributes
//     ~0 gross profit, and CPQL cannot see that at all (it is blind to
//     everything downstream of "qualified"). Requires a real sample
//     (>= sold_rate_min_sample terminal outcomes) on BOTH sides; a rate from
//     a handful of observations is noise, not a rung.
//   - cost_per_qualified_lead_*: the denominator is CRM-QUALIFIED leads
//     (PRIME-STRATEGY §5's north-star metric). Junk leads never become qualified,
//     so a junk-traffic flood does NOT improve CPQL. This rung is resistant to
//     the headline failure mode in a way CPL is not — but see R-014 below for
//     the failure mode it IS blind to, which is exactly what the sold_rate
//     rung above it now closes.
// An outcome with no basis at any rung ABSTAINS (null) — it counts as neither
// success nor failure. We would rather have no signal than a proxy signal that
// points the wrong way.
//
// R-014 — THE FAILURE THE SOLD_RATE RUNG CLOSES (harness/DECISIONS.md, formerly
// logged as a known limitation, reclassified as a defect once diagnosed): the
// header above already explains why CPL was rejected (blind to sold rate,
// exploitable by a junk-traffic flood). CPQL survives THAT attack — junk leads
// never qualify — but CPQL is a DIFFERENT rung short of the same underlying
// truth: qualified leads that do not close. An action that raises qualified-
// lead VOLUME while lowering the fraction of those qualified leads that
// actually sell improves CPQL (more qualified leads per dollar) while the
// business gets worse, and the CPQL-only ladder graded that outcome a SUCCESS
// — E7 would then up-weight exactly that action class, compounding the error
// every cycle. Fixed by inserting the sold_rate rung ABOVE CPQL: when terminal
// data exists on both sides, sold rate decides, and CPQL is only reached when
// sold-rate data is unmeasured or too thin a sample.
//
// COLD START: action_outcomes has ZERO rows in production (verified live,
// 2026-07-13). At n=0 the learning weight is EXACTLY 1.0 — the module must not
// manufacture a signal it does not have. E7 is fixture-provable now and becomes
// live the moment outcomes accrue.
//
// ── Gameability notes specific to this module ────────────────────────────────
// A6 Confidence inflation — grind an action class clean, then use the learning
//    multiplier to inflate everything in that class. Blocked: the weight ceiling
//    is HARD-CAPPED at 1.0 in resolveObjectiveConfig (config may lower it, never
//    raise it). The gate is DOWN-WEIGHT ONLY. A good record restores you to
//    neutral; it never pays a bonus.
// A7 Efficiency bought with collapse — an outcome where CPQL "improved" only
//    because volume cratered is not a success (volume_collapse_tolerance).
// A8 Queue flooding — split one idea into many small proposals to fill the cap.
//    Bounded by max_per_campaign / max_per_action_class in selectQueue.
//    (Dedup against open/recently-rejected actions is 08B's job, not ours.)
// A12 History omission — `outcomes` is caller-supplied, and an omitted array was
//    indistinguishable from a clean record (both n=0 => weight 1.0). Now omitting
//    it COSTS you: learning_missing_history_weight (0.25). Silence is not free.
//    That value is PINNED TO learning_weight_floor on purpose — do not raise it.
//    At any weight above the floor, a caller holding a BAD action class still
//    profits by staying silent (at 0.6 vs a floor of 0.25, omission scored 2.4
//    against an honest 1.6). See objective.js SCORING_DEFAULTS.
// A13 Action-class renaming — an LLM naming its action 'adjust_budget_v2' escaped
//    its own track record. Unknown action types are now penalised, and 08B must
//    validate against the actions.action_type CHECK enum before staging anyway.
//
// ── What this module is NOT ──────────────────────────────────────────────────
// It is a SCORER, not a safety control. Nothing here authorises anything. The
// autonomy coordinator, the holdout list and the budget guards are the
// enforcement layer, and 08B routes every proposal through them regardless of
// what this module returns. The risk penalties below are scoring pressure only.
// ============================================================

import {
  DEFAULTS,
  expectedDeltaProfitableLeads,
  dataSufficiency,
  clamp,
  round6,
} from './objective.js';

// ── Outcome grading (E7 substrate) ───────────────────────────────────────────

/**
 * Grade one action_outcomes row as success / failure, from its NUMBERS.
 *
 * Ladder: gross_profit_* -> cost_per_qualified_lead_*. There is deliberately NO
 * CPL rung (see the header — it would reward junk traffic).
 *
 * Excluded entirely (return null — neither success nor failure):
 *   - is_manual_action: Brian's own platform-side changes are not Prime's track
 *     record and must not shape Prime's confidence in itself.
 *   - confidence === 'insufficient_data': the post-window is not complete.
 *     Counting these as failures would punish every recent action for being
 *     recent — the same age bias the terminal sold-rate denominator avoids.
 *   - rows with no basis at any rung (GP, sold rate, or CPQL): we abstain
 *     rather than guess.
 *
 * @returns {{ success: boolean, basis: string }|null}
 */
export function gradeOutcome(row = {}, cfg = DEFAULTS) {
  if (!row || typeof row !== 'object') return null;
  if (row.is_manual_action === true) return null;
  if (row.confidence === 'insufficient_data') return null;

  const num = (v) => {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const tolerance = clamp(
    num(cfg.volume_collapse_tolerance) ?? DEFAULTS.volume_collapse_tolerance,
    0,
    1,
  );

  // Rung 1 — gross profit. The actual objective.
  const gpB = num(row.gross_profit_before);
  const gpA = num(row.gross_profit_after);
  if (gpB !== null && gpA !== null) {
    return { success: gpA > gpB, basis: 'gross_profit' };
  }

  // Rung 2 (S-04B, R-014) — SOLD RATE. Requires a real terminal-outcome
  // sample on BOTH sides (>= sold_rate_min_sample each) — same convention and
  // same minimum-sample gate as api/lib/objective.js's estimateSoldRate(),
  // so "measured" means the same thing in both the scoring path and the
  // learning-gate path. success = rate held or improved; a decline is a
  // failure regardless of what happened to volume or CPQL — this is the
  // specific check that stops "more, cheaper, worse" leads from grading as
  // a win.
  const minSample = num(cfg.sold_rate_min_sample) ?? DEFAULTS.sold_rate_min_sample;
  const bookedB = num(row.booked_leads_before);
  const lostB   = num(row.lost_leads_before);
  const bookedA = num(row.booked_leads_after);
  const lostA   = num(row.lost_leads_after);
  if (bookedB !== null && lostB !== null && bookedA !== null && lostA !== null) {
    const terminalB = bookedB + lostB;
    const terminalA = bookedA + lostA;
    if (terminalB >= minSample && terminalA >= minSample) {
      const soldRateB = bookedB / terminalB;
      const soldRateA = bookedA / terminalA;
      return { success: soldRateA >= soldRateB, basis: 'sold_rate' };
    }
  }

  // A7 — an efficiency gain paid for by losing most of the volume is not a win.
  const collapsed = (before, after) => {
    if (before === null || after === null || before <= 0) return false;
    return after < before * (1 - tolerance);
  };

  // Rung 3 — cost per QUALIFIED lead. Junk leads never become qualified, so this
  // rung cannot be gamed by a junk-traffic flood the way CPL can. Reached only
  // when sold-rate data is unmeasured or too thin a sample on either side.
  const cpqlB = num(row.cost_per_qualified_lead_before);
  const cpqlA = num(row.cost_per_qualified_lead_after);
  if (cpqlB !== null && cpqlA !== null) {
    const qlB = num(row.qualified_leads_before);
    const qlA = num(row.qualified_leads_after);
    const didCollapse = collapsed(qlB, qlA);
    return {
      success: cpqlA < cpqlB && !didCollapse,
      basis: didCollapse ? 'cost_per_qualified_lead_volume_collapsed' : 'cost_per_qualified_lead',
    };
  }

  // No profit-bearing evidence. ABSTAIN — do not fall back to CPL.
  return null;
}

/**
 * The E7 learning weight for an action class: a beta-binomial posterior over that
 * class's graded outcomes, normalised against the neutral prior and clamped.
 *
 *   w       = (successes + alpha) / (n + alpha + beta)
 *   neutral = alpha / (alpha + beta)                     (= 0.5 by default)
 *   weight  = clamp(w / neutral, floor, ceiling)         (ceiling hard-capped 1.0)
 *
 * n = 0            -> weight exactly 1.0 (cold start: no signal, no opinion)
 * 0 successes of 6 -> (0+2)/(6+4) = 0.2 -> /0.5 = 0.40   (down-weighted)
 * 6 successes of 6 -> (6+2)/(6+4) = 0.8 -> /0.5 = 1.60   -> clamped to 1.0
 *
 * A12: if `outcomes` is not an array at all, the caller did not fetch history.
 * That is NOT the same as "no history exists", and it must not be free — it
 * returns learning_missing_history_weight (0.25, pinned to the floor), not 1.0.
 */
export function actionClassWeight(actionType, outcomes, cfg = DEFAULTS) {
  const alpha   = Number(cfg.learning_prior_alpha ?? DEFAULTS.learning_prior_alpha);
  const beta    = Number(cfg.learning_prior_beta ?? DEFAULTS.learning_prior_beta);
  const floor   = Number(cfg.learning_weight_floor ?? DEFAULTS.learning_weight_floor);
  // Hard cap: down-weight only. Config can lower this, never raise it above 1.
  const ceiling = Math.min(1.0, Number(cfg.learning_weight_ceiling ?? DEFAULTS.learning_weight_ceiling));

  // A12 — history not provided is not the same as history being empty.
  if (!Array.isArray(outcomes)) {
    const w = clamp(
      Number(cfg.learning_missing_history_weight ?? DEFAULTS.learning_missing_history_weight),
      0,
      1,
    );
    return { weight: round6(w), n: 0, successes: 0, provided: false, reason: 'outcome_history_not_provided' };
  }

  const graded = outcomes
    .filter((r) => r && r.action_type === actionType)
    .map((r) => gradeOutcome(r, cfg))
    .filter((g) => g !== null);

  const n = graded.length;
  const successes = graded.filter((g) => g.success).length;

  if (n === 0) {
    return { weight: 1.0, n: 0, successes: 0, provided: true, reason: 'no_outcome_history_neutral' };
  }

  const posterior = (successes + alpha) / (n + alpha + beta);
  const neutral   = alpha / (alpha + beta);
  const weight    = clamp(posterior / neutral, floor, ceiling);

  return {
    weight: round6(weight),
    n,
    successes,
    provided: true,
    posterior: round6(posterior),
    reason: weight < 1 ? 'down_weighted_by_outcome_history' : 'outcome_history_at_or_above_neutral',
  };
}

// ── Confidence ───────────────────────────────────────────────────────────────

/**
 * confidence in [0,1] — a product of three independent factors:
 *
 *   analysis     — the model's self-reported confidence. Accepted, but NEVER the
 *                  sole term: a model can assert 0.99 about anything, and
 *                  ai_analysis_runs has no confidence column at all (it lives, if
 *                  anywhere, inside free-form output_json). Clamped, not trusted.
 *   learning     — the E7 gate. Down-weight only.
 *   data quality — attribution_confidence x sold-rate sample adequacy.
 *
 * `soldRateMeasured` is DERIVED by the caller from objective.estimateSoldRate()
 * and passed as the authoritative estimate — it is not a claim the candidate
 * makes about itself. Absence is treated as unmeasured.
 */
export function computeConfidence(signals = {}, cfg = DEFAULTS) {
  const reasons = [];

  const raw = signals.analysisConfidence;
  const analysis = raw === null || raw === undefined || !Number.isFinite(Number(raw)) || typeof raw === 'boolean'
    ? Number(cfg.default_analysis_confidence ?? DEFAULTS.default_analysis_confidence)
    : clamp(Number(raw), 0, 1);
  if (raw === null || raw === undefined) reasons.push('analysis_confidence_defaulted');

  const learning = actionClassWeight(signals.actionType, signals.outcomes, cfg);
  if (learning.weight < 1) reasons.push(`learning_weight_${learning.weight}`);
  if (learning.provided === false) reasons.push('outcome_history_not_provided');

  const factors = cfg.attribution_factors || DEFAULTS.attribution_factors;
  const attributionKey = signals.attributionConfidence || 'none';
  const attribution = clamp(Number(factors[attributionKey] ?? factors.none), 0, 1);
  if (attribution < 1) reasons.push(`attribution_${attributionKey}`);

  const unmeasuredFactor = clamp(
    Number(cfg.unmeasured_sample_factor ?? DEFAULTS.unmeasured_sample_factor),
    0,
    1,
  );
  const sample = signals.soldRateMeasured === true ? 1 : unmeasuredFactor;
  if (sample < 1) reasons.push('sold_rate_below_min_sample');

  const confidence = clamp(analysis * learning.weight * attribution * sample, 0, 1);

  return {
    confidence: round6(confidence),
    analysis: round6(analysis),
    learning: learning.weight,
    learningN: learning.n,
    learningProvided: learning.provided,
    attribution: round6(attribution),
    sample: round6(sample),
    reasons,
  };
}

// ── Risk ─────────────────────────────────────────────────────────────────────

/**
 * risk_penalty — ABSOLUTE, in profitable-lead units, subtracted from the score.
 *
 * Absolute (not a multiplier) on purpose: a risky action with only a marginal
 * expected benefit should go NEGATIVE and be dropped outright, rather than being
 * scaled down and still queued.
 *
 * Every penalty is guaranteed finite and non-negative (resolveObjectiveConfig
 * enforces it, and pen() re-checks): a NaN penalty used to round to null, and
 * `score - null` is `score - 0` — every penalty silently vanished. A
 * safety-adjacent term that disappears when its config is malformed is exactly
 * backwards.
 *
 * @param {object} candidate  soldRateMeasured must be the DERIVED value
 */
export function computeRiskPenalty(candidate = {}, cfg = DEFAULTS) {
  const p = cfg.risk_penalties || DEFAULTS.risk_penalties;
  const reasons = [];
  let penalty = 0;

  const pen = (key) => {
    const configured = Number(p[key]);
    if (Number.isFinite(configured) && configured >= 0) return configured;
    const fallback = Number(DEFAULTS.risk_penalties[key]);
    return Number.isFinite(fallback) ? fallback : 0;
  };

  if (candidate.isHoldoutClass === true) {
    penalty += pen('holdout');
    reasons.push('holdout_class');
  }

  // A13: an action class we do not recognise cannot be scored honestly — its
  // track record is unreachable (renaming escapes E7) and the DB would reject it.
  const known = Array.isArray(cfg.known_action_types) ? cfg.known_action_types : DEFAULTS.known_action_types;
  if (!known.includes(String(candidate.actionType))) {
    penalty += pen('unknown_action_type');
    reasons.push('unknown_action_type');
  }

  const protectedList = Array.isArray(cfg.protected_campaigns) ? cfg.protected_campaigns.map(String) : [];
  const campaignId = candidate.campaignId !== null && candidate.campaignId !== undefined
    ? String(candidate.campaignId)
    : null;
  const reduces = candidate.action === 'pause' || candidate.action === 'decrease';
  if (campaignId && protectedList.includes(campaignId) && reduces) {
    penalty += pen('protected_campaign');
    reasons.push('protected_campaign_reduction');
  }

  // Approaching the always-approval major-change line (>=25%): scoring pressure to
  // prefer smaller moves. The guards enforce the line itself.
  const changePct = Number(candidate.changePct);
  const major = Number(cfg.major_change_pct ?? 25);
  if (Number.isFinite(changePct) && Math.abs(changePct) >= major * 0.8) {
    penalty += pen('near_major_change');
    reasons.push('near_major_change_pct');
  }

  if (candidate.attributionConfidence === 'low' || candidate.attributionConfidence === 'none') {
    penalty += pen('low_attribution');
    reasons.push('low_attribution');
  }

  // !== true, not === false: an ABSENT flag is unmeasured. Omission dodges nothing.
  if (candidate.soldRateMeasured !== true) {
    penalty += pen('unmeasured_segment');
    reasons.push('unmeasured_segment');
  }

  return { penalty: Number.isFinite(penalty) ? round6(penalty) : 0, reasons };
}

// ── Score ────────────────────────────────────────────────────────────────────

/**
 * Score one candidate. Returns the score plus a full explain object — the explain
 * is the point: D-2 leaves the threshold soft precisely so Brian can tune it off
 * a week of real explain output rather than a guess.
 *
 * Sold rates are DERIVED inside expectedDeltaProfitableLeads from terminal lead
 * counts. The candidate does not get to assert them. Measured-ness likewise comes
 * back from that derivation (`soldRateEstimate`), never from a caller boolean.
 */
export function scoreRecommendation(candidate = {}, cfg = DEFAULTS) {
  const delta = expectedDeltaProfitableLeads(candidate, cfg);

  // AUTHORITATIVE measured-ness — derived, not asserted.
  const soldRateMeasured = delta.soldRateEstimate?.measured === true;
  const soldRateResolved = delta.soldRateEstimate?.rate ?? null;

  const suff = dataSufficiency(
    { ...(candidate.segment || {}), soldRateResolved },
    cfg,
  );

  // A13 — an unknown action class is NOT SCORABLE, and a flat risk penalty is not
  // enough to say so. A penalty is a constant; the learning down-weight it dodges
  // scales with the delta — so for a big enough delta, renaming still paid
  // (measured: 3.0 renamed vs 1.6 honest). An unrecognised class has no track
  // record BY CONSTRUCTION, and actions.action_type is a CHECK enum that would
  // reject the insert regardless. So it gates to zero, exactly like missing data.
  const known = Array.isArray(cfg.known_action_types) ? cfg.known_action_types : DEFAULTS.known_action_types;
  const actionTypeKnown = known.includes(String(candidate.actionType));
  const gate = suff.gate === 1 && actionTypeKnown ? 1 : 0;
  if (!actionTypeKnown) suff.reasons.push('unknown_action_type_not_scorable');

  const conf = computeConfidence(
    {
      analysisConfidence: candidate.analysisConfidence,
      actionType: candidate.actionType,
      outcomes: candidate.outcomes,
      attributionConfidence: candidate.attributionConfidence,
      soldRateMeasured,
    },
    cfg,
  );

  const risk = computeRiskPenalty({ ...candidate, soldRateMeasured }, cfg);

  const deltaValue = delta.delta === null ? 0 : delta.delta;
  const reasons = [
    ...(delta.reasons || []),
    ...suff.reasons,
    ...conf.reasons,
    ...risk.reasons,
  ];
  if (delta.delta === null) reasons.push('delta_unresolvable_treated_as_zero');

  const rawScore = deltaValue * conf.confidence * gate - risk.penalty;
  // Round BEFORE the threshold test, and publish the same rounded number
  // selectQueue() will compare. If aboveThreshold were computed on the unrounded
  // value the two could disagree at the boundary by float dust.
  const score = Number.isFinite(rawScore) ? round6(rawScore) : 0;
  const threshold = Number(cfg.min_score_threshold ?? DEFAULTS.min_score_threshold);

  const autoExecute = cfg.auto_execute_enabled === true
    && Array.isArray(cfg.auto_execute_allowlist)
    && cfg.auto_execute_allowlist.map(String).includes(String(candidate.actionType));

  return {
    id: candidate.id ?? null,
    actionType: candidate.actionType ?? null,
    campaignId: candidate.campaignId !== null && candidate.campaignId !== undefined
      ? String(candidate.campaignId)
      : null,
    score,
    expectedDeltaProfitableLeads: delta.delta,
    confidence: conf.confidence,
    dataSufficiencyGate: gate,
    riskPenalty: risk.penalty,
    soldRateMeasured,           // derived
    aboveThreshold: score >= threshold,
    autoExecute,                // D-1: false for everything until Brian flips config
    explain: {
      shape: delta.shape ?? null,
      objective: delta,
      confidence: conf,
      risk,
      dataSufficiency: suff,
      threshold,
      reasons,
    },
  };
}

// ── Selection: threshold, then volume cap ────────────────────────────────────

/**
 * Deterministic ordering. Ties are broken so the same fixture always produces the
 * same queue — the acceptance criteria require determinism, and a queue that
 * reshuffles between runs is impossible to review or to test.
 */
function compareCandidates(a, b) {
  if (b.score !== a.score) return b.score - a.score;                        // higher score first
  if (a.riskPenalty !== b.riskPenalty) return a.riskPenalty - b.riskPenalty; // safer first
  const at = String(a.actionType ?? '');
  const bt = String(b.actionType ?? '');
  if (at !== bt) return at < bt ? -1 : 1;
  const ac = String(a.campaignId ?? '');
  const bc = String(b.campaignId ?? '');
  if (ac !== bc) return ac < bc ? -1 : 1;
  const ai = String(a.id ?? '');
  const bi = String(b.id ?? '');
  if (ai !== bi) return ai < bi ? -1 : 1;
  return 0; // genuinely equal — a consistent comparator must be able to say so
}

/**
 * Threshold cutoff + volume-cap selection (eval E6).
 *
 * "Drop the lowest-scoring above-threshold items — don't queue noise." Nothing
 * below the threshold is EVER promoted to fill an empty cap: a short queue is the
 * correct output when there is little worth doing, and padding it would destroy
 * the one property that makes the queue reviewable.
 *
 * Dropped items are RETURNED, not silently truncated, each with why. 08B logs
 * them: a silent truncation reads as "we covered everything" when it didn't.
 */
export function selectQueue(scored = [], cfg = DEFAULTS) {
  const cap         = Number(cfg.daily_queue_cap ?? DEFAULTS.daily_queue_cap);
  const threshold   = Number(cfg.min_score_threshold ?? DEFAULTS.min_score_threshold);
  const perCampaign = Number(cfg.max_per_campaign ?? DEFAULTS.max_per_campaign);
  const perClass    = Number(cfg.max_per_action_class ?? DEFAULTS.max_per_action_class);

  const items = Array.isArray(scored) ? [...scored] : [];
  const queued = [];
  const dropped = [];

  const eligible = [];
  for (const item of items) {
    // NaN fails closed: !(NaN >= t) is true, so it drops.
    if (!(Number(item.score) >= threshold)) {
      dropped.push({ ...item, dropReason: 'below_threshold' });
    } else {
      eligible.push(item);
    }
  }

  eligible.sort(compareCandidates);

  const campaignCounts = new Map();
  const classCounts = new Map();

  for (const item of eligible) {
    if (queued.length >= cap) {
      dropped.push({ ...item, dropReason: 'volume_cap' });
      continue;
    }
    const cKey = String(item.campaignId ?? '__none__');
    const tKey = String(item.actionType ?? '__none__');
    if ((campaignCounts.get(cKey) || 0) >= perCampaign) {
      dropped.push({ ...item, dropReason: 'per_campaign_cap' });
      continue;
    }
    if ((classCounts.get(tKey) || 0) >= perClass) {
      dropped.push({ ...item, dropReason: 'per_action_class_cap' });
      continue;
    }
    campaignCounts.set(cKey, (campaignCounts.get(cKey) || 0) + 1);
    classCounts.set(tKey, (classCounts.get(tKey) || 0) + 1);
    queued.push(item);
  }

  return { queued, dropped, cap, threshold };
}

/** Convenience: score a list of candidates and select the queue in one call. */
export function scoreAndSelect(candidates = [], cfg = DEFAULTS) {
  const scored = (Array.isArray(candidates) ? candidates : []).map((c) => scoreRecommendation(c, cfg));
  return { ...selectQueue(scored, cfg), scored };
}

export default {
  gradeOutcome,
  actionClassWeight,
  computeConfidence,
  computeRiskPenalty,
  scoreRecommendation,
  selectQueue,
  scoreAndSelect,
};
