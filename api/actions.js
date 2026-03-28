import supabase from './lib/supabase.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function cors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — list actions by status
  if (req.method === 'GET') {
    const status = req.query?.status || 'pending';

    const { data, error } = await supabase
      .from('actions')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(200).json({ success: true, data });
  }

  // PATCH /api/actions/:id — update status
  if (req.method === 'PATCH') {
    // Extract id from URL path: /api/actions/123
    const urlParts = (req.url || '').split('?')[0].split('/').filter(Boolean);
    const id = urlParts[urlParts.length - 1];

    const { status } = req.body || {};

    if (!id || id === 'actions') {
      return res.status(400).json({ success: false, error: 'Missing action id in URL' });
    }
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status: ${status}` });
    }

    const { data, error } = await supabase
      .from('actions')
      .update({ status, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(200).json({ success: true, data });
  }

  // POST — legacy approve/reject/execute via body action field
  if (req.method === 'POST') {
    const { action, id } = req.body || {};

    if (!id) return res.status(400).json({ success: false, error: 'Missing action id' });

    const statusMap = { approve: 'approved', reject: 'rejected', execute: 'executed' };
    const newStatus = statusMap[action];

    if (!newStatus) {
      return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
    }

    const extra = action === 'execute'
      ? { executed_at: new Date().toISOString() }
      : { reviewed_at: new Date().toISOString() };

    const { data, error } = await supabase
      .from('actions')
      .update({ status: newStatus, ...extra })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(200).json({ success: true, data });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
