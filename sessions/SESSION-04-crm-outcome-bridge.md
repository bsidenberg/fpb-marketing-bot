# SESSION 04 — CRM → Prime profit bridge (nightly pull)
AUTONOMY: gated

GOAL: Prime's leads table already has booked_revenue, gross_profit,
estimated_value, qualification_status ('booked'), and booked_at — all
empty. Fill them nightly from the FPB CRM so Prime optimizes for sold
jobs and profit, not form fills. Design is PULL, decided 7/2 with Brian:
a Prime cron reads the CRM Supabase read-only; no CRM-repo changes.

VERIFIED FACTS (from live schema inspection 7/2 — do not re-derive):
- CRM project flabvhdgqddbfitbqjqk. CRM leads (571 rows): email, phone,
  alt_phone, first_name, last_name, stage (won/lost/estimate_sent/...),
  value, created_at, utm_campaign, service_type.
- CRM projects (21 rows): lead_id FK -> CRM leads, contract_amount,
  project_type ('kit'|'turnkey'), status incl 'closed_won'.
- NO shared ID between systems. Prime leads (266 rows) have
  contact_email, contact_phone, contact_name, lead_date, created_at.
- CRM has NO gross-profit column anywhere. GP must be ESTIMATED.

DESIGN (approved direction — Phase A refines, does not reopen):
1. Nightly cron api/cron-crm-sync.js (propose 11:15 UTC, before
   daily-stats 11:45) + api/lib/crm-bridge.js. Reads CRM via new env
   vars CRM_SUPABASE_URL + CRM_SUPABASE_SERVICE_KEY using a separate
   supabase client. CODE IS READ-ONLY against CRM: no insert/update/
   delete/upsert calls on the CRM client, ever.
2. Sold definition & revenue precedence:
   - CRM lead stage='won' => qualification_status='booked',
     booked_at=stage_changed_at.
   - booked_revenue: projects.contract_amount for that lead_id where
     status != 'cancelled' (sum if multiple) else leads.value else null.
   - stage='lost' => qualification_status='lost', lost_at, lost_reason.
   - stage in (estimate_sent, revision_negotiation, need_to_quote) =>
     'qualified' if Prime status is still 'new'. Never downgrade a
     Prime status that is already booked.
3. gross_profit = booked_revenue * margin from agent_config key
   'crm_bridge_margins' {"kit":0.XX,"turnkey":0.XX,"default":0.XX}
   (Brian supplies numbers at approval; seed via sql file, not applied).
   Write attribution_notes suffix "(GP estimated at NN% margin)".
4. Matching (deterministic, conservative):
   a. normalized email exact (lower/trim) ->
   b. normalized phone exact (strip non-digits, compare last 10; also
      try alt_phone) ->
   c. no match => log to automation_log details, skip. NEVER fuzzy-match
      names. If one CRM lead matches MULTIPLE Prime leads: pick the one
      with lead_date within ±7 days of CRM created_at; if still
      ambiguous, update ALL matched Prime rows' notes with
      "[CRM-AMBIGUOUS candidate <crm_id>]" and skip revenue write.
   Expect many unmatched CRM leads (571 vs 266; CRM history predates
   Prime ingest) — count them, don't treat as errors.
5. Full-table scan each run is fine at this size (<1k rows). Idempotent:
   re-running produces identical Prime rows.
6. Backfill = the first run (same code path). Report matched/booked/
   revenue-total counts in the cron response and automation_log.

FILE SCOPE: api/lib/crm-bridge.js (new), api/cron-crm-sync.js (new),
vercel.json (one cron entry), .env.example (two vars), sql/016_agent_
config_crm_margins.sql (seed file, NOT applied), tests/crm-bridge.test.js
(new). Nothing else. Do not touch evaluate-outcomes or leads ingest.

PHASE A (STOP for Brian): present matching pseudocode, the exact CRM
queries, field-mapping table, and edge-case handling (won lead with no
project, multiple projects, phone formats). Brian supplies margin
percentages at approval.
PHASE B implement with mocked CRM client. PHASE C: floor 480+, new tests
cover both match paths, precedence, no-downgrade rule, ambiguity skip,
read-only guarantee (assert CRM client mock never receives writes).
Safety-reviewer pass on the diff (writes to leads = truth-layer data),
verdict verbatim in report.

DoD: mock backfill maps a won CRM lead w/ project to a Prime lead with
booked_revenue, estimated GP, status booked; unmatched logged; second
run is a no-op diff-wise.
