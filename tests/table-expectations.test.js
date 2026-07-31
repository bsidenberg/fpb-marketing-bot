// ============================================================
// tests/table-expectations.test.js
// S-OBS-1 (2026-07-30) — zero-row sweep assertion registry.
// Pure logic, no network, no DB.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  TABLE_EXPECTATIONS,
  EXPECTATION,
  evaluateTableExpectation,
} from '../api/lib/table-expectations.js';

describe('TABLE_EXPECTATIONS registry', () => {
  it('covers all six tables named in HARNESS.md\'s zero-row sweep', () => {
    const expected = [
      'action_outcomes',
      'cost_rollups_monthly',
      'cost_hours',
      'cost_subscriptions',
      'automation_log',
      'performance_snapshots',
    ];
    for (const table of expected) {
      expect(TABLE_EXPECTATIONS).toHaveProperty(table);
      expect(Object.values(EXPECTATION)).toContain(TABLE_EXPECTATIONS[table].expectation);
      expect(TABLE_EXPECTATIONS[table].reason).toBeTruthy();
    }
  });

  it('flags automation_log and performance_snapshots as BROKEN, not merely unassigned', () => {
    // These were the two tables HARNESS.md flagged as "NO STATED EXPECTATION —
    // new finding." S-OBS-1's investigation found both write paths are
    // genuinely broken (schema/constraint mismatches), not just quiet.
    expect(TABLE_EXPECTATIONS.automation_log.expectation).toBe(EXPECTATION.BROKEN);
    expect(TABLE_EXPECTATIONS.performance_snapshots.expectation).toBe(EXPECTATION.BROKEN);
  });

  it('flags cost_hours and cost_subscriptions as expected-empty-but-disclosed', () => {
    expect(TABLE_EXPECTATIONS.cost_hours.expectation).toBe(EXPECTATION.EXPECTED_EMPTY_DISCLOSED);
    expect(TABLE_EXPECTATIONS.cost_subscriptions.expectation).toBe(EXPECTATION.EXPECTED_EMPTY_DISCLOSED);
  });
});

describe('evaluateTableExpectation', () => {
  it('returns unknown_table for a table with no registry entry (fail closed, SDR-1)', () => {
    const result = evaluateTableExpectation('some_new_table', { rowCount: 0 });
    expect(result.status).toBe('unknown_table');
    expect(result.detail).toMatch(/no entry/);
  });

  it('BROKEN tables alert even at 0 rows — zero is not evidence of health', () => {
    const result = evaluateTableExpectation('automation_log', { rowCount: 0 });
    expect(result.status).toBe('alert');
    expect(result.detail).toMatch(/not evidence of health/);
  });

  it('BROKEN tables still alert (with a different note) if rows unexpectedly appear', () => {
    const result = evaluateTableExpectation('performance_snapshots', { rowCount: 3 });
    expect(result.status).toBe('alert');
    expect(result.detail).toMatch(/if the write-path fix landed/);
  });

  it('EXPECTED_EMPTY tables are ok at 0 rows', () => {
    const result = evaluateTableExpectation('cost_rollups_monthly', { rowCount: 0 });
    expect(result.status).toBe('ok');
  });

  it('EXPECTED_EMPTY_DISCLOSED tables are ok at 0 rows (the disclosure lives elsewhere)', () => {
    const result = evaluateTableExpectation('cost_hours', { rowCount: 0 });
    expect(result.status).toBe('ok');
  });

  it('EXPECTED_EMPTY tables are still ok once rows appear (emptiness was never required, just permitted)', () => {
    const result = evaluateTableExpectation('action_outcomes', { rowCount: 5 });
    expect(result.status).toBe('ok');
  });
});
