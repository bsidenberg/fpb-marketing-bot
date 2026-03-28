import supabase from './lib/supabase.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function cors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

function extractMetrics(platformData) {
  if (!platformData) return null;
  // Handles both flat columns and the JSON blob shape from analyze-ads.js
  const s = platformData.summary || platformData;
  return {
    spend:       parseFloat(s.totalSpend   ?? s.spend       ?? 0),
    impressions: parseInt(  s.totalImpressions ?? s.impressions ?? 0, 10),
    clicks:      parseInt(  s.totalClicks  ?? s.clicks      ?? 0, 10),
    conversions: parseFloat(s.totalConversions ?? s.conversions ?? 0),
    roas:        parseFloat(s.roas         ?? 0),
    cpl:         parseFloat(s.cpl          ?? 0),
    ctr:         parseFloat(s.ctr          ?? 0),
  };
}

function buildCombined(google, meta) {
  const g = google || { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
  const m = meta   || { spend: 0, impressions: 0, clicks: 0, conversions: 0 };

  const spend       = g.spend       + m.spend;
  const impressions = g.impressions + m.impressions;
  const clicks      = g.clicks      + m.clicks;
  const conversions = g.conversions + m.conversions;
  const ctr         = impressions > 0 ? ((clicks / impressions) * 100) : 0;
  const cpc         = clicks > 0      ? (spend / clicks)              : 0;
  const roas        = spend > 0       ? (conversions * 150 / spend)   : 0;

  return { spend, impressions, clicks, conversions, ctr, cpc, roas };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const history = req.query?.history === 'true';

  if (history) {
    const { data, error } = await supabase
      .from('performance_snapshots')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(200).json({ success: true, data });
  }

  // Most recent snapshot
  const { data, error } = await supabase
    .from('performance_snapshots')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    // No rows yet — return empty structure
    if (error.code === 'PGRST116') {
      return res.status(200).json({ success: true, data: null });
    }
    return res.status(500).json({ success: false, error: error.message });
  }

  const google = extractMetrics(data.google_data);
  const meta   = extractMetrics(data.meta_data);
  const combined = buildCombined(google, meta);

  return res.status(200).json({
    success: true,
    data: {
      google,
      meta,
      combined,
      snapshot_at:  data.snapshot_at  || data.created_at,
      created_at:   data.created_at,
    },
  });
}
