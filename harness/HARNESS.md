# Project Harness — Prime (FPB Marketing Bot)

> This document is the operating system and source of truth for this project.
> No material implementation happens until the relevant section here is defined.
> Status: **ACTIVE** — Version: 1.1 — Last amended: 2026-07-28 — Amended by: S-HARNESS-P1 (chat-surface amendment + verify-gate honesty)

**Project tier: 3** (Rule 0.5). Prime proposes and executes changes against live Google Ads
campaigns that spend real money. Full standard applies: no exceptions.

---

## 0. Where the spec lives

**The authoritative Phase A specification is [`HARNESS-PHASE-A.md`](./HARNESS-PHASE-A.md).**
It is the source of truth for the objective function (§1.1), scope (§2), architecture (§3),
the autonomy/approval model (§4), the acceptance evals E1–E10 (§6), the build sessions
S-08A…S-10 (§8), and the Owner Decisions D-1…D-7 (§9). This file is the standing index;
that file is the contract. Where the two disagree, HARNESS-PHASE-A.md wins.

Supporting documents:

| Document | Role |
|---|---|
| `HARNESS-PHASE-A.md` | **Phase A spec — the contract.** Objective, evals, sessions, owner decisions. |
| `HARNESS-CHAT-SURFACE.md` | **Chat-surface amendment — the contract for S-08A.1 / S-07f.1 / S-07g / S-07h.** Field evidence, root causes, evals E-CHAT-1…7. |
| `SESSIONS.md` | Status board. Which session is live, what it depends on, where its evidence is. |
| `DECISIONS.md` | Owner Decisions (D-1…D-7) and recorded implementation clarifications. |
| `ENVIRONMENT.md` | Env var names, purpose, secret status. Names only — never values. |
| `AGENTS.md` | Specialist roles and the structured-handoff format. |
| `evidence/` | Raw `verify.ps1` logs. A session is not done until its exit-0 log lands here (Rule 10). |
| `../PRIME-STRATEGY.md` | Business context: what FPB sells, the CPL bands, the north-star metric. |
| `../PRIME-AGENCY-ROADMAP.md` | The build plan Phase A sits inside. |
| `../CLAUDE.md` | Standing session rules (test floor, file scope, never-commit, money-path care). |

## 1. Product & Business Intent

See `HARNESS-PHASE-A.md` §1. In one line: **an always-on agent that continuously monitors
FPB's campaigns and autonomously optimizes toward the most profitable qualified leads
possible within the budget cap** — where "profitable" means sold jobs from the CRM, never
clicks, impressions, or cheap form fills.

The objective function and its scoring formula are defined in `HARNESS-PHASE-A.md` §1.1 and
implemented in `api/lib/objective.js` + `api/lib/recommendation-score.js` (S-08A).

## 2. Architecture

See `HARNESS-PHASE-A.md` §3 (the two-loop diagram and the reuse table). No new credentials,
no new paid tool. Both loops sit on the existing recommend→approve→execute foundation and
are gated by the existing autonomy coordinator and budget guards.

## 3. Repository Authority

- **Authoritative repository:** `bsidenberg/fpb-marketing-bot`
- **Authoritative local directory:** `C:\Python\FPB Marketing Bot`
- **Authoritative branch:** Phase A work on `feat/phase-a-account-manager`. **Never `main`.**
- **Claude Code never commits or pushes.** Brian reviews the diff and commits manually.
  A commit is proven by `git log --oneline`, never by an agent's recap.
- **Protected / behavioral files** (consumed, never edited without an AMENDMENT +
  safety-reviewer sign-off): `api/lib/autonomy-coordinator.js`, `api/lib/budget-guards.js`,
  `api/lib/execute-action-logic.js`, `api/execute-action.js`, `api/approve-action.js`,
  `api/google-ads.js`, `api/facebook-ads.js`.
- **Authoritative schema & spec files:** `sql/*.sql` (never applied by an agent — Brian
  applies via the Supabase SQL editor), `HARNESS-PHASE-A.md`.

## 4. Security & Approvals

### PREAMBLE — the shape every defect in this system has taken

**Every defect found in this system took the form of an appearance of assurance that
suppressed inquiry.**

Not an absence of safeguards — an *apparent* safeguard. In each case something existed that
looked like it was doing the checking, and its existence is precisely what stopped anyone
checking. The harm was never done by the gap; it was done by the thing that made the gap
invisible.

| The artifact | What it appeared to assure | What it actually did |
|---|---|---|
| `npm run lint --if-present`, with no `lint` script | "Lint runs in CI" | Skipped silently, exit 0, green check |
| A test floor in `CLAUDE.md` and `HARNESS.md` | "Coverage cannot fall" | Fell 710 → 707, unnoticed |
| `"ALL CHECKS PASSED (2/2)"` in an evidence log | "The gate proved the code" | Proved two of four things, and named neither absence |
| Prose guards in `fpb.js` (`:193`, `:201`, `:207`, `:211`) | "The model is constrained" | Constrained nothing; `:191` contradicted them and made fabrication the compliant answer |
| A scheduled Vercel cron | "The loop runs" | No retries, no alerts, no overlap prevention — a dead loop looks like a quiet one |
| `cost_rollups_monthly`, 0 rows | "Spend is being tracked" | Never populated; indistinguishable from $0 spent |
| A `spendVerified` provenance flag | "This spend is measured" | A boolean any caller could set |
| A passed safety review over a mixed diff | "The whole change was scrutinised" | Attention spent on the trivial half |
| A brief asserting the agent "invented" a limit | "This is established fact" | The limit was real, enforced at `chat.js:543` |

### The five standing rules are instances of one shape

| Rule | The appearance it refuses to accept |
|---|---|
| **SDR-1** | Silence read as health — *a check that is configured is assumed to be running* |
| **SDR-2** | Authority read as verification — *a claim that is stated is assumed to be established* |
| **SDR-3** | Configuration read as completion — *work that is scheduled is assumed to have happened* |
| **SDR-4** | Approval read as scrutiny — *a diff that passed review is assumed to have been examined* |
| **SDR-5** | Measurement read as invariant — *a number that was observed is assumed to still hold* |
| **SDR-6** | Intention read as plan — *a revisit that was written down is assumed to be scheduled* |
| **SDR-7** | Adjacent defence read as coverage — *a defence that is true is assumed to cover the threat at hand* |

