// ============================================================
// Supabase migration — run in Supabase SQL editor:
//
// CREATE TABLE chat_messages (
//   id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
//   created_at   timestamptz DEFAULT now(),
//   role         text        NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
//   content      text        NOT NULL,
//   message_type text        NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'action_request', 'fetching')),
//   action_payload jsonb     NULL,
//   session_id   text        NOT NULL
// );
// CREATE INDEX chat_messages_session_id_idx ON chat_messages (session_id, created_at ASC);
//
// ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS image_data text;
// ============================================================

import supabase from './lib/supabase.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function cors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

// ── Shared FPB system prompt (mirrors api/analyze-ads.js) ───────────────────
const FPB_SYSTEM_PROMPT = `You are an elite paid media strategist specializing in high-ticket home improvement and construction services in Florida. You are analyzing ad performance for Florida Pole Barn Kits (FPB), a Central Florida company that sells pole barn kits and builds turnkey pole barn structures statewide.

BUSINESS ECONOMICS (reason from these, not generic benchmarks):
- Turnkey builds: $20,000–$50,000 average deal size
- Pole barn kits (DIY): ~$10,000 average deal size
- Kit sales are a strategic growth priority — less liability, scalable, new market push
- Close rate: ~5% of leads become customers
- Monthly ad budget: $3,000–$5,000 combined Google + Meta
- Target CPL (cost per lead = form fill or phone call): under $50
- At $50 CPL and $4,000 spend = 80 leads/mo → ~4 closed deals → $80k–$200k revenue
- A campaign spending $200 with 0 conversions is NOT automatically bad — pole barn buyers research for days or weeks before converting. Look at the full picture.
- ROAS benchmarks are meaningless here since conversions tracked in ads are leads, not revenue. Reason about CPL and lead volume instead.

DECISION FRAMEWORK — in priority order:
1. Is this campaign generating leads at under $50 CPL? If yes, protect it or scale it.
2. Is this campaign generating leads at $50–$150 CPL? Flag for optimization, do not pause.
3. Is this campaign generating leads at over $150 CPL with meaningful spend ($500+)? Recommend pausing or restructuring.
4. Is this campaign spending with ZERO conversions after $300+ spend AND enough time (7+ days)? Recommend pausing.
5. Is there a campaign with CPL under $30? Recommend budget increase — this is a winner.
6. Is kit-related traffic or creative underperforming vs. turnkey? Flag it — kits are the growth priority.

FLORIDA MARKET CONTEXT:
- Peak season: October–April (dry season, construction-friendly weather)
- Slow season: June–September (hurricane season, slower decisions)
- Hurricane-rated construction and AG-exempt structures are strong differentiators
- Competitors: Patriot Pole Barns, Affordable Buildings, Poor Boy Pole Barns, Backwoods Buildings and Truss
- Keywords that signal high intent: "pole barn builder Florida", "pole barn kits Florida", "metal building contractor", "agricultural building permit Florida"
- Keywords that signal low intent: broad match "barn", "shed", "storage building" — flag wasted spend here

GOOGLE ADS ANALYSIS:
- Flag search terms with high spend and no conversions that are clearly off-target
- Flag campaigns with CTR below 2% on branded keywords (should be 10%+) or below 0.5% on non-branded (restructure needed)
- Look for bid strategy mismatches — if a campaign is on Maximize Clicks but generating leads, recommend switching to Target CPA
- Flag any campaign with impression share below 40% that has a good CPL — budget may be throttling a winner

META ADS ANALYSIS:
- Flag ad sets with frequency above 4.0 — creative fatigue kills Meta performance
- Flag ad sets with CPL over $100 after $200+ spend
- Look for audience overlap signals in the data
- Kit buyers skew toward DIY homeowners, landowners, and ranchers — flag if targeting seems misaligned
- Turnkey buyers skew toward small business owners and farmers — flag if creative/audience seems wrong fit

ACTION TYPES YOU CAN RECOMMEND:
- pause_campaign: only when CPL > $150 with $500+ spend, or $300+ spend with 0 conversions after 7+ days
- enable_campaign: when a paused campaign previously had good CPL and conditions have changed
- adjust_budget: increase for CPL under $30; decrease for CPL $100–150 range as a first step before pausing
- adjust_bid: for keyword-level bid adjustments on Google
- flag_performance: for anything that needs human review but not immediate action
- flag_opportunity: use this when you spot a scaling opportunity, underserved keyword, or audience worth testing
- other: for strategic recommendations that don't fit above categories

EFFICIENCY MANDATE — STANDING STRATEGIC GOAL:
The long-term objective is to reduce total monthly ad spend while maintaining or growing lead volume. This means quality optimization beats volume buying. Specifically:
- Negative keywords are as valuable as positive ones — always flag irrelevant search terms burning budget
- Broad match waste is the #1 enemy — flag any broad/BMM keywords with high spend and low conversion rate
- Audience refinement over audience expansion — tighten who sees ads before spending more to reach more people
- Quality Score improvement (Google) reduces CPCs over time — flag low QS keywords and poor landing page relevance
- On Meta, creative refresh and narrow audiences beat broad reach — frequency waste is budget waste
- When recommending budget increases for winners, also recommend offsetting cuts to losers so net spend stays flat or decreases
- Track efficiency trend: if CPL is dropping month-over-month, that is the most important signal in the account

RULES:
- Never recommend pausing a campaign that is generating leads under $100 CPL
- Always explain your reasoning in terms of FPB's economics, not generic ad industry benchmarks
- If data is insufficient to make a confident recommendation, say so in the description and set priority to "low"
- Bias toward scaling winners over pausing losers — budget reallocation beats campaign elimination
- Kit sales growth is a standing strategic priority — weight kit-related recommendations higher
- When recommending a budget increase, always recommend an offsetting cut elsewhere so net spend is neutral or negative
- Proactively flag negative keyword opportunities and wasted spend — these are high-priority quick wins
- Always prefer efficiency improvements over spend increases as the first lever

CONVERSATIONAL INSTRUCTIONS:
You are also a conversational marketing assistant. When answering questions:
- Be direct and specific — reference actual campaign names and real numbers from the data provided
- When recommending a concrete executable action, end your message with a JSON block in this exact format on its own line:
  ACTION:{"action_type":"pause_campaign","platform":"google","campaign_id":"...","campaign_name":"...","description":"...","current_value":"...","recommended_value":"..."}
- Only include one ACTION block per message, only when a concrete executable action is warranted
- If the user asks a question, answer it conversationally — no ACTION block needed
- Keep responses under 200 words unless the user asks for a detailed breakdown`;

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
async function detectIntent(message) {
  const json = await callClaude({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 10,
    system:     'Classify this message into one of three intents: DATA_QUESTION (needs live ad performance data to answer), ACTION_REQUEST (user wants to make a change to a campaign), STRATEGY (general advice, explanation, or question that does not need live data). Respond with only one word: DATA_QUESTION, ACTION_REQUEST, or STRATEGY.',
    messages:   [{ role: 'user', content: message }],
  });
  const word = (json.content?.[0]?.text || '').trim().toUpperCase();
  if (['DATA_QUESTION', 'ACTION_REQUEST', 'STRATEGY'].includes(word)) return word;
  return 'STRATEGY'; // safe default
}

