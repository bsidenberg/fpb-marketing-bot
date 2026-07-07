// ============================================================
// api/chat.js — Conversational AI assistant
//
// Stage B1 retrofit:
//   • Account-scoped: resolves account from ?account or x-account-slug
//     (defaults to FPB). GET uses resolveForRead (archived/inactive OK
//     so dashboards can still read history). POST uses resolveForWrite
//     (rejects archived and inactive — chat is a write/cost-incurring op).
//   • chat_messages table existence preflight: before any Anthropic call
//     (including intent detection — we do not burn tokens when persistence
//     is broken). If the table is missing, returns 503 FEATURE_NOT_CONFIGURED
//     and logs a failed ai_analysis_runs row for visibility.
//   • ai_analysis_runs lifecycle (pending → running → succeeded/failed) is
//     logged around the main Claude call. Best-effort — logging failure
//     never kills the request.
//   • All chat_messages writes carry account_id.
//   • Internal /api/google-ads + /api/facebook-ads fetches pass
//     ?account=<slug> explicitly to prevent fallthrough to default FPB.
//
// NOTE: the chat_messages table does NOT currently exist in production.
// In that environment, POST returns 503 FEATURE_NOT_CONFIGURED on every
// request. Local dev can run the migration in the header comment below.
//
// ============================================================
// Supabase migration — run in Supabase SQL editor:
//
// CREATE TABLE chat_messages (
//   id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
//   created_at   timestamptz DEFAULT now(),
//   account_id   uuid        NOT NULL REFERENCES accounts(id),
//   role         text        NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
//   content      text        NOT NULL,
//   message_type text        NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'action_request', 'fetching')),
//   action_payload jsonb     NULL,
//   session_id   text        NOT NULL,
//   image_data   text        NULL
// );
// CREATE INDEX chat_messages_session_id_idx ON chat_messages (session_id, created_at ASC);
// CREATE INDEX chat_messages_account_idx    ON chat_messages (account_id, created_at DESC);
// ============================================================

import supabase from './lib/supabase.js';
import { getFpbChatSystemPrompt, FPB_SYSTEM_PROMPT_VERSION } from './lib/prompts/fpb.js';
import { resolveForRead, resolveForWrite, getConnectionForAccount } from './lib/accounts.js';
import { setCorsHeaders } from './lib/cors.js';
import { checkRateLimit } from './lib/rate-limit.js';
import { recordAnthropicCost } from './lib/anthropic-cost.js';
import { normalizeChannel } from './lib/normalize-channel.js';
import { inferPillar } from './lib/action-states.js';
import { checkPostureForAction } from './lib/autonomy-coordinator.js';
import { detectNovelty, detectConflict, detectExternalFlag, detectAnomaly } from './lib/autonomy-escalation.js';
import { requireAdmin } from './lib/require-admin.js';
import { fetchGoogleAdsData, fetchSearchTerms } from './google-ads.js';
import { fetchMetaAdsData } from './facebook-ads.js';
import { guardNegativeKeywordExecutionData, VALID_NEGATIVE_MATCH_TYPES } from './lib/negative-keyword-guard.js';

const CHAT_MODEL = 'claude-sonnet-4-6';

// S07b: waste/search-term questions additionally trigger a search_term_view
// fetch (whole-account) so Prime can recommend evidenced negative keywords.
const WASTE_QUESTION_RE = /waste|search term|junk|negative keyword|wasted spend/i;

// S07e: cap on terms accepted per add_negative_keyword_batch ACTION block.
const MAX_BATCH_TERMS = 25;

// ── chat_messages table existence preflight ──────────────────────────────────
// Returns true if the table exists (or appears to), false if it is missing.
// "Missing" matches PGRST205 (PostgREST schema cache miss) or the literal
// Postgres "relation ... does not exist" message. Any other error is treated
// as "exists" so callers fail loudly downstream rather than masking bugs.

async function chatMessagesTableExists() {
  const { error } = await supabase
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .limit(1);
  if (!error) return true;
  if (error.code === 'PGRST205') return false;
  if (typeof error.message === 'string' && /relation .* does not exist/i.test(error.message)) return false;
  return true;
}

// ── ai_analysis_runs lifecycle (best-effort logging) ─────────────────────────

