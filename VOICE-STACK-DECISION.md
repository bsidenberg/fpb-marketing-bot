# Prime — Voice Stack Decision (Phase 0 Sub-Task 8)

Owner: Brian Sidenberg
Author: Claude Code
Date: 2026-05-19
Status: **Locked** — Phase 1 voice build proceeds against this decision
References: `PRIME-STRATEGY.md` v1.0 (Section 4 voice, Section 9 open questions), `AUDIT-PHASE-0.md` Section 8

This is a decision-only sub-task. No code changes, no new tooling, no
sign-ups. It locks the voice stack choice and surfaces Phase 1
implementation notes so the Phase 1 voice build starts from a settled
foundation instead of relitigating the stack.

---

## 1. Decision

**Prime's Phase 1 voice interface is built on the OpenAI Realtime API.**

The Realtime API provides speech-to-text (STT), text-to-speech (TTS),
and conversational turn management through a single API. The browser
Web Speech API is explicitly rejected (Section 2).

This decision is locked. The items still genuinely open — model version,
wake-phrase strategy, UX details — are deferred to Phase 1 kickoff and
listed in Section 8. They do not reopen the stack choice.

OpenAI is already on Prime's approved-vendor list (`PRIME-STRATEGY.md`
Section 6: "Currently approved: Anthropic, OpenAI/ChatGPT, ..."). The
Realtime API is a new *capability* on an already-approved vendor, not a
new tool — no tool-approval protocol step is required.

---

## 2. Why not Web Speech API

The Phase 0 audit (`AUDIT-PHASE-0.md` Section 8) leaned toward Web Speech
API "for v0" on cost grounds. That recommendation is overridden here.
Web Speech is the wrong foundation for a tool Brian will operate daily.

- **Browser fragmentation.** `SpeechRecognition` is non-uniform across
  browsers: Chrome is workable, Safari support is weak and historically
  unreliable, Firefox is limited. A daily-driver tool cannot depend on a
  capability that degrades by browser.
- **Voice synthesis quality.** Web Speech `speechSynthesis` voices are
  robotic. For a back-and-forth conversational tool, synthesis quality
  is not cosmetic — it is the difference between a tool that gets used
  and one that gets abandoned.
- **Latency variability.** Web Speech recognition latency is
  inconsistent and not controllable from app code. There is no SLA, no
  tuning surface.
- **No conversational state.** Web Speech handles single utterances. All
  turn-taking, interruption handling, and conversation context must be
  built and maintained in app code. That is real engineering cost with a
  worse result than a conversation-native API delivers out of the box.
- **Free is the wrong optimization vector.** Brian's framing:
  *"budget is needs-based."* For a tool that is the primary control
  surface during drive-time and hands-busy moments, reliability and
  quality dominate cost. Saving a small monthly fee by shipping a
  fragile experience is a false economy.

Web Speech API is not a v0 stepping stone here. Adopting it would mean
building turn-taking and context plumbing that the Realtime API provides
natively, then discarding that code when the quality ceiling is hit.

---

## 3. Why OpenAI Realtime API

- **Conversation-native.** The Realtime API is built for continuous
  back-and-forth — turn detection, interruption ("barge-in"), and
  conversation context are first-class, not app-code responsibilities.
- **Low turn-around latency.** The Realtime API's native speech-to-speech
  path targets sub-300ms turn-around. (Important caveat: Prime routes
  reasoning through Claude — see Section 4 — which adds Claude inference
  latency on top of the Realtime path. The sub-300ms figure describes
  the audio layer, not the full Prime round-trip.)
- **High-quality voice synthesis.** Production-grade TTS voices, a large
  step above Web Speech synthesis.
- **Multimodal.** Audio in / audio out plus function-calling in one API.
- **Function-calling.** The Realtime API supports tool calls, which gives
  Phase 1 a fast path for lightweight voice commands (e.g. "approve
  action 42") without a full Claude round-trip — see Section 6.
- **Single API surface.** STT, TTS, turn management, and conversation
  routing in one integration instead of three stitched-together
  services. Fewer moving parts, fewer failure modes.

---

## 4. Architecture sketch

How voice integrates with Prime in Phase 1.

```
  Browser microphone
        │  (captured audio stream)
        ▼
  OpenAI Realtime API  ──STT──►  transcript
        ▲                          │
        │                          ▼
       TTS                  POST /api/chat   (existing Prime endpoint)
        │                          │
        │                          ▼
        │                  Claude (Prime's brain) → reply text [+ ACTION block]
        │                          │
        └──────────────────────────┘
        │
        ▼
  Audio playback in browser
```

**Realtime API is the ears and mouth; Claude remains the brain.** This
is the load-bearing architectural clarification. The Realtime API is
used for audio I/O — STT on the way in, TTS on the way out. The actual
reasoning, marketing judgment, and action generation stay with Claude
via the existing `/api/chat` endpoint. Prime is a Claude-centric system;
voice does not change that.

Flow:

1. Browser captures microphone audio and streams it to the OpenAI
   Realtime API.
2. The Realtime API transcribes speech to text.
3. The transcript is routed into the existing `/api/chat` endpoint —
   the same endpoint the text chat UI already uses. `/api/chat` is
   account-scoped, runs the chat_messages preflight, and calls Claude.
4. Claude's reply (and any `ACTION:` block it emits — `api/chat.js`
   already parses these) comes back as text.
