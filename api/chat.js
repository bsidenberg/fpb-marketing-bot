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
import { resolveForRead, resolveForWrite } from './lib/accounts.js';
import { setCorsHeaders } from './lib/cors.js';
import { checkRateLimit } from './lib/rate-limit.js';
import { recordAnthropicCost } from './lib/anthropic-cost.js';
import { normalizeChannel } from './lib/normalize-channel.js';
import { inferPillar } from './lib/action-states.js';
import { checkPostureForAction } from './lib/autonomy-coordinator.js';
import { detectNovelty, detectConflict, detectExternalFlag, detectAnomaly } from './lib/autonomy-escalation.js';

const CHAT_MODEL = 'claude-sonnet-4-20250514';

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
async function detectIntent(message, accountId = null) {
  const json = await callClaude({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 10,
    system:     'Classify this message into one of three intents: DATA_QUESTION (needs live ad performance data to answer), ACTION_REQUEST (user wants to make a change to a campaign), STRATEGY (general advice, explanation, or question that does not need live data). Respond with only one word: DATA_QUESTION, ACTION_REQUEST, or STRATEGY.',
    messages:   [{ role: 'user', content: message }],
  });
  // Cost ledger — fire-and-forget
  await recordAnthropicCost(json, accountId, 'intent_detection');
  const word = (json.content?.[0]?.text || '').trim().toUpperCase();
  if (['DATA_QUESTION', 'ACTION_REQUEST', 'STRATEGY'].includes(word)) return word;
  return 'STRATEGY'; // safe default
}

// ── Live ad data fetch (account-scoped) ──────────────────────────────────────
async function fetchAdData(baseUrl, accountSlug) {
  // Explicit account param prevents accidental fallthrough to default FPB
  const slugParam = encodeURIComponent(accountSlug);
  const [gRes, mRes] = await Promise.allSettled([
    fetch(`${baseUrl}/api/google-ads?account=${slugParam}`),
    fetch(`${baseUrl}/api/facebook-ads?account=${slugParam}`),
  ]);

  const googleData = gRes.status === 'fulfilled'
    ? await gRes.value.json().catch(() => null)
    : null;
  const metaData = mRes.status === 'fulfilled'
    ? await mRes.value.json().catch(() => null)
    : null;

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

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'GET, POST, OPTIONS', headers: 'Content-Type, x-account-slug' });
  if (req.method === 'OPTIONS') return res.status(200).end();

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
    let intent = includeAdData ? 'DATA_QUESTION' : await detectIntent(message, account.id);

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
    if (includeAdData) {
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host     = req.headers['x-forwarded-host'] || req.headers.host;
      const { google, meta } = await fetchAdData(`${protocol}://${host}`, account.slug);

      const dataParts = [];
      if (google) dataParts.push(`GOOGLE ADS DATA:\n${JSON.stringify(google, null, 2)}`);
      if (meta)   dataParts.push(`META ADS DATA:\n${JSON.stringify(meta, null, 2)}`);

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
    const { displayText: afterAction,   actionPayload } = parseActionBlock(rawText);
    const { displayText: afterCreative, creativeReady } = parseCreativeReady(afterAction);
    const { displayText,                adPreview     } = parseAdPreview(afterCreative);
    const messageType = actionPayload ? 'action_request' : 'text';

    // ── Step 6.5: Persist pre-created action row when Claude emits an ACTION block ──
    // process_image is UI-only (triggers image panel); skip it so only campaign-
    // management actions hit the DB. Coordinator gate is always called first.
    let savedActionId = null;
    if (actionPayload && actionPayload.action_type && actionPayload.action_type !== 'process_image') {
      try {
        const pillar = inferPillar(actionPayload.action_type);
        const [novel, conflict] = await Promise.all([
          detectNovelty(actionPayload.action_type, account.id),
          detectConflict(account.id),
        ]);
        const context = {
          novel,
          conflict,
          anomaly:       detectAnomaly(),
          external_flag: detectExternalFlag(actionPayload),
        };
        const { verdict } = await checkPostureForAction(account.id, pillar, actionPayload.action_type, context);
        if (verdict !== 'block') {
          const { data: actionRow, error: actionErr } = await supabase
            .from('actions')
            .insert({
              account_id:     account.id,
              channel:        normalizeChannel(actionPayload.channel || 'other'),
              action_type:    actionPayload.action_type,
              title:          (actionPayload.action_type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
              description:    actionPayload.description || '',
              priority:       actionPayload.priority || 'medium',
              auto_execute:   false,
              execution_data: {
                campaign_id:       actionPayload.campaign_id       || null,
                campaign_name:     actionPayload.campaign_name     || null,
                current_value:     actionPayload.current_value     || null,
                recommended_value: actionPayload.recommended_value || null,
              },
              status: 'pending',
            })
            .select('id')
            .single();
          if (!actionErr && actionRow?.id) {
            savedActionId = actionRow.id;
          } else if (actionErr) {
            console.error('[chat] action row creation failed:', actionErr.message);
          }
        }
      } catch (e) {
        console.error('[chat] action row creation threw:', e.message);
      }
    }

    await updateChatRunStatus(runId, {
      status:      'succeeded',
      output_json: { reply: displayText, messageType, hasActionPayload: !!actionPayload },
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
        content:        displayText,
        message_type:   messageType,
        action_payload: actionPayload,
        session_id:     sessionId,
        image_data:     null,
      },
    ]);

    // ── Step 8: Return ──
    return res.status(200).json({
      success:       true,
      reply:         displayText,
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
