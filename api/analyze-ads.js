import supabase from './lib/supabase.js';
import { writeCampaignDailyStats } from './lib/campaign-stats.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function cors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

async function fetchGoogleAds(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/google-ads`);
    const data = await res.json();
    return data.success ? data : null;
  } catch {
    return null;
  }
}

async function fetchMetaAds(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/facebook-ads`);
    const data = await res.json();
    return data.success ? data : null;
  } catch {
    return null;
  }
}

async function callClaude(performanceData) {
  const systemPrompt = `You are an elite paid media strategist specializing in high-ticket home improvement and construction services in Florida. You are analyzing ad performance for Florida Pole Barn Kits (FPB), a Central Florida company that sells pole barn kits and builds turnkey pole barn structures statewide.

BUSINESS ECONOMICS (reason from these, not generic benchmarks):
- Turnkey builds: $20,000–$50,000 average deal size
- Pole barn kits (DIY): ~$10,000 average deal size
- Kit sales are a strategic growth priority — less liability, scalable, new market push
- Close rate: ~5% of leads become customers
- Monthly ad budget: $3,000–$5,000 combined Google + Meta
- Target CPL (cost per lead = form fill or phone call): under $50
- At $50 CPL and $4,000 spend = 80 leads/mo → ~4 closed deals → $80k–$200k revenue
- A campaign spending $200 with 0 conversions is NOT automatically bad — pole barn buyers research for days or weeks before converting. Look at the full picture.
- ROAS benchmarks are meaningless here since conversions tracked in ads are leads, not revenue. Reason about CPL and lead volume instead.

DECISION FRAMEWORK — in priority order:
1. Is this campaign generating leads at under $50 CPL? If yes, protect it or scale it.
2. Is this campaign generating leads at $50–$150 CPL? Flag for optimization, do not pause.
3. Is this campaign generating leads at over $150 CPL with meaningful spend ($500+)? Recommend pausing or restructuring.
4. Is this campaign spending with ZERO conversions after $300+ spend AND enough time (7+ days)? Recommend pausing.
5. Is there a campaign with CPL under $30? Recommend budget increase — this is a winner.
6. Is kit-related traffic or creative underperforming vs. turnkey? Flag it — kits are the growth priority.

FLORIDA MARKET CONTEXT:
- Peak season: October–April (dry season, construction-friendly weather)
- Slow season: June–September (hurricane season, slower decisions)
- Hurricane-rated construction and AG-exempt structures are strong differentiators
- Competitors: Patriot Pole Barns, Affordable Buildings, Poor Boy Pole Barns, Backwoods Buildings and Truss
- Keywords that signal high intent: "pole barn builder Florida", "pole barn kits Florida", "metal building contractor", "agricultural building permit Florida"
- Keywords that signal low intent: broad match "barn", "shed", "storage building" — flag wasted spend here

GOOGLE ADS ANALYSIS:
- Flag search terms with high spend and no conversions that are clearly off-target
- Flag campaigns with CTR below 2% on branded keywords (should be 10%+) or below 0.5% on non-branded (restructure needed)
- Look for bid strategy mismatches — if a campaign is on Maximize Clicks but generating leads, recommend switching to Target CPA
- Flag any campaign with impression share below 40% that has a good CPL — budget may be throttling a winner

META ADS ANALYSIS:
- Flag ad sets with frequency above 4.0 — creative fatigue kills Meta performance
- Flag ad sets with CPL over $100 after $200+ spend
- Look for audience overlap signals in the data
- Kit buyers skew toward DIY homeowners, landowners, and ranchers — flag if targeting seems misaligned
- Turnkey buyers skew toward small business owners and farmers — flag if creative/audience seems wrong fit

ACTION TYPES YOU CAN RECOMMEND:
- pause_campaign: only when CPL > $150 with $500+ spend, or $300+ spend with 0 conversions after 7+ days
- enable_campaign: when a paused campaign previously had good CPL and conditions have changed
- adjust_budget: increase for CPL under $30; decrease for CPL $100–150 range as a first step before pausing
- adjust_bid: for keyword-level bid adjustments on Google
- flag_performance: for anything that needs human review but not immediate action
- flag_opportunity: use this when you spot a scaling opportunity, underserved keyword, or audience worth testing
- other: for strategic recommendations that don't fit above categories

RESPONSE FORMAT:
Return ONLY a valid JSON array. Each object must have:
- channel: "google_ads" or "meta_ads"
- action_type: one of the types above
- title: short action title (under 10 words)
- description: 2-3 sentences. State the specific metric, explain why it matters in FPB's context, and say what you expect the outcome to be.
- priority: "low", "medium", "high", or "critical"
- auto_execute: false for everything except flag_performance and flag_opportunity (those can be true)
- execution_data: { campaign_id, campaign_name, current_value, recommended_value } — include whatever is relevant to execute the action

EFFICIENCY MANDATE — STANDING STRATEGIC GOAL:
The long-term objective is to reduce total monthly ad spend while maintaining or growing lead volume. This means quality optimization beats volume buying. Specifically:
- Negative keywords are as valuable as positive ones — always flag irrelevant search terms burning budget
- Broad match waste is the #1 enemy — flag any broad/BMM keywords with high spend and low conversion rate
- Audience refinement over audience expansion — tighten who sees ads before spending more to reach more people
- Quality Score improvement (Google) reduces CPCs over time — flag low QS keywords and poor landing page relevance
- On Meta, creative refresh and narrow audiences beat broad reach — frequency waste is budget waste
- When recommending budget increases for winners, also recommend offsetting cuts to losers so net spend stays flat or decreases
- Track efficiency trend: if CPL is dropping month-over-month, that is the most important signal in the account

RULES:
- Never recommend pausing a campaign that is generating leads under $100 CPL
- Always explain your reasoning in terms of FPB's economics, not generic ad industry benchmarks
- If data is insufficient to make a confident recommendation, say so in the description and set priority to "low"
- Bias toward scaling winners over pausing losers — budget reallocation beats campaign elimination
- Kit sales growth is a standing strategic priority — weight kit-related recommendations higher
- When recommending a budget increase, always recommend an offsetting cut elsewhere so net spend is neutral or negative
- Proactively flag negative keyword opportunities and wasted spend — these are high-priority quick wins
- Always prefer efficiency improvements over spend increases as the first lever`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
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

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const startedAt = new Date().toISOString();

  try {
    // Derive base URL from request headers for internal fetches
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;

    // 1. Pull ad data
    const [googleData, metaData] = await Promise.all([
      fetchGoogleAds(baseUrl),
      fetchMetaAds(baseUrl),
    ]);

    const performanceData = {};
    if (googleData) performanceData.google_ads = googleData;
    if (metaData)   performanceData.meta_ads   = metaData;

    if (!googleData && !metaData) {
      return res.status(200).json({ success: false, error: 'No ad data available from either platform' });
    }

    // 2. Send to Claude
    const actions = await callClaude(performanceData);

    // 3. Insert actions into Supabase (with deduplication)
    let insertedCount = 0;
    let skippedCount  = 0;
    const totalCount  = Array.isArray(actions) ? actions.length : 0;

    if (totalCount > 0) {
      // Fetch all existing pending actions for dedup check
      const { data: existingPending } = await supabase
        .from('actions')
        .select('action_type, campaign_id, campaign_name')
        .eq('status', 'pending');

      const existingKeys = new Set(
        (existingPending || []).map(
          r => `${r.action_type}::${r.campaign_id || r.campaign_name || ''}`
        )
      );

      const rows = actions
        .map(a => ({
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

    // 4. Log the analysis run
    await supabase.from('automation_log').insert({
      event_type:  'analysis_run',
      description: `Analyzed ${Object.keys(performanceData).join(', ')}. Created ${insertedCount} recommended actions.`,
      status:      'complete',
      metadata:    { google_available: !!googleData, meta_available: !!metaData, total: totalCount, inserted: insertedCount, skipped: skippedCount },
    });

    // 5. Save performance snapshot (keep for backwards compatibility)
    await supabase.from('performance_snapshots').insert({
      snapshot_at:  startedAt,
      google_data:  googleData  || null,
      meta_data:    metaData    || null,
      actions_created: insertedCount,
    });

    // 6. Write per-campaign daily stats for attribution
    const today = startedAt.slice(0, 10);
    const statsPromises = [];
    if (googleData?.campaigns?.length > 0) {
      statsPromises.push(writeCampaignDailyStats(googleData.campaigns, 'google_ads', today));
    }
    if (metaData?.campaigns?.length > 0) {
      statsPromises.push(writeCampaignDailyStats(metaData.campaigns, 'meta_ads', today));
    }
    if (statsPromises.length > 0) {
      const statsResults = await Promise.all(statsPromises);
      const statsWritten = statsResults.reduce((sum, r) => sum + (r.written || 0), 0);
      const statsErrors  = statsResults.flatMap(r => r.errors || []);
      if (statsErrors.length > 0) {
        console.error('[campaign_daily_stats] write errors:', statsErrors);
      } else {
        console.log(`[campaign_daily_stats] wrote ${statsWritten} rows for ${today}`);
      }
    }

    return res.status(200).json({
      success: true,
      analyzed: Object.keys(performanceData),
      actions_created: insertedCount,
      actions,
    });

  } catch (error) {
    // Log failure
    try {
      await supabase.from('automation_log').insert({
        event_type:  'analysis_run',
        description: `Analysis failed: ${error.message}`,
        status:      'error',
        metadata:    { error: error.message },
      });
    } catch { /* swallow log errors */ }

    return res.status(500).json({ success: false, error: error.message });
  }
}
