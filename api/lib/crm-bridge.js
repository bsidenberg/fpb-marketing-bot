// ============================================================
// api/lib/crm-bridge.js — CRM → Prime profit bridge (SESSION-04)
//
// Nightly pull from the FPB CRM's own Supabase project into Prime's
// leads table, so Prime can optimize for sold jobs and profit instead
// of raw form fills. Design (approved 7/2): Prime pulls; the CRM repo
// is never touched. See api/cron-crm-sync.js for the cron entrypoint
// and sessions/SESSION-04-crm-outcome-bridge.md for the full contract.
//
// READ-ONLY GUARANTEE: the CRM is external truth outside Prime's
// control. createReadOnlyClient() wraps the raw CRM supabase client so
// only .from(table).select(...) is reachable — insert/update/upsert/
// delete/rpc are structurally impossible to call through it. Never
// bypass this wrapper to write to the CRM.
//
// Revenue precedence: projects.contract_amount (non-cancelled, summed)
// wins over leads.value. Gross profit is an ESTIMATE from agent_config
// key 'crm_bridge_margins' — a 0 or missing margin means "don't
// estimate" (never invent profit); see computeGrossProfit().
// ============================================================

import { createClient } from '@supabase/supabase-js';

const ONE_DAY_MS   = 24 * 60 * 60 * 1000;
const MATCH_WINDOW_DAYS = 7;

const CRM_STAGES = ['won', 'lost', 'estimate_sent', 'revision_negotiation', 'need_to_quote'];
const STAGE_ORDER = {
  won: 0,
  lost: 1,
  estimate_sent: 2,
  revision_negotiation: 2,
  need_to_quote: 2,
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ── CRM client (read-only) ──────────────────────────────────────────────────

/**
 * Wrap a raw supabase-js client so only reads are reachable.
 * CRM is external truth; this wrapper makes writes structurally impossible.
 */
export function createReadOnlyClient(client) {
  return {
    from(table) {
      return {
        select: (...args) => client.from(table).select(...args),
      };
    },
  };
}

/**
 * Build a read-only client against the FPB CRM's own Supabase project.
 * Throws if the required env vars are missing (fail closed — the caller
 * in api/cron-crm-sync.js catches and returns 500).
 */
export function createCrmClient() {
  const url = process.env.CRM_SUPABASE_URL;
  const key = process.env.CRM_SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('CRM_SUPABASE_URL and CRM_SUPABASE_SERVICE_KEY must be set');
  }

  const raw = createClient(url, key);
  return createReadOnlyClient(raw);
}

// ── Normalization ────────────────────────────────────────────────────────────

