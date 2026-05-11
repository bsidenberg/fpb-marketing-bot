// ============================================================
// api/analyze-ads.js — AI ad performance analysis
//
// Two entry points share a single core (`runAnalysisForAccount`):
//   1. HTTP handler (default export) — manual / dashboard triggers
//   2. Direct callable (named export) — used by /api/cron-analyze in
//      Sub-Task 9 to loop over active accounts without HTTP fan-out
//
// Stage B1 retrofit:
//   • Account-scoped throughout: every insert (actions, automation_log,
//     performance_snapshots, campaign_daily_stats) carries account_id.
//   • Connection lookup per platform via getConnectionForAccount.
//     If a platform's connection is missing or incomplete, the analysis
//     skips that platform with a warning rather than failing entirely.
//   • Internal /api/google-ads and /api/facebook-ads fetches pass
//     ?account=<slug> explicitly to avoid accidental fallthrough to FPB.
//   • ai_analysis_runs lifecycle (pending → running → succeeded/failed)
//     is logged best-effort. A logging failure NEVER kills the analysis.
//   • actions dedup query is account-scoped so two accounts can both
//     have a "pause campaign 123" action without colliding.
// ============================================================

import supabase from './lib/supabase.js';
import { writeCampaignDailyStats } from './lib/campaign-stats.js';
import { getFpbSystemPrompt, FPB_SYSTEM_PROMPT_VERSION } from './lib/prompts/fpb.js';
import {
  resolveForWrite,
  getConnectionForAccount,
} from './lib/accounts.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-account-slug',
};

function cors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

// ── Internal data fetchers (account-scoped) ───────────────────────────────────

async function fetchGoogleAds(baseUrl, accountSlug) {
  try {
    // Explicit account param prevents accidental fallthrough to default FPB
    const url = `${baseUrl}/api/google-ads?account=${encodeURIComponent(accountSlug)}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.success ? data : null;
  } catch {
    return null;
  }
}

async function fetchMetaAds(baseUrl, accountSlug) {
  try {
    // Explicit account param prevents accidental fallthrough to default FPB
    const url = `${baseUrl}/api/facebook-ads?account=${encodeURIComponent(accountSlug)}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.success ? data : null;
  } catch {
    return null;
  }
}

