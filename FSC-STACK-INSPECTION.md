# FSC Stack Inspection

Owner: Brian Sidenberg
Author: Claude Code
Date: 2026-05-14
Inspected repo: `C:\Users\BrianSidenberg\Python\florida-security-concepts`
This document lives in: Prime repo (`FPB Marketing Bot`)
Prior assumption being corrected: TENANT-MODEL-SPEC.md guessed Webflow. Brian then said "Next.js + TS + Tailwind + Supabase". Inspection confirms most of that — but **Supabase is a stub, not actually wired**. Lead delivery is via Resend (email).

---

## 1. Repo and deployment

- **Path on disk:** `C:\Users\BrianSidenberg\Python\florida-security-concepts`
- **GitHub remote:** `https://github.com/bsidenberg/florida-security-concepts.git`
- **Branch:** `main`
- **HEAD:** `109a15f` — "Add favicon Apple icon and Open Graph image"
- **Tracked files:** 55
- **Total LOC (tracked):** 14,114 (heavily inflated by `package-lock.json`; meaningful source is closer to ~3,500 LOC across `app/`, `components/`, `lib/`, `data/`)

Last 10 commits — small, focused, ship-ready scope:

| SHA | Subject |
|---|---|
| `109a15f` | Add favicon Apple icon and Open Graph image |
| `e482ec1` | Wire up real Florida Security Concepts contact info |
| `3573c66` | Normalize page titles and canonical fallback to www |
| `be1a3c3` | Add Google Search Console verification |
| `359124f` | Send customer confirmation email after successful lead |
| `d588cfa` | Fix honeypot autofill causing lead form rejections |
| `5bb3a55` | Redeploy with production lead delivery env vars |
| `f949902` | Remove fire alarm service positioning |
| `b161a35` | Initial commit: Florida Security Concepts website |

Reading: this repo is launch-recent. The initial commit lays in the full site; subsequent commits are launch-readiness polish (real contact info, search console, brand assets, lead delivery wiring).

### Deployment

From `DEPLOYMENT.md` and `README.md`:

- **Host:** Vercel (Next.js native; framework auto-detection; no `vercel.json`).
- **Region:** Vercel default.
- **Build:** `next build` (default), 44 prerendered routes + 2 dynamic routes (`/api/leads`, `/contact`).
- **Production URL:** `https://floridasecurityconcepts.com` (per `data/site.ts:27`); canonical is the `www.` form (`data/site.ts:12` — `https://www.floridasecurityconcepts.com`); apex 308-redirects to www.
- **Vercel project name:** not visible in any committed file. Inferred to be `florida-security-concepts` (matches repo name); Brian to confirm.
- **CI:** none configured. Vercel runs the build on push (`README.md:96`).

---

## 2. Next.js architecture

### Router

**App Router** (Next 14.2.35), TypeScript, Tailwind CSS.

### Top-level routes

From `git ls-files` and inspection of each `page.tsx`:

| Route | Render mode | Purpose |
|---|---|---|
| `/` | static (SSG) | Homepage |
| `/contact` | dynamic (`force-dynamic` reads `searchParams`) | Lead capture form; supports `?service=`, `?location=`, `?urgency=` prefill |
| `/services` | static | Service catalog index |
| `/services/[slug]` | SSG via `generateStaticParams` | One page per service (e.g. `/services/gate-automation`) |
| `/industries` | static | Industry catalog index |
| `/industries/[slug]` | SSG | One page per industry (e.g. `/industries/hoa-gated-communities`) |
| `/service-areas` | static | Location catalog index |
| `/service-areas/[slug]` | SSG | One page per city (e.g. `/service-areas/tampa`) |
| `/resources` | static | Resource articles index |
| `/resources/[slug]` | SSG via `generateStaticParams` | **One page per article — this is FSC's article surface today** |
| `/api/leads` | POST, Node.js runtime, `force-dynamic` | Lead intake endpoint |
| `/sitemap.xml` | App Router convention | Auto-generated from `app/sitemap.ts` |
| `/robots.txt` | App Router convention | Auto-generated from `app/robots.ts` |
| `/icon`, `/apple-icon`, `/opengraph-image` | edge runtime, `next/og` `ImageResponse` | Build-time generated brand placeholders |
| `/_not-found` | static | 404 |

### Blog infrastructure

**No `/blog` route.** No `content/`, `posts/`, or `mdx/` directories. No Markdown / MDX files anywhere. The project does not use a markdown processor (no `gray-matter`, `next-mdx-remote`, `contentlayer`, or `velite` in `package.json`).