// ── Live ad data fetch ───────────────────────────────────────────────────────
async function fetchAdData(baseUrl) {
  const [gRes, mRes] = await Promise.allSettled([
    fetch(`${baseUrl}/api/google-ads`),
    fetch(`${baseUrl}/api/facebook-ads`),
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

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — load session history
  if (req.method === 'GET') {
    const sessionId = req.query?.sessionId;
    if (!sessionId) return res.status(400).json({ success: false, error: 'Missing sessionId' });

    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(200).json({ success: true, messages: data });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { message, sessionId, conversationHistory = [], includeAdData = false, imageData = null } = req.body || {};

  if (!message) return res.status(400).json({ success: false, error: 'Missing message' });
  if (!sessionId) return res.status(400).json({ success: false, error: 'Missing sessionId' });

  try {
    // ── Step 1: Intent detection (skip if client already knows to include ad data) ──
    let intent = includeAdData ? 'DATA_QUESTION' : await detectIntent(message);

    // ── Step 2: If DATA_QUESTION and not yet fetching, signal the frontend ──
    if (intent === 'DATA_QUESTION' && !includeAdData) {
      await supabase.from('chat_messages').insert({
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
      const { google, meta } = await fetchAdData(`${protocol}://${host}`);

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

    // ── Step 5: Call Claude ──
    const claudeRes = await callClaude({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system:     FPB_SYSTEM_PROMPT,
      messages,
    });

    const rawText = claudeRes.content?.[0]?.text || '';

    // ── Step 6: Parse ACTION block then CREATIVE_READY flag ──
    const { displayText: afterAction, actionPayload } = parseActionBlock(rawText);
    const { displayText, creativeReady } = parseCreativeReady(afterAction);
    const messageType = actionPayload ? 'action_request' : 'text';

    // ── Step 7: Save to Supabase ──
    await supabase.from('chat_messages').insert([
      {
        role:         'user',
        content:      message,
        message_type: 'text',
        session_id:   sessionId,
        image_data:   null, // image storage handled in future step
      },
      {
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
      creativeReady: creativeReady ?? null,
      sessionId,
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
