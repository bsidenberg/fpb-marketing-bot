# SESSION 05 — Spend-magnitude budget guards  [MONEY PATH - safety-reviewer required]
AUTONOMY: gated


GOAL: The coordinator caps action FREQUENCY (cadence) but nothing caps MAGNITUDE - an approved action could 10x a budget. Add config-driven spend guards enforced at execution time.

RULES TO IMPLEMENT (defaults in agent_config, per-account overridable):
- max_budget_increase_pct_per_day (default 15) and max_budget_decrease_pct_per_day (default 20): exceeding -> verdict require_approval with reason; >= major_change_pct (default 25) -> require_approval ALWAYS regardless of autonomy tier.
- Absolute account daily-spend cap check (account_budget data): an increase that pushes projected account spend over cap -> block.
- protected_campaigns list (default: branded campaign 21613067518): pause or decrease -> require_approval always.
- Never allow pausing the last enabled lead-gen campaign for an account -> block with reason.
- min_data_volume: campaigns with < N conversions in lookback (default 5) -> aggressive changes (pause, decrease > 10%) require approval; never auto-pause high-CPL/low-data campaigns - flag instead.
- CPL bands recorded in reason strings: target 50 / warn 75 / emergency 100 (from agent_config, not constants).

FILE SCOPE: new api/lib/budget-guards.js, api/lib/execute-action-logic.js (guard call at execution entry - MINIMAL insertion), api/lib/autonomy-coordinator.js (guard consult at staging - MINIMAL), new tests/budget-guards.test.js, tests/execute-action.test.js updates, sql/01X for agent_config seed rows (file only), .env.example if needed.

PHASE A: scout both integration points + agent_config shape; present guard API (pure function: (action, campaignState, config) -> {verdict, reason}) and exact insertion points. STOP.
PHASE B: implement - guards must be PURE and unit-testable without DB.
PHASE C: floor 443 + comprehensive guard tests (every rule above, both sides of each boundary). Then invoke safety-reviewer on the diff; include its verdict verbatim in the report.

DoD: over-limit change blocked with human-readable reason; last-campaign pause impossible; all guards config-driven; safety-reviewer verdict is approve.