async function callClaude(performanceData) {
  const systemPrompt = getFpbSystemPrompt();

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Here is the current ad performance data:\n\n${JSON.stringify(performanceData, null, 2)}\n\nReturn your recommended actions as a JSON array.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err.substring(0, 200)}`);
  }

  const json = await response.json();
  const text = json.content?.[0]?.text || '[]';

  // Strip any markdown fences if present
  const clean = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  return JSON.parse(clean);
}

// ── Best-effort ai_analysis_runs logging ──────────────────────────────────────

async function insertAnalysisRunPending(account, googleData, metaData, triggeredBy) {
  try {
    const { data, error } = await supabase
      .from('ai_analysis_runs')
      .insert({
        account_id:      account.id,
        model_provider:  'anthropic',
        model_name:      'claude-sonnet-4-20250514',
        prompt_version:  FPB_SYSTEM_PROMPT_VERSION,
        status:          'pending',
        input_summary_json: {
          campaign_count_google: googleData?.campaigns?.length || 0,
          campaign_count_meta:   metaData?.campaigns?.length   || 0,
          date_window:           'last_30d',
          triggered_by:          triggeredBy,
        },
      })
      .select()
      .single();
    if (error) {
      console.error('[analyze-ads] ai_analysis_runs insert failed:', error.message);
      return null;
    }
    return data?.id || null;
  } catch (err) {
    console.error('[analyze-ads] ai_analysis_runs insert threw:', err.message);
    return null;
  }
}

async function updateAnalysisRunStatus(runId, patch) {
  if (!runId) return;
  try {
    const { error } = await supabase
      .from('ai_analysis_runs')
      .update(patch)
      .eq('id', runId);
    if (error) {
      console.error('[analyze-ads] ai_analysis_runs update failed:', error.message);
    }
  } catch (err) {
    console.error('[analyze-ads] ai_analysis_runs update threw:', err.message);
  }
}

// ── Connection availability check ─────────────────────────────────────────────

function googleConnectionUsable(connection) {
  return !!(connection
    && connection.resolved_account_id_external
    && connection.resolved_refresh_token);
}

function metaConnectionUsable(connection) {
  return !!(connection
    && connection.resolved_access_token
    && connection.resolved_account_id_external);
}

// ── Core: runAnalysisForAccount ───────────────────────────────────────────────
/**
 * Run an end-to-end ad analysis for a single account and persist results.
 *
 * Used by the HTTP handler below and (Sub-Task 9) by /api/cron-analyze.
 * The cron path will iterate listActiveAccounts() and call this directly,
 * avoiding URL construction and per-account HTTP fan-out.
 *
 * @param {object} account — account row with id and slug
 * @param {object} options
 * @param {string} options.baseUrl — for internal /api/google-ads + /api/facebook-ads fetches
 * @param {string} [options.triggeredBy='manual'] — 'http' | 'cron' | 'manual'
 * @returns {Promise<{success, analyzed?, actions_created?, actions?, error?}>}
 */
export async function runAnalysisForAccount(account, { baseUrl, triggeredBy = 'manual' } = {}) {
  if (!account || !account.id || !account.slug) {
    throw new Error('runAnalysisForAccount requires account with id and slug');
  }
  if (!baseUrl) {
    throw new Error('runAnalysisForAccount requires baseUrl');
  }

  const startedAt = new Date().toISOString();

  // ── Resolve connections — skip platforms whose connection is missing/incomplete ─
  const [googleConn, metaConn] = await Promise.all([
    getConnectionForAccount(account.id, 'google_ads'),
    getConnectionForAccount(account.id, 'meta_ads'),
  ]);

  const googleAvailable = googleConnectionUsable(googleConn);
  const metaAvailable   = metaConnectionUsable(metaConn);

  if (!googleAvailable) {
    console.warn(
      `[analyze-ads] account=${account.slug} google_ads skipped: ${googleConn ? 'connection incomplete' : 'no connection row'}`
    );
  }
  if (!metaAvailable) {
    console.warn(
      `[analyze-ads] account=${account.slug} meta_ads skipped: ${metaConn ? 'connection incomplete' : 'no connection row'}`
    );
  }

  // ── 1. Pull ad data for available platforms only ───────────────────────────
  const [googleData, metaData] = await Promise.all([
    googleAvailable ? fetchGoogleAds(baseUrl, account.slug) : Promise.resolve(null),
    metaAvailable   ? fetchMetaAds(baseUrl, account.slug)   : Promise.resolve(null),
  ]);

  if (!googleData && !metaData) {
    return { success: false, error: 'No ad data available from either platform' };
  }

  const performanceData = {};
  if (googleData) performanceData.google_ads = googleData;
  if (metaData)   performanceData.meta_ads   = metaData;

  // ── 2. Log AI run as pending, then transition to running ───────────────────
  const aiCallStartTime = Date.now();
  const runId = await insertAnalysisRunPending(account, googleData, metaData, triggeredBy);
  await updateAnalysisRunStatus(runId, { status: 'running' });

  // ── 3. Send to Claude ──────────────────────────────────────────────────────
  let actions  = [];
  let aiError  = null;
  try {
    const result = await callClaude(performanceData);
    actions = Array.isArray(result) ? result : [];
  } catch (err) {
    aiError = err;
  }

  const latency_ms = Date.now() - aiCallStartTime;

  // ── 4. Final ai_analysis_runs update ───────────────────────────────────────
  if (aiError) {
    await updateAnalysisRunStatus(runId, {
      status:     'failed',
      error:      aiError.message,
      latency_ms,
    });
    // Mirror the failure into automation_log for backward-compat dashboards
    try {
      await supabase.from('automation_log').insert({
        account_id:  account.id,
        event_type:  'analysis_run',
        description: `Analysis failed: ${aiError.message}`,
        status:      'error',
        metadata:    { error: aiError.message, triggered_by: triggeredBy },
      });
    } catch { /* best effort */ }
    return { success: false, error: aiError.message };
  }

  await updateAnalysisRunStatus(runId, {
    status:      'succeeded',
    output_json: actions,
    latency_ms,
  });

  // ── 5. Insert recommended actions (account-scoped dedup against pending) ───
  let insertedCount = 0;
  let skippedCount  = 0;
  const totalCount  = actions.length;

  if (totalCount > 0) {
    // Fetch pending actions for THIS account so dedup keys are isolated
    const { data: existingPending } = await supabase
      .from('actions')
      .select('action_type, execution_data')
      .eq('account_id', account.id)
      .eq('status', 'pending');

    const existingKeys = new Set(
      (existingPending || []).map(r =>
        `${r.action_type}::${r.execution_data?.campaign_id || r.execution_data?.campaign_name || ''}`
      )
    );

    const rows = actions
      .map(a => ({
        account_id:     account.id,
        channel:        a.channel        || 'other',
        action_type:    a.action_type    || 'other',
        title:          a.title          || 'Untitled',
        description:    a.description    || '',
        priority:       a.priority       || 'medium',
        auto_execute:   a.auto_execute   === true,
        execution_data: a.execution_data || {},
        status:         'pending',
      }))
      .filter(row => {
        const key = `${row.action_type}::${row.execution_data?.campaign_id || row.execution_data?.campaign_name || ''}`;
        if (existingKeys.has(key)) return false;
        existingKeys.add(key); // prevent dupes within this batch too
        return true;
      });

    skippedCount = totalCount - rows.length;

    if (rows.length > 0) {
      const { error: insertErr } = await supabase.from('actions').insert(rows);
      if (insertErr) throw new Error(`Supabase actions insert: ${insertErr.message}`);
      insertedCount = rows.length;
    }
  }

  // ── 6. Audit log ──────────────────────────────────────────────────────────
  await supabase.from('automation_log').insert({
    account_id:  account.id,
    event_type:  'analysis_run',
    description: `Analyzed ${Object.keys(performanceData).join(', ')}. Created ${insertedCount} recommended actions.`,
    status:      'complete',
    metadata: {
      google_available: !!googleData,
      meta_available:   !!metaData,
      total:            totalCount,
      inserted:         insertedCount,
      skipped:          skippedCount,
      triggered_by:     triggeredBy,
    },
  });

  // ── 7. Performance snapshot (kept for backwards-compatible dashboard reads) ─
  await supabase.from('performance_snapshots').insert({
    account_id:      account.id,
    snapshot_at:     startedAt,
    google_data:     googleData || null,
    meta_data:       metaData   || null,
    actions_created: insertedCount,
  });

  // ── 8. Per-campaign daily stats for attribution ───────────────────────────
  const today = startedAt.slice(0, 10);
  const statsPromises = [];
  if (googleData?.campaigns?.length > 0) {
    statsPromises.push(writeCampaignDailyStats(googleData.campaigns, 'google_ads', today, account));
  }
  if (metaData?.campaigns?.length > 0) {
    statsPromises.push(writeCampaignDailyStats(metaData.campaigns, 'meta_ads', today, account));
  }
  if (statsPromises.length > 0) {
    const statsResults = await Promise.all(statsPromises);
    const statsErrors  = statsResults.flatMap(r => r.errors || []);
    if (statsErrors.length > 0) {
      console.error('[campaign_daily_stats] write errors:', statsErrors);
    }
  }

  return {
    success:         true,
    analyzed:        Object.keys(performanceData),
    actions_created: insertedCount,
    actions,
  };
}

// ── HTTP handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const account = await resolveForWrite(req, res);
  if (!account) return;

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host     = req.headers['x-forwarded-host'] || req.headers.host;
  const baseUrl  = `${protocol}://${host}`;

  try {
    const result = await runAnalysisForAccount(account, { baseUrl, triggeredBy: 'http' });
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
