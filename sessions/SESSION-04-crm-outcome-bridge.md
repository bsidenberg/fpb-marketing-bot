# SESSION 04 — CRM → Prime lead-outcome bridge
AUTONOMY: gated


GOAL: Prime cannot see which leads became sold jobs or their revenue/gross profit, so it cannot optimize for what matters. Build the bridge: when FPB CRM (Supabase flabvhdgqddbfitbqjqk) marks a lead sold with revenue, that lands on Prime's leads row (booked_revenue, gross_profit, qualified/sold status).

DESIGN DECISION REQUIRED IN PHASE A - present both, recommend one:
 (a) Push: CRM-side calls Prime's existing POST /api/leads pattern (new secret-gated PATCH-by-match endpoint or extend ingest) - note this session may then also produce a small task spec for the fpb-crm repo (write it as CRM-BRIDGE-SPEC.md; do NOT touch the CRM repo from here).
 (b) Pull: Prime nightly cron reads CRM Supabase with a read-only service connection (new env var CRM_SUPABASE_URL + CRM_SUPABASE_SERVICE_KEY).
Matching strategy matters most: propose match precedence (crm_lead_id if present > email+phone > email) and how mismatches are logged for Brian's review rather than guessed.

FILE SCOPE (Prime repo only): new api/lib/crm-bridge.js, new api/cron-crm-sync.js OR extension of leads.js (per chosen design), vercel.json, .env.example, new tests/crm-bridge.test.js, sql/01X migration file if leads needs columns (crm_lead_id, sold_at). CRM-BRIDGE-SPEC.md if design (a).

PHASE A read + design (STOP for approval - gated class) / PHASE B implement with mocks / PHASE C floor 443 + report env vars Brian must add.

DoD: a test-mode sync maps a mock CRM sold lead onto a Prime lead with revenue + GP; unmatched leads logged, never force-matched.
