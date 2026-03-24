# Marketing AI Bot — Complete Setup Guide

## What You're Building

An AI-powered marketing automation system where Claude acts as your personal marketing agency. It monitors Google Ads, Facebook Ads, SEO, local/GEO SEO, blog content, and competitor activity — then recommends (and optionally executes) optimizations.

---

## PHASE 1: Foundation (Do These First)

### Step 1: Get Claude Pro or Team

You need a paid Claude plan to access Cowork.

1. Go to [claude.ai](https://claude.ai)
2. Click your profile → **Settings** → **Subscription**
3. Subscribe to **Claude Pro** ($20/month) or **Claude Team** ($25/user/month)

### Step 2: Install Claude Desktop App

Cowork runs through the desktop app, not the browser.

1. Download from [claude.ai/download](https://claude.ai/download)
2. Install and sign in with your Claude account
3. Go to **Settings** → Enable **Cowork** (it may be labeled as a beta feature)

### Step 3: Install Claude Code (Optional but Recommended)

Claude Code lets you run automations from your terminal. This is how you'll schedule recurring tasks.

```bash
npm install -g @anthropic-ai/claude-code
```

Requirements: Node.js 18+. If you don't have Node, install it from [nodejs.org](https://nodejs.org).

---

## PHASE 2: API Keys & Accounts (YOU Must Do These Steps)

These are the integrations that require YOUR credentials. I'll tell you exactly where to go and what to click.

### Step 4: Google Ads API

**What you need:** Developer Token, Customer ID, OAuth2 credentials

1. Go to [ads.google.com](https://ads.google.com) and sign into your Google Ads account
2. Click the **wrench icon** (Tools & Settings) → **API Center**
3. If you don't see API Center, you need to request access — click "Apply for access" and fill out the form (approval usually takes 1-3 business days)
4. Once approved, copy your **Developer Token**
5. Note your **Customer ID** (the XXX-XXX-XXXX number at the top of Google Ads)
6. Go to [console.cloud.google.com](https://console.cloud.google.com)
7. Create a new project (name it "Marketing Bot")
8. Go to **APIs & Services** → **Enable APIs** → search for and enable **Google Ads API**
9. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
10. Set application type to **Desktop App**
11. Download the JSON credentials file — save it as `google-ads-credentials.json`
12. You'll need to run the OAuth flow once to get a **refresh token** (instructions in Phase 3)

**Save these values:**
- Developer Token: `_______________`
- Customer ID: `_______________`
- OAuth Client ID: `_______________`
- OAuth Client Secret: `_______________`

### Step 5: Google Search Console API

**What you need:** Service account credentials

1. In the same Google Cloud project from Step 4
2. Go to **APIs & Services** → **Enable APIs** → enable **Search Console API**
3. Go to **Credentials** → **Create Credentials** → **Service Account**
4. Name it "marketing-bot-seo"
5. Download the JSON key file — save as `search-console-key.json`
6. Go to [search.google.com/search-console](https://search.google.com/search-console)
7. Click **Settings** → **Users and permissions** → **Add user**
8. Add the service account email (from the JSON file) with **Full** permission

### Step 6: Meta (Facebook) Marketing API

**What you need:** App ID, App Secret, Access Token, Ad Account ID

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Click **My Apps** → **Create App**
3. Select **Other** → **Business** type
4. Name it "Marketing Bot"
5. Once created, go to **App Settings** → **Basic** — copy your **App ID** and **App Secret**
6. Go to **Marketing API** in the left sidebar → **Tools**
7. Generate a **User Access Token** with these permissions:
   - `ads_management`
   - `ads_read`
   - `business_management`
   - `pages_read_engagement`
8. **IMPORTANT:** This token expires in 60 days. To get a long-lived token, run:
   ```
   https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=YOUR_APP_ID&client_secret=YOUR_APP_SECRET&fb_exchange_token=YOUR_SHORT_TOKEN
   ```
9. Go to [adsmanager.facebook.com](https://adsmanager.facebook.com) — your **Ad Account ID** is in the URL (starts with `act_`)

**Save these values:**
- App ID: `_______________`
- App Secret: `_______________`
- Long-lived Access Token: `_______________`
- Ad Account ID: `_______________`

### Step 7: Google Analytics 4 (GA4) API

1. In your Google Cloud project, enable the **Google Analytics Data API**
2. The same service account from Step 5 works here
3. Go to [analytics.google.com](https://analytics.google.com) → **Admin** → **Property Access Management**
4. Add your service account email with **Viewer** access
5. Note your **Property ID** (found in Admin → Property Settings)

### Step 8: Your CMS (WordPress or Webflow)

**For WordPress:**
1. Go to your WordPress admin → **Users** → your profile
2. Scroll to **Application Passwords**
3. Create a new application password named "Marketing Bot"
4. Copy the password (you'll only see it once)
5. Your API endpoint is: `https://yoursite.com/wp-json/wp/v2/`

**For Webflow:**
1. Go to [webflow.com](https://webflow.com) → Account Settings → **Integrations**
2. Click **Generate API Token**
3. Give it CMS read/write access
4. Copy the token

**Save these values:**
- CMS URL: `_______________`
- API Key/Password: `_______________`

---

## PHASE 3: MCP Server Configuration

This is where you connect everything to Claude. MCP (Model Context Protocol) servers let Claude interact with all your marketing APIs.

### Step 9: Create the MCP Configuration File

On your computer, find or create the Claude Desktop config file:

**Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

### Step 10: Paste This Configuration

Replace the placeholder values with your actual credentials from Phase 2.

```json
{
  "mcpServers": {
    "google-ads": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-google-ads"],
      "env": {
        "GOOGLE_ADS_DEVELOPER_TOKEN": "YOUR_DEVELOPER_TOKEN",
        "GOOGLE_ADS_CUSTOMER_ID": "YOUR_CUSTOMER_ID",
        "GOOGLE_ADS_CLIENT_ID": "YOUR_CLIENT_ID",
        "GOOGLE_ADS_CLIENT_SECRET": "YOUR_CLIENT_SECRET",
        "GOOGLE_ADS_REFRESH_TOKEN": "YOUR_REFRESH_TOKEN"
      }
    },
    "google-search-console": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-google-search-console"],
      "env": {
        "GOOGLE_SERVICE_ACCOUNT_KEY_PATH": "/path/to/search-console-key.json",
        "SEARCH_CONSOLE_SITE_URL": "https://yoursite.com"
      }
    },
    "meta-ads": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-meta-marketing"],
      "env": {
        "META_ACCESS_TOKEN": "YOUR_LONG_LIVED_TOKEN",
        "META_AD_ACCOUNT_ID": "act_YOUR_ACCOUNT_ID"
      }
    },
    "google-analytics": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-google-analytics"],
      "env": {
        "GOOGLE_SERVICE_ACCOUNT_KEY_PATH": "/path/to/search-console-key.json",
        "GA4_PROPERTY_ID": "YOUR_PROPERTY_ID"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/yourname/marketing-bot"]
    }
  }
}
```

**IMPORTANT NOTE:** The exact MCP server package names above are examples. As of early 2026, the MCP ecosystem is growing rapidly. Check the following for the latest available servers:

- [https://github.com/modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)
- Search npm for `@modelcontextprotocol/` packages
- Check Anthropic's MCP docs for verified integrations

If an official MCP server doesn't exist for a specific API, you can build a custom one (see Phase 5 below).

### Step 11: Create Your Project Folder

```bash
mkdir ~/marketing-bot
mkdir ~/marketing-bot/reports
mkdir ~/marketing-bot/content
mkdir ~/marketing-bot/competitor-intel
mkdir ~/marketing-bot/brand-assets
```

### Step 12: Restart Claude Desktop

Close and reopen Claude Desktop. It will load the MCP servers. You should see them listed when you click the tools icon in a new conversation.

---

## PHASE 4: The Prompts (Copy-Paste These Into Claude)

These are the exact prompts to use in Claude Cowork or Claude Desktop conversations. Each one is a specific automation workflow.

### Master System Prompt (Pin This in Every Conversation)

Open a new Claude conversation and paste this as your first message:

```
You are my personal AI marketing manager. Here is my business context:

BUSINESS:
- Name: [YOUR BUSINESS NAME]
- Website: [YOUR URL]
- Industry: [YOUR INDUSTRY]
- Target audience: [DESCRIBE YOUR IDEAL CUSTOMER]
- Main products/services: [LIST THEM]
- Geographic focus: [LOCAL/NATIONAL/GLOBAL + specific areas]
- Monthly marketing budget: $[AMOUNT]
- Main competitors: [LIST 3-5 COMPETITORS AND THEIR WEBSITES]

BRAND VOICE:
- Tone: [professional/casual/playful/authoritative/etc.]
- Key messaging pillars: [LIST 3-5 CORE MESSAGES]
- Words we use: [LIST PREFERRED TERMS]
- Words we avoid: [LIST TERMS TO AVOID]

GOALS:
- Primary KPI: [e.g., leads, sales, ROAS target]
- Monthly targets: [specific numbers]
- Current biggest challenge: [describe it]

RULES:
- Always recommend actions before taking them — I approve first
- Flag any spend increase over 15% for manual approval
- Never pause campaigns without my explicit approval
- Prioritize ROAS over volume
- All blog content must match our brand voice above
```

### Daily Morning Brief Prompt

Use this every morning (or set up as a scheduled Cowork task):

```
Run my daily marketing morning brief:

1. GOOGLE ADS: Pull yesterday's performance for all active campaigns.
   Show spend, clicks, conversions, CPA, and ROAS.
   Flag any keywords with CPA > 2x our target.
   Flag any ad groups with quality score drops.

2. FACEBOOK ADS: Pull yesterday's performance for all active ad sets.
   Show spend, reach, conversions, CPA, and ROAS.
   Flag any audience segments underperforming by >20%.

3. SEO: Check Search Console for any ranking changes in
   our top 20 keywords. Flag drops of 3+ positions.

4. WEBSITE: Pull GA4 data for yesterday — sessions, bounce rate,
   conversion rate. Compare to 7-day average.

5. RECOMMENDATIONS: Based on all the above, give me a prioritized
   list of 3-5 actions to take today. Format as:
   [HIGH/MED/LOW] - [Channel] - [Specific action] - [Expected impact]
```

### Weekly Competitor Analysis Prompt

Use this weekly:

```
Run weekly competitor intelligence:

Competitors to analyze: [COMPETITOR 1 URL], [COMPETITOR 2 URL], [COMPETITOR 3 URL]

For each competitor:
1. Check their Meta Ad Library for new/changed ads this week
   (go to facebook.com/ads/library and search for them)
2. Check Google for their top ranking pages on our target keywords
3. Note any new blog posts or content they published
4. Check for any pricing changes on their main product pages
5. Check their Google Business Profile for any updates

Then give me:
- A summary of what each competitor is doing differently this week
- Any threats I should respond to immediately
- Any opportunities they're missing that we should exploit
- Draft ad copy or content ideas inspired by gaps in their strategy
```

### Blog Content Generation Prompt

```
Generate this week's blog content plan:

1. Check Search Console for keywords where we rank positions 5-15
   (these are our best opportunities for quick wins)
2. Cross-reference with Google Ads data — which keywords convert best?
3. Check what competitors have published recently on these topics

Based on this analysis:
- Propose 2 blog post titles optimized for our best opportunity keywords
- For the #1 priority post, write a complete draft:
  - 1500-2000 words
  - Include our target keyword naturally (2-3% density)
  - Write an SEO-optimized meta title (under 60 chars) and meta description (under 155 chars)
  - Include H2 and H3 subheadings with related keywords
  - Suggest 3 internal links to our existing content
  - Match our brand voice exactly
- Save the draft to my content folder
```

### Monthly Strategy Review Prompt

```
Run my monthly marketing strategy review:

1. PERFORMANCE SUMMARY
   - Total spend across all channels this month
   - Total attributed revenue / leads
   - Overall ROAS and month-over-month trend
   - Best performing channel and worst performing channel

2. GOOGLE ADS DEEP DIVE
   - Top 10 keywords by conversion volume
   - Bottom 10 keywords by CPA (candidates for pause)
   - Search term report — any new high-intent terms to add?
   - Ad copy performance — which headlines/descriptions win?

3. META ADS DEEP DIVE
   - Best performing audiences
   - Creative fatigue — any ads with declining CTR over 30 days?
   - Suggest 3 new audience tests for next month

4. SEO PROGRESS
   - Keyword ranking changes (up vs down)
   - New keywords we've entered top 20 for
   - Technical SEO issues from Search Console
   - Content performance — which posts drive the most traffic?

5. NEXT MONTH PLAN
   - Budget allocation recommendation across channels
   - Top 5 priority actions
   - Content calendar (4 blog posts + topics)
   - New tests to run
```

### Ad Copy Generation Prompt

```
I need new ad copy for [CHANNEL: Google/Facebook]:

PRODUCT/SERVICE: [what you're promoting]
TARGET AUDIENCE: [who sees this ad]
GOAL: [clicks/conversions/awareness]
BUDGET: $[daily budget]
CURRENT BEST PERFORMER: [paste your current best ad copy]

Generate:
- For Google Ads: 5 responsive search ad variations
  (15 headlines max 30 chars each, 4 descriptions max 90 chars each)
- For Facebook: 3 primary text variations, 3 headline variations,
  3 description variations
- Pin the strongest value proposition as Headline 1

Match our brand voice. Focus on [SPECIFIC ANGLE/OFFER].
Make each variation test a different emotional trigger:
urgency, social proof, value, curiosity, fear of missing out.
```

### GEO / Local SEO Prompt

```
Run local SEO audit and optimization:

1. Check our Google Business Profile for completeness
   - Are all hours correct?
   - Are all services/products listed?
   - When was the last post published?
   - How many reviews do we have and what's our average rating?

2. Generate 2 Google Business Profile posts:
   - 1 promotional (highlight a product/service/offer)
   - 1 informational (tip or insight relevant to our industry)
   - Include a call-to-action and relevant keywords

3. Draft 3 review response templates:
   - 1 for 5-star reviews (grateful, specific, encourages return)
   - 1 for 3-star reviews (acknowledges feedback, offers resolution)
   - 1 for 1-star reviews (empathetic, takes conversation offline)

4. Local keyword opportunities:
   - What "[service] near me" and "[service] in [city]" keywords
     should we target?
   - Any local content ideas? (neighborhood guides, local partnerships)
```

---

## PHASE 5: Building Custom MCP Servers (If Needed)

If an official MCP server doesn't exist for one of your tools, here's how to build one. Paste this prompt into Claude Code:

```
Help me build a custom MCP server for [PLATFORM NAME].

Here's the API documentation: [PASTE API DOCS URL]

The server should support these operations:
- Read campaign/content performance data
- List active campaigns/posts
- Create new campaigns/posts (with approval flow)
- Update existing campaigns/posts
- Get analytics/reporting data

Build it as a Node.js MCP server following the official
MCP SDK patterns. Include error handling, rate limiting,
and authentication refresh logic.

Save it to ~/marketing-bot/mcp-servers/[platform-name]/
```

---

## PHASE 6: Automation Schedule

Once everything is connected and you've tested the prompts manually, set up recurring automations.

### Option A: Using Cowork Scheduled Tasks

In Claude Desktop with Cowork enabled, you can set up recurring workflows. The exact method depends on the current Cowork feature set — check Settings → Cowork → Automations.

### Option B: Using Cron + Claude Code

Create a shell script for each automation:

```bash
# ~/marketing-bot/scripts/daily-brief.sh
#!/bin/bash
cd ~/marketing-bot
claude-code --prompt "$(cat prompts/daily-brief.txt)" --output reports/daily/$(date +%Y-%m-%d).md
```

Then add to crontab:

```bash
crontab -e

# Daily morning brief at 8 AM
0 8 * * * ~/marketing-bot/scripts/daily-brief.sh

# Weekly competitor analysis on Mondays at 9 AM
0 9 * * 1 ~/marketing-bot/scripts/weekly-competitor.sh

# Monthly review on the 1st at 10 AM
0 10 1 * * ~/marketing-bot/scripts/monthly-review.sh
```

---

## PHASE 7: Safety & Best Practices

### Start Read-Only

For the first 2 weeks, only use Claude to ANALYZE and RECOMMEND. Don't let it make changes to live campaigns. This builds your trust in its judgment.

### Approval Thresholds

Set these rules in your system prompt:
- **Auto-approve:** Bid adjustments under 10%, pausing keywords with zero conversions in 30 days
- **Require approval:** Budget changes, new campaigns, pausing campaigns, any change over $50/day impact
- **Never auto-approve:** Account structure changes, audience deletion, campaign deletion

### Budget Guardrails

Add this to your system prompt:
```
BUDGET RULES:
- Daily spend cap across all channels: $[YOUR MAX]
- Never increase any single campaign budget by more than 25% in one day
- If any campaign CPA exceeds 3x target for 3 consecutive days, flag it immediately
- Weekly spend must stay within 10% of the weekly budget allocation
```

### Data Backup

```bash
# Add to your weekly cron
0 6 * * 0 cp -r ~/marketing-bot/reports ~/marketing-bot/backups/$(date +%Y-%m-%d)/
```

---

## Quick Reference: What Requires YOUR Action

| Task | Why You Must Do It |
|------|-------------------|
| Create API accounts & keys | Security — only you should handle credentials |
| Initial OAuth authorization | Requires browser login with your accounts |
| Approve budget increases >15% | Financial safety guardrail |
| Review ad copy before launch | Brand safety |
| Approve blog posts before publish | Quality control |
| Renew Meta access token every 60 days | API requirement |
| Monthly strategy review | Strategic decisions need human judgment |

---

## Troubleshooting

**Claude can't connect to an API:**
Check the MCP config file for typos. Restart Claude Desktop. Check that Node.js packages are installed.

**Google Ads API access denied:**
Your developer token may still be pending approval. Check the API Center in Google Ads.

**Meta token expired:**
Re-run the token exchange URL from Step 6 to get a new long-lived token.

**MCP server not showing in Claude:**
Make sure the config JSON is valid (use a JSON validator). The file path must be exactly right for your OS.
