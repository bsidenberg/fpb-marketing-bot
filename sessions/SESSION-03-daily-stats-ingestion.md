# SESSION 03 — campaign_daily_stats nightly ingestion (Google)

GOAL: campaign_daily_stats has 0 rows, which leaves evaluate-outcomes and the entire learning loop inert. Build a nightly ingestion that pulls per-campaign daily metrics from Google Ads (v23) and upserts them.

FILE SCOPE: new api/cron-daily-stats.js, new api/lib/daily-stats.js, api/lib/campaign-stats.js (extend only if needed), vercel.json (add cron entry), .env.example, new tests/daily-stats.test.js, tests/cron mocks as needed, sql/016_daily_stats_upsert_index.sql ONLY if a unique index for upsert is missing. Nothing else.

PHASE A (read-only): scout campaign_daily_stats schema (see sql/003), the evaluate-outcomes reader (what columns/grain it expects - THIS DEFINES THE CONTRACT), fetchGoogleAdsData for the segmented-by-date GAQL pattern, cron auth pattern in cron-analyze.js. Present: GAQL query (segments.date, last 3 days for late-conversion restatement), upsert key (account_id, campaign_id, date), cron schedule (propose 11:45 UTC, before the 12:30 analyze), failure behavior (log + continue per account), and cost-ledger recording. STOP for approval.
PHASE B: implement with mocks; NO live credentials in tests. PHASE C: floor 443 + new tests; report the exact one-line PowerShell curl Brian can run to trigger the cron manually once (with CRON_SECRET header) for first-fill validation.

DoD: manual trigger fills rows for FPB campaigns; evaluate-outcomes can read them; nightly cron registered.
