import supabase from './lib/supabase.js';

export default async function handler(req, res) {
  // Vercel cron jobs send x-vercel-cron: 1
  // Optionally also accept a CRON_SECRET via Authorization header
  const cronHeader = req.headers['x-vercel-cron'];
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;

  const validCronHeader = cronHeader === '1';
  const validSecret     = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!validCronHeader && !validSecret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const startedAt = new Date().toISOString();

  try {
    // Derive base URL the same way analyze-ads.js does
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host     = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl  = `${protocol}://${host}`;

    // Call analyze-ads internally — it handles Google/Meta fetch, Claude, Supabase inserts
    const analyzeRes = await fetch(`${baseUrl}/api/analyze-ads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Pass the cron header so analyze-ads can identify the caller if needed
        'x-triggered-by': 'cron',
      },
    });

    const analyzeJson = await analyzeRes.json();

    if (!analyzeJson.success) {
      throw new Error(analyzeJson.error || 'analyze-ads returned failure');
    }

    // Log success
    await supabase.from('automation_log').insert({
      event_type:  'cron_analysis',
      status:      'complete',
      description: `Daily scheduled analysis completed. Actions created: ${analyzeJson.actions_created ?? 0}`,
      created_at:  startedAt,
    });

    return res.status(200).json({ success: true, message: 'Analysis triggered', result: analyzeJson });

  } catch (error) {
    // Log failure
    try {
      await supabase.from('automation_log').insert({
        event_type:  'cron_analysis',
        status:      'error',
        description: error.message,
        created_at:  startedAt,
      });
    } catch { /* swallow log errors */ }

    return res.status(500).json({ success: false, error: error.message });
  }
}