**SDR-1 and SDR-3 sit on the same axis and are easily confused — the distinction is checks
versus work: SDR-1 is the OBSERVER ASSUMED ALIVE, SDR-3 is the TASK ASSUMED FINISHED.** A
watch loop that died is an SDR-1 failure (nothing is looking, and the silence reads as calm);
a daily loop that wrote 4 of 10 recommendations is an SDR-3 failure (the work is half-done,
and the queue reads as complete). The same cron can fail both ways, which is why the two
rules bind it independently.

### How to derive SDR-5 without waiting for an incident

**This is the point of writing the shape down.** Do not wait to be taught the next instance by
a wasted session. For any component, ask:

> **What does the existence of this thing make someone stop checking?**

Anything that answers that question is load-bearing on trust, and must therefore carry proof
**proportional to the inquiry it suppresses.** A component that ends inquiry and cannot prove
its claim is not neutral — it is worse than its own absence, because absence invites the
question that its presence closes. That is why "a gate that lies is worse than no gate" is
literally true here rather than rhetorical.

The corresponding design move is always the same: **make the thing capable of failing loudly
in the specific way it is currently incapable of failing.** SDR-1 gives checks a heartbeat.
SDR-2 makes claims falsifiable against code. SDR-3 makes missed work durable. SDR-4 makes
review scope narrow enough that approval means something.

See `HARNESS-PHASE-A.md` §5 and global `CLAUDE.md` Rule 7. Standing constraints that may be
*proposed* but never auto-executed are enumerated in `HARNESS-PHASE-A.md` §4.

**Scoring modules are not a safety control.** `objective.js` / `recommendation-score.js`
authorise nothing; they rank. The coordinator, the holdout list, the budget guards and the
kill-switch are the enforcement layer, and every proposal routes through them regardless of
score. Treat scoring bugs as *queue-quality* bugs, not as breaches — but note that a scoring
bug that inflates a bad action still consumes Brian's limited approval attention, which is
the scarce resource Phase A exists to protect.

## 4.1 Standing Design Rules

### SDR-1 — Absence of a negative signal is never positive confirmation

**Adopted 2026-07-28 (Brian). Binding on every session.**

> Any check, gate, cron, or alert path must be able to **fail loudly when it does not run.**
> Every monitoring or verification component requires a **heartbeat or an equivalent liveness
> proof.**

Silence is not evidence of health. A component that produces no output when healthy and no
output when dead is indistinguishable from a component that was never wired up — and it will
be read as "fine" for exactly as long as it takes for that assumption to cost something.

**Three instances found on this project — none of which announced themselves:**

| # | Instance | How it looked | How long |
|---|---|---|---|
| 1 | **`--if-present` skipping a missing script and exiting 0.** `.github/workflows/verify.yml` ran `npm run lint --if-present` with no `lint` script defined; `scripts/verify.ps1` guarded the same call with `if ($scripts.ContainsKey("lint"))`. **CORRECTED 2026-07-30 (S-CI-1) — see `DECISIONS.md`: GitHub Actions CI never ran at all (0 registered workflows, 0 runs, ever — `.github/` was never committed until tonight). "CI green" describes the LOCAL `verify.ps1` gate only; GitHub Actions had no history to be green or red.** | Local gate: evidence logs attested "ALL CHECKS PASSED (2/2)". `HARNESS.md` §5 claimed the gate ran lint. GitHub Actions: nothing — never invoked. | Local gate: months, until 2026-07-28. GitHub Actions: N/A, zero runs ever |
| 2 | **A test floor documented but unenforced.** `CLAUDE.md` and `HARNESS.md` both stated a floor that "rises and never falls". Nothing checked it. | The count fell 710 → 707 between `d0a1f0e` and `92567dd`. No gate noticed. | Until 2026-07-28 (`DECISIONS.md` R-006) |
| 3 | **Alerting that goes silent when the alerter dies.** The planned watch loop (S-09B) alerts on anomalies. If the cron does not fire, it emits nothing — which is identical to "no anomalies found". | Would read as a healthy account. | Not yet built — this rule is why it must be built with a heartbeat |
| 4 | **An empty aggregate table reads as a measured zero.** `cost_rollups_monthly` has **0 rows** in production (verified live 2026-07-28). "Never populated" and "$0 of spend" are the same query result. | A cost dashboard reading this table would report zero spend while `cost_api_events` holds 456 real events. | **Ruling (Brian, 2026-07-28): populate it or drop it. Nothing may be built against it in its current state.** |
| 5 | **Vercel crons have no retries, no failure alerts, and no overlap prevention.** A cron that 500s is not retried and nobody is told; a slow run can overlap its own next invocation. | A dead loop looks exactly like a loop with nothing to report. | **SDR-1 arriving from the platform.** See §4.2. |
| 7 | **A SECOND zero-row masking case — `action_outcomes`, 0 rows.** It is the only thing currently hiding **R-014** (the learning gate rewarding worse leads). "No outcomes yet" and "outcomes exist and all grade fine" are the same query result. | The misaligned reward looks dormant because the table that would expose it is empty. | **Ruling: every read-path table with an expectation attached carries an emptiness-and-freshness assertion. Zero rows must be EXPECTED or ALERTING — never default.** Sweep below. |
| 6 | **A tripped kill-switch that announced itself only once.** A one-shot trip alert is lost to a missed notification, a restarted process, or Brian being asleep — after which the system sits halted and silent. | "Halted and quiet" is indistinguishable from "running and healthy". | **Ruling (D-5): a tripped switch announces itself CONTINUOUSLY.** So does the indeterminate state. |

#### Zero-row sweep — every empty table in production (live, 2026-07-28)

**Rule: zero rows must be EXPECTED (with a stated reason) or ALERTING. Never default.**
Six tables are empty; **only two have a stated expectation.**

| Table | Rows | Expectation | Assertion required |
|---|---|---|---|
| `action_outcomes` | **0** | **NOT expected long-term.** Currently the only thing masking R-014 | **Alert** once executed actions are older than `OUTCOME_WINDOW_DAYS` and still ungraded |
| `cost_rollups_monthly` | **0** | **Never populated.** Masks all spend tracking | Populate or drop — **S-COST-1** |
| `cost_hours` | **0** | Expected-empty *only* while Brian logs no hours — but then the cost ledger is knowingly incomplete and the pricing floor (`PRIME-STRATEGY` §6) is unbacked | **Expected**, with the incompleteness disclosed at every cost-ledger read |
| `cost_subscriptions` | **0** | Same — manual entry, never made | **Expected**, same disclosure |
| `automation_log` | **0** | **NO STATED EXPECTATION — new finding** | Assign one, then assert |
| `performance_snapshots` | **0** | **NO STATED EXPECTATION — new finding** | Assign one, then assert |