async function insertChatRunPending(account, sessionId) {
  try {
    const { data, error } = await supabase
      .from('ai_analysis_runs')
      .insert({
        account_id:      account.id,
        model_provider:  'anthropic',
        model_name:      CHAT_MODEL,
        prompt_version:  FPB_SYSTEM_PROMPT_VERSION,
        status:          'pending',
        input_summary_json: {
          triggered_by: 'chat',
          session_id:   sessionId,
        },
      })
      .select()
      .single();
    if (error) {
      console.error('[chat] ai_analysis_runs insert failed:', error.message);
      return null;
    }
    return data?.id || null;
  } catch (err) {
    console.error('[chat] ai_analysis_runs insert threw:', err.message);
    return null;
  }
}

async function updateChatRunStatus(runId, patch) {
  if (!runId) return;
  try {
    const { error } = await supabase
      .from('ai_analysis_runs')
      .update(patch)
      .eq('id', runId);
    if (error) console.error('[chat] ai_analysis_runs update failed:', error.message);
  } catch (err) {
    console.error('[chat] ai_analysis_runs update threw:', err.message);
  }
}

async function logFailedChatRun(account, errorMessage, sessionId) {
  try {
    const { error } = await supabase
      .from('ai_analysis_runs')
      .insert({
        account_id:      account.id,
        model_provider:  'anthropic',
        model_name:      CHAT_MODEL,
        prompt_version:  FPB_SYSTEM_PROMPT_VERSION,
        status:          'failed',
        error:           errorMessage,
        input_summary_json: {
          triggered_by: 'chat',
          session_id:   sessionId,
        },
      });
    if (error) {
      console.error('[chat] failed ai_analysis_runs insert failed:', error.message);
    }
  } catch (err) {
    console.error('[chat] failed ai_analysis_runs insert threw:', err.message);
  }
}