**The closest thing to a blog is `/resources`.** Articles are typed `Resource` objects in `data/resources.ts`. Each article has structured fields (slug, question/H1, metaTitle, metaDescription, publishedDate, updatedDate, shortAnswer, intro, sections array, faqs array, relatedServices, relatedIndustries, keywords). Rendered at build time via `generateStaticParams` — adding a new article means appending to the array and pushing.

This is **fully file-based content**, no database read at request time.

### Layout / design system

- Global layout: `app/layout.tsx` — Inter + JetBrains Mono fonts, OrganizationSchema, header/footer, skip-to-content link.
- Shared components in `components/`: Header, Footer, Hero, Container/Section/Eyebrow, Breadcrumbs, BreadcrumbSchema, ArticleSchema, FAQSchema, OrganizationSchema, ContactPageSchema, FAQ, IndustryCard, ServiceCard, LocationGrid, CapabilityBar, CTASection, LeadCaptureForm.
- Tailwind config: `tailwind.config.ts` (custom `fsc-*` tokens visible inline in JSX — accent, surface, text-muted, etc.).

---

## 3. Supabase integration

**Critical correction to Brian's prompt assumption: there is no Supabase backend. Supabase is referenced only as a not-yet-implemented stub.**

Evidence:

- `package.json` dependencies: `next`, `react`, `react-dom`, `resend`. **No `@supabase/supabase-js`.**
- No `lib/supabase.ts`, no `lib/leads/providers/supabase.ts` (despite being referenced).
- `lib/leads/leadDelivery.ts:60-66` — when `LEAD_DELIVERY_MODE=supabase` is set, dispatches to a switch case that returns:
  ```
  { ok: false, mode: 'supabase',
    reason: 'Supabase delivery provider is not implemented yet.
             Set LEAD_DELIVERY_MODE to console, resend, or webhook —
             or implement lib/leads/providers/supabase.ts.' }
  ```
- `.env.example:64-68` — `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are listed under "Future" with comment: `Not yet implemented. Selecting LEAD_DELIVERY_MODE=supabase returns a configuration error until lib/leads/providers/supabase.ts is built.`
- `DEPLOYMENT.md:75` — same — Supabase env vars are "Reserved for the not-yet-built Supabase provider".
- `LAUNCH_CHECKLIST.md:30-31` — same — "Future Supabase provider — Not implemented yet".
- `LAUNCH_CHECKLIST.md:215` — known deferred items include "Supabase lead provider (stub returns 'not yet implemented')".

There are **no schema files**, no `migrations/`, no `sql/` folder, no Supabase project connected. **FSC has no database today.** Leads flow Resend → email inbox; nothing is persisted in any data store.

---

## 4. Contact / lead capture

### Form fields captured (from `lib/leads/validateLead.ts`)

Required:
- `fullName` (≥2 chars)
- `phone` (regex `^[+()0-9\s.\-extEXT]{7,32}$`)
- `email` (basic email regex)
- `propertyType` (must match one of 7 allowed values)
- `service` (must match one of 8 allowed values)
- `urgency` (one of: Emergency, This week, This month, Planning / budgeting)

Optional:
- `company`, `city`, `contactMethod` (Email / Phone call / Text message), `message`, `sourcePage`, `serviceSlug`, `industrySlug`, `locationSlug`, `utmSource`, `utmMedium`, `utmCampaign`, `referrer`

Server-side: `submittedAt` (ISO timestamp).

Honeypot field (`honeypot`) is checked first; non-empty → silently rejected with generic "Submission rejected." error.

### Delivery path

`POST /api/leads` (`app/api/leads/route.ts`):
1. Content-Type guard: must include `application/json` else 415.
2. Body size guard: 32KB cap else 413.
3. JSON parse: invalid → 400.
4. `validateLead()` (sanitize, validate, honeypot check) → 400 with field-level errors on failure.
5. `deliverLead()` dispatches by `LEAD_DELIVERY_MODE` env:
   - `console` → `lib/leads/providers/console.ts` (server log only)
   - `resend` → `lib/leads/providers/resend.ts` (email via Resend SDK; sends both internal-notification and customer-confirmation emails)
   - `webhook` → `lib/leads/providers/webhook.ts` (POST JSON to `LEADS_WEBHOOK_URL`, optional `X-Webhook-Secret`)
   - `supabase` → returns config error (not implemented)
6. On delivery failure: 503 with user-friendly error.
7. On success: 200 with success message.

**In production, `LEAD_DELIVERY_MODE=resend` is the only sane setting.** Console mode in prod emits a `[PROD-FALLBACK]` warning per lead. Misconfigured env returns 503 — no silent fallback.

### Universal lead minimum (Prime Strategy Section 5)

Strategy doc requires every lead to have: name, phone, email, address.

| Universal field | FSC capture |
|---|---|
| name | ✅ `fullName` (required) |
| phone | ✅ `phone` (required) |
| email | ✅ `email` (required) |
| address | **partial** — `city` is optional, no street address field at all |

**FSC's lead capture covers 3 of 4 universal lead minimums.** The "address" requirement is satisfied at the city level only when the submitter chooses to fill in city. No street address is ever requested. For Prime's metric architecture (qualified-lead computation, attribution, region-specific routing), that's fine for FSC — the service-area attribution comes from `locationSlug` on the form. But it does mean Prime cannot strictly enforce "name + phone + email + street address" as a qualification gate for FSC. Recommendation: redefine "address" for FSC as "city or locationSlug present".

---

## 5. Content management

**Content authoring today: TypeScript files in `data/`.**

| File | Type | What it holds |
|---|---|---|
| `data/site.ts` | `site` object + helpers | Branding, real contact info (phone is filled — `+13522820692`; email `info@floridasecurityconcepts.com`; city Clermont; address.street still blank), nav config, social links |
| `data/services.ts` | `Service[]` | Full service catalog rendered at `/services` and `/services/[slug]` |
| `data/industries.ts` | `Industry[]` | Same pattern for industries |
| `data/locations.ts` | `Location[]` | Same for service-area cities |
| `data/resources.ts` | `Resource[]` | **Article catalog** — each entry is a complete content brief with structured `sections`, `faqs`, related links, keywords; rendered at `/resources/[slug]` |

The `Resource` type schema (`data/resources.ts:4-24`):

```ts
type ResourceSection = {
  heading: string;
  body: string[];      // paragraphs
  bullets?: string[];
};

