// ============================================================
// api/lib/attribution.js — attribution math helpers
//
// Pure functions: no DB, no network.
// Imported by evaluate-outcomes.js and tests.
// ============================================================

// ── CPL calculation ───────────────────────────────────────────────────────────

/**
 * Calculate cost per lead. Returns null if leads is 0 (not Infinity).
 * @param {number} spend
 * @param {number} leads
 * @returns {number|null}
 */
export function calcCPL(spend, leads) {
  if (typeof spend !== 'number' || typeof leads !== 'number') return null;
  if (leads <= 0) return null;
  return spend / leads;
}

/**
 * Calculate cost per qualified lead.
 * @param {number} spend
 * @param {number} qualifiedLeads
 * @returns {number|null}
 */
export function calcCostPerQualifiedLead(spend, qualifiedLeads) {
  return calcCPL(spend, qualifiedLeads);
}

// ── Direction / delta helpers ─────────────────────────────────────────────────

/**
 * Delta between two values: positive = increased, negative = decreased.
 * Returns null if either value is null.
 */
export function delta(before, after) {
  if (before == null || after == null) return null;
  return after - before;
}

/**
 * Percentage change from before to after.
 * Returns null if before is 0 or null.
 * Returns a decimal (0.25 = 25%).
 */
export function pctChange(before, after) {
  if (before == null || after == null) return null;
  if (before === 0) return null;
  return (after - before) / before;
}

// ── Window helpers ────────────────────────────────────────────────────────────

/**
 * Given an action's executed_at timestamp and a window size in days,
 * return the before and after date ranges.
 *
 * Before: [executed_at - 2*windowDays, executed_at)
 * After:  [executed_at, executed_at + windowDays)
 *
 * Note: the after window may extend into the future. The caller should
 * check that the after window is complete before rating confidence high.
 *
 * @param {string|Date} executedAt
 * @param {number} windowDays
 * @returns {{ before: { start: Date, end: Date }, after: { start: Date, end: Date } }}
 */
export function buildWindows(executedAt, windowDays = 7) {
  const anchor = new Date(executedAt);
  const msPerDay = 86400000;

  const beforeStart = new Date(anchor.getTime() - windowDays * msPerDay);
  const beforeEnd   = new Date(anchor.getTime());
  const afterStart  = new Date(anchor.getTime());
  const afterEnd    = new Date(anchor.getTime() + windowDays * msPerDay);

  return {
    before: { start: beforeStart, end: beforeEnd },
    after:  { start: afterStart,  end: afterEnd  },
  };
}

/**
 * Is the after window fully elapsed (i.e., afterEnd is in the past)?
 * @param {Date} afterEnd
 * @returns {boolean}
 */
export function isWindowComplete(afterEnd) {
  return afterEnd <= new Date();
}

// ── Outcome conclusion builder ────────────────────────────────────────────────

/**
 * Given before/after metrics, produce a conclusion string and confidence.
 * Does not claim causality — uses directional language.
 *
 * @param {object} params
 * @param {number|null} params.spendBefore
 * @param {number|null} params.spendAfter
 * @param {number|null} params.leadsBefore
 * @param {number|null} params.leadsAfter
 * @param {number|null} params.qualifiedLeadsBefore
 * @param {number|null} params.qualifiedLeadsAfter
 * @param {boolean} params.windowComplete  — whether the post window is finished
 * @param {boolean} params.isManual        — true for adjust_budget/bid (not platform-executed)
 * @returns {{ conclusion: string, confidence: string }}
 */
export function buildConclusion({
  spendBefore,
  spendAfter,
  leadsBefore,
  leadsAfter,
  qualifiedLeadsBefore,
  qualifiedLeadsAfter,
  windowComplete,
  isManual = false,
}) {
  // Manual actions can't be auto-verified
  if (isManual) {
    return {
      conclusion:  'Manual action — platform-executed by human. No automated outcome available.',
      confidence:  'insufficient_data',
    };
  }

  // Post window not yet complete
  if (!windowComplete) {
    return {
      conclusion:  'Post-action window not yet complete. Check back once the evaluation period ends.',
      confidence:  'insufficient_data',
    };
  }

  const parts      = [];
  let confidence   = 'low';

  // Spend direction
  if (spendBefore != null && spendAfter != null) {
    const spendDelta = pctChange(spendBefore, spendAfter);
    if (spendDelta != null) {
      const dir = spendDelta > 0.05 ? 'increased' : spendDelta < -0.05 ? 'decreased' : 'was roughly flat';
      parts.push(`Spend ${dir} ${Math.abs(Math.round(spendDelta * 100))}% ($${spendBefore.toFixed(0)} → $${spendAfter.toFixed(0)}).`);
    }
  }

  // Lead volume direction
  if (leadsBefore != null && leadsAfter != null) {
    confidence = 'medium';
    const leadDelta = delta(leadsBefore, leadsAfter);
    if (leadDelta != null) {
      const dir = leadDelta > 0 ? `up ${leadDelta}` : leadDelta < 0 ? `down ${Math.abs(leadDelta)}` : 'unchanged';
      parts.push(`Leads ${dir} (${leadsBefore} → ${leadsAfter}).`);
    }

    const cplBefore = calcCPL(spendBefore, leadsBefore);
    const cplAfter  = calcCPL(spendAfter, leadsAfter);
    if (cplBefore != null && cplAfter != null) {
      const cplDelta = pctChange(cplBefore, cplAfter);
      if (cplDelta != null) {
        const dir = cplDelta < -0.05 ? 'improved' : cplDelta > 0.05 ? 'worsened' : 'was flat';
        parts.push(`CPL ${dir} ($${cplBefore.toFixed(2)} → $${cplAfter.toFixed(2)}).`);
      }
    }
  } else {
    parts.push('Lead data not yet available in the leads table — CPL comparison not possible.');
  }

  // Qualified leads if available
  if (qualifiedLeadsBefore != null && qualifiedLeadsAfter != null) {
    confidence = 'high';
    const qDelta = delta(qualifiedLeadsBefore, qualifiedLeadsAfter);
    if (qDelta != null) {
      const dir = qDelta > 0 ? `up ${qDelta}` : qDelta < 0 ? `down ${Math.abs(qDelta)}` : 'unchanged';
      parts.push(`Qualified leads ${dir} (${qualifiedLeadsBefore} → ${qualifiedLeadsAfter}).`);

      const cpqlBefore = calcCostPerQualifiedLead(spendBefore, qualifiedLeadsBefore);
      const cpqlAfter  = calcCostPerQualifiedLead(spendAfter, qualifiedLeadsAfter);
      if (cpqlBefore != null && cpqlAfter != null) {
        const dir = cpqlAfter < cpqlBefore ? 'improved' : cpqlAfter > cpqlBefore ? 'worsened' : 'flat';
        parts.push(`Cost per qualified lead ${dir} ($${cpqlBefore.toFixed(2)} → $${cpqlAfter.toFixed(2)}).`);
      }
    }
  }

  parts.push('Results are directional — not causal. Other factors may have contributed.');

  return {
    conclusion:  parts.join(' '),
    confidence,
  };
}
