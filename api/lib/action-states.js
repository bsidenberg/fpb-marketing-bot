// ============================================================
// action-states.js — single source of truth for action state machine
//
// Status field lifecycle:
//   pending  → approved   (human approves via approve-action)
//   pending  → rejected   (human rejects)
//   approved → approved   (status unchanged through execution)
//
// execution_result field lifecycle:
//   null            → 'executing'       (idempotency lock acquired)
//   'executing'     → 'success'         (execution succeeded)
//   'executing'     → <error string>    (execution failed)
//   null            → 'requires_manual' (manual action type, never executed)
//
// Invalid transitions (rejected by validateStatusPatch):
//   anything → pending        (cannot revert)
//   non-pending → rejected    (already actioned)
//   any final → any           (final states are immutable)
// ============================================================

// ── Status values ─────────────────────────────────────────────────────────────
export const STATUS = {
  PENDING:  'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

// ── execution_result sentinel values ─────────────────────────────────────────
// Any other string in execution_result is treated as an error message.
export const EXEC_RESULT = {
  EXECUTING:       'executing',
  SUCCESS:         'success',
  REQUIRES_MANUAL: 'requires_manual',
};

// ── Action type classification ────────────────────────────────────────────────
// EXECUTABLE: fully wired to a platform API call in execute-action-logic.js
export const EXECUTABLE_TYPES = [
  'pause_campaign',
  'enable_campaign',
  'publish_creative',
  'create_meta_campaign',
];

// MANUAL: valid AI recommendations; must be applied by a human in the ad platform.
// These are never auto-executed — approval records the intent only.
export const MANUAL_TYPES = [
  'adjust_budget',
  'adjust_bid',
];

// ── State predicates ──────────────────────────────────────────────────────────

/**
 * Is this action in a terminal state that no longer allows execution or updates?
 * Terminal = rejected, successfully executed, requires_manual, or failed.
 */
export function isFinal(action) {
  if (!action) return true;
  if (action.status === STATUS.REJECTED) return true;
  const er = action.execution_result;
  if (er === EXEC_RESULT.SUCCESS)         return true;
  if (er === EXEC_RESULT.REQUIRES_MANUAL) return true;
  // Any non-null, non-'executing' execution_result is an error message (final)
  if (er && er !== EXEC_RESULT.EXECUTING) return true;
  return false;
}

/**
 * Can this action enter the execution flow right now?
 * Requires: status pending or approved, execution_result null.
 */
export function canExecute(action) {
  if (!action) return false;
  if (isFinal(action)) return false;
  if (!['pending', 'approved'].includes(action.status)) return false;
  if (action.execution_result != null) return false;
  return true;
}

/**
 * Is this a manual-only action type that should never be auto-executed?
 */
export function isManualType(actionType) {
  return MANUAL_TYPES.includes(actionType);
}

/**
 * Is this action type fully executable by the system?
 */
export function isExecutableType(actionType) {
  return EXECUTABLE_TYPES.includes(actionType);
}

/**
 * Validate a PATCH status transition.
 * Returns { valid: true } or { valid: false, error: string }.
 *
 * @param {object} current  — current action row { status, execution_result }
 * @param {string} newStatus — requested new status value
 */
export function validateStatusPatch(current, newStatus) {
  if (!current) {
    return { valid: false, error: 'Action not found' };
  }

  const allowed = [STATUS.PENDING, STATUS.APPROVED, STATUS.REJECTED];
  if (!allowed.includes(newStatus)) {
    return { valid: false, error: `Invalid status value: ${newStatus}` };
  }

  // Immutable final states
  if (isFinal(current)) {
    return {
      valid: false,
      error: `Action is in a final state (status=${current.status}, execution_result=${current.execution_result}) and cannot be updated`,
    };
  }

  // Cannot revert to pending once actioned
  if (newStatus === STATUS.PENDING && current.status !== STATUS.PENDING) {
    return { valid: false, error: 'Cannot revert a non-pending action to pending' };
  }

  // Only pending actions can be approved or rejected
  if (newStatus === STATUS.APPROVED && current.status !== STATUS.PENDING) {
    return { valid: false, error: 'Only pending actions can be approved this way — use approve-action for execution' };
  }
  if (newStatus === STATUS.REJECTED && current.status !== STATUS.PENDING) {
    return { valid: false, error: 'Only pending actions can be rejected' };
  }

  return { valid: true };
}
