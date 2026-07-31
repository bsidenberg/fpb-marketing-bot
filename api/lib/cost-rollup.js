// ============================================================
// api/lib/cost-rollup.js — monthly cost rollup computation
//
// computeMonthlyRollup(accountId, yearMonth)
//   Aggregates cost_api_events + cost_subscriptions + cost_hours for
//   a given account and calendar month, then upserts the result into
//   cost_rollups_monthly. Returns the rollup row on success.
//
// Subscription allocation logic (caller-account-wins, Section 2.4):
//   - Shared subscriptions (allocation_account_id IS NULL) are split
//     evenly across active tenants: 1/N per tenant.
//   - Account-specific subscriptions are attributed 100% to that account.
//
// Hours allocation: rows where focus_area = account.slug are counted.
// Cross-tenant hours ('prime-platform', 'cross-tenant') are not attributed
// to any single account in this rollup — they remain unallocated until
// a cross-tenant rollup view is added in a later phase.
//
// data_completeness disclosure (S-OBS-1, 2026-07-30):
//   cost_subscriptions and cost_hours are MANUAL-ENTRY tables — nothing
//   auto-logs into them. HARNESS.md §4.1's zero-row sweep ruled both
//   "expected-empty ONLY while Brian logs no hours/subscriptions — but then
//   the cost ledger is knowingly incomplete and the pricing floor
//   (PRIME-STRATEGY.md §6) is unbacked." That incomplete state must be
//   disclosed at every read, not silently assumed away by an empty-looking
//   $0 line item that reads the same as "genuinely nothing to allocate."
//   Checked against table-wide row counts (not just this account/month) —
//   a table that has never been written to at all is a materially
//   different situation than one this account simply had nothing in this
//   month, and the disclosure is about the former.
// ============================================================

import supabase from './supabase.js';