// ── Claude fetch helper ──────────────────────────────────────────────────────
async function callClaude({ model, system, messages, max_tokens }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({ model, system, messages, max_tokens }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.substring(0, 200)}`);
  }
  return res.json();
}

// ── Intent detection ─────────────────────────────────────────────────────────
async function detectIntent(message, conversationHistory = [], accountId = null) {
  // Include the last assistant turn as context so short affirmatives ("yes do it",
  // "go ahead") following a data analysis are correctly classified as DATA_QUESTION
  // rather than STRATEGY.
  const lastAssistant = [...(conversationHistory || [])].reverse().find(m => m.role === 'assistant');
  const contextSuffix = lastAssistant
    ? `\n\nFor context, the prior assistant message began: "${String(lastAssistant.content).substring(0, 300)}"`
    : '';

  const json = await callClaude({
    model:      'claude-haiku-4-5',
    max_tokens: 10,
    system:     'Classify this message into one of three intents: DATA_QUESTION (needs live ad performance data to answer), ACTION_REQUEST (user wants to make a change to a campaign), STRATEGY (general advice, explanation, or question that does not need live data). If the message is a short affirmative ("yes", "do it", "go ahead", "sounds good", "proceed") following a prior data analysis in the conversation, classify as DATA_QUESTION. Respond with only one word: DATA_QUESTION, ACTION_REQUEST, or STRATEGY.',
    messages:   [{ role: 'user', content: message + contextSuffix }],
  });
  // Cost ledger — fire-and-forget
  await recordAnthropicCost(json, accountId, 'intent_detection');
  const word = (json.content?.[0]?.text || '').trim().toUpperCase();
  if (['DATA_QUESTION', 'ACTION_REQUEST', 'STRATEGY'].includes(word)) return word;
  return 'STRATEGY'; // safe default
}

// ── Live ad data fetch via named imports (bypasses HTTP + requireAdmin gate) ──
async function fetchAdData(account, googleConn, metaConn) {
  const [gResult, mResult] = await Promise.allSettled([
    googleConn ? fetchGoogleAdsData(account, googleConn) : Promise.resolve(null),
    metaConn   ? fetchMetaAdsData(account, metaConn)     : Promise.resolve(null),
  ]);

  const googleData = gResult.status === 'fulfilled' ? gResult.value : null;
  const metaData   = mResult.status === 'fulfilled' ? mResult.value : null;

  return {
    google: googleData?.success ? googleData : null,
    meta:   metaData?.success   ? metaData   : null,
  };
}

// ── Parse ACTION block from Claude response ──────────────────────────────────
function parseActionBlock(text) {
  const match = text.match(/^ACTION:(\{.+\})\s*$/m);
  if (!match) return { displayText: text, actionPayload: null };

  let actionPayload = null;
  try {
    actionPayload = JSON.parse(match[1]);
  } catch { /* malformed JSON — treat as text */ }

  const displayText = text.replace(/^ACTION:\{.+\}\s*$/m, '').trim();
  return { displayText, actionPayload };
}

// ── Parse CREATIVE_READY flag from Claude response ───────────────────────────
function parseCreativeReady(text) {
  const match = text.match(/CREATIVE_READY:(true|false)/i);
  if (!match) return { displayText: text, creativeReady: null };
  const creativeReady = match[1].toLowerCase() === 'true';
  const displayText = text.replace(/\n?CREATIVE_READY:(true|false)/i, '').trim();
  return { displayText, creativeReady };
}

// ── Verify and enrich a google_ads ACTION payload against live campaign data ──
// Pure function — never mutates the input payload.
// Non-google_ads payloads are returned unchanged (status: 'passthrough').
// Matching priority: exact campaign_id → single campaign_name → unverified.
export function verifyAndEnrichAction(actionPayload, fetchedCampaigns) {
  const result = verifyAndEnrichActionByCampaign(actionPayload, fetchedCampaigns);

  if (actionPayload && actionPayload.action_type === 'add_negative_keyword') {
    // S07c: fail-early staging guard — an empty/missing keyword_text must
    // never reach the executor (it throws there with a cryptic error).
    // Catch it here, at staging, with a legible reason instead.
    const keywordText = typeof actionPayload.keyword_text === 'string' ? actionPayload.keyword_text.trim() : '';
    if (!keywordText) {
      return {
        payload: {
          ...result.payload,
          description: `[UNVERIFIED - negative keyword action missing keyword_text] ${result.payload?.description || ''}`.trim(),
        },
        status: 'unverified',
      };
    }

    // S07b: additional gate for add_negative_keyword — an invalid match_type
    // (present but not BROAD/PHRASE/EXACT) downgrades to 'unverified' regardless
    // of the campaign id/name match above. Absent match_type is NOT downgraded —
    // the executor already defaults it to 'BROAD'.
    if (actionPayload.match_type != null) {
      const normalized = String(actionPayload.match_type).toUpperCase();
      if (!VALID_NEGATIVE_MATCH_TYPES.includes(normalized)) {
        return {
          payload: {
            ...result.payload,
            description: `[UNVERIFIED - invalid match_type "${actionPayload.match_type}", expected BROAD/PHRASE/EXACT] ${result.payload?.description || ''}`.trim(),
          },
          status: 'unverified',
        };
      }
      // Store the canonical uppercase enum — Google's API rejects lowercase
      // (e.g. "broad") even though it passes this validation case-insensitively.
      return { ...result, payload: { ...result.payload, match_type: normalized } };
    }
  }

  return result;
}

function verifyAndEnrichActionByCampaign(actionPayload, fetchedCampaigns) {
  if (!actionPayload || actionPayload.channel !== 'google_ads') {
    return { payload: actionPayload, status: 'passthrough' };
  }

  const campaigns = Array.isArray(fetchedCampaigns) ? fetchedCampaigns : [];

  if (campaigns.length === 0) {
    return {
      payload: {
        ...actionPayload,
        description: `[UNVERIFIED - campaign not found in live data] ${actionPayload.description || ''}`.trim(),
      },
      status: 'unverified',
    };
  }

  // ID match — most reliable path
  const idMatch = campaigns.find(c => String(c.id) === String(actionPayload.campaign_id));
  if (idMatch) {
    return {
      payload: {
        ...actionPayload,
        // Use only the verified live budget_id; null lets execute-action-logic derive it safely.
        // Never fall back to the LLM-supplied value — it is unverified and could target a
        // different campaign's budget in the fast-path mutator.
        budget_id:     idMatch.budget_id     || null,
        current_value: actionPayload.current_value || idMatch.daily_budget  || null,
      },
      status: 'id_match',
    };
  }

  // Name match — exactly one campaign must match
  if (actionPayload.campaign_name) {
    const nameMatches = campaigns.filter(c => c.name === actionPayload.campaign_name);
    if (nameMatches.length === 1) {
      const m = nameMatches[0];
      return {
        payload: {
          ...actionPayload,
          campaign_id:   String(m.id),
          budget_id:     m.budget_id     || null,  // verified live value only
          current_value: actionPayload.current_value || m.daily_budget  || null,
          description:   `${actionPayload.description || ''} (campaign_id corrected from model output by server verification)`.trim(),
        },
        status: 'name_match',
      };
    }
  }

  // Neither matches — flag for manual review; never silently pass an unverifiable ID
  return {
    payload: {
      ...actionPayload,
      description: `[UNVERIFIED - campaign not found in live data] ${actionPayload.description || ''}`.trim(),
    },
    status: 'unverified',
  };
}

// ── Parse AD_PREVIEW block from Claude response ───────────────────────────────
function parseAdPreview(text) {
  const match = text.match(/^AD_PREVIEW:(\{.+\})\s*$/m);
  if (!match) return { displayText: text, adPreview: null };
  let adPreview = null;
  try {
    adPreview = JSON.parse(match[1]);
  } catch { /* malformed — treat as text */ }
  const displayText = text.replace(/^AD_PREVIEW:\{.+\}\s*$/m, '').trim();
  return { displayText, adPreview };
}

// ── Stage a single google_ads/ACTION-block action ─────────────────────────────
// Runs the full per-action safety pipeline (coordinator gate → verify/enrich →
// terminal negative-keyword guard → insert) for exactly one action. Used by
// both the single-ACTION path and the batch-expansion loop so there is only
// one insert path to keep safe, not two that can drift apart.
async function stageGoogleAdsAction(actionPayload, account, fetchedCampaigns) {
  const pillar = inferPillar(actionPayload.action_type);
  const [novel, conflict] = await Promise.all([
    detectNovelty(actionPayload.action_type, account.id),
    detectConflict(account.id),
  ]);
  const context = {
    novel, conflict, anomaly: detectAnomaly(), external_flag: detectExternalFlag(actionPayload),
    execution_data: {
      campaign_id:       actionPayload.campaign_id       || null,
      current_value:     actionPayload.current_value     || null,
      recommended_value: actionPayload.recommended_value || null,
    },
  };
  const { verdict } = await checkPostureForAction(account.id, pillar, actionPayload.action_type, context);
  if (verdict === 'block') return { savedActionId: null, status: null, blocked: true };

  // Verify google_ads campaign IDs against live data before saving. An
  // add_negative_keyword ACTION is ALWAYS verified/guarded here too, even if
  // the model supplied a missing/wrong channel — this closes the S07e
  // channel-gate bypass that let malformed negative-keyword rows through.
  // If this turn didn't already fetch ad data, fetch server-side solely for verification.
  let actionForInsert = actionPayload;
  let verificationStatus = 'passthrough';
  if (actionPayload.channel === 'google_ads' || actionPayload.action_type === 'add_negative_keyword') {
    let campaigns = fetchedCampaigns;
    if (!campaigns) {
      try {
        const gConnForVerify = await getConnectionForAccount(account.id, 'google_ads');
        if (gConnForVerify) {
          const googleData = await fetchGoogleAdsData(account, gConnForVerify);
          campaigns = googleData?.success ? googleData.campaigns : null;
        }
      } catch (_verifyErr) { /* non-fatal — proceed as unverified */ }
    }
    ({ payload: actionForInsert, status: verificationStatus } = verifyAndEnrichAction(actionPayload, campaigns));
  }

  const executionData = {
    campaign_id:       actionForInsert.campaign_id       || null,
    campaign_name:     actionForInsert.campaign_name     || null,
    budget_id:         actionForInsert.budget_id         || null,
    current_value:     actionForInsert.current_value     || null,
    recommended_value: actionForInsert.recommended_value || null,
    keyword_text:      actionForInsert.keyword_text       || null,
    match_type:        actionForInsert.match_type         || null,
    evidence:          actionForInsert.evidence           || null,
  };

  // Terminal guard — checked on the fully-assembled execution_data right
  // before the insert, regardless of how actionForInsert got here.
  const guard = guardNegativeKeywordExecutionData(actionForInsert.action_type, executionData);
  const finalStatus = (!guard.ok || verificationStatus === 'unverified') ? 'requires_review' : 'pending';
  const description = guard.ok
    ? (actionForInsert.description || '')
    : `[UNVERIFIED - ${guard.reason}] ${actionForInsert.description || ''}`.trim();

  const { data: actionRow, error: actionErr } = await supabase
    .from('actions')
    .insert({
      account_id:     account.id,
      channel:        normalizeChannel(actionForInsert.channel || 'other'),
      action_type:    actionForInsert.action_type,
      title:          (actionForInsert.action_type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      description,
      priority:       actionForInsert.priority || 'medium',
      auto_execute:   false,
      execution_data: executionData,
      status:         finalStatus,
    })
    .select('id')
    .single();

  if (actionErr) {
    console.error('[chat] action row creation failed:', actionErr.message);
    return { savedActionId: null, status: null, blocked: false };
  }
  return { savedActionId: actionRow?.id || null, status: finalStatus, blocked: false };
}

// ── Stage a batch of negative-keyword terms (add_negative_keyword_batch) ─────
// Expands a single add_negative_keyword_batch ACTION block into N individual
// add_negative_keyword rows, each run through the same stageGoogleAdsAction
// safety pipeline (coordinator gate → verify/enrich → terminal guard → insert)
// as a single-term ACTION. Replaces the old one-term-per-turn "say next"
// prompt convention with server-side expansion.
async function stageNegativeKeywordBatch(batchPayload, account, fetchedGoogleCampaigns) {
  const rawTerms = Array.isArray(batchPayload.terms) ? batchPayload.terms : [];
  const validTerms = rawTerms.filter(t => t && typeof t.keyword_text === 'string' && t.keyword_text.trim());
  const terms = validTerms.slice(0, MAX_BATCH_TERMS);
  const droppedCount = validTerms.length - terms.length;

  if (terms.length === 0) {
    return { summaryText: 'No valid terms were provided to stage as negative keywords.', staged: 0, requiresReview: 0 };
  }

  // Resolve live campaign data ONCE, server-side — reused unmodified S06 logic
  // inside stageGoogleAdsAction/verifyAndEnrichAction per item. Never trust the
  // model's campaign_name/campaign_id directly.
  let campaigns = fetchedGoogleCampaigns;
  if (!campaigns) {
    try {
      const gConn = await getConnectionForAccount(account.id, 'google_ads');
      if (gConn) {
        const googleData = await fetchGoogleAdsData(account, gConn);
        campaigns = googleData?.success ? googleData.campaigns : null;
      }
    } catch (_e) { /* non-fatal — items resolve as unverified below */ }
  }

  let staged = 0;
  let requiresReview = 0;

  for (const term of terms) {
    const itemPayload = {
      action_type:   'add_negative_keyword',
      channel:       'google_ads', // server-authoritative — never trust the batch wrapper's channel
      campaign_id:   batchPayload.campaign_id   || null,
      campaign_name: batchPayload.campaign_name || null,
      keyword_text:  term.keyword_text.trim(),
      match_type:    term.match_type || batchPayload.match_type || 'BROAD',
      description:   term.description || `Negate '${term.keyword_text.trim()}' — batch negative keyword request.`,
      evidence:      term.evidence || null,
    };

    try {
      const { status } = await stageGoogleAdsAction(itemPayload, account, campaigns);
      if (status === 'requires_review') requiresReview++;
      else if (status === 'pending') staged++;
      // status === null (blocked or insert error): counted in neither — matches
      // existing single-action behavior where a blocked/failed item just doesn't land.
    } catch (_e) { /* one bad term must never abort the rest of the batch */ }
  }

  const parts = [];
  if (staged)           parts.push(`${staged} staged for approval`);
  if (requiresReview)   parts.push(`${requiresReview} flagged for manual review (campaign or keyword could not be verified)`);
  if (droppedCount > 0) parts.push(`${droppedCount} term(s) beyond the ${MAX_BATCH_TERMS}-term cap were not staged — resend the remainder in a new message`);

  return {
    summaryText: `Batch negative-keyword request processed: ${parts.join('; ')}. Review and approve in the Actions queue.`,
    staged,
    requiresReview,
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'GET, POST, OPTIONS', headers: 'Content-Type, x-account-slug' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAdmin(req, res)) return;

  // ── GET — load session history ────────────────────────────────────────────
  if (req.method === 'GET') {
    const sessionId = req.query?.sessionId;
    if (!sessionId) return res.status(400).json({ success: false, error: 'Missing sessionId' });

    const account = await resolveForRead(req, res);
    if (!account) return;

    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('account_id', account.id)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(200).json({ success: true, messages: data });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // ── POST — validate body, resolve account, preflight, then run ────────────
  const { message, sessionId, conversationHistory = [], includeAdData = false, imageData = null } = req.body || {};

  if (!message)   return res.status(400).json({ success: false, error: 'Missing message' });
  if (!sessionId) return res.status(400).json({ success: false, error: 'Missing sessionId' });

  const account = await resolveForWrite(req, res);
  if (!account) return;

  // Rate limit (Sub-Task 6.4): per-account guard on the highest-cost
  // endpoint so one account cannot exhaust Anthropic budget for others.
  const rl = checkRateLimit(account.id);
  if (!rl.allowed) {
    console.warn(
      `[RATE-LIMIT-EXCEEDED] /api/chat account=${account.slug} count=${rl.count} limit=${rl.limit}`
    );
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return res.status(429).json({
      success: false,
      error:   `Rate limit exceeded — max ${rl.limit} chat requests per minute. Retry in ${rl.retryAfterSec}s.`,
      code:    'RATE_LIMIT_EXCEEDED',
    });
  }

  // Preflight chat_messages table existence. If missing, log a failed AI run
  // and bail with 503 — never burn Anthropic tokens when persistence is broken.
  const tableOk = await chatMessagesTableExists();
  if (!tableOk) {
    const errorMessage = 'FEATURE_NOT_CONFIGURED: chat_messages table does not exist';
    await logFailedChatRun(account, errorMessage, sessionId);
    return res.status(503).json({
      success: false,
      error:   'Chat feature is not currently configured. The chat_messages table has not been created in this environment.',
      code:    'FEATURE_NOT_CONFIGURED',
    });
  }

  try {
    // ── Step 1: Intent detection (skip if client already knows to include ad data) ──
    let intent = includeAdData ? 'DATA_QUESTION' : await detectIntent(message, conversationHistory, account.id);

    // ── Step 2: If DATA_QUESTION and not yet fetching, signal the frontend ──
    if (intent === 'DATA_QUESTION' && !includeAdData) {
      await supabase.from('chat_messages').insert({
        account_id:   account.id,
        role:         'assistant',
        content:      'Fetching live ad data…',
        message_type: 'fetching',
        session_id:   sessionId,
      });
      return res.status(200).json({ type: 'fetching', sessionId });
    }

    // ── Step 3: Optionally attach live ad data to user message ──
    let userContent = message;
    let fetchedGoogleCampaigns = null;
    if (includeAdData) {
      const [gConn, mConn] = await Promise.all([
        getConnectionForAccount(account.id, 'google_ads'),
        getConnectionForAccount(account.id, 'meta_ads'),
      ]);
      const { google, meta } = await fetchAdData(account, gConn, mConn);
      fetchedGoogleCampaigns = google?.campaigns || null;

      const dataParts = [];
      if (google) dataParts.push(`GOOGLE ADS DATA:\n${JSON.stringify(google, null, 2)}`);
      if (meta)   dataParts.push(`META ADS DATA:\n${JSON.stringify(meta, null, 2)}`);

      // S07b: additive waste-keyword trigger — whole-account search-term view.
      if (WASTE_QUESTION_RE.test(message) && gConn) {
        const searchTermsResult = await fetchSearchTerms(account, gConn);
        if (searchTermsResult.success) {
          dataParts.push(`SEARCH TERMS (waste analysis):\n${JSON.stringify(searchTermsResult, null, 2)}`);
        }
      }

      if (dataParts.length > 0) {
        userContent = `${message}\n\n--- LIVE AD DATA ---\n${dataParts.join('\n\n')}`;
      }
    }

    // ── Step 4: Build messages array (last 20 turns + current) ──
    const history = (conversationHistory || []).slice(-20).map(m => ({
      role:    m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content),
    }));

    // If an image was uploaded, append analysis instructions to the text
    let finalUserText = userContent;
    if (imageData?.base64) {
      finalUserText += '\n\nAn image has been uploaded. Analyze it for ad creative use and provide:\n1. Creative assessment — what\'s strong or weak about this image for pole barn ads\n2. Recommended ad copy — 2-3 headline options and a primary text option\n3. Best audience fit — which FPB customer segment this image would resonate with most (DIY kit buyers, turnkey project buyers, agricultural/farm, commercial)\n4. Format recommendations — which Meta ad formats this image works best in (single image, carousel, story)\n5. Image improvements — if the image would benefit from a text overlay, logo placement, or crop adjustment, describe exactly what you\'d recommend\n6. End with: CREATIVE_READY:true if the image is strong enough to use as-is, or CREATIVE_READY:false if it needs processing first';
    }

    // Build user message content — array for vision, string for text-only
    const userMessageContent = imageData?.base64
      ? [
          {
            type:   'image',
            source: {
              type:       'base64',
              media_type: imageData.mediaType,
              data:       imageData.base64,
            },
          },
          { type: 'text', text: finalUserText },
        ]
      : finalUserText;

    const messages = [...history, { role: 'user', content: userMessageContent }];

    // ── Step 5: Call Claude (with ai_analysis_runs lifecycle) ──
    const runId = await insertChatRunPending(account, sessionId);
    await updateChatRunStatus(runId, { status: 'running' });

    const aiCallStartTime = Date.now();
    let claudeRes;
    try {
      claudeRes = await callClaude({
        model:      CHAT_MODEL,
        max_tokens: 1000,
        system:     getFpbChatSystemPrompt(),
        messages,
      });
    } catch (aiErr) {
      const latency_ms = Date.now() - aiCallStartTime;
      await updateChatRunStatus(runId, {
        status:     'failed',
        error:      aiErr.message,
        latency_ms,
      });
      throw aiErr;
    }
    const latency_ms = Date.now() - aiCallStartTime;

    const rawText = claudeRes.content?.[0]?.text || '';

    // ── Step 6: Parse ACTION block → CREATIVE_READY → AD_PREVIEW ──
    const { displayText: afterAction,   actionPayload: parsedActionPayload } = parseActionBlock(rawText);
    let actionPayload = parsedActionPayload;
    const { displayText: afterCreative, creativeReady } = parseCreativeReady(afterAction);
    const { displayText: initialDisplayText, adPreview } = parseAdPreview(afterCreative);
    let finalDisplayText = initialDisplayText;

    // ── Step 6.5: Persist pre-created action row(s) when Claude emits an ACTION block ──
    // process_image is UI-only (triggers image panel); skip it so only campaign-
    // management actions hit the DB. Coordinator gate is always called first.
    // add_negative_keyword_batch expands into N single-term actions server-side
    // (S07e) — never a single action_request card for a batch turn.
    let savedActionId = null;
    let batchSummary = null;
    if (actionPayload && actionPayload.action_type === 'add_negative_keyword_batch') {
      try {
        batchSummary = await stageNegativeKeywordBatch(actionPayload, account, fetchedGoogleCampaigns);
      } catch (e) {
        console.error('[chat] batch negative-keyword staging threw:', e.message);
        batchSummary = { summaryText: 'Batch negative-keyword staging failed — please retry or stage terms individually.', staged: 0, requiresReview: 0 };
      }
      actionPayload = null; // no single action_request card for a batch turn
    } else if (actionPayload && actionPayload.action_type && actionPayload.action_type !== 'process_image') {
      try {
        const { savedActionId: id } = await stageGoogleAdsAction(actionPayload, account, fetchedGoogleCampaigns);
        savedActionId = id;
      } catch (e) {
        console.error('[chat] action row creation threw:', e.message);
      }
    }

    if (batchSummary) {
      finalDisplayText = `${finalDisplayText}\n\n${batchSummary.summaryText}`.trim();
    }

    const messageType = actionPayload ? 'action_request' : 'text';

    await updateChatRunStatus(runId, {
      status:      'succeeded',
      output_json: { reply: finalDisplayText, messageType, hasActionPayload: !!actionPayload },
      latency_ms,
    });

    // Cost ledger — fire-and-forget; never throws back to caller
    await recordAnthropicCost(claudeRes, account.id, 'chat', runId);

    // ── Step 7: Save to Supabase ──
    await supabase.from('chat_messages').insert([
      {
        account_id:   account.id,
        role:         'user',
        content:      message,
        message_type: 'text',
        session_id:   sessionId,
        image_data:   null, // image storage handled in future step
      },
      {
        account_id:     account.id,
        role:           'assistant',
        content:        finalDisplayText,
        message_type:   messageType,
        action_payload: actionPayload,
        session_id:     sessionId,
        image_data:     null,
      },
    ]);

    // ── Step 8: Return ──
    return res.status(200).json({
      success:       true,
      reply:         finalDisplayText,
      messageType,
      actionPayload: actionPayload || null,
      actionId:      savedActionId || null,
      creativeReady: creativeReady ?? null,
      adPreview:     adPreview     || null,
      sessionId,
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
