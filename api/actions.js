import supabase from './lib/supabase.js';
import { validateStatusPatch, inferPillar } from './lib/action-states.js';
import { resolveForRead, resolveForWrite, getConnectionForAccount } from './lib/accounts.js';
import { setCorsHeaders } from './lib/cors.js';
import { checkPostureForAction } from './lib/autonomy-coordinator.js';
import { detectNovelty, detectConflict, detectExternalFlag, detectAnomaly } from './lib/autonomy-escalation.js';
import { normalizeChannel } from './lib/normalize-channel.js';
import { requireAdmin } from './lib/require-admin.js';
import { guardNegativeKeywordExecutionData } from './lib/negative-keyword-guard.js';
import { verifyAndEnrichAction } from './chat.js';
import { fetchGoogleAdsData } from './google-ads.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'GET, POST, PATCH, OPTIONS', headers: 'Content-Type, x-account-slug' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAdmin(req, res)) return;

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

    const { status, executed_at, result } = req.body || {};

    if (!id || id === 'actions') {
      return res.status(400).json({ success: false, error: 'Missing action id in URL' });
    }

    const account = await resolveForWrite(req, res);
    if (!account) return;

    // ── Fetch current row for transition validation + ownership check ─────────
    const { data: current, error: fetchErr } = await supabase
      .from('actions')
      .select('id, account_id, status, result')
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
    if (result) updatePayload.result = result;

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

    // ── S07e fix: server-side campaign verification for add_negative_keyword ──
    // Mirrors the same verification api/chat.js runs before staging a negative
    // keyword action — a client-supplied campaign_id/campaign_name must never
    // reach a 'pending' row unverified against live Google Ads data.
    let verifiedExecutionData = execution_data;
    let campaignVerificationStatus = null;
    let campaignVerificationReason = null;
    if (action_type === 'add_negative_keyword') {
      let campaigns = null;
      try {
        const gConn = await getConnectionForAccount(account.id, 'google_ads');
        if (gConn) {
          const googleData = await fetchGoogleAdsData(account, gConn);
          campaigns = googleData?.success ? googleData.campaigns : null;
        }
      } catch (_e) { /* non-fatal — falls through to unverified below */ }

      const verifyInput = {
        action_type,
        channel:       'google_ads',
        campaign_id:   execution_data.campaign_id   || null,
        campaign_name: execution_data.campaign_name || null,
        keyword_text:  execution_data.keyword_text  || null,
        match_type:    execution_data.match_type    || null,
        current_value: execution_data.current_value || null,
        description,
      };
      const { payload: verifiedPayload, status } = verifyAndEnrichAction(verifyInput, campaigns);
      campaignVerificationStatus = status;
      campaignVerificationReason = verifiedPayload?.description || null;

      verifiedExecutionData = {
        ...execution_data,
        campaign_id: verifiedPayload.campaign_id || null,   // server-verified, never the client-supplied raw value if it was corrected/rejected
        budget_id:   null,                                   // negative keywords never need budget_id — never trust a client-supplied one
      };
    }

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
      execution_data, // SESSION-05: budget-guard staging consult (magnitude/protection)
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

    // Terminal, bypass-proof guard — checked on the fully-assembled
    // execution_data right before the insert, regardless of which client
    // path (chat ACTION card fallback, direct API call, etc.) built it.
    const finalExecutionData = { ...verifiedExecutionData, ...coordinatorMeta };
    const guard = guardNegativeKeywordExecutionData(action_type, finalExecutionData);
    const campaignUnverified = campaignVerificationStatus === 'unverified';
    const finalStatus = (guard.ok && !campaignUnverified) ? 'pending' : 'requires_review';
    const finalDescription = finalStatus === 'pending'
      ? description
      : (!guard.ok ? `[UNVERIFIED - ${guard.reason}] ${description || ''}`.trim() : campaignVerificationReason);

    const { data, error } = await supabase
      .from('actions')
      .insert({
        account_id:     account.id,
        channel:        normalizeChannel(channel),
        action_type,
        title,
        description:    finalDescription,
        priority,
        auto_execute:   effectiveAutoExecute,
        execution_data: finalExecutionData,
        status:         finalStatus,
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
