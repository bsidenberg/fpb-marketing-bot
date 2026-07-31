// ============================================================
// api/lib/table-expectations.js — zero-row sweep registry (S-OBS-1, 2026-07-30)
//
// HARNESS.md §4.1's ruling: "zero rows must be EXPECTED (with a stated
// reason) or ALERTING. Never default." A table with no stated expectation
// makes emptiness un-interpretable — it could mean "nothing has happened
// yet" or "the write path is broken," and nothing distinguishes them.
//
// This module is a pure, declarative registry + evaluator. It does NOT
// query Supabase itself — callers pass in a live row count (and, where
// relevant, the most recent row's timestamp) obtained however they already
// obtain it (Supabase MCP list_tables tonight; a real query from a future
// heartbeat/health-check endpoint, which is S-09A's scope, not this one).
//
// Scope: the six tables HARNESS.md's zero-row sweep already named. Extending
// this registry to the other ~11 tables in the schema is a reasonable future
// session, not done here — undirected scope expansion is exactly what
// tonight's queue (§3, Scope freeze) prohibits.
// ============================================================

export const EXPECTATION = Object.freeze({
  EXPECTED_EMPTY:            'expected_empty',
  EXPECTED_EMPTY_DISCLOSED:  'expected_empty_disclosed', // empty is fine, but every reader must say so
  EXPECTED_POPULATED:        'expected_populated',
  BROKEN:                    'broken', // known write-path defect — emptiness is neither of the above, it's a bug
});

export const TABLE_EXPECTATIONS = Object.freeze({
  action_outcomes: {
    expectation: EXPECTATION.EXPECTED_EMPTY,
    reason: 'No executed action has completed its outcome-evaluation window yet. ' +
      'NOT expected long-term — this table filling in is the trigger that wakes ' +
      'R-014 (gradeOutcome is blind to sold rate; DECISIONS.md).',
    stalenessBoundDays: null,
    alertRule: 'Alert once an executed action older than the outcome window remains ' +
      'ungraded (S-09A scope — the alerting mechanism itself is not yet built).',
  },
  cost_rollups_monthly: {
    expectation: EXPECTATION.EXPECTED_EMPTY,
    reason: 'Never populated in production. Ruling (HARNESS.md §4.1, instance 4): ' +
      'populate or drop, nothing may be built against it as a source of truth until ' +
      'then. Populate-or-drop is session S-COST-1, not tonight\'s queue.',
    stalenessBoundDays: null,
    alertRule: 'No component may read this table as authoritative while it is empty ' +
      '(cost-rollup.js reads cost_api_events directly, not this table, for exactly ' +
      'this reason).',
  },
  cost_hours: {
    expectation: EXPECTATION.EXPECTED_EMPTY_DISCLOSED,
    reason: 'Manual-entry only (Brian logs hours via the dashboard); nothing auto-writes. ' +
      'Empty is legitimate, but the cost ledger is then knowingly incomplete and the ' +
      'pricing floor (PRIME-STRATEGY.md §6) is unbacked while it stays empty.',
    stalenessBoundDays: null,
    alertRule: 'Every cost-ledger read must disclose incompleteness while this is empty ' +
      '— implemented in api/lib/cost-rollup.js\'s data_completeness field (S-OBS-1).',
  },
  cost_subscriptions: {
    expectation: EXPECTATION.EXPECTED_EMPTY_DISCLOSED,
    reason: 'Manual-entry only, same as cost_hours.',
    stalenessBoundDays: null,
    alertRule: 'Same disclosure mechanism as cost_hours — api/lib/cost-rollup.js data_completeness.',
  },
  automation_log: {
    expectation: EXPECTATION.BROKEN,
    reason: 'S-OBS-1 investigation (2026-07-30): every write-path call site in the ' +
      'codebase (api/lib/execute-action-logic.js writeLog(), api/cron-analyze.js, ' +
      'api/cron-daily-stats.js, api/cron-crm-sync.js, api/analyze-ads.js, ' +
      'api/meta-creative.js) passes an event_type value that VIOLATES the table\'s ' +
      'own CHECK constraint (only data_pull/analysis/recommendation/action_executed/ ' +
      'action_failed/alert/report/system are allowed; every call site passes something ' +
      'else, e.g. the raw actions.action_type value like "pause_campaign"). No call ' +
      'site checks the returned error, so every insert has always failed silently. ' +
      'This is NOT "nothing logged yet" — it is a live, universal write-path defect. ' +
      'See DECISIONS.md S-OBS-1 for the full finding and recommended fix (new session, ' +
      'not built tonight — one call site lives in a protected money-path file).',
    stalenessBoundDays: null,
    alertRule: 'Cannot self-heal — the defect must be fixed in code (new session). ' +
      'Any monitoring built against this table before the fix lands would alert ' +
      'forever, which is correct: the alert IS the finding until it is fixed.',
  },
  performance_snapshots: {
    expectation: EXPECTATION.BROKEN,
    reason: 'S-OBS-1 investigation (2026-07-30): the write path (api/analyze-ads.js:302) ' +
      'inserts snapshot_at/google_data/meta_data/actions_created — none of which are ' +
      'columns on the live table (actual columns: snapshot_date, channel, metrics, ' +
      'campaigns, all NOT NULL except metrics/campaigns defaults). The insert cannot ' +
      'succeed against the real schema, and the call site does not check the returned ' +
      'error. The read path (api/performance-snapshots.js) and the evaluate-outcomes.js ' +
      'fallback both expect the SAME wrong shape, so nobody has round-tripped this table ' +
      'against its real schema. Masked in practice because campaign_daily_stats (111 ' +
      'rows live) satisfies evaluate-outcomes.js\'s preferred path first. No test file ' +
      'exists for api/performance-snapshots.js; tests/analyze-ads.test.js mocks Supabase ' +
      'and never validates against the real column set, which is why mocked tests pass ' +
      'while the live write has always failed. See DECISIONS.md S-OBS-1.',
    stalenessBoundDays: null,
    alertRule: 'Same as automation_log — fix is a new session, not built tonight.',
  },
});