type Resource = {
  slug: string;
  question: string;       // page H1, written as a question
  metaTitle: string;
  metaDescription: string;
  publishedDate: string;
  updatedDate: string;
  shortAnswer: string;    // direct answer at top
  intro: string;
  sections: ResourceSection[];
  faqs: { q: string; a: string }[];
  relatedServices: string[];
  relatedIndustries: string[];
  keywords: string[];
};
```

The `/resources/[slug]/page.tsx` route emits Article schema, FAQ schema, and Breadcrumb schema automatically based on these fields. SEO infrastructure is mature out of the box.

**No admin UI.** No CMS. No web-based content editing. Articles ship via git commit → Vercel rebuild → CDN propagation.

### Cleanest pattern for Prime to publish blog content

Three options, in increasing complexity:

**Option A — extend the `/resources` content model (recommended).** Prime generates a `Resource` object → commits to `data/resources.ts` (or a per-article file under `data/resources/<slug>.ts` if Brian wants finer-grained version control) → push to `main` → Vercel auto-deploys (~60s).

Pros:
- Zero new infrastructure. Reuses the route, the schema emission, the layout.
- The `Resource` type already maps cleanly onto SEO blog structure (H1 question, short-answer block, sections with bullets, FAQ, keywords, related links).
- Versioning is git-native — every article publish is a commit, fully auditable.
- Brian can review and revert articles like any code change.

Cons:
- Each article is a deploy. Fine for the strategy doc's cadence (max 1 blog post per week per tenant — `PRIME-STRATEGY.md` Section 4 soft coordinator).
- Requires Prime to have a GitHub commit + push capability (would need GitHub App or PAT). New integration surface for Prime.
- If `data/resources.ts` is one giant file, concurrent edits could race. Splitting into per-slug files mitigates.

**Option B — add a Supabase-backed dynamic blog at `/blog/[slug]`.** Build the `lib/leads/providers/supabase.ts` stub for leads, plus a `posts` table for content. `/blog/[slug]` reads at request time (or with ISR caching).

Pros:
- No deploy per article. Prime writes a row, content goes live immediately.
- Could share a Supabase project with FPB / Prime backend for unified ops.

Cons:
- Adds Supabase as a runtime dependency (currently zero — FSC has no database).
- New integration surface for Prime: `posts` table schema, write API, draft/published states.
- Doubles the article-rendering surface (resources + blog) which fragments SEO and confuses navigation.
- Loses git-native versioning and review workflow.

**Option C — add a headless CMS (Contentful / Storyblok).** Same publishing flow as Option B but via third-party API.

Pros:
- Brian (or future content reviewers) can edit in a web UI.
- Battle-tested admin surface.

Cons:
- New subscription (Contentful free tier OK for low volume).
- Three article surfaces if `/resources` keeps file-based: code + Supabase + CMS.

**Recommendation: Option A.** Lowest-friction, preserves the structured content model FSC already invested in, fits Prime's "tag every action with account_id and commit-as-action" architecture cleanly. Each blog publish becomes a Prime action of type `publish_blog_post` that opens a PR or commits directly to `main` after approval.

---

## 6. Tooling and integrations already in place

### npm dependencies (production)

| Package | Version | Purpose |
|---|---|---|
| `next` | ^14.2.35 | Framework |
| `react`, `react-dom` | ^18.3.1 | UI runtime |
| `resend` | ^6.12.2 | Lead email delivery |

### npm devDependencies

| Package | Purpose |
|---|---|
| `@types/*` | TS types |
| `autoprefixer`, `postcss`, `tailwindcss` ^3.4.17 | Tailwind toolchain |
| `eslint`, `eslint-config-next` | Lint |
| `typescript` ^5.5.4 | TS compiler |

That's the entire dependency footprint. FSC is deliberately minimal.

### AI integrations

**None.** No `@anthropic-ai/sdk`, no `openai`, no fetch calls to AI APIs anywhere in the code. No Anthropic, no OpenAI, no other model provider. (Confirmed by grep.)

### Analytics

**None.** No GA4 (`gtag`/`GoogleAnalytics`), no Meta Pixel (`fbq`), no PostHog, no Plausible, no Vercel Analytics installed. The matches against `tostringtag` in package-lock.json are unrelated false positives.

`LAUNCH_CHECKLIST.md:225` flags this explicitly: *"Analytics (GA4 or Plausible) — wire whichever Brian prefers; the form already captures UTM and referrer fields, so attribution works without a third-party analytics script."*

### Tracking pixels

**None.** No Meta pixel, no Google Ads conversion script.

### Schema markup / SEO infrastructure

**Mature and production-ready.** From `components/Schema.tsx` (referenced throughout):
- `OrganizationSchema` rendered globally in `app/layout.tsx`.
- `ArticleSchema` on every `/resources/[slug]` page.
- `FAQSchema` on resource pages with FAQ blocks.
- `BreadcrumbSchema` on every nested route.
- `ContactPageSchema` on `/contact`.

`app/layout.tsx:69-72` includes Google Search Console verification: `google: '6eUk_tq6HeTljucVT9bMJKri3z8eGdoXu1nXfQw48mI'`.

Sitemap (`app/sitemap.ts`) and robots (`app/robots.ts`) are generated via App Router conventions. `LAUNCH_CHECKLIST.md` documents the Google Search Console + Bing Webmaster Tools setup.

---

## 7. Open questions surfaced by the inspection

### What changes in TENANT-MODEL-SPEC.md

| Spec assumption | Reality | Action |
|---|---|---|
| FSC is on Webflow (Spec §4.1, §4.2) | FSC is on Next.js + TypeScript on Vercel | **Replace §4 entirely.** No Webflow Blog Collection setup needed; the publishing path is Option A above (extend `/resources`). |
| FSC platform recommendation: "Stay on Webflow, add a Blog Collection" (Spec §4.3) | FSC has a `/resources` article surface already, with Article schema, FAQ schema, structured content type | **Recommendation becomes:** Stay on the existing Next.js stack. Extend `data/resources.ts` (or split into per-slug files) for Prime-published articles. Possibly add a `/blog` route as an alias only if Brian wants visual separation between FSC's hand-curated guides and Prime-generated content. |
| Open question 6.10 ("Confirm FSC platform is Webflow") | Resolved — confirmed Next.js | **Strike Q6.10** from the spec's open-questions list. |
| Spec §5 (Lovable for Weld) is unaffected | n/a | No change. |

### Does FSC's Supabase project share infrastructure with FPB / Prime?

**FSC has no Supabase project.** The question is moot in its current form. The right reformulation: *if* Prime adds a Supabase-backed component to FSC (Option B from §5 above, or a per-tenant content table on Prime's existing Supabase), should it go in Prime's existing Supabase project (`flabvhdgqddbfitbqjqk` per Brian's prompt) or a separate FSC project?

**Recommendation: same Prime Supabase project.** Reasons:
- One credential surface to manage.
- Cross-tenant analytics from Prime's dashboard already query that project; adding FSC content rows there keeps the data adjacency.
- Strategy doc's architectural principle 1 (multi-tenant from day one) and 4 (no fork between internal and external) push toward a single shared backend with `account_id`-scoped rows.

But this is a Phase 1+ decision — Phase 0 doesn't need to add any Supabase tables for FSC content because Option A (file-based) is the recommended path.

### Should Prime publish FSC blog content as MDX files or Supabase rows?

**Neither — TypeScript objects in `data/resources.ts` (Option A from §5).** That matches the existing pattern. Prime's commit looks like:

```diff
// data/resources.ts
 export const resources: Resource[] = [
+  {
+    slug: 'access-control-mistakes-property-managers-make',
+    question: 'Common Access Control Mistakes Property Managers Make',
+    publishedDate: '2026-05-21',
+    updatedDate: '2026-05-21',
+    ...
+  },
   { slug: 'how-much-does-an-automatic-gate-cost', ... },
   ...
 ];
```

If Brian later wants MDX for richer content (embedded code blocks, custom React components), migrate then. The current `Resource` shape (sections with paragraphs + optional bullets, FAQs, schema-emitting fields) is more than enough for SEO blog content.

### Are there existing blog routes / infrastructure to extend?

**Yes — `/resources` is the existing surface.** Greenfield is unnecessary. The structured `Resource` type, the route, the schema emission, the layout, the related-services + related-industries cross-linking are all in place.

### New questions Brian should answer before Phase 1 SEO blog work

| # | Question | Default if Brian defers |
|---|---|---|
| F1 | Publish under `/resources` (mixed with hand-curated guides) or under a new `/blog` (separated)? | `/resources` — single article surface keeps SEO authority concentrated. |
| F2 | Single `data/resources.ts` array, or split into per-slug files (`data/resources/<slug>.ts`)? | Split into per-slug files. Easier git review; concurrent Prime publishes don't merge-conflict. Requires a tiny refactor in `data/resources.ts` to glob-import. |
| F3 | Prime commits via GitHub App (cleaner) or PAT (simpler)? | GitHub App scoped to the FSC repo — auditable identity, can be revoked, fits multi-tenant model. |
| F4 | Each Prime publish: PR or direct commit to `main`? | PR for first 5 publishes per the holdout list; direct-commit-to-main once graduated to Tier 2. |
| F5 | When does FSC need analytics? Phase 1 cron starts measuring lead volume — without GA4 / Plausible, we have form submissions only, no organic-traffic numbers. | Add Plausible (privacy-friendly, lightweight, $9/mo) in Phase 0 alongside FSC tenant activation, OR rely on Google Search Console + Vercel Logs through Phase 1 month 1 then revisit. |
| F6 | Lead capture: do we keep Resend-only delivery, or also start writing to Prime's Supabase `leads` table for unified attribution? | Build the `lib/leads/providers/supabase.ts` stub — write to BOTH Resend (preserves email notifications) AND Supabase (so Prime's `/api/leads` and attribution work uniformly across tenants). One small file, clear separation, no behavior change to the existing Resend path. This is a Phase 0 sub-task candidate. |
| F7 | FSC's `address.street` and `address.postalCode` are blank — does this gate any Prime work? | No — strategy doc's universal lead minimum ("name, phone, email, address") is for inbound lead data, not the company's own address. No action. |

### Items that should now be added to the upcoming sub-task plan

1. **Build `lib/leads/providers/supabase.ts` in the FSC repo** so FSC leads land in Prime's `leads` table with `account_id = FSC.id`. Without this, Prime's lead-volume metrics for FSC will always be zero — leads exist only as Resend emails, invisible to Prime. (See F6.) Estimated: ~80 LOC + env var documentation update + README update.
2. **Decide F1 (resources vs blog) and F2 (one file vs per-slug)** before Sub-Task 4 / Sub-Task 5 planning, since the autonomy posture for `publish_blog_post` actions depends on the publishing target.
3. **Update TENANT-MODEL-SPEC.md** Section 4 to reflect the corrected platform finding. Either as an addendum block or a follow-up commit replacing §4 entirely.

---

End of inspection. No file modifications outside this report.
