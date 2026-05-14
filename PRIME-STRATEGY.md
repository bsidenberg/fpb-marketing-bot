# PRIME — Product Strategy

Owner: Brian Sidenberg
Status: Locked v1.0
Last updated: May 2026

---

## 1. Vision

**Prime** is an autonomous, multi-tenant marketing system that runs the complete digital marketing function for a business — paid ads, SEO content, Google Business Profile, social media — with minimal human guidance. It synthesizes the best marketing practices in the world into an executing agent constellation that decides what to do, does it, measures the result, and iterates. The system is aspirational by design: day-one capability is meaningful but bounded; the long arc is sophistication that compounds as the system ingests more strategies, runs more campaigns, and learns from real outcomes.

Built internal-first across Brian Sidenberg's businesses (Florida Pole Barn, Weld Workx, Florida Security Concepts), Prime proves cost-effective lead generation under real-world conditions before being productized for external sale. The end-state is an enterprise-grade marketing platform that consistently outperforms human-operated marketing across every business it serves.

The system is self-extending: it adds new agents, new capabilities, and new integrations as the work demands. Brian's role is operator now, overseer eventually. Once the system is mature, his time goes to other ventures — Jarvis, new businesses, life — while Prime runs the marketing function autonomously, escalating only the cases it can't or shouldn't decide alone.

**Success is measured by:** cost-per-lead, lead volume, lead quality, and revenue attributed to marketing — across every tenant the system serves.

---

## 2. Audiences

Prime serves tenants in two distinct classes: **internal tenants** (businesses Brian owns or controls) and **external tenants** (paying customers). The internal-first sequencing is foundational — the product is only productized after internal tenants demonstrate sustained results.

**Tenant Zero — Florida Pole Barn (FPB Kits).** FPB is one brand with two products: turnkey builds (materials + installation) and Kits (materials only, the under-marketed product). FPB Kits is the proving ground for FPB in Prime. FPB has operational infrastructure already in place — Next.js site with tracking, CRM with lead capture, Jeff Hicks in sales. FPB turnkey is deferred to Phase 3 as an optional add.

**Tenant One — Weld Workx.** Primary proving ground for marketing capability itself. Weld Workx has a different business model (B2B gate fabrication and access control), different audience, different sales cycle, and little to no current marketing footprint. Clean test of what Prime can do from a near-zero baseline. Site exists on Lovable (weldworkxfl.com). Caleb is the operating partner.

**Tenant Two — Florida Security Concepts (FSC).** The cleanest proving ground. Pre-market today — no legacy marketing, no existing ad accounts, no inherited content. Site exists at floridasecurityconcepts.com (platform TBD). Validates Prime end-to-end: from zero marketing function to consistent leads.

**Tenant Three and beyond — External clients.** Onboarded Phase 4. Profile: small Florida service businesses (contractors, trades, local services) — same vertical as internal tenants, audience Brian understands operationally.

**Proving ground hierarchy:** FPB Kits validates Prime works against an existing baseline. Weld Workx validates Prime works from a low baseline. FSC validates Prime works from zero. If all three hold, external clients across the same spectrum are ready.

---

## 3. Phasing

Twelve months from start to first external paid client. Phases overlap; onboarding a new tenant doesn't pause development for existing tenants.

### Phase 0 — 2–3 weeks. Foundation hardening and audit.

- Capability audit of current code against the multi-tenant + autonomous vision
- Brand voice extraction for FPB (with FPB Kits product nuance), Weld Workx, FSC
- Resolve KNOWN_SECURITY_GAPS items (auth gaps on anonymous API routes)
- Tenant setup in Prime backend: FPB Kits, Weld Workx, FSC all live as active tenants
- Tooling stack inventory and gaps identified
- Weld Workx site migration decision: Lovable stays vs. migrate
- FSC site publishing path identified
- Build cost ledger infrastructure: dedicated "Costs" page UI scoped, schema designed

**Exit:** audit committed, voice specs written, security gaps closed, three tenants live, tooling stack confirmed, publishing paths known, cost ledger ready.

### Phase 1 — Weeks 4–13 (10 weeks). SEO blog + GBP + voice interface, three tenants in parallel.

**SEO blog content pipeline:** keyword research → topic ideation → outline → draft → fact-check → SEO optimization → publishing per tenant. Autonomy: agent drafts and optimizes autonomously, human approval before publish (Phase 1 holdout — first 5 per tenant).

**GBP pipeline:** Claimed/verified for all three. Weekly post cadence. Photo management (Nano Banana). Q&A monitoring and response. Review responses (drafts; negative reviews require approval).

