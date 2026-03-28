import supabase from './lib/supabase.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function cors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — list actions
  if (req.method === 'GET') {
    const status = req.query?.status || 'pending';

    const { data, error } = await supabase
      .from('actions')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(200).json({ success: true, actions: data });
  }

  // POST — approve / reject / execute
  if (req.method === 'POST') {
    const { action, id } = req.body || {};

    if (!id) return res.status(400).json({ success: false, error: 'Missing action id' });

    if (action === 'approve') {
      const { data, error } = await supabase
        .from('actions')
        .update({ status: 'approved', reviewed_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) return res.status(500).json({ success: false, error: error.message });
      return res.status(200).json({ success: true, action: data });
    }

    if (action === 'reject') {
      const { data, error } = await supabase
        .from('actions')
        .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) return res.status(500).json({ success: false, error: error.message });
      return res.status(200).json({ success: true, action: data });
    }

    if (action === 'execute') {
      // Placeholder for future execution logic
      const { data, error } = await supabase
        .from('actions')
        .update({ status: 'executed', executed_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) return res.status(500).json({ success: false, error: error.message });
      return res.status(200).json({ success: true, action: data, note: 'Execution logic not yet implemented' });
    }

    return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