**Two tables are empty and nobody has ever said whether that is correct.** That is the exact
condition this rule exists to make impossible — not a wrong expectation, but *no* expectation,
so emptiness can never be evidence of anything either way. Assigned to **S-COST-1** (cost
tables) and **S-09A** (the assertion mechanism, alongside the heartbeats).

**What this requires in practice.** Every session that adds a check, gate, cron, or alert
path must state, in its acceptance criteria, **how that component proves it ran.** Options
that satisfy the rule: a heartbeat row with a freshness assertion; a positive "check ran and
passed" line in the evidence log (which is why `verify.ps1` prints `=== CHECK: <name> ===`
for every rung, including ones that pass); a last-success timestamp that a separate watcher
asserts against; a dead-man's switch that fires when a signal *stops*. Options that do not:
"it logs an error if it fails", "it would have alerted", "we would notice".

**This rule is why `--if-present` was removed from CI for lint and tests, and why
`scripts/check-test-floor.mjs` fails closed when it cannot find a vitest summary line rather
than passing on the assumption that the suite must have been fine.**

## 4.2 Vercel platform constraints (binding on S-08B, S-09A, S-09B)

**Recorded 2026-07-28 (Brian). Design against these before building, not after.**

| Constraint | Consequence |
|---|---|
| ~~Hobby caps cron at once per day~~ **✅ PLAN CONFIRMED PRO (Brian, 2026-07-28)** | **No upgrade needed, no owner decision required, S-09B's hourly loop is viable.** Usage is **$0.03 of a $20 credit** — the watch loop is effectively free, so cadence is not cost-constrained. |
| **300s function limit on Pro** | **Size S-08B against 300s before building it.** The daily loop mines `campaign_daily_stats` + search terms + outcomes, scores, and writes — if that cannot finish in 300s it must be chunked or paginated by design, not discovered at the timeout. *(Note: `HARNESS-PHASE-A.md:237` still refers to a "60-second function limit" — stale, corrected here.)* |
| **No cron retries** | A transient failure means that cycle simply did not happen. Anything that must not be missed needs its own catch-up logic — the platform provides none. |
| **No built-in failure alerts** | A cron returning 500 tells nobody. Combined with no retries, a loop can be dead indefinitely while the dashboard looks normal. |
| **No overlap prevention** | A run slower than its own interval can overlap itself. Any loop that writes must be **idempotent or explicitly locked**, or it will double-write under exactly the conditions (slow platform, big account) where errors cost most. |

> **The silent-500 case is SDR-1 arriving from the platform.** Vercel will not tell us a loop
> is dead, so every cron in this project carries its **own** liveness proof — a heartbeat row
> written on each successful completion, with a separate freshness assertion. "The cron is
> configured" is not evidence it ran.

### SDR-3 — Partial-failure work is ENQUEUED, never done inline by a cron (D-3)

> **Anything with a partial-failure mode or a long tail is a job the cron enqueues, not work
> the cron does.**

**The deciding test — applied per loop, never globally:** *does a missed or partial run leave
durable inconsistency, or does the next tick self-heal?*

- **Self-healing (level sampling) ⇒ cron-as-worker is fine.** The S-09B watch loop reads
  current state; a missed cycle costs one sample and the next tick reaches the same
  conclusion. Read-mostly, idempotent, nothing half-written.
- **Durable artifacts ⇒ decouple.** S-08B writes queue rows. Failing after 4 of 10 means the
  other 6 never exist, nobody is told, nothing retries, and a re-run duplicates the first 4.

**Note the reason is NOT the function time limit.** A timeout is a capacity problem; capacity
was never the risk here. The risk is the platform's three silent-failure properties above.
An earlier draft of this harness justified the same conclusion on the 300s limit (citing a
stale 60s figure at that) — right answer, wrong reason, which would have generalised badly to
the next loop.

Workers are per-item, retryable, and idempotent. **SDR-1 applies to both halves:** a dead
enqueuer is silent, and a queue that stops draining looks exactly like a queue with nothing
in it — so the enqueuer needs a heartbeat and the worker needs a queue-depth /
oldest-unprocessed-item freshness assertion.

**Queue substrate: a Supabase job table** (approved, D-3), following the `actions` /
`action-states.js` patterns. Beyond adding no vendor and no cost, it shares a database with
the audit log and action records — so **`enqueued → ran → wrote` reconciles in a single
query**, which is what the D-10 ledger panel requires. A queue in another store would make
"what did Prime actually do?" a join across two systems with no transactional relationship,
i.e. an inference again — the exact failure this amendment exists to end.

> **⚠️ Decoupling buys DURABILITY and RETRY — never latency.** The worker's cadence is still
> bounded by cron; an enqueued job is not picked up sooner than the drain schedule, and
> end-to-end wall-clock is the same or slightly worse for the added hop. What is bought:
> failed items retry instead of vanishing, partial runs leave pending jobs instead of silent
> gaps, idempotency keys make overlap harmless, and queue depth becomes an observable SDR-1
> surface. **Anyone proposing to decouple something for speed has misread this rule.**

### SDR-4 — A safety review's scope must be HOMOGENEOUS IN RISK PROFILE

**Adopted 2026-07-28 (Brian).**

> Bundling a low-risk change with a high-risk one spends reviewer attention on the low-risk
> one and provides **cover** for the other. **Splitting increases review count, and that is
> the point.**

Review capacity is not measured in sessions; it is measured in the attention a reviewer can
bring to one risk class at a time. A session containing both a two-field `SELECT` addition and
a new refusal path in the money path presents as *one* review, and the reviewer arrives
knowing they must clear both. The trivial half is legible and quickly satisfying to confirm —
so it consumes the early, sharpest attention, and the dangerous half is read last and read
tired. The low-risk change does not merely dilute the review; it **launders** the high-risk one
by making the overall diff look routine.

**This is the same failure mode as every other defect in this harness**: a real check
(`--if-present`), a documented floor, a prose guard in `fpb.js` — each *appeared* to provide
assurance, and the appearance is what stopped anyone looking harder.

**The test:** could a reviewer plausibly approve one part of this diff on grounds that do not
apply to the other part? If yes, it is two reviews.