**Voice interface:** Browser-based microphone input. Full control surface — conversational queries, approvals, direct commands. Voice routes through the same action and approval architecture as text — holdout list applies identically.

**Shared agent loop:** trigger → research → plan → generate → human review at configured gates → execute → measure → log → learn

**Exit:** blog publishing weekly on all three tenants, GBP posting weekly on all three, voice interface operational, multi-tenant architecture validated under three-tenant load.

### Phase 2 — Weeks 14–23 (10 weeks). Paid ads + social images + LinkedIn + press releases.

- Paid ads optimization added (FPB Kits $2,500/mo existing, Weld Workx $500/mo testing, FSC $500/mo testing)
- Social media images across Instagram, Facebook, LinkedIn, TikTok (per-tenant platform configuration)
- Press release pipeline added to content vocabulary
- Multi-agent decomposition begins where complexity demands it

**Exit:** all three tenants on at least three pillars, paid ads with measurable ROAS, social cadence established, press releases issued where strategically valuable.

### Phase 3 — Weeks 24–38 (15 weeks). Social video, multi-agent maturity, full pillar coverage.

- Social video generation added (Reels, TikTok, YouTube Shorts)
- Multi-agent architecture matured: specialized research, content, ads, social, strategy agents with orchestration layer
- All four pillars live for all three internal tenants
- Cross-tenant learning operational (internal tenants share patterns)
- FPB turnkey added as tenant or sub-tenant if desired

**Exit:** complete pillar coverage, multi-agent architecture proven, leads measurably attributed to Prime across every tenant, pricing floor data available.

### Phase 4 — Weeks 39–52 (14 weeks). Productization and first external client.