export function normalizeEmail(e) {
  if (typeof e !== 'string') return null;
  const trimmed = e.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

export function normalizePhone(p) {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

// ── Margins config ───────────────────────────────────────────────────────────

/**
 * Read the crm_bridge_margins row from agent_config. Returns the
 * config_value object, or null on any error/absence (caller treats a
 * null margins config as "never estimate GP").
 */
export async function getMargins(prime) {
  try {
    const { data, error } = await prime
      .from('agent_config')
      .select('config_value')
      .eq('config_key', 'crm_bridge_margins')
      .maybeSingle();

    if (error || !data) return null;
    return data.config_value ?? null;
  } catch {
    return null;
  }
}

// ── Revenue / gross profit ───────────────────────────────────────────────────

/**
 * Revenue precedence for a CRM lead: sum of non-cancelled project
 * contract_amount wins; else leads.value; else null (never invent).
 */
export function computeRevenue(crmLead, projectsForLead) {
  const usable = (projectsForLead || []).filter(p => p.contract_amount != null);

  if (usable.length > 0) {
    const sum = usable.reduce((total, p) => total + Number(p.contract_amount), 0);
    return { revenue: round2(sum), source: 'projects', usableProjects: usable };
  }

  if (crmLead.value != null) {
    return { revenue: round2(Number(crmLead.value)), source: 'lead_value', usableProjects: [] };
  }

  return { revenue: null, source: null, usableProjects: [] };
}

function marginFor(margins, key) {
  let m = Number(margins[key]);
  if (!m || m <= 0) m = Number(margins.default);
  if (!m || m <= 0) return null;
  return m;
}

/**
 * gross_profit = revenue * margin, keyed by project_type (projects
 * source) or service_type (lead_value source). Never invents profit:
 * a missing margins config, or a margin that resolves to 0/missing
 * with no usable default, yields gp: null.
 */
export function computeGrossProfit({ revenue, source, usableProjects }, crmLead, margins) {
  if (!margins || typeof margins !== 'object') return { gp: null, applied: [] };

  if (source === 'projects') {
    let gp = 0;
    const appliedByKey = new Map();
    for (const p of usableProjects) {
      const key = p.project_type;
      const pct = marginFor(margins, key);
      if (pct == null) return { gp: null, applied: [] };
      gp += Number(p.contract_amount) * pct;
      appliedByKey.set(key, pct);
    }
    const applied = Array.from(appliedByKey, ([key, pct]) => ({ key, pct }));
    return { gp: round2(gp), applied };
  }

  if (source === 'lead_value') {
    const key = crmLead.service_type === 'Kit Delivery Only'    ? 'kit'
              : crmLead.service_type === 'Kit + Installation'   ? 'turnkey'
              : 'default';
    const pct = marginFor(margins, key);
    if (pct == null) return { gp: null, applied: [] };
    return { gp: round2(Number(revenue) * pct), applied: [{ key, pct }] };
  }

  return { gp: null, applied: [] };
}

function formatPct(pct) {
  // 0.20 -> "20", 0.225 -> "22.5" (no trailing zeros, no float artifacts)
  return Number((pct * 100).toFixed(2)).toString();
}

const KEY_ORDER = ['kit', 'turnkey', 'default'];

/**
 * Build the attribution_notes suffix describing how gross_profit was
 * estimated. Returns null if there's nothing to attribute.
 */
export function gpSuffix(applied) {
  if (!applied || applied.length === 0) return null;

  const distinctPcts = [...new Set(applied.map(a => a.pct))];
  if (distinctPcts.length === 1) {
    return `(GP estimated at ${formatPct(distinctPcts[0])}% margin)`;
  }

  const sorted = [...applied].sort((a, b) => KEY_ORDER.indexOf(a.key) - KEY_ORDER.indexOf(b.key));
  const parts = sorted.map(a => `${a.key} ${formatPct(a.pct)}%`);
  return `(GP estimated at ${parts.join(' / ')} margins)`;
}

const GP_SUFFIX_RE = /\s*\(GP estimated at [^)]*\)/g;

/**
 * Idempotently apply (or refresh) the GP-estimate suffix on a lead's
 * attribution_notes. If suffix is null (no GP being written this run),
 * existing notes are returned untouched — we only ever strip/replace
 * the suffix when we are actively writing a new GP value.
 */
export function applyGpSuffix(existingNotes, suffix) {
  if (suffix == null) return existingNotes;

  const stripped = (existingNotes || '').replace(GP_SUFFIX_RE, '');
  return `${stripped} ${suffix}`.trim();
}

// ── Ambiguous-match marker ───────────────────────────────────────────────────

export const AMBIGUOUS_MARKER = (crmId) => `[CRM-AMBIGUOUS candidate ${crmId}]`;

// ── Full sync pass ───────────────────────────────────────────────────────────

/**
 * Run one full CRM -> Prime sync pass. Read-only against the CRM;
 * writes only to prime.leads (notes for ambiguous matches, or the
 * matched-lead update object). Idempotent: re-running with unchanged
 * upstream data produces zero Prime updates.
 */
export async function runCrmSync({ crm, prime }) {
  // ── CRM reads (the only two queries against the CRM, read-only) ──────────
  const { data: crmLeads, error: crmLeadsErr } = await crm
    .from('leads')
    .select('id, email, phone, alt_phone, first_name, last_name, stage, stage_changed_at, value, lost_reason, service_type, created_at')
    .in('stage', CRM_STAGES);
  if (crmLeadsErr) throw new Error(`CRM leads query failed: ${crmLeadsErr.message}`);

  const { data: crmProjects, error: crmProjectsErr } = await crm
    .from('projects')
    .select('id, lead_id, project_type, status, contract_amount')
    .not('lead_id', 'is', null)
    .neq('status', 'cancelled');
  if (crmProjectsErr) throw new Error(`CRM projects query failed: ${crmProjectsErr.message}`);

  // ── Prime reads ────────────────────────────────────────────────────────────
  const { data: primeLeads, error: primeErr } = await prime
    .from('leads')
    .select('id, contact_email, contact_phone, contact_name, lead_date, created_at, qualification_status, qualified_at, booked_revenue, gross_profit, booked_at, lost_at, lost_reason, estimated_value, attribution_notes, notes');
  if (primeErr) throw new Error(`Prime leads query failed: ${primeErr.message}`);

  const margins = await getMargins(prime);

  // ── Prime match indexes ────────────────────────────────────────────────────
  const emailIndex = new Map();
  const phoneIndex  = new Map();
  for (const lead of primeLeads || []) {
    const em = normalizeEmail(lead.contact_email);
    if (em) {
      if (!emailIndex.has(em)) emailIndex.set(em, []);
      emailIndex.get(em).push(lead);
    }
    const ph = normalizePhone(lead.contact_phone);
    if (ph) {
      if (!phoneIndex.has(ph)) phoneIndex.set(ph, []);
      phoneIndex.get(ph).push(lead);
    }
  }

  // ── CRM projects grouped by lead_id ─────────────────────────────────────────
  const projectsByLeadId = new Map();
  for (const p of crmProjects || []) {
    if (!projectsByLeadId.has(p.lead_id)) projectsByLeadId.set(p.lead_id, []);
    projectsByLeadId.get(p.lead_id).push(p);
  }

  // ── Process order: won first, then lost, then pipeline stages — so
  //    booked truth wins any Prime-lead collisions. ────────────────────────
  const orderedLeads = [...(crmLeads || [])].sort(
    (a, b) => (STAGE_ORDER[a.stage] ?? 99) - (STAGE_ORDER[b.stage] ?? 99)
  );

  const claimedPrimeIds = new Set();
  const collisions      = [];
  const conflicts       = [];
  const unmatchedIds    = [];
  const ambiguousIds    = [];

  let matched = 0, updated = 0, unchanged = 0, booked = 0, lost = 0, qualified = 0;
  let revenueTotal = 0, gpTotal = 0;

  for (const crmLead of orderedLeads) {
    // ── Matching: normalized email exact, else phone/alt_phone exact ───────
    const em = normalizeEmail(crmLead.email);
    let candidates = em ? (emailIndex.get(em) || []) : [];

    if (candidates.length === 0) {
      const seen = new Set();
      const phCandidates = [];
      for (const raw of [crmLead.phone, crmLead.alt_phone]) {
        const ph = normalizePhone(raw);
        if (!ph) continue;
        for (const lead of phoneIndex.get(ph) || []) {
          if (!seen.has(lead.id)) {
            seen.add(lead.id);
            phCandidates.push(lead);
          }
        }
      }
      candidates = phCandidates;
    }

    if (candidates.length === 0) {
      // Expected at volume — CRM history predates Prime ingest.
      unmatchedIds.push(crmLead.id);
      continue;
    }

    let winner = null;
    if (candidates.length === 1) {
      winner = candidates[0];
    } else {
      const crmCreatedMs = new Date(crmLead.created_at).getTime();
      const within7 = candidates.filter(c => {
        const primeDate = c.lead_date || c.created_at;
        const diffMs = Math.abs(new Date(primeDate).getTime() - crmCreatedMs);
        return diffMs <= MATCH_WINDOW_DAYS * ONE_DAY_MS;
      });

      if (within7.length === 1) {
        winner = within7[0];
      } else {
        // Still ambiguous — mark every original candidate, idempotently.
        const marker = AMBIGUOUS_MARKER(crmLead.id);
        for (const c of candidates) {
          if (!(c.notes || '').includes(marker)) {
            const newNotes = c.notes ? `${c.notes} ${marker}` : marker;
            await prime.from('leads').update({ notes: newNotes }).eq('id', c.id);
          }
        }
        ambiguousIds.push(crmLead.id);
        continue;
      }
    }

    if (claimedPrimeIds.has(winner.id)) {
      collisions.push({ crm_id: crmLead.id, prime_id: winner.id });
      continue;
    }
    claimedPrimeIds.add(winner.id);
    matched++;

    // ── Build the update object: only fields that CHANGE (idempotency) ─────
    const changes = {};

    if (crmLead.stage === 'won') {
      if (winner.qualification_status !== 'booked') changes.qualification_status = 'booked';
      // Never null-out an existing truth timestamp (old CRM rows may lack stage_changed_at).
      if (crmLead.stage_changed_at != null && winner.booked_at !== crmLead.stage_changed_at) {
        changes.booked_at = crmLead.stage_changed_at;
      }

      const projectsForLead = projectsByLeadId.get(crmLead.id) || [];
      const { revenue, source, usableProjects } = computeRevenue(crmLead, projectsForLead);

      // Never null-out an existing value.
      if (revenue != null && winner.booked_revenue !== revenue) {
        changes.booked_revenue = revenue;
      }

      const { gp, applied } = computeGrossProfit({ revenue, source, usableProjects }, crmLead, margins);
      if (gp != null && winner.gross_profit !== gp) {
        changes.gross_profit = gp;
        changes.attribution_notes = applyGpSuffix(winner.attribution_notes, gpSuffix(applied));
      }
      booked++;
    } else if (crmLead.stage === 'lost') {
      // Conflicts skip the lead entirely — no writes of any kind, not even
      // estimated_value ("skip + log conflict").
      if (winner.qualification_status === 'booked') {
        conflicts.push({ crm_id: crmLead.id, prime_id: winner.id, reason: 'crm_lost_vs_prime_booked' });
        continue;
      }
      if (winner.qualification_status === 'unqualified') {
        conflicts.push({ crm_id: crmLead.id, prime_id: winner.id, reason: 'crm_lost_vs_prime_unqualified' });
        continue;
      }
      if (winner.qualification_status !== 'lost') changes.qualification_status = 'lost';
      // Never null-out an existing truth timestamp (old CRM rows may lack stage_changed_at).
      if (crmLead.stage_changed_at != null && winner.lost_at !== crmLead.stage_changed_at) {
        changes.lost_at = crmLead.stage_changed_at;
      }
      if (crmLead.lost_reason != null && winner.lost_reason !== crmLead.lost_reason) {
        changes.lost_reason = crmLead.lost_reason;
      }
      lost++;
    } else {
      // Pipeline stages: estimate_sent / revision_negotiation / need_to_quote.
      // Never downgrade a Prime status that's already past 'new'.
      if (winner.qualification_status === 'new') {
        changes.qualification_status = 'qualified';
        if (winner.qualified_at == null) changes.qualified_at = crmLead.stage_changed_at;
        qualified++;
      }
    }

    // All matched leads, regardless of stage: fill estimated_value only if
    // Prime doesn't already have one.
    if (winner.estimated_value == null && crmLead.value != null) {
      changes.estimated_value = Number(crmLead.value);
    }

    if (Object.keys(changes).length === 0) {
      unchanged++;
      continue;
    }

    const { error: updateErr } = await prime.from('leads').update(changes).eq('id', winner.id);
    if (updateErr) throw new Error(`Prime leads update failed for ${winner.id}: ${updateErr.message}`);
    updated++;

    if (changes.booked_revenue != null) revenueTotal += changes.booked_revenue;
    if (changes.gross_profit  != null) gpTotal      += changes.gross_profit;
  }

  return {
    crm_actionable:     orderedLeads.length,
    matched,
    updated,
    unchanged,
    booked,
    lost,
    qualified,
    unmatched:          unmatchedIds.length,
    ambiguous:          ambiguousIds.length,
    collisions:         collisions.length,
    conflicts:          conflicts.length,
    revenue_total:      round2(revenueTotal),
    gp_total:           round2(gpTotal),
    unmatched_crm_ids:  unmatchedIds.slice(0, 100),
    unmatched_total:    unmatchedIds.length,
    ambiguous_crm_ids:  ambiguousIds,
    conflict_details:   conflicts,
    collision_details:  collisions,
    margins_available:  !!margins,
  };
}
