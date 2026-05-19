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

  return rollup;
}