**Founding case — S-07f.1, split 2026-07-28.** It bundled a read-path GAQL `SELECT` addition
(low risk, trivially auditable) with an execute-path staleness refusal (high risk, new failure
mode in the money path). Split into **S-07f.0** (row identity, `api/google-ads.js` only) and
S-07f.1 (execute path). Two narrow reviews replace one wide one. **The count went up on
purpose.**

**Second application — S-08A.1, split into four (Brian, 2026-07-28).** The rule was applied to
a session this harness had itself been accreting scope onto, which is how the failure actually
happens: nobody bundles deliberately, things get *added* to an open session because it is open.

| Session | Approvable on the grounds… |
|---|---|
| **S-08A.1** cohort rewrite | *Can an attacker inflate the cohort?* — contract & security |
| **S-08A.2** cap redesign | *Does the bound hold across the range without opening an input path?* — safety-bound design |
| **S-08A.3** constant provenance | *Is every constant labelled and justified?* — documentation |
| **S-08A.4** scale invariance | *Is the score scale-invariant, with no behaviour change at FPB scale?* — numerical refactor |

A reviewer could approve S-08A.3 on grounds wholly irrelevant to S-08A.1 — which is the test.
Bundled, the documentation pass would have been the legible half providing cover for a money-
path contract rewrite.

#### Countermeasure for bundling gravity (Brian, 2026-07-28)

**Nobody bundles deliberately. Things get added to an open session because it is open** — that
is how S-08A.1 accreted a cap redesign, a documentation pass, and a numerical refactor over the
course of a few turns, each addition individually reasonable. SDR-4 catches the result; this
catches the mechanism.

1. **Scope and permitted files FREEZE at session acceptance.** The packet is a contract from
   that moment, not a working document.
2. **Later discoveries default to a NEW session ID.** The default is not "fold it in" — the
   default is a new packet, even for something small.
3. **Adding to an open session requires recorded justification** in `DECISIONS.md`, naming why
   the addition shares the *approval grounds* of the existing scope. "It touches the same file"
   is not that justification; "a reviewer clearing the existing scope necessarily clears this
   too" is.

The asymmetry is deliberate. Splitting costs a session packet, which is cheap and recoverable.
Bundling costs review quality, which is neither — and is invisible until something ships.

**Corollary:** "we can review it all at once" is not an efficiency argument, it is a request
to be reviewed less carefully. Session packets that name protected files in more than one risk
class must justify the bundling or split.

### SDR-5 — A measurement's scope is the moment it was taken, never a system property

**Adopted 2026-07-28 (Brian).**

> **Measured assumed invariant.** A number derived from observation describes the conditions
> that existed when it was observed. Carrying it forward as a property of the system is the
> same substitution as the other four rules.

> **Every standing number needs EITHER a re-derivation cadence OR an explicit snapshot label.**

A snapshot label is a legitimate answer — some numbers *should* be frozen (a business
constraint, an account cap). What is not legitimate is a number whose provenance has been
forgotten, so that nobody can say whether it is still true or was ever meant to be.

**Two instances already existed before the rule was named**, which is the argument for naming
it:

| Instance | Mechanism | Which form |
|---|---|---|
| **D-6 cost ceiling** | Interim $25/day · $250/month, **re-derived after 14 days** of real S-08B/S-09 data, as a scheduled decision with Brian's sign-off | Cadence |
| **Test floor** | `harness/TEST_FLOOR` **ratchets** on every session; `check-test-floor.mjs` prints "the floor should RISE to N" whenever the suite exceeds it | Cadence |

#### The 0.1 drift is ALREADY REAL — falsified by a constant 23 lines above it

`objective.js:147-149` states the cap's justification: *"FPB reality is ~0.004 (a $50 CPL at a
20% sold rate), so this is ~25x headroom."* The same module declares, at **`objective.js:124`**,
`cpl_emergency: 100`.

| CPL band (same file) | Leads/$ at 20% sold rate | Actual headroom vs. `0.1` |
|---|---|---|
| `cpl_target: 50` (`:122`) | 0.0040 | **25x** — the documented figure |
| `cpl_warn: 75` (`:123`) | 0.0027 | **38x** |
| `cpl_emergency: 100` (`:124`) | 0.0020 | **50x** |

**This is not a hypothetical future drift. The system already documents, twenty-three lines
earlier, the operating condition under which its own stated headroom is wrong by a factor of
two.** The comment anchors on the *target* — the best case — while the module's own emergency
band defines the range the cap must survive. A sanity cap calibrated against the best case and
documented as if it were the worst is not a bound; at the emergency band it permits a host
efficiency 50x anything FPB has ever achieved, which is most of the way back to the A10 attack
it was added to stop.

**Both numbers are in the same file, in the same defaults block, unreconciled.** Nothing
detects the contradiction because nothing was ever asked to.

#### Hypothesis (NOT a finding): express the cap as a multiple of measured leads-per-dollar

Attractive because it self-updates and cannot go stale.

> ### ⚠️ CORRECTION — my stated second mechanism was wrong, and it made the hypothesis look weaker than it is
>
> An earlier draft argued: *"a self-loosening cap is worse than a stale one — depress the
> measured account rate and the cap rises."* **That is inverted.** With `cap = k × measured`,
> depressing `measured` *lowers* the cap. The attack direction is **inflation** of the
> denominator, not depression of it.
>
> Brian caught it, and the correction is recorded rather than quietly fixed because
> **right-answer-wrong-reason is the 60-second-function-limit failure repeating** — that
> justification was also stale and also produced the correct recommendation, which is exactly
> what let it survive unexamined.

#### Evaluate FORM and PARAMETER independently (Brian, 2026-07-28)

An earlier table compared absolute-`0.1` against derived-`k=5` and concluded "derived is
tighter everywhere." **That conflated two decisions.** At `k=25` the derived cap *equals* the
absolute at target — so much of the apparent tightness was just a smaller multiplier, not a
property of the form.

**The correct invariant to compare is effective headroom = `cap / measured LPD`:**

| Band | absolute `0.1` | derived, any `k=5` | derived, any `k=25` |
|---|---|---|---|
| `cpl_target` $50 | **25x** | 5x | 25x |
| `cpl_warn` $75 | **37x** | 5x | 25x |
| `cpl_emergency` $100 | **50x** | 5x | 25x |

**FORM — the only thing the form decides:** the derived cap holds **constant headroom across
the whole CPL range by construction** (`k`, `k`, `k`). The absolute cap **drifts 25x → 50x**
because its numerator is fixed while the denominator moves. *This is the entire argument for
the form, and it is independent of `k`.*

