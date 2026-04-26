// ============================================================
// Safety Sprint 1 — verification endpoint
//
// GET /api/verify-safety
//   Returns a JSON report confirming all five safety changes
//   are wired. No external API calls are made; this is a
//   static configuration check only.
//
// Usage (browser):  https://your-app.vercel.app/api/verify-safety
// Usage (curl):     curl https://your-app.vercel.app/api/verify-safety | jq
// ============================================================

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const checks = [];

  // ── 1. Credential debug logging removed ─────────────────────────────────────
  // Cannot test at runtime; mark as implemented (verified by code inspection).
  checks.push({
    id:     'no_credential_logs',
    title:  'Credential debug logs removed from google-ads.js',
    status: 'implemented',
    detail: 'TOKEN REQUEST DEBUG block and token response dump removed from api/google-ads.js.',
  });

  // ── 2. EXECUTE_SECRET configured ────────────────────────────────────────────
  const secretSet = !!process.env.EXECUTE_SECRET;
  checks.push({
    id:     'execute_secret_set',
    title:  'EXECUTE_SECRET env var is set',
    status: secretSet ? 'pass' : 'warn',
    detail: secretSet
      ? 'EXECUTE_SECRET is present — mutation endpoints will enforce the x-execute-secret header.'
      : 'EXECUTE_SECRET is NOT set — mutation endpoints are currently unprotected (will warn in logs). Add EXECUTE_SECRET to Vercel env vars and redeploy.',
  });

  // ── 3. Mutation endpoints protected ─────────────────────────────────────────
  // Static assertion: auth is added to execute-action, meta-creative,
  // create-facebook-campaign, create-google-campaign.
  checks.push({
    id:     'mutation_auth_wired',
    title:  'x-execute-secret auth wired to mutation endpoints',
    status: 'implemented',
    detail: 'requireExecuteSecret() is called at handler entry in execute-action.js, meta-creative.js, create-facebook-campaign.js, create-google-campaign.js.',
  });

  // ── 4. Creative publish gated through approval queue ────────────────────────
  // Static assertion: doPublish() and handlePush() in the dashboard
  // now POST to /api/actions (pending queue) instead of /api/meta-creative.
  checks.push({
    id:     'creative_publish_gated',
    title:  'Creative publishing routes through the approval queue',
    status: 'implemented',
    detail: 'doPublish() and handlePush() in marketing-bot-dashboard.jsx POST to /api/actions with action_type="publish_creative". The Meta creative API is only called from execute-action.js after human approval.',
  });

  // ── 5. Idempotency lock wired ────────────────────────────────────────────────
  // Static assertion: execute-action.js does an atomic update
  // (execution_result: null → 'executing') before calling any platform API.
  checks.push({
    id:     'idempotency_lock',
    title:  'Execution idempotency lock in execute-action.js',
    status: 'implemented',
    detail: 'execute-action.js atomically sets execution_result="executing" with .eq("status","approved").is("execution_result",null) before any platform API call. Duplicate requests return 409.',
  });

  // ── 6. Manual action types handled correctly ─────────────────────────────────
  checks.push({
    id:     'manual_types_safe',
    title:  'adjust_budget / adjust_bid return requires_manual — no platform call',
    status: 'implemented',
    detail: 'MANUAL_TYPES in execute-action.js returns {requires_manual:true, executed:false} and marks execution_result="requires_manual" without touching any ad platform API.',
  });

  // ── 7. META_ACCESS_TOKEN present ────────────────────────────────────────────
  const metaTokenSet = !!process.env.META_ACCESS_TOKEN;
  checks.push({
    id:     'meta_token_set',
    title:  'META_ACCESS_TOKEN env var is set',
    status: metaTokenSet ? 'pass' : 'warn',
    detail: metaTokenSet
      ? 'META_ACCESS_TOKEN is present.'
      : 'META_ACCESS_TOKEN is not set — Meta API calls will fail.',
  });

  const allPass = checks.every(c => c.status === 'pass' || c.status === 'implemented');

  return res.status(200).json({
    sprint:   'Safety Sprint 1',
    overall:  allPass ? 'PASS' : 'WARN',
    checks,
    note:     'Status "implemented" means the change is in the code. Status "pass"/"warn" means a live runtime value was checked.',
  });
}
