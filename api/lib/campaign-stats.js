// ============================================================
// api/lib/campaign-stats.js — write campaign_daily_stats rows
//
// Called by analyze-ads.js after fetching Google/Meta data.
// Uses upsert on (platform, campaign_id, date) — safe to call
// multiple times per day (idempotent, last-write-wins).
// ============================================================

import supabase from './supabase.js';

/**
 * Write campaign-level daily stats to campaign_daily_stats.
 * @param {Array}  campaigns  — array of campaign objects from google-ads or facebook-ads APIs
 * @param {string} platform   — 'google_ads' | 'meta_ads'
 * @param {string} dateStr    — YYYY-MM-DD for the stat date (defaults to today UTC)
 * @returns {{ written: number, errors: string[] }}
 */
export async function writeCampaignDailyStats(campaigns, platform, dateStr) {
  const date = dateStr || new Date().toISOString().slice(0, 10);

  if (!campaigns || campaigns.length === 0) {
    return { written: 0, errors: [] };
  }

  const rows = campaigns.map(c => ({
    client_key:   'fpb',
    platform,
    campaign_id:  String(c.id || c.campaign_id || ''),
    campaign_name: c.name || c.campaign_name || null,
    date,
    spend:       c.spend        != null ? parseFloat(c.spend)       : null,
    impressions: c.impressions  != null ? parseInt(c.impressions)   : null,
    clicks:      c.clicks       != null ? parseInt(c.clicks)        : null,
    conversions: c.conversions  != null ? parseFloat(c.conversions) : null,
    ctr:         c.ctr          != null ? parseFloat(c.ctr)         : null,
    cpc:         c.cpc          != null ? parseFloat(c.cpc)
                 : (c.avgCpc    != null ? parseFloat(c.avgCpc)      : null),
    cpl:         c.cpl          != null ? parseFloat(c.cpl)         : null,
    frequency:   c.frequency    != null ? parseFloat(c.frequency)   : null,
    raw_payload: c,
  })).filter(r => r.campaign_id !== '');

  if (rows.length === 0) return { written: 0, errors: [] };

  const { error } = await supabase
    .from('campaign_daily_stats')
    .upsert(rows, {
      onConflict:       'platform,campaign_id,date',
      ignoreDuplicates: false,  // update on conflict (last-write-wins)
    });

  if (error) {
    return { written: 0, errors: [error.message] };
  }

  return { written: rows.length, errors: [] };
}

/**
 * Sum spend for a campaign over a date range from campaign_daily_stats.
 * Returns null if no rows found (caller should fall back to performance_snapshots).
 * @param {string} campaignId
 * @param {string} platform   — 'google_ads' | 'meta_ads'
 * @param {string} startDate  — YYYY-MM-DD inclusive
 * @param {string} endDate    — YYYY-MM-DD exclusive
 * @returns {number|null}
 */
export async function getCampaignSpend(campaignId, platform, startDate, endDate) {
  if (!campaignId) return null;

  const { data, error } = await supabase
    .from('campaign_daily_stats')
    .select('spend, conversions')
    .eq('campaign_id', campaignId)
    .eq('platform', platform)
    .gte('date', startDate)
    .lt('date', endDate);

  if (error || !data || data.length === 0) return null;

  const total = data.reduce((sum, row) => sum + (parseFloat(row.spend) || 0), 0);
  return total;
}
