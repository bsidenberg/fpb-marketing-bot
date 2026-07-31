-- ============================================================
-- Migration 025: sold-rate columns on action_outcomes (S-04B)
--
-- R-014 (harness/DECISIONS.md): gradeOutcome (api/lib/recommendation-score.js)
-- grades on gross_profit_* -> cost_per_qualified_lead_*, and gross_profit_*
-- is written NULL by evaluate-outcomes.js today (never computed — see that
-- file's own comment, "future: aggregate from leads.booked_revenue"). So
-- CPQL is the LIVE grading basis, and CPQL is blind to SOLD RATE: an action
-- that raises qualified-lead volume while lowering the fraction of those
-- leads that actually close grades as a SUCCESS on CPQL, and the E7 learning
-- gate then up-weights that action class — rewarding more, cheaper, worse
-- leads every cycle, against the stated sold-jobs-and-gross-profit objective.
--
-- These columns give evaluate-outcomes.js (api/evaluate-outcomes.js) a place
-- to write TERMINAL lead counts per window, so recommendation-score.js's
-- gradeOutcome can add a sold-rate rung ABOVE CPQL: sold_rate = booked /
-- (booked + lost), same denominator convention as api/lib/objective.js's
-- soldRate() (terminal outcomes only — in-flight 'qualified'/'new' leads are
-- excluded from both numerator and denominator, for the same reason
-- objective.js excludes them: a lead that has not lost YET would count as a
-- non-sale, deflating every recent campaign's rate purely for being recent).
--
-- Run in Supabase SQL editor after 002_action_outcomes.sql.
-- Never applied directly by an agent — Brian applies via the SQL editor.
-- ============================================================

alter table action_outcomes
  add column if not exists booked_leads_before  int,
  add column if not exists lost_leads_before     int,
  add column if not exists booked_leads_after    int,
  add column if not exists lost_leads_after      int;

comment on column action_outcomes.booked_leads_before is 'Terminal CRM-booked leads in the before window, same convention as api/lib/objective.js soldRate() — NULL means not measured, never 0.';
comment on column action_outcomes.lost_leads_before    is 'Terminal CRM-lost leads in the before window. booked_leads_before + lost_leads_before = terminal outcomes; qualified_leads_before may exceed this (in-flight leads not yet resolved).';
comment on column action_outcomes.booked_leads_after   is 'Terminal CRM-booked leads in the after window.';
comment on column action_outcomes.lost_leads_after     is 'Terminal CRM-lost leads in the after window.';