- External-tenant onboarding flow
- Per-tenant billing and metering
- Approval workflows for external approvers
- Pricing decisions derived from cost ledger floor + market ceiling
- Sales motion, contracts, legal
- First paid external client onboarded
- Operational separation between internal (full autonomy, Brian's holdouts) and external (conservative defaults, their approvals)

**Exit:** one paying external client live, all internal tenants running, productization infrastructure validated.

---

## 4. Autonomy Model

Prime's autonomy posture is **per tenant, per pillar, per action class**. Different tenants, different pillars, and different action classes carry different stakes — Prime treats them accordingly.

### Two autonomy tiers

**Tier 1 — Recommendation only.** Agent proposes the action and waits for human approval before executing. Default for any new tenant + pillar combination, and the permanent posture for all holdout-list items.

**Tier 2 — Full autonomy.** Agent acts immediately, logs everything, surfaces only flagged exceptions. Graduation criteria: 20 successful cycles AND 95%+ success rate (no flagged outcomes) for that specific tenant + pillar + action class combination.

### Holdout list — always requires human approval, never graduates

**Across all pillars:**
- Any spend change above per-tenant threshold (5% of monthly budget; FPB: $125, Weld Workx: $25, FSC: $25)
- Pausing, creating, or deleting an ad campaign
- First 5 posts on any new platform or new pillar for any new tenant
- Any content mentioning specific pricing, warranties, or competitive comparisons
- Any content making claims about timelines, capacity, or guarantees
- Any post including a real person's image or likeness (Phase 1 — loosens later)
- Responding to negative reviews or critical comments on any platform

**GBP-specific:**
- Any change to customer-facing business info (hours, address, phone, service area, business name, primary category)
- Routine post creation and photos are fine autonomously after the first-5 graduation.

**Blog-specific:**
- First 5 publishes on any new domain
- Subsequent publishes can graduate

**Paid ads-specific:**
- Launch of any net-new ad creative on a new audience segment
- Spend changes above the per-tenant threshold

**Social-specific:**
- Any post including a real person's image or likeness
- Any post responding to a comment or DM mentioning a complaint or dispute

### Escalation triggers — agent flags itself

The agent surfaces for human review when:
- Performance anomaly (>2 standard deviations outside expected range)
- Conflicting signals from research
- Novel situation (action class not seen for this tenant before)
- External event (news/industry development changing marketing context)
- Confidence below configured floor

Escalation executes the conservative default while surfacing for review. Total stalls are themselves failures — marketing has a tempo.

### Soft coordinator (Phase 1 cadence rules)

A rules layer enforces per-tenant per-day and per-week limits:
- Maximum 1 blog post per tenant per week
- Maximum 3 GBP posts per tenant per week (no more than 1 per day)
- Maximum 5 social posts per tenant per week (across platforms)
- Maximum 1 ad campaign change per tenant per day
- Topic diversity: no two pieces of content on the same primary topic within 14 days

Graduates to full strategy agent in Phase 2/3 as part of multi-agent decomposition.

### Voice interface honors the same gates

Voice commands route through the same action and approval architecture as text. "Publish that draft" via voice still triggers the same holdout check as a button click. Voice is an input mechanism, not an approval bypass. Brian can approve/reject flagged actions via voice — particularly useful for drive-time decisions.

### Approval routing

**Internal tenants:** All approvals route to Brian. Single approver, fast turnaround. Post-maturity, approvals can route to Michelle (COO) as designated reviewer.

**External tenants (Phase 4+):** Approvals route to tenant-designated approver(s). Tenant configures single vs. multi-approver workflows.

---

## 5. Success Metrics

Prime's success is measured at three levels: **per-action**, **per-tenant**, **system-wide**.

### North star metric

**Cost-per-qualified-lead (CPQL) per tenant.** Total marketing spend (ads + tooling allocation + paid distribution) divided by qualified leads generated.

### Lead definition

**Universal lead minimum (every tenant, every channel):** name, phone, email, address.

**Qualification overlay per tenant:**
- **FPB Kits:** universal minimum + barn-size intent
- **Weld Workx:** universal minimum + project description + B2B context
- **FSC:** universal minimum + service interest + service area

### Secondary metrics — per tenant

- Lead volume (qualified leads / month)
- Lead quality (manual sample scoring in Phase 1; CRM-integrated close-rate in Phase 2+)
- Revenue attribution (revenue traceable to Prime-generated leads / month)
- Organic traffic per tenant
- GBP discovery views + actions
- Paid ad ROAS (Phase 2+)
- Social engagement rate (Phase 2+)

### System-wide metrics

- Cycles per week per tenant
- Autonomy graduation rate
- Approval queue depth
- Action success rate
- **Total cost to build Prime** — running cumulative ledger (pricing floor)
- **Cost per Prime tenant per month** — operational cost per tenant

### Per-action measurement

Every action logged with: action class, tenant, pillar, tier, predicted outcome range, actual outcome at 7/30/90 days, success classification.

### Baseline-driven phase targets

**Phase 0 establishes baselines** — each tenant's current monthly qualified leads from organic channels before Prime touches anything.

**Phase 1 success criterion** — measurable uptick in qualified-lead volume by end of Month 1 of active blog + GBP operation per tenant. Directional improvement against baseline, not fixed numbers.

**Phase 2+ targets** — set from Phase 1 actual data.

---

## 6. Operating Budget

Prime is operated as a marketing agency. Internal tenants are zero-revenue clients during Phases 0–3. External tenants (Phase 4+) are revenue-generating clients. Economic test: Prime's operational cost per client must be lower than what external clients would pay for equivalent agency services.

**Cost categories tracked:** Brian's hours, subscriptions (Anthropic, OpenAI, Lovable, Supabase, Vercel, Perplexity, Nano Banana, anything added), API costs (Google Ads, Meta, GBP, keyword research, image gen, etc.), infrastructure (Vercel, Supabase, workers), AI inference tokens per tenant.

**Not tracked as Prime cost:** Client ad spend. That's the client's money.

**Cost ledger lives in Prime itself.** Dedicated "Costs" page in the dashboard UI. Two tabs: build costs (cumulative, all-time) and operating costs (monthly recurring). Programmatic costs (API calls, token usage) auto-log; manual costs (subscriptions, Brian's hours) entered via UI.

**Brian's hours logged per session.** Date, focus area, hours. Categories: Strategy, Build, QA, Approval workflow, Operations. Honest logs.

**Hour budget:** Several hours per day during build. Target operating-mode budget: ~1 hour per day once Prime is live. System alerts if weekly hours exceed sustainable rate.

**Cost-per-tenant alert.** Prime's per-tenant operating cost must stay below the equivalent agency rate. If exceeded, productization economics are inverted — alert fires.

**Tool approval protocol.** New tool needed → surface to Brian → approve/reject → Brian provisions credentials → logged in build cost tracker → integration proceeds.

**Currently approved:** Anthropic, OpenAI/ChatGPT, Lovable, Supabase, Vercel, Perplexity, Nano Banana.

**Phase 0 evaluates:** keyword research, GBP API, image gen alternatives, rank tracking, schema validation, voice tooling.

---

## 7. Architectural Principles

1. **Multi-tenant from day one.** Every data model, API route, agent action, log entry tenant-scoped. Onboarding tenant N+1 is data work, not engineering.

2. **Full autonomy is the default.** Approval gates require justification. Every gate is justified or removed.

3. **Tenant-aware everything.** Agent never operates without knowing which tenant. Cross-tenant data flow for learning, never for action.

4. **No fork between internal and external.** Same codebase, different configuration. No "we'll rebuild for productization" decisions.

5. **Multi-agent decomposition is earned, not assumed.** Single agent loop in Phase 1. Specialization emerges via capability gap, cognitive overload, or specialization opportunity. Each decomposition documented with trigger.

6. **Every action logged. Every cost captured.** The data trail is both learning substrate and pricing-floor evidence.

7. **Agent honest about uncertainty.** Escalate rather than guess. Surface conflicting signals rather than pick. Ask rather than improvise on novel situations.

8. **Best tool for the job, replaced when better emerges.** Quarterly tool stack audit. Documented decisions. Lock-in is a failure mode.

9. **Cost-per-client converges down as tenant count grows.** Fixed costs amortize; variable costs stay flat per tenant. Leaks indicate architecture problems.

10. **Brand voice is data, not code.** Structured spec per tenant in database. Voice changes don't require code deploys.

11. **Standard tenants onboard via data; non-standard tenants expand the platform.** New integration needs expand Prime's capabilities, helping all future tenants.

12. **Internal tenants share learnings freely; external tenants are isolated.** Phase 1–3 internal cross-tenant learning. Phase 4+ external tenants opt-in.

13. **Cost ledger sets pricing floor; market sets ceiling.** Prime never sells below ledger-derived cost. Market analysis sets the ceiling. Individual deals land between.

---

## 8. Out of Scope (Year 1)

### In Year 1 scope (clarifying inclusions)

- LinkedIn (B2B critical for Weld Workx and FSC)
- TikTok / Instagram Reels (extends social pillar)
- Press release writing and distribution (extends content pillar)
- Joseph chatbot sources content from Prime (single source of truth — Phase 2 reconsideration)
- Voice interface, full control, web app — Phase 1

### Out of Year 1 scope

**Communication channels:** Email marketing automation, SMS / WhatsApp marketing (the FPB speed-to-lead WhatsApp agent is a separate sales-side product).

**Adjacent marketing capabilities:** Lead-magnet / gated content creation, webinar production, podcast production, influencer outreach automation, marketing event coordination, loyalty / retention marketing.

**Beyond marketing:** Sales-side automation, customer service chatbots beyond marketing, conversion rate optimization beyond content quality, web development, video editing beyond AI generation, generic SEO technical audits.

**Reputation management beyond GBP:** Yelp, BBB, Angi, industry review sites — tenant-managed manually in Year 1.

**Generic platform features:** Content marketplace, content library, syndication network, white-label resale.

**Geographic / platform expansion:** International, mobile native apps.

**Analytics beyond Prime's needs:** Generalized analytics, custom funnel analysis, cohort retention dashboards.

### Year 2 reconsideration list

Email automation, webinars and podcasts, lead magnets, other review platforms, white-label resale.

---

## 9. Open Questions

### Phase 0 must resolve

- Keyword research tool (Ahrefs, SEMrush, DataForSEO API, other)
- Weld Workx site migration (Lovable stays vs. migrate to what stack)
- FSC site CMS/platform and publishing path
- GBP API access pattern
- Voice tooling stack (OpenAI Realtime API vs. browser Web Speech API vs. ElevenLabs vs. combination)
- Brand voice extraction methodology (interview, corpus, both)
- KNOWN_SECURITY_GAPS resolution plan
- Cost ledger schema (tables, fields, auto-logging mechanisms)

### Phase 1 must resolve

- First-5-posts approval graduation criteria (what counts as "successfully approved")
- Soft coordinator rule tuning from real data
- Voice interface escalation handling pattern
- Manual lead quality scoring workflow (who, how often, scale, feedback)

### Phase 2 must resolve

- Soft coordinator → full strategy agent graduation
- Paid ads autonomy postures (bid changes vs. budget reallocation vs. creative changes)
- Social platform connector priorities per tenant
- Multi-agent decomposition triggers in practice

### Phase 3 must resolve

- Video generation tool choice
- FPB turnkey added as tenant or sub-tenant
- Cross-tenant learning mechanism (anonymized patterns vs. raw data vs. templating)
- Quarterly tool review #1

### Phase 4 must resolve

- Pricing model (flat fee, ad-spend percentage, per-pillar, hybrid)
- External approver UX (email links, portal, mobile, voice)
- Legal structure for external client work
- Sales motion (outbound, inbound, partnerships)
- Service tier definitions

### Ongoing / undated

- When voice interface expands beyond web app (phone, mobile app)
- Year 2 reconsideration triggers (email, white-label, other platforms)
- Michelle's integration into Prime approvals
- Whether Jarvis and Prime converge infrastructure

---

End of document. After creating the file, run git status and show me the new file's path. Do NOT commit — Brian will commit and push manually.