/**
 * Evaluate whether a table's current state matches its declared expectation.
 * Pure function — caller supplies the live facts.
 *
 * @param {string} tableName
 * @param {{ rowCount: number, mostRecentRowAt?: string|Date|null }} state
 * @returns {{ status: 'ok'|'alert'|'unknown_table', expectation?: string, reason?: string, detail?: string }}
 */
export function evaluateTableExpectation(tableName, state) {
  const spec = TABLE_EXPECTATIONS[tableName];
  if (!spec) {
    // SDR-1: an unlisted table must not be silently assumed fine.
    return {
      status: 'unknown_table',
      detail: `"${tableName}" has no entry in TABLE_EXPECTATIONS — its emptiness or ` +
        `population carries no stated meaning. Add an entry before treating either ` +
        `state as informative.`,
    };
  }

  const rowCount = state?.rowCount ?? 0;

  if (spec.expectation === EXPECTATION.BROKEN) {
    // A known-broken write path alerts unconditionally until the code is fixed —
    // rows appearing would actually be the surprising case here (worth a separate
    // look, since it would mean the defect was fixed without this registry being
    // told), but zero rows is not "healthy", it's "still broken".
    return {
      status: 'alert',
      expectation: spec.expectation,
      reason: spec.reason,
      detail: rowCount > 0
        ? `${tableName} now has ${rowCount} row(s) despite being marked BROKEN — ` +
          `if the write-path fix landed, update this registry entry.`
        : `${tableName} has 0 rows, consistent with the known write-path defect. ` +
          `This is not evidence of health.`,
    };
  }

  if (spec.expectation === EXPECTATION.EXPECTED_POPULATED && rowCount === 0) {
    return {
      status: 'alert',
      expectation: spec.expectation,
      reason: spec.reason,
      detail: `${tableName} is expected to be populated but has 0 rows.`,
    };
  }

  // EXPECTED_EMPTY and EXPECTED_EMPTY_DISCLOSED: zero rows is fine either way;
  // the "disclosed" variant additionally requires a caller-side disclosure
  // (checked by cost-rollup.js's data_completeness, not by this function).
  return {
    status: 'ok',
    expectation: spec.expectation,
    reason: spec.reason,
  };
}
