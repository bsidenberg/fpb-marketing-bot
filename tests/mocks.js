// ============================================================
// tests/mocks.js — shared test helpers and Supabase mock
// ============================================================

/**
 * Build a minimal action row for tests.
 * Defaults to a valid pending, unexecuted action.
 */
export function makeAction(overrides = {}) {
  return {
    id:               'test-action-id',
    status:           'pending',
    action_type:      'pause_campaign',
    execution_result: null,
    ...overrides,
  };
}

/**
 * Minimal Supabase client mock.
 * Lets individual tests override `mockRows` and `mockError`
 * without reimplementing the entire chain.
 */
export function makeSupabaseMock({ rows = [], error = null } = {}) {
  const chain = {
    select:  () => chain,
    eq:      () => chain,
    in:      () => chain,
    is:      () => chain,
    update:  () => chain,
    insert:  () => chain,
    single:  async () => ({ data: rows[0] ?? null, error }),
    // Returns all rows on .select() without .single()
    then:    async (resolve) => resolve({ data: rows, error }),
  };
  return {
    from: () => chain,
    _chain: chain,  // expose for per-test overrides
  };
}