export async function computeMonthlyRollup(accountId, yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  const nextYear      = month === 12 ? year + 1 : year;
  const nextMonthNum  = month === 12 ? 1 : month + 1;
  const startDate     = `${yearMonth}-01T00:00:00.000Z`;
  const endDate       = `${nextYear}-${String(nextMonthNum).padStart(2, '0')}-01T00:00:00.000Z`;
  const startDay      = `${yearMonth}-01`;
  const endDay        = `${nextYear}-${String(nextMonthNum).padStart(2, '0')}-01`;

  // ── API events for this account and month ─────────────────────────────────
  const { data: events, error: eventsErr } = await supabase
    .from('cost_api_events')
    .select('vendor, tokens_in, tokens_out, units, cost_usd')
    .eq('account_id', accountId)
    .gte('occurred_at', startDate)
    .lt('occurred_at', endDate);

  if (eventsErr) throw new Error(`cost_api_events query failed: ${eventsErr.message}`);

  let anthropicInputTokens  = 0;
  let anthropicOutputTokens = 0;
  let anthropicTotalUsd     = 0;
  let googleAdsCalls        = 0;
  let metaAdsCalls          = 0;

  for (const row of events || []) {
    if (row.vendor === 'anthropic') {
      anthropicInputTokens  += row.tokens_in  ?? 0;
      anthropicOutputTokens += row.tokens_out ?? 0;
      anthropicTotalUsd     += parseFloat(row.cost_usd ?? 0);
    } else if (row.vendor === 'google_ads') {
      googleAdsCalls += row.units ?? 1;
    } else if (row.vendor === 'meta_ads') {
      metaAdsCalls += row.units ?? 1;
    }
  }

  // ── Active tenant count for shared subscription split ─────────────────────
  const { data: activeAccounts, error: activeAccountsErr } = await supabase
    .from('accounts')
    .select('id')
    .eq('status', 'active');
  if (activeAccountsErr) throw new Error(`accounts (active count) query failed: ${activeAccountsErr.message}`);
  const activeCount = Math.max(1, (activeAccounts || []).length);

  // ── Shared subscriptions active during the month ──────────────────────────
  const { data: sharedSubs, error: sharedSubsErr } = await supabase
    .from('cost_subscriptions')
    .select('monthly_amount_usd')
    .is('allocation_account_id', null)
    .lte('started_at', endDate)
    .or(`ended_at.is.null,ended_at.gte.${startDate}`);
  if (sharedSubsErr) throw new Error(`cost_subscriptions (shared) query failed: ${sharedSubsErr.message}`);

  let subscriptionShareUsd = 0;
  for (const sub of sharedSubs || []) {
    subscriptionShareUsd += parseFloat(sub.monthly_amount_usd ?? 0) / activeCount;
  }

  // ── Account-specific subscriptions active during the month ───────────────
  const { data: acctSubs, error: acctSubsErr } = await supabase
    .from('cost_subscriptions')
    .select('monthly_amount_usd')
    .eq('allocation_account_id', accountId)
    .lte('started_at', endDate)
    .or(`ended_at.is.null,ended_at.gte.${startDate}`);
  if (acctSubsErr) throw new Error(`cost_subscriptions (account-specific) query failed: ${acctSubsErr.message}`);

  for (const sub of acctSubs || []) {
    subscriptionShareUsd += parseFloat(sub.monthly_amount_usd ?? 0);
  }

  // ── Hours by focus_area = account slug ────────────────────────────────────
  const { data: accountRow, error: accountRowErr } = await supabase
    .from('accounts')
    .select('slug')
    .eq('id', accountId)
    .single();
  if (accountRowErr) throw new Error(`accounts (slug lookup) query failed: ${accountRowErr.message}`);

  let hoursTotal = 0;
  if (accountRow?.slug) {
    const { data: hours, error: hoursErr } = await supabase
      .from('cost_hours')
      .select('hours')
      .eq('focus_area', accountRow.slug)
      .gte('log_date', startDay)
      .lt('log_date', endDay);
    if (hoursErr) throw new Error(`cost_hours query failed: ${hoursErr.message}`);

    for (const row of hours || []) {
      hoursTotal += parseFloat(row.hours ?? 0);
    }
  }

  const operatingTotal = anthropicTotalUsd + subscriptionShareUsd;

  // ── Data-completeness disclosure (S-OBS-1) — table-wide, not month-scoped ──
  const { count: subscriptionsEverLogged, error: subsCountErr } = await supabase
    .from('cost_subscriptions')
    .select('id', { count: 'exact', head: true });
  if (subsCountErr) throw new Error(`cost_subscriptions (count) query failed: ${subsCountErr.message}`);

  const { count: hoursEverLogged, error: hoursCountErr } = await supabase
    .from('cost_hours')
    .select('id', { count: 'exact', head: true });
  if (hoursCountErr) throw new Error(`cost_hours (count) query failed: ${hoursCountErr.message}`);

  // TODO (Phase 4 pricing): build_total_usd is deferred until Brian sets an
  // hourly rate. Hours are captured in hours_total but not converted to USD.
  // When an hourly rate is defined, compute: build_hours * rate_per_hour.
  const rollup = {
    account_id:              accountId,
    year_month:              yearMonth,
    build_total_usd:         0,
    operating_total_usd:     Math.round(operatingTotal * 1_000_000) / 1_000_000,
    anthropic_input_tokens:  anthropicInputTokens,
    anthropic_output_tokens: anthropicOutputTokens,
    anthropic_total_usd:     Math.round(anthropicTotalUsd * 1_000_000) / 1_000_000,
    google_ads_calls:        googleAdsCalls,
    meta_ads_calls:          metaAdsCalls,
    subscription_share_usd:  Math.round(subscriptionShareUsd * 1_000_000) / 1_000_000,
    hours_total:             Math.round(hoursTotal * 100) / 100,
    last_computed_at:        new Date().toISOString(),
  };

  const { error: upsertErr } = await supabase
    .from('cost_rollups_monthly')
    .upsert(rollup, { onConflict: 'account_id,year_month' });

  if (upsertErr) throw new Error(`cost_rollups_monthly upsert failed: ${upsertErr.message}`);

  // data_completeness is disclosure metadata, returned to the caller but NOT
  // persisted onto the cost_rollups_monthly row — the row's numeric columns
  // are the stored aggregate; completeness is a live fact about the source
  // tables, re-evaluated on every read rather than frozen at compute time.
  return {
    ...rollup,
    data_completeness: {
      subscriptions_logged: (subscriptionsEverLogged ?? 0) > 0,
      hours_logged:         (hoursEverLogged ?? 0) > 0,
      note: 'cost_subscriptions and cost_hours are manual-entry tables. ' +
        'While either is unlogged (zero rows system-wide), operating_total_usd ' +
        'and/or hours_total are known undercounts, not confirmed zeros — see ' +
        'harness/DECISIONS.md S-OBS-1.',
    },
  };
}
