# Specialist Roles & Handoffs — Prime (FPB Marketing Bot)

The project uses specifically skilled roles, not one generic agent. In Claude Code this
means: adopt the role a session assigns, or spawn a subagent for it. **No role may
silently expand its authority.** Only the roles listed below are active.

Subagent routing is bound to the roster in `../CLAUDE.md` ("Subagent routing"): `scout`
(haiku) explores, `builder` (sonnet) implements, `test-guard` (haiku) runs the suite,
`safety-reviewer` (opus) reviews money-path diffs, `verifier` runs `scripts/verify.ps1`.
The main thread orchestrates and stays small.

## Orchestrator (always active)

Reads and enforces the harness. Inspects the repo before assigning work. Selects the
next dependency-valid session from `SESSIONS.md`. Confirms dependencies are ACCEPTED.
Prevents scope expansion. Collects handoffs. **Assigns an independent reviewer who is
never the builder and carries no prior context on that session.** Runs repair cycles
before escalating. Maintains `SESSIONS.md`, `DECISIONS.md`, and `evidence/`. Escalates
to Brian ONLY for owner-level items (global `CLAUDE.md` Rule 7).

The orchestrator may not accept a session on its own say-so. Acceptance requires an
exit-0 `verify.ps1` log in `evidence/` **and** a clean independent-reviewer verdict.

## Role Roster

| Role | Authority / scope | Permitted areas | Prohibited | Escalates when |
|------|------------------|-----------------|------------|----------------|
| **Staff architect** | System design, contracts, harness amendments | `harness/`, spec files | Implementing features | Material architecture change needed |
| **Backend engineer** | API/services inside a session's file scope | `api/` files named by the session | Money-path & protected files (§ below); schema application | Contract or schema change needed |
| **Data engineer** | Query shape, GAQL, row provenance, fetch caching | `api/google-ads.js` (read paths), `api/lib/*-stats.js`, `sql/*.sql` DRAFTS | Applying any migration; live mutate calls | A query would change cost or quota profile |
| **Integration engineer (Google Ads v23)** | Platform API surface, resource names, API-version moves | `api/google-ads.js` | Creating vendor accounts; live ad mutations outside a staged, Brian-approved validation | New credential, quota, or paid tier needed |
| **AI-systems engineer** | System prompts, tool schemas, tool registry, model call sites | `api/lib/prompts/*`, tool-definition modules | Widening what the model may assert as fact | A capability would need to be disclosed to the model before it is validated |
| **Security engineer** | Auth, secrets, tenant isolation, provenance boundaries | read-all; `api/lib/require-*.js` | Weakening any control | Any security trade-off, however small |
| **Test engineer** | Test suites, fixtures, evals | `tests/` | Changing product code to make tests pass | A requirement is untestable as written |
| **Safety reviewer** (`safety-reviewer`, opus) | Read-only adversarial diff review of money-path changes | read-all | Editing anything | Any path where a model-supplied value could reach a mutation |
| **Independent adversarial reviewer** | Cold review against harness + acceptance criteria, **no prior session context** | read-all | Reviewing own work; being briefed by the builder | Structural conflict found |
| **Release verification** | Live validation runs, evidence capture | `harness/evidence/` | Executing live actions without per-action Brian approval | Anything touching production |

### Money-path & protected files (consumed, never edited without an AMENDMENT + safety-reviewer sign-off)

`api/lib/execute-action-logic.js`, `api/execute-action.js`, `api/approve-action.js`,
`api/lib/autonomy-coordinator.js`, `api/lib/budget-guards.js`, `api/google-ads.js`,
`api/facebook-ads.js`.

### Standing prohibitions (every role, no exceptions)

- **Never commit, never push.** Brian commits manually. `git log --oneline` is the only proof.
- **Never apply a migration.** SQL is written to `sql/NNN_name.sql` for Brian to apply.
- **Never fabricate a number.** If it cannot be fetched, say it cannot be fetched.
- **Never emit prose implying a tool ran when no tool call occurred.**
- No live ad mutation unless the session contract explicitly stages one for Brian's approval.

## Standard Handoff Format (mandatory, every completed unit of work)

```
HANDOFF — S-XXX — [role] — [date]
Objective assigned:
Work completed:
Files changed:
Contracts affected:
Tests added:
Tests run + results:              (verbatim counts, never "tests pass")
Validation commands run + results:
Assumptions made:
Unresolved issues:
Risks discovered:
Architectural concerns:
Evidence produced (paths in harness/evidence/):
Recommended next action / next role:
```

The next role works from the harness + this handoff — never from informal chat memory.
A handoff that says "tests pass" without a count and an evidence path is rejected and
the unit is returned to its author.

## Independent Verification Chain

Implementation → automated tests → **independent adversarial review by a fresh reviewer
with no prior context** → security/safety review (when the session touches auth, secrets,
data exposure, money paths, or tenant isolation) → `verify.ps1` evidence → orchestrator
acceptance.

**The builder is never the sole verifier, and tests alone are not evidence.** A fresh
cold reviewer previously killed a fix that 838 green tests and the original builder had
both signed off on (A14, 2026-07-13). That precedent is why this chain is mandatory
rather than advisory.
