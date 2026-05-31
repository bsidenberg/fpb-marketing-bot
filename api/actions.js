import supabase from './lib/supabase.js';
import { validateStatusPatch, inferPillar } from './lib/action-states.js';
import { resolveForRead, resolveForWrite } from './lib/accounts.js';
import { setCorsHeaders } from './lib/cors.js';
import { checkPostureForAction } from './lib/autonomy-coordinator.js';
import { detectNovelty, detectConflict, detectExternalFlag, detectAnomaly } from './lib/autonomy-escalation.js';
import { normalizeChannel } from './lib/normalize-channel.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'GET, POST, PATCH, OPTIONS', headers: 'Content-Type, x-account-slug' });
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — list actions by status (read; archived/inactive allowed)
  if (req.method === 'GET') {
    const account = await resolveForRead(req, res);
    if (!account) return;

    const status = req.query?.status || 'pending';

    const { data, error } = await supabase
      .from('actions')
      .select('*')
      .eq('account_id', account.id)
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(200).json({ success: true, data });
  }

  // PATCH /api/actions/:id — update status (write; ownership-checked)
  if (req.method === 'PATCH') {
    // Extract id from URL path: /api/actions/123
    const urlParts = (req.url || '').split('?')[0].split('/').filter(Boolean);
    const id = urlParts[urlParts.length - 1];

    const { status, executed_at, execution_result } = req.body || {};

    if (!id || id === 'actions') {
      return res.status(400).json({ success: false, error: 'Missing action id in URL' });
    }

    const account = await resolveForWrite(req, res);
    if (!account) return;

    // ── Fetch current row for transition validation + ownership check ─────────
    const { data: current, error: fetchErr } = await supabase
      .from('actions')
      .select('id, account_id, status, execution_result')
      .eq('id', id)
      .single();

    if (fetchErr || !current) {
      return res.status(404).json({ success: false, error: 'Action not found' });
    }

    if (current.account_id !== account.id) {
      return res.status(403).json({
        success: false,
        error:   'Action belongs to a different account',
        code:    'ACCOUNT_MISMATCH',
      });
    }

    const { valid, error: validationError } = validateStatusPatch(current, status);
    if (!valid) {
      return res.status(409).json({ success: false, error: validationError });
    }

    const updatePayload = { status, reviewed_at: new Date().toISOString() };
    if (executed_at)      updatePayload.executed_at      = executed_at;
    if (execution_result) updatePayload.execution_result = execution_result;

    const { data, error } = await supabase
      .from('actions')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(200).json({ success: true, data });
  }

  // POST — create a new pending action (write; rejects inactive/archived)
  if (req.method === 'POST' && req.body?.action_type && !req.body?.action) {
    const account = await resolveForWrite(req, res);
    if (!account) return;

    const {
      channel       = 'other',
      action_type,
      title         = 'Untitled',
      description   = '',
      priority      = 'medium',
      auto_execute  = false,
      execution_data = {},
    } = req.body;

    // ── Autonomy coordinator gate ─────────────────────────────────────────────
    const pillar = inferPillar(action_type);

    // Build escalation context from detectors
    const [novel, conflict] = await Promise.all([
      detectNovelty(action_type, account.id),
      detectConflict(account.id),
    ]);
    const context = {
      novel,
      conflict,
      anomaly:       detectAnomaly(),
      external_flag: detectExternalFlag(req.body),
      confidence:    req.body.confidence ?? undefined,
    };

    const { verdict, reason } = await checkPostureForAction(account.id, pillar, action_type, context);

    if (verdict === 'block') {
      return res.status(403).json({
        success: false,
        error:   `Action blocked by autonomy coordinator: ${reason}`,
        code:    'AUTONOMY_BLOCKED',
      });
    }

    // Force auto_execute=false when coordinator says require_approval
    const effectiveAutoExecute = verdict === 'allow_auto' ? (auto_execute === true) : false;
    const coordinatorMeta = { autonomy_verdict: verdict, ...(reason ? { autonomy_reason: reason } : {}) };

    const { data, error } = await supabase
      .from('actions')
      .insert({
        account_id:     account.id,
        channel:        normalizeChannel(channel),
        action_type,
        title,
        description,
        priority,
        auto_execute:   effectiveAutoExecute,
        execution_data: { ...execution_data, ...coordinatorMeta },
        status:         'pending',
      })
      .select()
      .single();

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(201).json({ success: true, data });
  }

  // POST — legacy approve/reject/execute via body action field
  // NOTE: legacy path sets status='executed' which bypasses validateStatusPatch.
  // Stage B1 keeps this behavior (per "no auth gap fixes" constraint) but
  // adds an ownership check so it can't mutate another account's actions.
  if (req.method === 'POST') {
    const { action, id } = req.body || {};

    if (!id) return res.status(400).json({ success: false, error: 'Missing action id' });

    const statusMap = { approve: 'approved', reject: 'rejected', execute: 'executed' };
    const newStatus = statusMap[action];

    if (!newStatus) {
      return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
    }

    const account = await resolveForWrite(req, res);
    if (!account) return;

    const { data: existing, error: fetchErr } = await supabase
      .from('actions')
      .select('id, account_id')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) {
      return res.status(404).json({ success: false, error: 'Action not found' });
    }

    if (existing.account_id !== account.id) {
      return res.status(403).json({
        success: false,
        error:   'Action belongs to a different account',
        code:    'ACCOUNT_MISMATCH',
      });
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
