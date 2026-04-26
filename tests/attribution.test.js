// ============================================================
// tests/attribution.test.js
// Pure-logic tests for api/lib/attribution.js
// No network, no DB.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  calcCPL,
  calcCostPerQualifiedLead,
  delta,
  pctChange,
  buildWindows,
  isWindowComplete,
  buildConclusion,
} from '../api/lib/attribution.js';

// ── calcCPL ───────────────────────────────────────────────────────────────────

describe('calcCPL', () => {
  it('calculates CPL correctly', () => {
    expect(calcCPL(1000, 20)).toBe(50);
  });

  it('returns null when leads is 0 (zero-lead edge case)', () => {
    expect(calcCPL(1000, 0)).toBeNull();
  });

  it('returns null when spend is 0 and leads is 0', () => {
    expect(calcCPL(0, 0)).toBeNull();
  });

  it('returns 0 when spend is 0 but leads > 0', () => {
    expect(calcCPL(0, 10)).toBe(0);
  });

  it('returns null for non-numeric inputs', () => {
    expect(calcCPL(null, 10)).toBeNull();
    expect(calcCPL(100, null)).toBeNull();
    expect(calcCPL(undefined, 5)).toBeNull();
  });
});

// ── delta / pctChange ────────────────────────────────────────────────────────

describe('delta', () => {
  it('returns positive when after > before', () => {
    expect(delta(10, 15)).toBe(5);
  });
  it('returns negative when after < before', () => {
    expect(delta(15, 10)).toBe(-5);
  });
  it('returns null for null inputs', () => {
    expect(delta(null, 10)).toBeNull();
    expect(delta(10, null)).toBeNull();
  });
});

describe('pctChange', () => {
  it('returns 0.25 for 25% increase', () => {
    expect(pctChange(100, 125)).toBeCloseTo(0.25);
  });
  it('returns -0.5 for 50% decrease', () => {
    expect(pctChange(200, 100)).toBeCloseTo(-0.5);
  });
  it('returns null when before is 0 (zero-spend edge case)', () => {
    expect(pctChange(0, 100)).toBeNull();
  });
  it('returns null for null inputs', () => {
    expect(pctChange(null, 100)).toBeNull();
  });
});

// ── buildWindows ─────────────────────────────────────────────────────────────

describe('buildWindows', () => {
  it('creates 7-day before/after windows by default', () => {
    const executedAt = new Date('2026-01-15T12:00:00Z');
    const { before, after } = buildWindows(executedAt, 7);

    expect(before.end.toISOString()).toBe(executedAt.toISOString());
    expect(after.start.toISOString()).toBe(executedAt.toISOString());

    const ms = 7 * 86400000;
    expect(before.start.getTime()).toBe(executedAt.getTime() - ms);
    expect(after.end.getTime()).toBe(executedAt.getTime() + ms);
  });

  it('before window ends exactly at execution timestamp', () => {
    const executedAt = new Date('2026-03-01T00:00:00Z');
    const { before } = buildWindows(executedAt, 14);
    expect(before.end.getTime()).toBe(executedAt.getTime());
  });
});

// ── isWindowComplete ─────────────────────────────────────────────────────────

describe('isWindowComplete', () => {
  it('returns true for a date in the past', () => {
    const past = new Date(Date.now() - 86400000);
    expect(isWindowComplete(past)).toBe(true);
  });

  it('returns false for a date in the future', () => {
    const future = new Date(Date.now() + 86400000);
    expect(isWindowComplete(future)).toBe(false);
  });
});

// ── buildConclusion ───────────────────────────────────────────────────────────

describe('buildConclusion', () => {
  it('returns insufficient_data for manual actions', () => {
    const { confidence, conclusion } = buildConclusion({
      spendBefore: 500, spendAfter: 400,
      leadsBefore: 10, leadsAfter: 12,
      windowComplete: true,
      isManual: true,
    });
    expect(confidence).toBe('insufficient_data');
    expect(conclusion.toLowerCase()).toMatch(/manual/);
  });

  it('returns insufficient_data when window not yet complete', () => {
    const { confidence } = buildConclusion({
      spendBefore: 500, spendAfter: 200,
      windowComplete: false,
    });
    expect(confidence).toBe('insufficient_data');
  });

  it('returns low confidence with no lead data', () => {
    const { confidence, conclusion } = buildConclusion({
      spendBefore: 500, spendAfter: 400,
      leadsBefore: null, leadsAfter: null,
      windowComplete: true,
      isManual: false,
    });
    expect(confidence).toBe('low');
    expect(conclusion).toMatch(/directional/i);
  });

  it('returns medium confidence with lead data', () => {
    const { confidence } = buildConclusion({
      spendBefore: 1000, spendAfter: 900,
      leadsBefore: 20, leadsAfter: 22,
      windowComplete: true,
      isManual: false,
    });
    expect(confidence).toBe('medium');
  });

  it('returns high confidence with qualified lead data', () => {
    const { confidence } = buildConclusion({
      spendBefore: 1000, spendAfter: 900,
      leadsBefore: 20, leadsAfter: 22,
      qualifiedLeadsBefore: 5, qualifiedLeadsAfter: 6,
      windowComplete: true,
      isManual: false,
    });
    expect(confidence).toBe('high');
  });

  it('handles zero leads in post window (zero-lead edge case)', () => {
    const { conclusion } = buildConclusion({
      spendBefore: 500, spendAfter: 100,
      leadsBefore: 10, leadsAfter: 0,
      windowComplete: true,
      isManual: false,
    });
    // leadsAfter = 0 → CPL after is null → no CPL comparison line
    expect(conclusion).toBeTruthy();
    expect(conclusion.toLowerCase()).toMatch(/directional/);
  });

  it('notes spend direction correctly', () => {
    const { conclusion } = buildConclusion({
      spendBefore: 1000, spendAfter: 500,
      windowComplete: true,
      isManual: false,
    });
    expect(conclusion).toMatch(/decreased/i);
  });

  it('action without enough post-window data returns insufficient_data', () => {
    const { confidence } = buildConclusion({
      spendBefore: null, spendAfter: null,
      leadsBefore: null, leadsAfter: null,
      windowComplete: false,
      isManual: false,
    });
    expect(confidence).toBe('insufficient_data');
  });
});
