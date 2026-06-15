// ============================================================
// tests/action-states.test.js
// Pure-logic tests — no network, no DB.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  isFinal,
  canExecute,
  isManualType,
  isExecutableType,
  validateStatusPatch,
  STATUS,
  EXEC_RESULT,
} from '../api/lib/action-states.js';

// ── isFinal ──────────────────────────────────────────────────────────────────

describe('isFinal', () => {
  it('returns true for null action', () => {
    expect(isFinal(null)).toBe(true);
  });

  it('returns true for rejected status', () => {
    expect(isFinal({ status: STATUS.REJECTED, result: null })).toBe(true);
  });

  it('returns true for result=success', () => {
    expect(isFinal({ status: STATUS.APPROVED, result: EXEC_RESULT.SUCCESS })).toBe(true);
  });

  it('returns true for result=requires_manual', () => {
    expect(isFinal({ status: STATUS.APPROVED, result: EXEC_RESULT.REQUIRES_MANUAL })).toBe(true);
  });

  it('returns true for non-sentinel non-null result (error string)', () => {
    expect(isFinal({ status: STATUS.APPROVED, result: 'Google Ads API 400: ...' })).toBe(true);
  });

  it('returns false for pending, no result', () => {
    expect(isFinal({ status: STATUS.PENDING, result: null })).toBe(false);
  });

  it('returns false while executing (not yet final)', () => {
    expect(isFinal({ status: STATUS.APPROVED, result: EXEC_RESULT.EXECUTING })).toBe(false);
  });
});

// ── canExecute ───────────────────────────────────────────────────────────────

describe('canExecute', () => {
  it('returns true for pending action with null result', () => {
    expect(canExecute({ status: STATUS.PENDING, result: null })).toBe(true);
  });

  it('returns true for approved action with null result', () => {
    expect(canExecute({ status: STATUS.APPROVED, result: null })).toBe(true);
  });

  it('returns false when already executing', () => {
    expect(canExecute({ status: STATUS.APPROVED, result: EXEC_RESULT.EXECUTING })).toBe(false);
  });

  it('returns false for rejected action', () => {
    expect(canExecute({ status: STATUS.REJECTED, result: null })).toBe(false);
  });

  it('returns false when result is success (final)', () => {
    expect(canExecute({ status: STATUS.APPROVED, result: EXEC_RESULT.SUCCESS })).toBe(false);
  });

  it('returns false for null', () => {
    expect(canExecute(null)).toBe(false);
  });
});

// ── isManualType / isExecutableType ──────────────────────────────────────────

describe('type classification', () => {
  it('classifies adjust_budget as manual', () => {
    expect(isManualType('adjust_budget')).toBe(true);
    expect(isExecutableType('adjust_budget')).toBe(false);
  });

  it('classifies adjust_bid as manual', () => {
    expect(isManualType('adjust_bid')).toBe(true);
  });

  it('classifies pause_campaign as executable', () => {
    expect(isExecutableType('pause_campaign')).toBe(true);
    expect(isManualType('pause_campaign')).toBe(false);
  });

  it('classifies publish_creative as executable', () => {
    expect(isExecutableType('publish_creative')).toBe(true);
  });

  it('classifies create_meta_campaign as executable', () => {
    expect(isExecutableType('create_meta_campaign')).toBe(true);
  });

  it('returns false for unknown type in both lists', () => {
    expect(isManualType('unknown_thing')).toBe(false);
    expect(isExecutableType('unknown_thing')).toBe(false);
  });
});

// ── validateStatusPatch ───────────────────────────────────────────────────────

describe('validateStatusPatch', () => {
  const pending  = { status: STATUS.PENDING,  result: null };
  const approved = { status: STATUS.APPROVED, result: null };
  const rejected = { status: STATUS.REJECTED, result: null };
  const done     = { status: STATUS.APPROVED, result: EXEC_RESULT.SUCCESS };

  it('allows pending → approved', () => {
    const { valid } = validateStatusPatch(pending, STATUS.APPROVED);
    expect(valid).toBe(true);
  });

  it('allows pending → rejected', () => {
    const { valid } = validateStatusPatch(pending, STATUS.REJECTED);
    expect(valid).toBe(true);
  });

  it('rejects null action', () => {
    const { valid, error } = validateStatusPatch(null, STATUS.APPROVED);
    expect(valid).toBe(false);
    expect(error).toMatch(/not found/i);
  });

  it('rejects revert to pending', () => {
    const { valid, error } = validateStatusPatch(approved, STATUS.PENDING);
    expect(valid).toBe(false);
    expect(error).toMatch(/pending/i);
  });

  it('rejects update of final state', () => {
    const { valid, error } = validateStatusPatch(done, STATUS.REJECTED);
    expect(valid).toBe(false);
    expect(error).toMatch(/final/i);
  });

  it('rejects approving an already-approved action via PATCH', () => {
    const { valid, error } = validateStatusPatch(approved, STATUS.APPROVED);
    expect(valid).toBe(false);
    expect(error).toMatch(/pending/i);
  });

  it('rejects rejecting an already-rejected action', () => {
    const { valid, error } = validateStatusPatch(rejected, STATUS.REJECTED);
    expect(valid).toBe(false);
    expect(error).toMatch(/final/i);
  });

  it('rejects invalid status value', () => {
    const { valid, error } = validateStatusPatch(pending, 'launched');
    expect(valid).toBe(false);
    expect(error).toMatch(/invalid status/i);
  });
});