**PARAMETER — what `k` decides, and nothing else:** where that constant headroom sits. `k=25`
reproduces today's target-band tightness exactly; `k=5` is a policy choice to be four times
stricter. **Choosing the form does not commit to changing the tightness** — `k=25` is the
null-change migration, which is the safe way to land a form change without silently
re-tuning the queue.

| Decision | Question | Independent of |
|---|---|---|
| **Form** (absolute vs. multiple) | Should headroom stay constant as CPL moves? | the value of `k` |
| **Parameter** (`k`, or `0.1`) | How much headroom? | the form |

**The hazard is a property of the FORM, not the parameter:** to break the derived cap you must
inflate `measured` so that `k × measured` exceeds what the absolute would have allowed — at
`k=5`, a 10x inflation yields `0.2`, twice the absolute cap. So: **absolute fails open slowly
and predictably** (drift, but unconditional safety); **derived fails open fast, and only if
provenance breaks.**

#### Added to the adversarial pass: Prime is inside its own measurement window (Brian)

**Prime acts on the account, then measures the account.** A trailing-window derived cap
therefore includes the effects of Prime's own prior actions — **past actions are already inside
the window.** This is not an external attacker model; it is the system's own outputs re-entering
as inputs to its own safety bound. An action class that raises apparent efficiency raises the
cap that permits more of that action class, each cycle.

**Candidate mitigation for the reviewer to evaluate (not a decision): bound the cap's RATE OF
CHANGE**, so honest drift is tracked while inflation is not. Genuine account improvement is
gradual; an inflation attack is a step change. A slew limit distinguishes them without needing
to identify intent.

**Suggested asymmetry, also for the reviewer:** let the cap **fall fast** (tightening is always
safe) and **rise slowly** (loosening must earn it over time). That makes the bound a ratchet in
the safe direction — the same asymmetry as D-5's auto-trip/never-auto-re-arm and the test-floor
ratchet, both of which this project already relies on.

**The surviving objection is circularity, and it is conditional on provenance.** The cap bounds
`hostRate`, computed from host data; derive it from the same family of quantities and the bound
becomes a function of what it bounds — the A10/A14 shape. A second-order concern: even with
server-derived inputs, actions that raise apparent efficiency raise the cap permitting further
such actions — a slow feedback ratchet rather than a direct exploit.

**Status: the hypothesis is MORE live than the earlier draft implied, not less.** The
adversarial pass is now a genuine question rather than a formality, and it must decide on
provenance: server-authoritative, derived-not-asserted, computed over a trailing window the
proposal cannot influence. If the source cannot meet full S-08A.1 provenance discipline, keep
the value absolute and give it a cadence. **The reviewer decides — not the builder, and not
this document.**

#### Sweep — justified-against-nominal siblings in `SCORING_DEFAULTS` (2026-07-28)

**The defect class: a constant justified against a single nominal value rather than the range
it must survive.** Brian predicted siblings. There are several, and one is larger than the
`0.1` case that prompted the search.

**🔴 The big one — the entire scoring scale is denominated in an absolute unit that does not
scale with the account.** `min_score_threshold: 0.25` and all six `risk_penalties` are
*absolute* quantities in profitable-lead units, subtracted from or compared against a delta
that scales **linearly with spend**:

| Account scale | Typical waste-removal delta | `min_score_threshold: 0.25` filters | `holdout: 0.5` penalty is |
|---|---|---|---|
| **FPB today** ($2.5k/mo, $400 cohort) | 1.12 | **22.3%** of the delta | **44.6%** of the delta |
| 5x scale ($2k cohort) | 5.60 | 4.5% | 8.9% |
| 10x scale ($4k cohort) | 11.20 | **2.2%** | **4.5%** |

The threshold and every risk penalty were calibrated — implicitly, never stated — against
FPB's **current $2,500/month** spend. **Raise the budget and the quality bar and every safety
penalty become proportionally toothless**, silently, with no code change and nothing detecting
it. A holdout penalty meant to make risky marginal actions go *negative* stops being able to.
This is the `0.1` defect affecting **seven constants at once**, and it is latent in exactly
the way SDR-5 describes: the calibration was true at the moment it was set.

**Other siblings found:**

| Constant | Finding |
|---|---|
| `reallocation_efficiency: 0.7` | *"freed spend is worth less at the margin"* — **justifies the direction, never the magnitude.** It is a first-order multiplier on every waste-removal delta; 0.7 vs 0.5 moves every such score by 40%. No basis stated. |
| `sold_rate_prior_strength: 10` vs `sold_rate_min_sample: 5` | **Mutually calibrated, and neither says so.** k=10 against a typical terminal-lead count of ~5 means the prior outweighs the evidence 2:1 for a segment that has *just* qualified as "measured". Defensible — but it is a joint decision presented as two independent knobs. |
| `default_analysis_confidence: 0.6` and `unmeasured_sample_factor: 0.6` | Two unrelated 0.6s, neither justified. Equal values invite the reader to assume a shared basis that does not exist. |
| `max_projected_lift_pct: 100`, `volume_collapse_tolerance: 0.5` | Justified by **restating themselves** (*"no proposal may claim to more than double volume"*). Circular, but they are genuine **CHOSEN** policy values — acceptable once tagged. |

**✅ Positive control — what a properly justified constant looks like.**
`learning_missing_history_weight: 0.25` is justified against the **range of caller behaviour**,
with worked numbers and a counterexample: *"at 0.6 vs a floor of 0.25, omission scored 2.4
against an honest 1.6."* It states what breaks at other values. **Every constant above should
be justified this way, and this one proves the standard is achievable in this codebase.**

All findings assigned to **S-08A.1**.

#### Every standing number tagged DERIVED or CHOSEN (Brian, 2026-07-28)

**DERIVED** = carries a re-derivation cadence. **CHOSEN** = carries a review date and a named
owner. Every standing number gets one. An untagged number is a defect.

| Number | Tag | Cadence / Owner + review |
|---|---|---|
| `harness/TEST_FLOOR` (838) | **DERIVED** | Ratchets every session; `check-test-floor.mjs` prints when it should rise |
| `COST_ALERT_DAILY_USD` / `_MONTHLY_USD` | **DERIVED** | `sql/023` now; **re-derive after 14 days** of S-08B/S-09 data |
| `max_profitable_leads_per_dollar: 0.1` | **DERIVED** — *currently without a cadence, and already falsified (above)* | Assign in S-08A.1. Reconcile against the CPL bands or restate the justification honestly |
| `min_score_threshold: 0.25` | **DERIVED** — *intended, never scheduled (below)* | Schedule the D-2 tuning window in S-08B |
| `daily_queue_cap: 10` | **CHOSEN** | Owner **Brian**; review when queue review time becomes the binding constraint |
| `reallocation_max_waste_multiple: 3` (W) | **CHOSEN** | Owner **Brian**; review after the S-08A.1 contract has run against production data |
| CPL bands: target $50 / warn $75 / emergency $100 | **CHOSEN** | Owner **Brian**; business constants, not measurements |
| **$2,500/month** Google Ads cap | **CHOSEN** | Owner **Brian**; business constraint |

