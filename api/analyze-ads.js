import supabase from './lib/supabase.js';

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
  const systemPrompt = `You are an expert Google Ads and Meta Ads optimizer for Florida Pole Barn Kits, a pole barn kit supplier in Central Florida. Analyze the campaign performance data and return a JSON array of recommended actions. Each action should have: channel (google_ads or meta_ads), action_type (pause_campaign, pause_keyword, adjust_budget, adjust_bid, flag_performance, other), title (short action title), description (detailed explanation), priority (low, medium, high, critical), auto_execute (boolean - true only for flagging, false for everything else), execution_data (object with any IDs or values needed to execute). Rules: Flag any campaign with CPA over $50. Flag any campaign with CTR below 1%. Recommend pausing campaigns spending over $100 with 0 conversions. Recommend budget increases for campaigns with ROAS over 3x. Always respond with ONLY a valid JSON array, no other text.`;

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

    // 3. Insert actions into Supabase
    let insertedCount = 0;
    if (Array.isArray(actions) && actions.length > 0) {
      const rows = actions.map(a => ({
        channel:        a.channel        || 'other',
        action_type:    a.action_type    || 'other',
        title:          a.title          || 'Untitled',
        description:    a.description    || '',
        priority:       a.priority       || 'medium',
        auto_execute:   a.auto_execute   === true,
        execution_data: a.execution_data || {},
        status:         'pending',
      }));

      const { error: insertErr } = await supabase.from('actions').insert(rows);
      if (insertErr) throw new Error(`Supabase actions insert: ${insertErr.message}`);
      insertedCount = rows.length;
    }

    // 4. Log the analysis run
    await supabase.from('automation_log').insert({
      event_type:  'analysis_run',
      description: `Analyzed ${Object.keys(performanceData).join(', ')}. Created ${insertedCount} recommended actions.`,
      status:      'complete',
      metadata:    { google_available: !!googleData, meta_available: !!metaData, actions_created: insertedCount },
    });

    // 5. Save performance snapshot
    await supabase.from('performance_snapshots').insert({
      snapshot_at:  startedAt,
      google_data:  googleData  || null,
      meta_data:    metaData    || null,
      actions_created: insertedCount,
    });

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
