// ============================================================
// api/lib/automation-log-schema.js — automation_log's live CHECK constraints,
// as a single source every writer imports.
//
// Tag: DERIVED. Source: live `public.automation_log` CHECK constraints, read
// directly via Supabase MCP `list_tables` against project olpyqfuphiwdongzmazi
// on 2026-07-31 (S-AUTOLOG-1) — NOT inferred from code. Re-derivation
// trigger (SDR-6): any live 22P02/23514 CHECK-violation error surfacing from
// an `automation_log` insert (every writer now logs its returned `error`
// loudly — see the writers below), OR a schema migration touching this
// table's CHECK constraints, whichever comes first.
//
// This is a HAND-MAINTAINED mirror of the live constraint, not a live drift
// detector — disclosed plainly per this project's own standard (see
// DECISIONS.md I-005/R-002's precedent on overclaiming a coverage guard's
// strength). If the live constraint changes and this file is not updated to
// match, every write will start failing the CHECK again, silently, exactly
// as it did before S-AUTOLOG-1 — except now the loud error-logging this
// session added will surface it, which is the actual fix; this file being
// stale is a lesser, recoverable failure mode, not a silent one.
// ============================================================

export const AUTOMATION_LOG_EVENT_TYPE = Object.freeze({
  DATA_PULL:       'data_pull',
  ANALYSIS:        'analysis',
  RECOMMENDATION:  'recommendation',
  ACTION_EXECUTED: 'action_executed',
  ACTION_FAILED:   'action_failed',
  ALERT:           'alert',
  REPORT:          'report',
  SYSTEM:          'system',
});

export const AUTOMATION_LOG_EVENT_TYPES = Object.freeze(Object.values(AUTOMATION_LOG_EVENT_TYPE));

export const AUTOMATION_LOG_STATUS = Object.freeze({
  RUNNING:  'running',
  COMPLETE: 'complete',
  ERROR:    'error',
});

export const AUTOMATION_LOG_STATUSES = Object.freeze(Object.values(AUTOMATION_LOG_STATUS));

export function isValidAutomationLogEventType(eventType) {
  return AUTOMATION_LOG_EVENT_TYPES.includes(eventType);
}

export function isValidAutomationLogStatus(status) {
  return AUTOMATION_LOG_STATUSES.includes(status);
}