> **W=3 specifically: note that it sits among derived quantities with no basis stated, and that
> is what makes it read as unquestionable.** Surrounded by numbers with worked justifications
> in the same block, an unjustified constant inherits their authority by adjacency. It is
> **CHOSEN** — a judgement call about how disproportionate genuine waste can be — and labelling
> it so is what makes it *available to be questioned*. Its neighbours' rigour was doing the
> work of an argument it never had.

### SDR-6 — Intended assumed scheduled

**Adopted 2026-07-28 (Brian).**

> **A written intention is not a plan.** Only a **date**, a **trigger**, or a **ratchet** makes
> an intention operational. Writing "we will revisit this" without one makes the thing *more*
> permanent, not less.

**Written-but-unscheduled is weaker than unwritten.** An unwritten intention nags — it stays
live as an open loop in someone's head. A written one **discharges the feeling of obligation
without discharging the obligation**, and thereafter reads to every subsequent reader as
evidence the matter is handled. The record of the plan substitutes for the plan.

**Distinct from SDR-5**, though they meet at standing numbers: **SDR-5 is stale numbers — a
measurement that was true and no longer is. SDR-6 is plans never operationalized — an
intention that was never true, and looked true because it was written down.** SDR-5's remedy
is a cadence; SDR-6's remedy is to notice the cadence was never actually attached.

**Founding case — `min_score_threshold: 0.25`.** D-2 records the intention plainly: the
threshold is soft and *"gets tuned off a week of real explain output."* **The tuning was never
scheduled, and writing the intention down is why.**

**The test:** for every "later", "eventually", "once we have data", "revisit", "tune", "follow
up" in this harness — **name the date, the trigger, or the ratchet.** If none exists, it is not
a plan, and it must either acquire one or be struck.

#### SDR-6 sweep — every unscheduled intention in the harness (2026-07-28)

| Intention | Where | Status |
|---|---|---|
| Tune `min_score_threshold` off a week of explain output | D-2 | **UNSCHEDULED** → trigger assigned: first week of S-08B queue output |
| Re-derive cost ceiling from actuals | D-6 | ✅ **Trigger:** `sql/023` results |
| Re-derive cost ceiling after loop data | D-6 | ✅ **Trigger:** 14 days post-S-08B/S-09 first run |
| Test floor rises | `TEST_FLOOR` | ✅ **Ratchet:** enforced by `check-test-floor.mjs` |
| Lint baseline → `error` | I-005 / R-002 | ✅ **Trigger:** session S-LINT-1 |
| `cost_rollups_monthly` populate-or-drop | SDR-1 inst. 4 | ✅ **Trigger:** session S-COST-1 |
| Retire the W cap "on evidence from a contract that has run" | D-11 | **UNSCHEDULED** → trigger assigned: 30 days of S-08A.1 production data |
| Sold-rate columns on `action_outcomes` (L-001) | `recommendation-score.js` header | **UNSCHEDULED — "recommended as a follow-up session"**, no session ID, no trigger |
| E7 "becomes live the moment outcomes accrue" (L-002) | module header | **UNSCHEDULED** → trigger assigned: first non-zero `action_outcomes` row |
| Weld/FSC enablement "later config work" (L-003) | `HARNESS-PHASE-A.md` §2.2 | **CHOSEN deferral** — acceptable, owner Brian |
| Meta Bug 19 (v19 → current) | L-004 | **UNSCHEDULED**, no session ID |
| Multi-account cron (`ENABLE_MULTI_ACCOUNT_CRON`) | `ENVIRONMENT.md` | **CHOSEN deferral** — tied to L-003 |

**Five unscheduled intentions found.** Three given triggers above; **L-001 (sold-rate columns)
and Bug 19 have neither a session ID nor a trigger and are the two most exposed** — L-001 in
particular is a known correctness limitation in the learning gate that has been "recommended as
a follow-up" since S-08A with nothing attached to it.

### SDR-7 — A verified defence covers the threat it was built for, not the one in front of you

**Adopted 2026-07-28 (Brian).**

> **Adjacent defence assumed sufficient.** A true, verified, scrutiny-surviving defence against
> a *neighbouring* threat, read as coverage of the threat actually at hand.

**Distinct from SDR-2, and more dangerous.** Under SDR-2 the claim is unverified and can be
*refuted* by checking. Here **the claim is true and survives every check** — what is wrong is
its **scope**, and scope is not something checking the claim can reveal. You cannot catch this
by verifying harder. You catch it only by asking what question the defence answers.

> **The test: does this defence address the threat model in front of me, or a neighbouring
> one?**

**Founding case — the CPQL defence in `recommendation-score.js`.** The module header argues,
at length and correctly, that grading on cost-per-**qualified**-lead resists a junk-traffic
flood, because junk leads never become qualified. **That is true.** It was independently
reviewed, it is well-reasoned, and it defeats the threat it names.

It does nothing about **R-014**, the threat actually present: *qualified leads that do not
close*. Volume up, sold rate down, CPQL improves, `gradeOutcome` returns success, the learning
gate up-weights the action class. Both threats are "lead quality" threats — adjacent enough
that the genuine defence against one reads as cover for the other, and the header's confidence
about the first is precisely what made nobody ask about the second.

**Why it outranks a false claim in danger:** a false claim invites refutation and eventually
meets it. A true claim is unfalsifiable *as stated*, so it sits in the codebase accruing
authority, and every reader who checks it comes away reassured — correctly, about the wrong
thing.

**In practice:** when a comment, review, or handoff says "X is safe because Y", name the threat
Y defeats and the threat you are facing, **and check they are the same threat.** Where they are
not, say so — even when Y is unimpeachable.

### SDR-2 — Every architectural claim is a hypothesis until the repo confirms it, **including Brian's**

**Adopted 2026-07-28 (Brian).** Same standard as a model-supplied number: a statement about
how this system is built is *unverified input* until code, schema, or live state confirms it.
It does not matter who said it.