5. The reply text is sent back through the Realtime API for TTS.
6. Audio plays back in the browser.

**Key principle — voice honors the same approval gates as text.** A
spoken "pause campaign Acme Q4" is not a shortcut around the control
plane. It must:

1. Land in `/api/chat` exactly as a typed message would.
2. Generate an action in the `actions` queue with the same approval
   requirements any text-originated action carries (holdout rules,
   autonomy posture, ownership checks — the gate infrastructure built in
   Sub-Task 5 and Phase 1).
3. Be approvable via voice ("approve the action") **or** via the
   dashboard — both routes hit the same `/api/approve-action` with the
   same ownership and state-machine guarantees.

Phase 1 voice does **not** fork the agent loop. It gives audio I/O to the
existing chat-based control plane. Every guarantee that protects
text-originated actions protects voice-originated actions because they
are the same actions, created through the same endpoint.

**Two integration details Phase 1 must carry forward:**

- **Latency budget.** Total perceived round-trip = Realtime STT +
  `/api/chat` (Claude inference) + Realtime TTS. The Realtime audio
  layer is fast; Claude inference is the dominant term. Phase 1 should
  plan for response streaming and/or short filler audio ("let me check
  that...") so the experience stays conversational while Claude thinks.
- **Rate limiting.** Sub-Task 6.4 added a per-account rate limit to
  `/api/chat` (30 requests / 60s, keyed on `account_id`). Voice routes
  through `/api/chat`, so each spoken turn that triggers a Claude call
  counts against that limit. A chatty voice session is unlikely to hit
  30/min, but Phase 1 should confirm the cap is comfortable for voice
  cadence and revisit if a dedicated allowance is warranted.

---

## 5. Cost projection for Phase 1

> **PLACEHOLDER NUMBERS — illustrative only.** OpenAI Realtime API
> pricing must be re-verified at Phase 1 kickoff before any budget is
> committed. The figures below exist to anchor the order of magnitude,
> not to quote a price.

Assumed Phase 1 usage (Brian, daily driver):

| Input | Assumption |
|---|---|
| Voice interactions per day | 10–30 (use 20 midpoint) |
| Average interaction length | ~30 seconds of audio |
| Audio minutes per day | ~10 min (input + output combined) |
| Audio minutes per month | ~300 min |

Illustrative arithmetic (placeholder blended rate — **verify**):

| Line | Placeholder | Monthly |
|---|---|---|
| Realtime audio, ~300 min/mo | ~$0.10–$0.30 / min (blended in+out, **placeholder**) | **~$30–$90** |

**Order-of-magnitude conclusion: roughly $20–$100/month** for Phase 1
single-operator usage. This is a needs-based cost for a daily-driver
control surface and is consistent with Brian's "budget is needs-based"
framing.

When voice ships, this becomes a recurring row in Prime's cost ledger
(Sub-Task 4): a `cost_api_events` / `cost_subscriptions` entry under the
OpenAI vendor, allocated per the cost-allocation rules. Realtime API
usage is per-session and can be tagged to the operating account, so it
slots into the same auto-logging hook pattern the ledger uses for
Anthropic calls.

---

## 6. Approval-by-voice mechanics

Phase 1 voice must support the following spoken interactions. They are
specified here so Phase 1 does not relitigate the gates.

| Spoken command | Behavior |
|---|---|
| "Pause campaign Acme Q4" | Routes through `/api/chat` → Claude generates a pause action → lands in the `actions` queue → **approval required** per holdout / autonomy posture. Voice does not auto-execute. |
| "Approve action 42" | Calls `/api/approve-action` for action 42 — same ownership check, state-machine `canExecute` gate, and idempotency lock as a dashboard click. |
| "Reject action 42" | Moves action 42 to the rejected state via the same action-state transition the dashboard uses. |
| "What actions are pending?" | Reads `/api/actions?status=pending` for the active account and speaks the list back. |

**Gate principle restated:** voice is an input mechanism, never an
approval bypass (`PRIME-STRATEGY.md` Section 4). A voice command that
generates an action gets the identical holdout check, autonomy-posture
evaluation, and ownership enforcement that a text command or a button
click gets. Approval-by-voice is a convenience for drive-time decisions;
it does not lower the bar for what requires approval.

**Intent routing — TBD at Phase 1 kickoff, two viable paths:**

- **Path A — everything through Claude.** All voice transcripts go to
  `/api/chat`; Claude interprets "approve action 42" and emits the
  appropriate action/approval instruction. Uniform, but pays a full
  Claude round-trip even for trivial control commands.
- **Path B — Realtime function-calling fast path.** Lightweight,
  unambiguous control commands ("approve action 42", "what's pending")
  are handled via the Realtime API's function-calling, hitting
  `/api/approve-action` or `/api/actions` directly, while substantive
  requests still route to Claude via `/api/chat`. Lower latency for
  control verbs, more routing logic to build.

This doc does not pick A vs. B — that is a Phase 1 implementation call
once the Realtime model's function-calling behavior is hands-on tested.
What is locked: whichever path is chosen, an action-generating command
still passes through the full approval gate.

---

## 7. Phase 1 build kickoff checklist

When the Phase 1 voice build begins, the implementer needs:

- **OpenAI API access with Realtime API enabled** on Prime's existing
  OpenAI account. Confirm Realtime API availability and any access
  tier requirements at kickoff.
- **New env var `OPENAI_API_KEY`** added to Prime (Vercel project
  settings + `.env.example` documentation). This is the standing,
  server-side key — it must never reach the browser (see below).

**Decision: monolithic Prime app vs. separate voice service?**
**Recommendation: integrate into the Prime repo.** Voice is an I/O layer
on the existing `/api/chat` control plane, not a separate product. A
separate service would duplicate account resolution, auth, and config
for no benefit at Phase 1 scale. Keep voice in the Prime monorepo;
revisit only if voice grows its own backend needs.

**Decision: in-browser WebSocket vs. backend proxy for the Realtime
connection?**
**Recommendation: ephemeral-token pattern — backend mints a short-lived
token, browser connects directly to OpenAI.** Rationale:

- The standing `OPENAI_API_KEY` must stay server-side. A naive
  in-browser direct connection would expose it.
- A full backend *proxy* of the realtime media stream fights Vercel's
  serverless model — Vercel functions are request/response with an
  execution-time limit (`vercel.json`: `maxDuration: 60`) and are not
  built to hold a persistent media WebSocket open.
- The clean resolution: a small Prime endpoint (e.g.
  `/api/voice-token`) mints a short-lived ephemeral credential — a
  quick request/response that fits serverless perfectly. The browser
  then establishes the realtime audio connection **directly** to OpenAI
  using that ephemeral credential. The standing key never leaves the
  server; Vercel never has to proxy a long-lived stream.

This recommendation should be confirmed against the current Realtime API
connection options (WebRTC vs. WebSocket, ephemeral-token support) at
Phase 1 kickoff, but the principle — standing key server-side, realtime
media not proxied through Vercel functions — is firm.

---

## 8. Open questions deferred to Phase 1

These must be decided **at** Phase 1 kickoff, not before. Deferring them
does not reopen the stack decision in Section 1.

- **Realtime model selection.** Pick the current best OpenAI Realtime
  model at Phase 1 build time — model lineup will have moved.
- **Connection transport.** Confirm WebRTC vs. WebSocket and the
  ephemeral-token mechanism against the then-current Realtime API.
- **Wake-phrase strategy.** Push-to-talk vs. continuous listening vs. a
  wake phrase. Push-to-talk is the likely Phase 1 default (simplest,
  most predictable, no false triggers) — confirm at kickoff.
- **Mobile vs. desktop voice UX.** Phase 1 voice is browser-based
  (`PRIME-STRATEGY.md` Section 4). Whether the first build targets
  desktop browser only or also mobile browser is a kickoff scoping call.
- **Conversation context window.** How much prior turn history rides
  along with each voice turn, and the sliding-window size.
- **Voice-to-action confidence thresholds.** When a transcript is
  ambiguous ("pause the Acme campaign" with two Acme campaigns), the
  threshold at which the system asks a clarifying question rather than
  generating an action. Ties into the escalation model.
- **Intent routing path A vs. B** (Section 6) — Claude-for-everything
  vs. Realtime function-calling fast path.
- **Latency mitigation tactics** — response streaming, filler audio —
  finalized once real round-trip latency is measured.

---

## 9. Out of scope for Phase 0

Sub-Task 8 deliberately does **not**:

- Pick the OpenAI Realtime model version.
- Build any voice code, endpoints, or UI.
- Test latency, transcription accuracy, or synthesis quality.
- Sign up for or enable OpenAI Realtime API access.
- Add `OPENAI_API_KEY` or any voice env var to Prime.
- Commit any cost or budget.

It locks the strategic stack choice — OpenAI Realtime API — so the
Phase 1 voice build begins with the foundation settled instead of
opening with a stack debate. Everything buildable is Phase 1 work.

---

End of decision. No file modifications beyond this document.
