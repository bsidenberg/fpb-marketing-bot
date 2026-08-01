// ============================================================
// tests/automation-log-schema.test.js — S-AUTOLOG-1 (2026-07-31)
//
// AUTOMATION_LOG_EVENT_TYPES / AUTOMATION_LOG_STATUSES is a HAND-MAINTAINED
// mirror of automation_log's live CHECK constraint, NOT a live drift
// detector — there is no execute_sql/migration-reading tool available to
// this environment to verify it against the database at test time. The
// values below were read directly via Supabase MCP `list_tables` (verbose)
// against project olpyqfuphiwdongzmazi on 2026-07-31 and copied verbatim
// from the returned `check` clauses:
//
//   event_type: automation_log_event_type_check —
//     ANY (ARRAY['data_pull','analysis','recommendation','action_executed',
//                 'action_failed','alert','report','system'])
//   status: automation_log_status_check —
//     ANY (ARRAY['running','complete','error'])
//
// If the live constraint changes and this file/automation-log-schema.js are
// not updated to match, every write will silently start failing the CHECK
// again — exactly as it did before this session — until the loud
// error-logging this session added (every writer now checks and logs its
// returned `error`) surfaces it. Re-derivation trigger (SDR-6): any live
// automation_log CHECK-violation error in logs, or a migration touching this
// table, whichever comes first.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  AUTOMATION_LOG_EVENT_TYPE,
  AUTOMATION_LOG_EVENT_TYPES,
  AUTOMATION_LOG_STATUS,
  AUTOMATION_LOG_STATUSES,
  isValidAutomationLogEventType,
  isValidAutomationLogStatus,
} from '../api/lib/automation-log-schema.js';

describe('automation-log-schema — mirrors the live DB CHECK constraint (hand-maintained, see file header)', () => {
  it('event types match exactly what was read live on 2026-07-31', () => {
    expect([...AUTOMATION_LOG_EVENT_TYPES].sort()).toEqual([
      'action_executed',
      'action_failed',
      'alert',
      'analysis',
      'data_pull',
      'recommendation',
      'report',
      'system',
    ].sort());
  });

  it('statuses match exactly what was read live on 2026-07-31', () => {
    expect([...AUTOMATION_LOG_STATUSES].sort()).toEqual(['running', 'complete', 'error'].sort());
  });

  it('every named constant is itself a member of the allowed set (no typo in the map)', () => {
    for (const v of Object.values(AUTOMATION_LOG_EVENT_TYPE)) {
      expect(AUTOMATION_LOG_EVENT_TYPES).toContain(v);
    }
    for (const v of Object.values(AUTOMATION_LOG_STATUS)) {
      expect(AUTOMATION_LOG_STATUSES).toContain(v);
    }
  });

  it('validators agree with the arrays they are derived from', () => {
    expect(isValidAutomationLogEventType('action_executed')).toBe(true);
    expect(isValidAutomationLogEventType('creative_uploaded')).toBe(false); // the original S-AUTOLOG-1 defect literal
    expect(isValidAutomationLogEventType('cron_daily_stats')).toBe(false);
    expect(isValidAutomationLogEventType('crm_sync')).toBe(false);
    expect(isValidAutomationLogEventType('analysis_run')).toBe(false);
    expect(isValidAutomationLogEventType('cron_analysis')).toBe(false);

    expect(isValidAutomationLogStatus('complete')).toBe(true);
    expect(isValidAutomationLogStatus('success')).toBe(false); // the cron-crm-sync.js defect literal
  });

  it('the arrays are frozen — a writer cannot accidentally mutate the shared constant', () => {
    expect(Object.isFrozen(AUTOMATION_LOG_EVENT_TYPES)).toBe(true);
    expect(Object.isFrozen(AUTOMATION_LOG_STATUSES)).toBe(true);
    expect(Object.isFrozen(AUTOMATION_LOG_EVENT_TYPE)).toBe(true);
    expect(Object.isFrozen(AUTOMATION_LOG_STATUS)).toBe(true);
  });
});