This is `S-08A.1 — derive, don't assert` turned on the people writing the harness, and it has
now caught errors from every direction on this project:

| Source | Claim | Reality |
|---|---|---|
| The session brief | The agent "invented a constraint (25 terms per batch) with no source" | `MAX_BATCH_TERMS = 25` is real: `api/chat.js:73`, enforced `:543`, disclosed `:594`, stated to the model `fpb.js:210`. The model quoted a working limit. |
| Claude (me), correcting the above | The limit is "enforced nowhere in code" | Also wrong. Caught by independent review. Two successive unverified assertions **inside the document written to stop unverified assertions**. |
| Claude (me), design | The S-08A.1 contract removes the A14 attack class | Permitted **167x** — worse than the 18x it replaced. Killed by a fresh adversarial reviewer. |
| Brian | D-6 conflated ad spend and API cost | D-6 was scoped to API/LLM cost in every source. The ad-spend guard was new work, not disentangling. |

**In practice:** when a prompt, a decision, or a handoff asserts that the system works a
certain way, verify it before building on it, and **say so plainly when it does not hold.**
Agreeing with an incorrect premise is not deference, it is a defect that propagates into the
harness and then into code. Corrections flow in both directions or the rule is decorative.

## 4.3 Design Invariants (DI-1…) — deliberately NOT standing design rules

**Kept separate from SDR-1…6 on purpose (Brian, 2026-07-28).** Every SDR is an instance of one
shape — *an appearance of assurance that suppressed inquiry* — and the derivation question
("what does the existence of this thing make someone stop checking?") only works as a filter
while that set stays pure. The invariants below are good design that this project keeps
re-deriving, but they are **not** instances of that shape. Filing them as SDRs would blunt the
question that generates real SDRs.

### DI-1 — Asymmetric ratchets: fall fast, rise slow

Where a control has a safe direction, make movement **free toward safety and slow away from
it**. Tightening needs no evidence; loosening must earn it.

| Instance | Free direction | Constrained direction |
|---|---|---|
| Kill switch (D-5) | Auto-**trip** permitted | **Never** auto-re-arms — Brian's recorded decision |
| Test floor | Rises automatically | Falls only via a harness AMENDMENT |
| Derived cap slew (proposed, S-08A.2) | Cap falls fast | Cap rises slowly |
| Learning gate (`objective.js`) | Down-weight to 0.25 | Ceiling **hard-capped at 1.0** — a clean record restores neutral, never pays a bonus |

### DI-2 — Observability is the last thing to go

| Constraint | What is shed | What survives |
|---|---|---|
| Kill switch tripped (D-5) | Google Ads writes | Fetch, analysis, telemetry, **alerting** |
| API cost ceiling hit (D-6) | Proactive analysis → recommendations → S-08B loop | **Watch loop, preserved last** |

Reached independently three times. Any proposal that sheds monitoring to protect throughput,
spend, or safety contradicts all of them and must argue accordingly.

### DI-3 — Change one variable at a time; attributability is a design property

**When a change has both a *form* and a *level*, land the form at a null-change level first.**
Shipping both together makes any observed behavioural difference **unattributable** — you
cannot tell whether the queue changed because the mechanism changed or because the tuning did,
and the ambiguity is permanent because there is no clean before.

**Founding case — the `max_profitable_leads_per_dollar` cap (Brian, 2026-07-28).** Land the
multiple form at **`k = 25`**, which reproduces today's target-band tightness exactly. Observe.
**Then tune `k` as a separate, separately-reviewed decision.** The reason is attributability
first and safety second: `k=25` is not merely the cautious choice, it is the only choice that
leaves the form's effect measurable.

## 5. Testing & Evaluation

- **Test layers:** unit + integration on fixtures; acceptance evals E1–E10
  (`HARNESS-PHASE-A.md` §6) and E-CHAT-1…7 (`HARNESS-CHAT-SURFACE.md` §6).
- **Exact validation command:**
  ```
  .\scripts\verify.ps1 -SessionId S-XXX
  ```
### 5.0 THE RULE: every claim in this section maps to an executable check

**Adopted 2026-07-28 (Brian).** No statement in §5 may assert a property of this repo unless
a named check proves it and `verify.ps1` **prints that check by name** in the evidence log.
A claim with no check is deleted or downgraded to a stated limitation — it is never left
standing as prose. This section previously claimed the gate ran lint when nothing ran lint;
the rule exists so that cannot recur.

| # | Claim made in §5 | Executable check | Printed as |
|---|------------------|------------------|-----------|
| 1 | Code is free of undefined identifiers, duplicate keys, unreachable code, fall-through | `npm run lint` (ESLint 9, `js.configs.recommended` at **error**) | `=== CHECK: lint ===` |
| 2 | The full suite passes | `npm test -- --run` (vitest) | `=== CHECK: tests ===` |
| 3 | **The test floor holds and never falls** | `node scripts/check-test-floor.mjs <log>` vs. `harness/TEST_FLOOR` | `=== CHECK: test-floor ===` |
| 4 | The app builds | `npm run build` (vite) | `=== CHECK: build ===` |
| — | *Typecheck* | **No check exists** — JavaScript repo, no `tsconfig.json` | Not claimed. The gate reports 4/4, not 5. |

**What the gate runs: 4 checks** (verified 2026-07-28). It writes a raw log to `evidence/`
and exits non-zero if any check fails. **CI runs the same four** — `.github/workflows/verify.yml`
no longer uses `--if-present` for lint or tests, because `--if-present` silently skips a
missing script and still exits 0, which is precisely how lint went unrun for months while CI
reported green.
- **Lint baseline (disclosed, not hidden):** all `js.configs.recommended` correctness rules
  are ERRORS and the repo is clean against every one. `no-unused-vars` and
  `no-prototype-builtins` are WARNINGS for the initial baseline — 15 warnings, printed in
  full in every evidence log. Session **S-LINT-1** burns them to zero and flips both to
  `error`. See `DECISIONS.md` I-005 / R-002.
  > **History:** until 2026-07-28 no `lint` script existed, so `verify.ps1`'s
  > `if ($scripts.ContainsKey("lint"))` and CI's `--if-present` both skipped lint **silently**
  > while this section claimed the gate ran it and the log attested "ALL CHECKS PASSED (2/2)".
  > A gate that lies is worse than no gate. Fixed in S-HARNESS-P1.
### 5.1 The test floor — which suite it governs, and the 707/838 reconciliation

**Floor: 838.** It rises and never falls. The number lives in **`harness/TEST_FLOOR`**, is
enforced by `scripts/check-test-floor.mjs`, and is checked by both `verify.ps1` and CI.
Lowering it is a harness **AMENDMENT** — change the file deliberately and say why in
`DECISIONS.md`. Editing the checker instead is a completion-standard violation.

**Which suite the floor governs: the WORKING TREE, as run by `npm test` (`vitest run`) —
every test file on disk, tracked or not.** That is what the gate executes, so that is what
the floor measures. It does not govern `git HEAD`.

**Reconciling 707 vs 838** — both numbers are correct, for different sets:

| Count | Set | Why |
|-------|-----|-----|
| **707** | Committed suite at `92567dd` | What is in git history today |
| **131** | `tests/objective.test.js` (82) + `tests/recommendation-score.test.js` (71) | S-08A's tests, written but **untracked** — Brian has not committed S-08A yet |
| **838** | Working tree = 707 + 131 | What `npm test` actually runs, machine-verified across 34 files on 2026-07-28 |

The gap is not drift; it is simply that S-08A is unc*ommitted*. **When Brian commits S-08A,
HEAD's count becomes 838 and the two converge.** Until then, a fresh clone of `main` will
count 707 and the floor check would fail there — expected, and the correct signal: the floor
describes the work in progress, not the last commit.

> **The floor was previously enforced by nobody.** `CLAUDE.md` and this file both stated it,
> and it still fell 710 → 707 between `d0a1f0e` (S07e) and `92567dd` (S07f) with no gate
> noticing (`DECISIONS.md` R-006). A floor only a human enforces is not a floor. As of
> 2026-07-28 it is an exit code.
- **Required completion evidence:** an exit-0 `verify.ps1` log in `harness/evidence/` named
  `S-XXX-verify-<timestamp>.log`. An agent asserting "tests pass" without the log is a
  completion-standard violation (Rule 5).

## 6. Build Plan

Dependency-ordered sessions live in `HARNESS-PHASE-A.md` §8; live status in `SESSIONS.md`.

## 7. Open Owner Decisions

D-1…D-7 in `HARNESS-PHASE-A.md` §9; resolutions recorded in `DECISIONS.md`.
D-1 (fully gated) and D-2 (cap 10 / threshold 0.25) are resolved and seeded in `sql/020`.
D-3…D-7 remain OPEN and gate S-08B / S-09A / S-09B.

**ALL owner decisions D-1…D-12 are now RESOLVED** (2026-07-28). D-1, D-2 previously; D-3
(per-loop enqueue rule → SDR-3), D-4 (Pro required for hourly cron; alert channel), D-5
(execute-path-only kill switch), D-6 (API/LLM ceiling, interim $25/day · $250/month pending
`sql/023`), D-7, D-8, D-9, D-10, D-11 (W cap retained), D-12 (ad-spend pacing, session S-05B)
this session. Full text and reasoning in `DECISIONS.md`.

**Two items await Brian's action, not his decision:** running
`sql/023_cost_actuals_readonly.sql` to replace the interim cost ceiling, and confirming the
Vercel plan before S-09B (hourly cron requires Pro).

> **Two ceilings, never merged.** `COST_ALERT_*` bounds **Prime's own operating cost**
> (Anthropic inference). The **$2,500/month Google Ads cap is FPB's ad spend**. They are
> different budgets belonging to different parties, and `PRIME-STRATEGY.md` §6 holds them
> apart deliberately. **Only Brian raises either, recorded as a decision.**
> At the API ceiling, shed in this order: proactive analysis → recommendation generation →
> the S-08B daily loop. **The watch loop is preserved last** — shedding the component that
> notices the account is on fire, in order to save inference cost, inverts the point of
> having a ceiling.

**D-8, D-9, D-10** are raised by `HARNESS-CHAT-SURFACE.md` and recorded in `DECISIONS.md`:
- **D-8** — fetch-cache TTL (recommend 30 min, config-driven). Gates S-07f.1 acceptance.
- **D-9** — what `removedQualifiedLeads` derives FROM (platform conversions vs. CRM-qualified
  leads). **Blocks S-08A.1 completion** — the two are different units.
- **D-10** — capability-disclosure blast radius: registry-driven disclosure will narrow what
  the agent says it can do.

All resolutions are recorded in `DECISIONS.md`, which until 2026-07-28 was still the blank
installer template despite this section pointing at it.

## 8. Amendment Log

| Date | Version | Change | Classification | Approved by |
|------|---------|--------|----------------|-------------|
| 2026-07-13 | 1.0 | Harness activated; `HARNESS-PHASE-A.md` designated the Phase A contract. Tier 3 declared. | Clarification | Brian |
| 2026-07-28 | 1.1 | **Chat-surface provenance amendment.** A live session fabricated a search-term report, narrated a tool call that never ran, and emitted a truncated `ACTION:{...}` payload with markdown bleed. The staging validator fail-closed correctly and nothing reached Google Ads — the safety layer is not what failed. The failure is that the conversational layer may author data and narrate actions. Extends S-08A.1 *derive, don't assert* from the reallocation module to the chat surface. Adds `HARNESS-CHAT-SURFACE.md` with sessions S-08A.1 / S-07f.1 / S-07g / S-07h and evals E-CHAT-1…7. Raises D-8/D-9/D-10 and R-001/R-003/R-004/R-005. | Amendment | **PENDING BRIAN** |
| 2026-07-28 | 1.1 | **Verify gate made honest.** No `lint` script existed, so `verify.ps1` and CI both skipped lint silently while §5 claimed the gate ran it and logs attested "ALL CHECKS PASSED (2/2)". Added ESLint 9 flat config + `lint` script; gate now runs 3/3. Filled `AGENTS.md`, `DECISIONS.md`, `ENVIRONMENT.md`, which were still blank installer templates. | Clarification | Orchestrator |
| 2026-07-13 | 1.0 | **A14 — reallocation spend-coherence cap.** Independent review of S-08A found `removed.spend` was trusted independently of the removed cohort's lead share, letting an inflated spend claim score ~18x honest value while passing every A10 subset check. Added `reallocation_max_waste_multiple` (W=3, config-driven) bounding an *unverified* spend claim to `W × leadShare × hostSpend`; server-verified spend (fetched search-term cost, per S07f provenance) is exempt, which is what keeps eval E1 alive for zero-lead pure-waste terms. Scoring-only change; no money-path file touched. | Amendment | Brian (this pass) |
