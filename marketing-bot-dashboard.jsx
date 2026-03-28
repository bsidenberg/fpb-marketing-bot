import { useState, useEffect, useReducer, useCallback } from "react";

// ── Design tokens ──
const C = {
  bgBase:    "#f3f4f6",   // Gray-100 page bg
  bgSurface: "#ffffff",   // White cards
  bgRaised:  "#ffffff",   // White cards
  bgOverlay: "#f9fafb",
  bgInput:   "#f9fafb",

  borderDim: "#e5e7eb",   // Gray-200
  borderMed: "#d1d5db",   // Gray-300
  borderHi:  "#9ca3af",   // Gray-400

  gold:     "#c0272d",    // Brand Red
  goldLt:   "#e04a4f",
  goldDk:   "#8b1a1e",
  goldGlow: "rgba(192,39,45,0.12)",

  textPrimary:   "#3a3a3a",   // Charcoal
  textSecondary: "#374151",   // Gray-700
  textMuted:     "#6b7280",   // Gray-500
  textDim:       "#9ca3af",   // Gray-400

  emerald: "#16a34a",   // Green-600 (readable on white)
  sapphire: "#2563eb",  // Blue-600
  amber:   "#c0272d",   // Brand Red
  rose:    "#dc2626",   // Red-600
  violet:  "#c0272d",   // Brand Red
  teal:    "#0284c7",   // Sky-600
};
const F = {
  serif: "'Inter', system-ui, sans-serif",
  sans:  "'Inter', system-ui, sans-serif",
  mono:  "'DM Mono', monospace",
};

// ── Injected global styles ──
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }

  body {
    background: #f3f4f6;
    min-height: 100vh;
    font-family: 'Inter', system-ui, sans-serif;
    color: #3a3a3a;
    position: relative;
    overflow-x: hidden;
  }
  #root { position: relative; z-index: 1; }

  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #2b3a6b; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #374d8a; }

  @keyframes pipPulse {
    0%,100% { opacity:1; box-shadow: 0 0 8px #22d472; }
    50%      { opacity:0.5; box-shadow: 0 0 3px #22d472; }
  }
  @keyframes panelIn {
    from { opacity:0; transform:translateY(10px); }
    to   { opacity:1; transform:translateY(0); }
  }
  @keyframes spin { to { transform:rotate(360deg); } }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

  .pip {
    display: inline-block;
    width: 5px; height: 5px; border-radius: 50%;
    background: #22d472;
    animation: pipPulse 2.4s infinite;
    flex-shrink: 0;
  }

  .app-header {
    position: relative;
    height: 64px;
    background: rgba(26,36,68,0.97);
    backdrop-filter: blur(28px);
    border-bottom: 1px solid rgba(209,213,219,0.10);
    padding: 0 24px;
    display: flex; align-items: center; justify-content: space-between;
    z-index: 10;
  }
  .app-header::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, transparent, #8b1a1e 20%, #c0272d 50%, #8b1a1e 80%, transparent);
    opacity: 0.9;
  }

  .logo-box {
    width: 38px; height: 38px;
    background: linear-gradient(145deg, #2b3a6b, #1a2444);
    border: 1px solid #c0272d;
    border-radius: 10px;
    box-shadow: 0 0 20px rgba(192,39,45,0.22), inset 0 1px 0 rgba(255,255,255,0.08);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }

  .nav-tab {
    display: flex; align-items: center; gap: 6px;
    padding: 12px 16px;
    border: none; cursor: pointer;
    background: transparent; color: #9ca3af;
    border-bottom: 2px solid transparent;
    font-family: 'Inter', sans-serif;
    font-size: 12px; font-weight: 500;
    transition: all 0.18s ease;
    white-space: nowrap;
  }
  .nav-tab:hover:not(.active) { color: #ffffff; background: rgba(255,255,255,0.04); }
  .nav-tab.active {
    color: #ffffff;
    border-bottom-color: #c0272d;
    background: rgba(192,39,45,0.08);
  }

  .metric-card {
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 16px;
    padding: 20px 22px;
    position: relative; overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  }
  .metric-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(0,0,0,0.10);
    border-color: #9ca3af;
  }
  .metric-card .card-top-bar {
    position: absolute; top: 0; left: 0; right: 0; height: 2px;
  }
  .metric-card .card-glow {
    position: absolute; top: -20px; right: -20px;
    width: 80px; height: 80px;
    border-radius: 50%; opacity: 0.08;
    pointer-events: none;
  }
  .metric-card .card-corner {
    position: absolute; top: 0; right: 0;
    width: 60px; height: 60px;
    background: linear-gradient(225deg, rgba(255,255,255,0.04), transparent);
    border-bottom-left-radius: 60px;
    pointer-events: none;
  }

  .data-card {
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 12px; padding: 16px;
    position: relative; overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    transition: transform 0.16s ease, box-shadow 0.16s ease;
  }
  .data-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(0,0,0,0.10);
  }
  .data-card::after {
    content: '';
    position: absolute; bottom: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, transparent, #c0272d, transparent);
    opacity: 0;
    transition: opacity 0.16s ease;
  }
  .data-card:hover::after { opacity: 0.6; }

  .live-card {
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 12px; padding: 18px 20px;
    position: relative; overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }
  .live-card .card-top-bar {
    position: absolute; top: 0; left: 0; right: 0; height: 2px;
  }

  .section-label {
    display: flex; align-items: center; gap: 10px;
    font-family: 'DM Mono', monospace;
    font-size: 9.5px; text-transform: uppercase; letter-spacing: 2px;
    color: #2b3a6b; margin-bottom: 12px;
  }
  .section-label::after {
    content: ''; flex: 1; height: 1px;
    background: linear-gradient(90deg, #d1d5db, transparent);
  }

  .activity-row {
    padding: 11px 18px;
    border-bottom: 1px solid #e5e7eb;
    transition: background 0.12s ease;
    display: flex; align-items: center; gap: 10px;
  }
  .activity-row:last-child { border-bottom: none; }
  .activity-row:hover { background: #f9fafb; }

  .badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 9px; border-radius: 10px;
    font-family: 'DM Mono', monospace;
    font-size: 9px; font-weight: 500; letter-spacing: 0.5px;
    white-space: nowrap;
  }
  .badge-complete, .badge-approved, .badge-scheduled {
    background: rgba(34,212,114,0.10); color: #22d472;
    border: 1px solid rgba(34,212,114,0.22);
  }
  .badge-pending, .badge-waiting, .badge-review {
    background: #f3f4f6; color: #6b7280;
    border: 1px solid #d1d5db;
  }
  .badge-rejected {
    background: rgba(192,39,45,0.10); color: #e04a4f;
    border: 1px solid rgba(192,39,45,0.22);
  }
  .badge-draft {
    background: rgba(96,165,250,0.10); color: #60a5fa;
    border: 1px solid rgba(96,165,250,0.22);
  }

  .kw-chip {
    padding: 3px 9px; border-radius: 6px;
    font-family: 'DM Mono', monospace; font-size: 10px;
    background: #f3f4f6; color: #6b7280;
    border: 1px solid #d1d5db;
    transition: all 0.14s ease; cursor: default;
  }
  .kw-chip:hover {
    border-color: rgba(192,39,45,0.4);
    color: #c0272d; background: #fdf2f2;
  }

  .btn-approve {
    background: rgba(34,212,114,0.10); border: 1px solid rgba(34,212,114,0.28);
    color: #22d472; padding: 5px 13px; border-radius: 8px;
    font-size: 11px; cursor: pointer; font-family: 'Inter', sans-serif;
    font-weight: 600; transition: background 0.14s ease;
  }
  .btn-approve:hover { background: rgba(34,212,114,0.18); }

  .btn-reject {
    background: #f3f4f6; border: 1px solid #d1d5db;
    color: #6b7280; padding: 5px 13px; border-radius: 8px;
    font-size: 11px; cursor: pointer; font-family: 'Inter', sans-serif;
    transition: all 0.14s ease;
  }
  .btn-reject:hover { background: #e5e7eb; color: #374151; }

  .btn-approve-all {
    background: linear-gradient(135deg, #8b1a1e 0%, #c0272d 55%, #e04a4f 100%);
    border: none; color: #ffffff;
    padding: 10px 22px; border-radius: 12px;
    font-size: 12px; font-weight: 700; cursor: pointer;
    font-family: 'Inter', sans-serif;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.15);
    transition: transform 0.16s ease, box-shadow 0.16s ease, opacity 0.16s ease;
  }
  .btn-approve-all:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(192,39,45,0.40), inset 0 1px 0 rgba(255,255,255,0.15);
    opacity: 0.94;
  }

  .btn-sync {
    background: linear-gradient(135deg, #8b1a1e 0%, #c0272d 55%, #e04a4f 100%);
    border: none; color: #ffffff;
    padding: 9px 20px; border-radius: 10px;
    font-size: 12px; font-weight: 700; cursor: pointer;
    font-family: 'Inter', sans-serif;
    display: flex; align-items: center; gap: 7px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.15);
    transition: transform 0.16s ease, box-shadow 0.16s ease, opacity 0.16s ease;
  }
  .btn-sync:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(192,39,45,0.40), inset 0 1px 0 rgba(255,255,255,0.15);
    opacity: 0.94;
  }
  .btn-sync:disabled { opacity: 0.50; cursor: not-allowed; transform: none; }

  .btn-view-live {
    background: rgba(192,39,45,0.08);
    border: 1px solid rgba(192,39,45,0.25);
    color: #e04a4f; padding: 6px 14px; border-radius: 8px;
    font-size: 11px; font-weight: 600; cursor: pointer;
    font-family: 'Inter', sans-serif;
    display: inline-flex; align-items: center; gap: 6px;
    transition: all 0.14s ease;
  }
  .btn-view-live:hover {
    background: rgba(192,39,45,0.15);
    color: #ffffff;
    border-color: rgba(192,39,45,0.45);
  }

  .spinner {
    width: 14px; height: 14px;
    border: 2px solid rgba(255,255,255,0.35);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  .campaigns-table {
    width: 100%; border-collapse: collapse; margin-top: 12px;
  }
  .campaigns-table th {
    font-family: 'DM Mono', monospace; font-size: 9px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 1.5px; color: #374151;
    padding: 8px 12px; text-align: left;
    border-bottom: 1px solid #d1d5db;
    background: #f9fafb;
  }
  .campaigns-table td {
    font-family: 'DM Mono', monospace; font-size: 11px; color: #374151;
    padding: 9px 12px;
    border-bottom: 1px solid #d1d5db;
  }
  .campaigns-table tr:nth-child(even) td { background: #f3f4f6; }
  .campaigns-table tr:last-child td { border-bottom: none; }
  .campaigns-table tr:hover td { background: #fdf2f2; }
  .campaigns-table td:first-child { color: #3a3a3a; font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 500; }

  .view-all-btn {
    background: none; border: none; color: #c0272d;
    font-size: 11px; cursor: pointer;
    font-family: 'DM Mono', monospace;
    display: flex; align-items: center; gap: 4px;
    transition: color 0.14s ease;
  }
  .view-all-btn:hover { color: #e04a4f; }

  .step-icon {
    width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 700; font-family: 'DM Mono', monospace;
  }

  .stat-chip {
    background: rgba(255,255,255,0.10);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 20px; padding: 5px 13px;
    font-family: 'DM Mono', monospace; font-size: 11px; color: #d1d5db;
    display: flex; align-items: center; gap: 6px;
  }
`;

// ── Icon components ──
const Icons = {
  Google: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
      <path d="M2 12h20"/>
    </svg>
  ),
  Facebook: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
    </svg>
  ),
  Search: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  Edit: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  ),
  TrendUp: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
    </svg>
  ),
  TrendDown: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>
    </svg>
  ),
  Bot: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/>
    </svg>
  ),
  Check: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  Clock: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  Alert: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  Play: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  ),
  Settings: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>
  ),
  Zap: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  BarChart: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>
    </svg>
  ),
  Globe: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  ),
  Eye: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  ChevRight: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  Refresh: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  ),
};

// ── Mock data ──
const initialState = {
  activeTab: "overview",
  actionQueue: [
    { id: 1, channel: "Google Ads", action: "Pause keyword 'cheap widgets' — CPA $42 vs target $18", status: "pending", priority: "high" },
    { id: 2, channel: "Facebook Ads", action: "Scale Lookalike Audience #3 budget +25% — ROAS 4.2x", status: "pending", priority: "medium" },
    { id: 3, channel: "SEO", action: "Publish optimized blog: '10 Best [Product] for 2026'", status: "pending", priority: "medium" },
    { id: 4, channel: "Google Ads", action: "New responsive search ad for 'premium widgets' — est. CTR 3.8%", status: "pending", priority: "low" },
    { id: 5, channel: "Competitor Intel", action: "Alert: Competitor X launched -20% promo campaign", status: "pending", priority: "high" },
    { id: 6, channel: "GEO / Local", action: "Update Google Business hours for holiday schedule", status: "pending", priority: "low" },
  ],
  metrics: {
    totalSpend: 4280,
    totalRevenue: 18940,
    overallROAS: 4.42,
    leadsThisWeek: 127,
    conversionRate: 3.8,
    organicTraffic: 12400,
  },
  channels: {
    googleAds: { spend: 2100, clicks: 3400, conversions: 89, cpa: 23.6, roas: 3.8, trend: "up" },
    facebookAds: { spend: 1680, reach: 45000, conversions: 64, cpa: 26.25, roas: 4.2, trend: "up" },
    seo: { organicVisits: 12400, keywords: 340, top10: 47, avgPosition: 14.2, trend: "up" },
    blog: { posts: 12, views: 8900, avgTimeOnPage: "3:24", topPost: "Ultimate Guide to Widgets", trend: "up" },
    geo: { impressions: 5600, calls: 34, directions: 89, reviews: 4.7, trend: "up" },
  },
  competitorAlerts: [
    { competitor: "WidgetCo", alert: "New Google Ads campaign targeting your top 5 keywords", time: "2h ago" },
    { competitor: "SuperWidgets", alert: "Published 3 new blog posts on long-tail keywords you rank for", time: "5h ago" },
    { competitor: "WidgetCo", alert: "Running 20% off promotion across all Meta placements", time: "1d ago" },
  ],
  blogQueue: [
    { title: "10 Best Premium Widgets for Small Business 2026", status: "draft", keywords: ["premium widgets", "small business tools"], estTraffic: 2400 },
    { title: "How to Choose the Right Widget: Complete Buyer's Guide", status: "review", keywords: ["widget buyer guide", "how to choose widgets"], estTraffic: 1800 },
    { title: "Widget Industry Trends Q1 2026", status: "scheduled", keywords: ["widget trends", "industry report"], estTraffic: 950 },
  ],
  automationLog: [
    { time: "09:15 AM", action: "Pulled Google Ads performance data", status: "complete" },
    { time: "09:16 AM", action: "Analyzed 34 keywords — flagged 3 for pause", status: "complete" },
    { time: "09:18 AM", action: "Pulled Meta Ads Manager data", status: "complete" },
    { time: "09:20 AM", action: "Competitor scan: WidgetCo, SuperWidgets, MegaWidget", status: "complete" },
    { time: "09:22 AM", action: "Generated blog draft: '10 Best Premium Widgets'", status: "complete" },
    { time: "09:25 AM", action: "SEO audit: 4 pages need meta description updates", status: "complete" },
    { time: "09:30 AM", action: "Waiting for approval on 6 pending actions", status: "waiting" },
  ],
};

function reducer(state, action) {
  switch (action.type) {
    case "SET_TAB":
      return { ...state, activeTab: action.payload };
    case "APPROVE_ACTION":
      return {
        ...state,
        actionQueue: state.actionQueue.map(a =>
          a.id === action.payload ? { ...a, status: "approved" } : a
        ),
      };
    case "REJECT_ACTION":
      return {
        ...state,
        actionQueue: state.actionQueue.map(a =>
          a.id === action.payload ? { ...a, status: "rejected" } : a
        ),
      };
    case "APPROVE_ALL":
      return {
        ...state,
        actionQueue: state.actionQueue.map(a =>
          a.status === "pending" ? { ...a, status: "approved" } : a
        ),
      };
    default:
      return state;
  }
}

// ── Sparkline component ──
function Sparkline({ data, color = "#22d472", width = 80, height = 24 }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((d - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Mini bar chart ──
function MiniBar({ values, labels, color = "#d4a843", height = 120 }) {
  const max = Math.max(...values);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height, padding: "0 4px" }}>
      {values.map((v, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, gap: 4 }}>
          <div style={{
            width: "100%",
            height: `${(v / max) * 100}%`,
            background: `linear-gradient(to top, ${color}, ${color}aa)`,
            borderRadius: 4, minHeight: 4,
            transition: "height 0.5s ease",
          }} />
          <span style={{ fontSize: 9, color: C.textDim, fontFamily: F.mono, whiteSpace: "nowrap" }}>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

// ── Status badge ──
function StatusBadge({ status }) {
  const labels = {
    pending: "Pending", approved: "Approved", rejected: "Rejected", complete: "Complete",
    waiting: "Waiting", draft: "Draft", review: "Review", scheduled: "Scheduled",
  };
  return (
    <span className={`badge badge-${status || "pending"}`}>
      {status === "approved" && <Icons.Check />}
      {status === "waiting" && <Icons.Clock />}
      {labels[status] || "Pending"}
    </span>
  );
}

// ── Priority indicator ──
function PriorityDot({ priority }) {
  const colors = { high: C.rose, medium: C.amber, low: C.textDim };
  return (
    <span style={{
      width: 7, height: 7, borderRadius: "50%",
      background: colors[priority] || colors.low,
      display: "inline-block", flexShrink: 0,
      boxShadow: priority === "high" ? `0 0 6px ${C.rose}` : "none",
    }} />
  );
}

// ── Live metric mini card ──
function LiveMetric({ label, value, color }) {
  return (
    <div style={{
      background: "#f9fafb",
      border: "1px solid #e5e7eb",
      borderRadius: 10, padding: "12px 14px",
      borderTop: `2px solid ${color || "#c0272d"}`,
    }}>
      <div style={{ fontFamily: F.mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "1.5px", color: "#374151", marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color: "#3a3a3a", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

// ── Campaigns table ──
function CampaignsTable({ campaigns }) {
  if (!campaigns || campaigns.length === 0) return (
    <div style={{ fontFamily: F.mono, fontSize: 11, color: C.textMuted, padding: "12px 0" }}>No campaign data available.</div>
  );
  return (
    <table className="campaigns-table">
      <thead>
        <tr>
          <th>Campaign</th>
          <th>Status</th>
          <th>Spend</th>
          <th>Clicks</th>
          <th>Conv.</th>
        </tr>
      </thead>
      <tbody>
        {campaigns.map((c, i) => (
          <tr key={i}>
            <td>{c.name || c.id}</td>
            <td>
              <span className={`badge badge-${(c.status || "").toLowerCase() === "active" ? "approved" : "pending"}`}>
                {c.status || "—"}
              </span>
            </td>
            <td style={{ color: "#3a3a3a" }}>${c.spend != null && c.spend !== "" ? (parseFloat(c.spend) === 0 ? "0" : c.spend) : "—"}</td>
            <td>{c.clicks != null ? Number(c.clicks).toLocaleString() : "—"}</td>
            <td style={{ color: "#374151" }}>{c.conversions != null ? c.conversions : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Main component ──
export default function MarketingBotDashboard() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [now, setNow] = useState(new Date());
  const [botPulse, setBotPulse] = useState(true);

  // ── Live data state ──
  const [googleData, setGoogleData] = useState(null);
  const [facebookData, setFacebookData] = useState(null);
  const [liveDataLoading, setLiveDataLoading] = useState(false);
  const [liveDataError, setLiveDataError] = useState(null);
  const [lastSynced, setLastSynced] = useState(null);

  // ── Actions tab state ──
  const [actionsData, setActionsData] = useState([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [actionsFilter, setActionsFilter] = useState("pending");
  const [toast, setToast] = useState(null);

  // ── Performance snapshot state (Overview) ──
  const [snapshotData, setSnapshotData] = useState(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  // ── Automation Log tab state ──
  const [logData, setLogData] = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logPlatform, setLogPlatform] = useState("all");

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    const p = setInterval(() => setBotPulse(v => !v), 2000);
    return () => { clearInterval(t); clearInterval(p); };
  }, []);

  // ── Live data fetch ──
  const fetchLiveData = async () => {
    setLiveDataLoading(true);
    setLiveDataError(null);
    try {
      const [gRes, fbRes] = await Promise.all([
        fetch('/api/google-ads'),
        fetch('/api/facebook-ads'),
      ]);
      const gData = await gRes.json();
      const fbData = await fbRes.json();
      console.log('Google Ads data:', gData);
      console.log('Facebook Ads data:', fbData);
      console.log('Facebook campaigns:', fbData?.campaigns);
      setGoogleData(gData);
      setFacebookData(fbData);
      setLastSynced(new Date().toLocaleTimeString());
    } catch (err) {
      setLiveDataError('Failed to fetch live data. Check API connections.');
    } finally {
      setLiveDataLoading(false);
    }
  };

  // ── Actions fetch ──
  const fetchActions = useCallback(async (status) => {
    setActionsLoading(true);
    try {
      const res = await fetch(`/api/actions?status=${status}`);
      const json = await res.json();
      setActionsData(json.success ? (json.data || []) : []);
    } catch {
      setActionsData([]);
    } finally {
      setActionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (state.activeTab === "actions") fetchActions(actionsFilter);
  }, [state.activeTab, actionsFilter, fetchActions]);

  const handleActionUpdate = async (id, newStatus) => {
    setActionsData(prev => prev.filter(a => a.id !== id));
    const msg = newStatus === "approved" ? "Action approved" : "Action rejected";
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
    try {
      await fetch(`/api/actions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch { /* optimistic applied — ignore */ }
  };

  // ── Performance snapshot fetch ──
  const fetchSnapshot = useCallback(async () => {
    setSnapshotLoading(true);
    try {
      const res = await fetch("/api/performance-snapshots");
      const json = await res.json();
      setSnapshotData(json.success ? json.data : null);
    } catch {
      setSnapshotData(null);
    } finally {
      setSnapshotLoading(false);
    }
  }, []);

  useEffect(() => {
    if (state.activeTab === "overview") fetchSnapshot();
  }, [state.activeTab, fetchSnapshot]);

  // ── Automation Log fetch ──
  const fetchLog = useCallback(async (platform) => {
    setLogLoading(true);
    try {
      const params = platform !== "all" ? `?platform=${platform}` : "";
      const res = await fetch(`/api/automation-log${params}`);
      const json = await res.json();
      setLogData(json.success ? (json.data || []) : []);
    } catch {
      setLogData([]);
    } finally {
      setLogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (state.activeTab === "log") fetchLog(logPlatform);
  }, [state.activeTab, logPlatform, fetchLog]);

  const pendingCount = state.actionQueue.filter(a => a.status === "pending").length;

  const tabs = [
    { id: "overview",  label: "Overview",                  icon: <Icons.BarChart /> },
    { id: "live",      label: "Live Data",                 icon: <Icons.Refresh /> },
    { id: "actions",   label: `Actions (${pendingCount})`, icon: <Icons.Zap /> },
    { id: "channels",  label: "Channels",                  icon: <Icons.Globe /> },
    { id: "content",   label: "Content",                   icon: <Icons.Edit /> },
    { id: "intel",     label: "Intel",                     icon: <Icons.Eye /> },
    { id: "log",       label: "Automation Log",            icon: <Icons.Clock /> },
    { id: "setup",     label: "Setup Guide",               icon: <Icons.Settings /> },
  ];

  return (
    <div style={{ fontFamily: F.sans, minHeight: "100vh" }}>
      <style>{GLOBAL_CSS}</style>

      {/* ── HEADER ── */}
      <div className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="logo-box">
            <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
              <path d="M13 3L4 14h8l-1 7 9-11h-8l1-7z" fill="url(#g1)" stroke="url(#g1)" strokeWidth="0.5" strokeLinejoin="round"/>
              <defs>
                <linearGradient id="g1" x1="4" y1="3" x2="17" y2="21" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#e04a4f"/>
                  <stop offset="100%" stopColor="#8b1a1e"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div>
            <div style={{ fontFamily: F.serif, fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.15 }}>
              <span style={{ color: C.textPrimary }}>FPB</span>
              <span style={{ color: C.gold }}>AI</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
              <span className="pip" />
              <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "2.5px", color: C.textMuted, textTransform: "uppercase" }}>
                Marketing Agent
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="stat-chip">
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.emerald, boxShadow: `0 0 7px ${C.emerald}`, display: "inline-block" }} />
            LIVE
          </div>
          <div className="stat-chip">
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.amber, boxShadow: `0 0 7px ${C.amber}`, display: "inline-block" }} />
            {pendingCount} pending
          </div>
          {lastSynced && (
            <div className="stat-chip">
              <span style={{ color: C.emerald, fontSize: 10 }}>●</span>
              Synced {lastSynced}
            </div>
          )}
          <div className="stat-chip">
            {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      </div>

      {/* ── TABS ── */}
      <div style={{
        display: "flex", gap: 2, padding: "0 24px",
        background: "rgba(22,28,45,0.80)", borderBottom: "1px solid rgba(255,255,255,0.08)",
        overflowX: "auto", backdropFilter: "blur(16px)",
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => dispatch({ type: "SET_TAB", payload: tab.id })}
            className={`nav-tab${state.activeTab === tab.id ? " active" : ""}`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── CONTENT ── */}
      <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>

        {/* OVERVIEW TAB */}
        {state.activeTab === "overview" && (
          <div key="overview" style={{ animation: "panelIn 0.22s ease" }}>

            {/* ── Metric cards ── */}
            {snapshotLoading && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 14, marginBottom: 24 }}>
                {[0,1,2,3,4,5].map(i => (
                  <div key={i} className="metric-card" style={{ minHeight: 110 }}>
                    <div className="card-top-bar" style={{ background: C.borderMed }} />
                    <div style={{ paddingTop: 4 }}>
                      <div style={{ height: 9,  width: "50%", background: C.borderDim, borderRadius: 4, marginBottom: 14 }} />
                      <div style={{ height: 28, width: "70%", background: C.borderDim, borderRadius: 6, marginBottom: 12 }} />
                      <div style={{ height: 9,  width: "85%", background: C.borderDim, borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!snapshotLoading && !snapshotData && (
              <div style={{ textAlign: "center", padding: "56px 20px", color: C.textMuted, marginBottom: 24 }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={C.borderMed} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 14 }}>
                  <line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>
                </svg>
                <div style={{ fontFamily: F.sans, fontSize: 15, fontWeight: 600, color: C.textSecondary, marginBottom: 6 }}>
                  No performance data yet
                </div>
                <div style={{ fontFamily: F.sans, fontSize: 13 }}>
                  Run an analysis from the Live Data tab to populate metrics.
                </div>
              </div>
            )}

            {!snapshotLoading && snapshotData && (() => {
              const c  = snapshotData.combined || {};
              const g  = snapshotData.google   || {};
              const m  = snapshotData.meta     || {};
              const fmt = (n) => Number(n || 0).toLocaleString("en-US");
              const fmtUSD = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              const fmtPct = (n) => `${Number(n || 0).toFixed(2)}%`;

              const updatedTs = snapshotData.created_at
                ? new Date(snapshotData.created_at).toLocaleString("en-US", {
                    month: "short", day: "numeric",
                    hour: "numeric", minute: "2-digit", hour12: true,
                  }).replace(", ", " · ").replace(" AM", "am").replace(" PM", "pm")
                : null;

              const cards = [
                {
                  label: "Total Spend", color: C.gold,
                  value: fmtUSD(c.spend),
                  breakdown: `Google: ${fmtUSD(g.spend)} · Meta: ${fmtUSD(m.spend)}`,
                },
                {
                  label: "Impressions", color: "#2b3a6b",
                  value: fmt(c.impressions),
                  breakdown: `Google: ${fmt(g.impressions)} · Meta: ${fmt(m.impressions)}`,
                },
                {
                  label: "Clicks", color: "#2b3a6b",
                  value: fmt(c.clicks),
                  breakdown: `Google: ${fmt(g.clicks)} · Meta: ${fmt(m.clicks)}`,
                },
                {
                  label: "Conversions", color: "#2b3a6b",
                  value: fmt(c.conversions),
                  breakdown: `Google: ${fmt(g.conversions)} · Meta: ${fmt(m.conversions)}`,
                },
                {
                  label: "Avg CTR", color: "#2b3a6b",
                  value: fmtPct(c.ctr),
                  breakdown: `Google: ${fmtPct(g.ctr)} · Meta: ${fmtPct(m.ctr)}`,
                },
                {
                  label: "Avg CPC", color: "#2b3a6b",
                  value: fmtUSD(c.cpc),
                  breakdown: `Google: ${fmtUSD(g.cpc)} · Meta: ${fmtUSD(m.cpc)}`,
                },
              ];

              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 14, marginBottom: 10 }}>
                    {cards.map((kpi, i) => (
                      <div key={i} className="metric-card">
                        <div className="card-top-bar" style={{ background: kpi.color }} />
                        <div style={{ position: "relative", zIndex: 1 }}>
                          <div style={{ fontFamily: F.mono, fontSize: 10, textTransform: "uppercase", letterSpacing: "1.5px", color: C.textMuted, marginBottom: 10 }}>{kpi.label}</div>
                          <div style={{ fontFamily: F.serif, fontSize: 28, fontWeight: 700, color: C.textPrimary, letterSpacing: "-0.5px", lineHeight: 1, marginBottom: 10 }}>{kpi.value}</div>
                          <div style={{ fontFamily: F.mono, fontSize: 9.5, color: C.textDim, lineHeight: 1.4 }}>{kpi.breakdown}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, padding: "0 2px" }}>
                    {updatedTs && (
                      <span style={{ fontFamily: F.mono, fontSize: 10, color: C.textDim }}>
                        Last updated: <span style={{ color: C.textMuted }}>{updatedTs}</span>
                      </span>
                    )}
                  </div>
                </>
              );
            })()}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: `linear-gradient(145deg, ${C.bgRaised}, ${C.bgSurface})`, border: `1px solid ${C.borderDim}`, borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div className="section-label" style={{ marginBottom: 0, color: C.amber }}>{pendingCount} Actions Pending</div>
                  <button onClick={() => dispatch({ type: "SET_TAB", payload: "actions" })} className="view-all-btn">
                    View all <Icons.ChevRight />
                  </button>
                </div>
                {state.actionQueue.filter(a => a.status === "pending").slice(0, 3).map(a => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0", borderBottom: `1px solid ${C.borderDim}` }}>
                    <PriorityDot priority={a.priority} />
                    <span style={{ color: C.textSecondary, flex: 1, fontFamily: F.sans, fontSize: 12 }}>{a.action}</span>
                    <span style={{ color: C.textDim, fontSize: 10, fontFamily: F.mono, whiteSpace: "nowrap" }}>{a.channel}</span>
                  </div>
                ))}
              </div>

              <div style={{ background: `linear-gradient(145deg, ${C.bgRaised}, ${C.bgSurface})`, border: `1px solid ${C.borderDim}`, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "16px 18px 10px" }}>
                  <div className="section-label">Automation Log — Today</div>
                </div>
                <div style={{ maxHeight: 196, overflow: "auto" }}>
                  {state.automationLog.map((log, i) => (
                    <div key={i} className="activity-row">
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: log.status === "waiting" ? C.amber : C.emerald, boxShadow: `0 0 7px ${log.status === "waiting" ? C.amber : C.emerald}`, display: "inline-block", flexShrink: 0 }} />
                      <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.textDim, width: 64, flexShrink: 0 }}>{log.time}</span>
                      <StatusBadge status={log.status} />
                      <span style={{ color: C.textSecondary, fontFamily: F.sans, fontSize: 12, flex: 1 }}>{log.action}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16, background: `linear-gradient(145deg, ${C.bgRaised}, ${C.bgSurface})`, border: `1px solid ${C.borderDim}`, borderRadius: 12, padding: 20 }}>
              <div className="section-label">Channel Spend vs Revenue</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                <MiniBar values={[2100,1680,0,0,500]}      labels={["Google","Meta","SEO","Blog","Local"]} color={C.rose}    height={100} />
                <MiniBar values={[7980,7056,2200,890,814]} labels={["Google","Meta","SEO","Blog","Local"]} color={C.emerald} height={100} />
              </div>
              <div style={{ display: "flex", gap: 24, marginTop: 10, justifyContent: "center" }}>
                <span style={{ fontSize: 10, color: C.rose,    fontFamily: F.mono, display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: C.rose,    display: "inline-block" }} /> Spend
                </span>
                <span style={{ fontSize: 10, color: C.emerald, fontFamily: F.mono, display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: C.emerald, display: "inline-block" }} /> Revenue
                </span>
              </div>
            </div>
          </div>
        )}

        {/* LIVE DATA TAB */}
        {state.activeTab === "live" && (
          <div key="live" style={{ animation: "panelIn 0.22s ease" }}>
            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
              <div>
                <div style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>Live Performance</div>
                <div style={{ fontSize: 13, color: C.textSecondary, fontFamily: F.sans }}>
                  Real-time data from Google Ads and Facebook Ads APIs
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {lastSynced && (
                  <span style={{ fontFamily: F.mono, fontSize: 10, color: C.textMuted }}>
                    Last synced: <span style={{ color: C.emerald }}>{lastSynced}</span>
                  </span>
                )}
                <button className="btn-sync" onClick={fetchLiveData} disabled={liveDataLoading}>
                  {liveDataLoading ? <span className="spinner" /> : <Icons.Refresh />}
                  {liveDataLoading ? "Syncing…" : "Sync Live Data"}
                </button>
              </div>
            </div>

            {/* Error state */}
            {liveDataError && (
              <div style={{
                background: "rgba(242,92,122,0.08)", border: "1px solid rgba(242,92,122,0.22)",
                borderRadius: 10, padding: "12px 16px", marginBottom: 20,
                fontFamily: F.sans, fontSize: 13, color: C.rose,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <Icons.Alert /> {liveDataError}
              </div>
            )}

            {/* Empty state */}
            {!liveDataLoading && !googleData && !facebookData && !liveDataError && (
              <div style={{
                background: `linear-gradient(145deg, ${C.bgRaised}, ${C.bgSurface})`,
                border: `1px solid ${C.borderDim}`, borderRadius: 14,
                padding: 48, textAlign: "center",
              }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📡</div>
                <div style={{ fontFamily: F.serif, fontSize: 18, fontWeight: 700, color: C.textPrimary, marginBottom: 8 }}>No Live Data Yet</div>
                <div style={{ fontFamily: F.sans, fontSize: 13, color: C.textSecondary, marginBottom: 24 }}>
                  Click "Sync Live Data" to pull real-time metrics from your ad accounts.
                </div>
                <button className="btn-sync" onClick={fetchLiveData} style={{ margin: "0 auto" }}>
                  <Icons.Refresh /> Sync Live Data
                </button>
              </div>
            )}

            {/* Google Ads live data */}
            <div style={{ marginBottom: 20 }}>
              <div className="section-label" style={{ color: "#2b3a6b" }}>Google Ads — Last 30 Days</div>
              {!googleData ? (
                <div style={{
                  background: "rgba(255,255,255,0.02)", border: `1px solid ${C.borderDim}`,
                  borderRadius: 12, padding: "24px 22px",
                  display: "flex", alignItems: "center", gap: 14,
                }}>
                  <div style={{ color: C.textMuted }}><Icons.Google /></div>
                  <div>
                    <div style={{ fontFamily: F.serif, fontSize: 15, fontWeight: 700, color: C.textSecondary, marginBottom: 4 }}>Google Ads</div>
                    <div style={{ fontFamily: F.sans, fontSize: 12, color: C.textMuted }}>
                      Click Sync to load Google Ads data. Requires a developer token with production access.
                    </div>
                  </div>
                </div>
              ) : googleData.success === false ? (
                <div style={{
                  background: "rgba(244,167,50,0.06)",
                  border: "1px solid rgba(244,167,50,0.28)",
                  borderRadius: 12, padding: "20px 22px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <div style={{ color: C.amber }}><Icons.Google /></div>
                    <span style={{ fontFamily: F.serif, fontSize: 16, fontWeight: 700, color: C.textPrimary }}>Google Ads — Connection Issue</span>
                  </div>
                  <div style={{ fontFamily: F.mono, fontSize: 12, color: C.amber, marginBottom: 8 }}>
                    {googleData.error}
                  </div>
                  {googleData.detail && (
                    <div style={{
                      background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "10px 12px", marginBottom: 12,
                      fontFamily: F.mono, fontSize: 11, color: C.textMuted, wordBreak: "break-all",
                    }}>
                      {googleData.detail}
                    </div>
                  )}
                  <div style={{ fontFamily: F.sans, fontSize: 12, color: C.textSecondary, lineHeight: 1.6 }}>
                    Your developer token may still be in test mode. Apply for production access at{" "}
                    <span style={{ color: C.gold }}>ads.google.com → Tools → API Center</span>
                  </div>
                </div>
              ) : (
                <div className="live-card">
                  <div className="card-top-bar" style={{ background: C.amber }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, paddingTop: 4 }}>
                    <div style={{ color: C.amber }}><Icons.Google /></div>
                    <span style={{ fontFamily: F.serif, fontSize: 16, fontWeight: 700, color: C.textPrimary }}>Google Ads</span>
                    <span className="badge badge-approved" style={{ marginLeft: "auto" }}>Live</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 20 }}>
                    <LiveMetric label="Total Spend"  value={`$${googleData.summary.totalSpend}`}                     color={C.amber} />
                    <LiveMetric label="Clicks"       value={Number(googleData.summary.totalClicks).toLocaleString()} color={C.sapphire} />
                    <LiveMetric label="Conversions"  value={googleData.summary.totalConversions}                     color={C.emerald} />
                    <LiveMetric label="ROAS"         value={`${googleData.summary.roas}x`}                          color={C.gold} />
                    <LiveMetric label="Cost / Lead"  value={`$${googleData.summary.cpl}`}                           color={C.violet} />
                  </div>
                  {googleData.campaigns && googleData.campaigns.length > 0 && (
                    <>
                      <div className="section-label">Campaigns</div>
                      <CampaignsTable campaigns={googleData.campaigns} />
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Facebook Ads live data */}
            <div style={{ marginBottom: 20 }}>
              <div className="section-label" style={{ color: "#2b3a6b" }}>Facebook Ads — Last 30 Days</div>
              {!facebookData ? (
                <div style={{
                  background: "rgba(255,255,255,0.02)", border: `1px solid ${C.borderDim}`,
                  borderRadius: 12, padding: "24px 22px",
                  display: "flex", alignItems: "center", gap: 14,
                }}>
                  <div style={{ color: C.textMuted }}><Icons.Facebook /></div>
                  <div>
                    <div style={{ fontFamily: F.serif, fontSize: 15, fontWeight: 700, color: C.textSecondary, marginBottom: 4 }}>Facebook Ads</div>
                    <div style={{ fontFamily: F.sans, fontSize: 12, color: C.textMuted }}>
                      Click Sync to load Facebook Ads data.
                    </div>
                  </div>
                </div>
              ) : facebookData.success === false ? (
                <div style={{
                  background: "rgba(244,167,50,0.06)",
                  border: "1px solid rgba(244,167,50,0.28)",
                  borderRadius: 12, padding: "20px 22px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <div style={{ color: C.sapphire }}><Icons.Facebook /></div>
                    <span style={{ fontFamily: F.serif, fontSize: 16, fontWeight: 700, color: C.textPrimary }}>Facebook Ads — Connection Issue</span>
                  </div>
                  <div style={{ fontFamily: F.mono, fontSize: 12, color: C.amber, marginBottom: 8 }}>
                    {facebookData.error}
                  </div>
                  {facebookData.detail && (
                    <div style={{
                      background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "10px 12px",
                      fontFamily: F.mono, fontSize: 11, color: C.textMuted, wordBreak: "break-all",
                    }}>
                      {facebookData.detail}
                    </div>
                  )}
                </div>
              ) : (
                <div className="live-card">
                  <div className="card-top-bar" style={{ background: C.sapphire }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, paddingTop: 4 }}>
                    <div style={{ color: C.sapphire }}><Icons.Facebook /></div>
                    <span style={{ fontFamily: F.serif, fontSize: 16, fontWeight: 700, color: C.textPrimary }}>Facebook Ads</span>
                    <span className="badge badge-approved" style={{ marginLeft: "auto" }}>Live</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 20 }}>
                    <LiveMetric label="Total Spend"   value={`$${facebookData.summary.totalSpend}`}                       color={C.sapphire} />
                    <LiveMetric label="Clicks"        value={Number(facebookData.summary.totalClicks).toLocaleString()}    color={C.teal} />
                    <LiveMetric label="Conversions"   value={facebookData.summary.totalConversions}                        color={C.emerald} />
                    <LiveMetric label="ROAS"          value={`${facebookData.summary.roas}x`}                             color={C.gold} />
                    <LiveMetric label="Cost / Lead"   value={`$${facebookData.summary.cpl}`}                              color={C.violet} />
                  </div>
                  {facebookData.campaigns && facebookData.campaigns.length > 0 ? (
                    <>
                      <div className="section-label">Campaigns</div>
                      <CampaignsTable campaigns={facebookData.campaigns} />
                    </>
                  ) : (
                    <div style={{ fontFamily: F.mono, fontSize: 11, color: C.textMuted, padding: "4px 0" }}>
                      No campaigns returned. Check console for debug output.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ACTIONS TAB */}
        {state.activeTab === "actions" && (
          <div key="actions" style={{ animation: "panelIn 0.22s ease" }}>
            {/* Header */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>Action Queue</div>
              <div style={{ fontSize: 13, color: C.textSecondary, fontFamily: F.sans }}>Claude analyzed your campaigns and recommends these actions</div>
            </div>

            {/* Filter tabs */}
            <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: `1px solid ${C.borderDim}` }}>
              {[
                { key: "pending",  label: "Pending",  accent: C.gold },
                { key: "approved", label: "Approved", accent: C.emerald },
                { key: "rejected", label: "Rejected", accent: C.textDim },
              ].map(({ key, label, accent }) => (
                <button
                  key={key}
                  onClick={() => setActionsFilter(key)}
                  style={{
                    padding: "10px 20px", border: "none", cursor: "pointer",
                    background: "transparent",
                    color: actionsFilter === key ? accent : C.textMuted,
                    borderBottom: `2px solid ${actionsFilter === key ? accent : "transparent"}`,
                    fontFamily: F.sans, fontSize: 12, fontWeight: 500,
                    transition: "all 0.15s", marginBottom: -1,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Skeleton loading */}
            {actionsLoading && [0, 1, 2].map(i => (
              <div key={i} className="data-card" style={{ marginBottom: 10, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 40, height: 18, borderRadius: 99, background: C.borderDim }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 12, width: "55%", background: C.borderDim, borderRadius: 4, marginBottom: 8 }} />
                    <div style={{ height: 10, width: "35%", background: C.borderDim, borderRadius: 4 }} />
                  </div>
                </div>
              </div>
            ))}

            {/* Empty state */}
            {!actionsLoading && actionsData.length === 0 && (
              <div style={{ textAlign: "center", padding: "56px 20px", color: C.textMuted }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={C.borderMed} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 14 }}>
                  <polyline points="20 6 9 17 4 12"/><rect x="3" y="3" width="18" height="18" rx="3"/>
                </svg>
                <div style={{ fontFamily: F.sans, fontSize: 15, fontWeight: 600, color: C.textSecondary, marginBottom: 6 }}>
                  No {actionsFilter} actions
                </div>
                <div style={{ fontFamily: F.sans, fontSize: 13 }}>
                  {actionsFilter === "pending"
                    ? "Run an analysis to generate new recommendations."
                    : `No actions have been ${actionsFilter} yet.`}
                </div>
              </div>
            )}

            {/* Action cards */}
            {!actionsLoading && actionsData.map(a => (
              <div key={a.id} className="data-card" style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  {/* Platform badge */}
                  <span style={{
                    padding: "3px 9px", borderRadius: 99, fontSize: 10, fontFamily: F.mono, fontWeight: 600,
                    background: a.platform === "google_ads" ? "rgba(192,39,45,0.08)" : "rgba(37,99,235,0.08)",
                    color: a.platform === "google_ads" ? C.gold : C.sapphire,
                    border: `1px solid ${a.platform === "google_ads" ? "rgba(192,39,45,0.2)" : "rgba(37,99,235,0.2)"}`,
                    flexShrink: 0, marginTop: 2, whiteSpace: "nowrap",
                  }}>
                    {a.platform === "google_ads" ? "Google" : "Meta"}
                  </span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Action type + campaign name */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: F.mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "1px", color: C.textDim }}>
                        {(a.action_type || "").replace(/_/g, " ")}
                      </span>
                      {a.campaign_name && (
                        <span style={{ fontFamily: F.mono, fontSize: 9, color: C.textMuted }}>— {a.campaign_name}</span>
                      )}
                    </div>

                    {/* Description */}
                    <div style={{ fontSize: 13, fontWeight: 500, color: C.textPrimary, marginBottom: 8, fontFamily: F.sans, lineHeight: 1.45 }}>
                      {a.description}
                    </div>

                    {/* Value change + impact */}
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                      {(a.current_value != null || a.recommended_value != null) && (
                        <span style={{ fontFamily: F.mono, fontSize: 10, color: C.textMuted }}>
                          {a.current_value ?? "—"}
                          <span style={{ color: C.gold, margin: "0 4px" }}>→</span>
                          {a.recommended_value ?? "—"}
                        </span>
                      )}
                      {a.impact_estimate && (
                        <span style={{ fontFamily: F.mono, fontSize: 10, color: C.emerald }}>{a.impact_estimate}</span>
                      )}
                    </div>
                  </div>

                  {/* Approve / Reject buttons */}
                  {actionsFilter === "pending" ? (
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button onClick={() => handleActionUpdate(a.id, "approved")} className="btn-approve">Approve</button>
                      <button onClick={() => handleActionUpdate(a.id, "rejected")} className="btn-reject">Reject</button>
                    </div>
                  ) : (
                    <StatusBadge status={actionsFilter} />
                  )}
                </div>
              </div>
            ))}

            {/* Toast */}
            {toast && (
              <div style={{
                position: "fixed", bottom: 28, right: 28, zIndex: 999,
                background: "#1a2444", color: "#ffffff",
                padding: "12px 22px", borderRadius: 10,
                fontFamily: F.sans, fontSize: 13, fontWeight: 500,
                boxShadow: "0 8px 28px rgba(0,0,0,0.22)",
                animation: "panelIn 0.2s ease",
              }}>
                {toast}
              </div>
            )}
          </div>
        )}

        {/* CHANNELS TAB */}
        {state.activeTab === "channels" && (
          <div key="channels" style={{ animation: "panelIn 0.22s ease" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[
                {
                  name: "Google Ads", icon: <Icons.Google />, color: C.amber, platform: "google",
                  stats: [
                    { l: "Spend",       v: `$${state.channels.googleAds.spend}` },
                    { l: "Clicks",      v: state.channels.googleAds.clicks.toLocaleString() },
                    { l: "Conversions", v: state.channels.googleAds.conversions },
                    { l: "CPA",         v: `$${state.channels.googleAds.cpa}` },
                    { l: "ROAS",        v: `${state.channels.googleAds.roas}x` },
                  ],
                  spark: [1200,1400,1650,1800,1950,2000,2100],
                },
                {
                  name: "Facebook Ads", icon: <Icons.Facebook />, color: C.sapphire, platform: "facebook",
                  stats: [
                    { l: "Spend",       v: `$${state.channels.facebookAds.spend}` },
                    { l: "Reach",       v: state.channels.facebookAds.reach.toLocaleString() },
                    { l: "Conversions", v: state.channels.facebookAds.conversions },
                    { l: "CPA",         v: `$${state.channels.facebookAds.cpa}` },
                    { l: "ROAS",        v: `${state.channels.facebookAds.roas}x` },
                  ],
                  spark: [900,1100,1250,1400,1500,1600,1680],
                },
                {
                  name: "SEO", icon: <Icons.Search />, color: C.emerald,
                  stats: [
                    { l: "Organic Visits",   v: state.channels.seo.organicVisits.toLocaleString() },
                    { l: "Keywords Tracked", v: state.channels.seo.keywords },
                    { l: "Top 10 Rankings",  v: state.channels.seo.top10 },
                    { l: "Avg Position",     v: state.channels.seo.avgPosition },
                  ],
                  spark: [7200,8100,9200,10100,10800,11600,12400],
                },
                {
                  name: "Blog / Content", icon: <Icons.Edit />, color: C.violet,
                  stats: [
                    { l: "Posts This Month",  v: state.channels.blog.posts },
                    { l: "Total Views",       v: state.channels.blog.views.toLocaleString() },
                    { l: "Avg Time on Page",  v: state.channels.blog.avgTimeOnPage },
                    { l: "Top Post",          v: state.channels.blog.topPost },
                  ],
                  spark: [4200,5100,5800,6400,7200,8000,8900],
                },
                {
                  name: "GEO / Local SEO", icon: <Icons.Globe />, color: C.teal,
                  stats: [
                    { l: "Map Impressions", v: state.channels.geo.impressions.toLocaleString() },
                    { l: "Phone Calls",     v: state.channels.geo.calls },
                    { l: "Directions",      v: state.channels.geo.directions },
                    { l: "Review Score",    v: `${state.channels.geo.reviews} ★` },
                  ],
                  spark: [3200,3600,4100,4500,4900,5200,5600],
                },
              ].map((ch, i) => (
                <div key={i} className="data-card">
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <div style={{ color: ch.color, display: "flex" }}>{ch.icon}</div>
                    <span style={{ fontFamily: F.serif, fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{ch.name}</span>
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                      {ch.platform && (
                        <button
                          className="btn-view-live"
                          onClick={() => { fetchLiveData(); dispatch({ type: "SET_TAB", payload: "live" }); }}
                        >
                          <Icons.Refresh /> Live Data
                        </button>
                      )}
                      <Sparkline data={ch.spark} color={ch.color} width={60} height={20} />
                    </div>
                  </div>
                  {/* Inline live summary if available */}
                  {ch.platform === "google" && googleData && (
                    <div style={{
                      background: "rgba(244,167,50,0.06)", border: "1px solid rgba(244,167,50,0.15)",
                      borderRadius: 8, padding: "8px 12px", marginBottom: 12,
                      display: "flex", gap: 16, flexWrap: "wrap",
                    }}>
                      <span style={{ fontFamily: F.mono, fontSize: 10, color: C.amber }}>● LIVE</span>
                      <span style={{ fontFamily: F.mono, fontSize: 10, color: C.textSecondary }}>Spend: <strong style={{ color: C.amber }}>${googleData.summary.totalSpend}</strong></span>
                      <span style={{ fontFamily: F.mono, fontSize: 10, color: C.textSecondary }}>ROAS: <strong style={{ color: C.gold }}>{googleData.summary.roas}x</strong></span>
                      <span style={{ fontFamily: F.mono, fontSize: 10, color: C.textSecondary }}>Conv: <strong style={{ color: C.emerald }}>{googleData.summary.totalConversions}</strong></span>
                    </div>
                  )}
                  {ch.platform === "facebook" && facebookData && (
                    <div style={{
                      background: "rgba(77,142,240,0.06)", border: "1px solid rgba(77,142,240,0.15)",
                      borderRadius: 8, padding: "8px 12px", marginBottom: 12,
                      display: "flex", gap: 16, flexWrap: "wrap",
                    }}>
                      <span style={{ fontFamily: F.mono, fontSize: 10, color: C.sapphire }}>● LIVE</span>
                      <span style={{ fontFamily: F.mono, fontSize: 10, color: C.textSecondary }}>Spend: <strong style={{ color: C.sapphire }}>${facebookData.summary.totalSpend}</strong></span>
                      <span style={{ fontFamily: F.mono, fontSize: 10, color: C.textSecondary }}>ROAS: <strong style={{ color: C.gold }}>{facebookData.summary.roas}x</strong></span>
                      <span style={{ fontFamily: F.mono, fontSize: 10, color: C.textSecondary }}>Conv: <strong style={{ color: C.emerald }}>{facebookData.summary.totalConversions}</strong></span>
                    </div>
                  )}
                  {ch.stats.map((s, j) => (
                    <div key={j} style={{
                      display: "flex", justifyContent: "space-between",
                      padding: "5px 0", borderBottom: j < ch.stats.length - 1 ? `1px solid ${C.borderDim}` : "none",
                    }}>
                      <span style={{ color: C.textSecondary, fontFamily: F.sans, fontSize: 12 }}>{s.l}</span>
                      <span style={{ fontWeight: 600, fontFamily: F.mono, fontSize: 12, color: C.textPrimary }}>{s.v}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CONTENT TAB */}
        {state.activeTab === "content" && (
          <div key="content" style={{ animation: "panelIn 0.22s ease" }}>
            <div style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>Content Pipeline</div>
            <div style={{ fontSize: 13, color: C.textSecondary, fontFamily: F.sans, marginBottom: 20 }}>Claude identifies keyword opportunities and drafts optimized content</div>
            {state.blogQueue.map((post, i) => (
              <div key={i} className="data-card" style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, fontFamily: F.sans, color: C.textPrimary, flex: 1, marginRight: 12 }}>{post.title}</div>
                  <StatusBadge status={post.status} />
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {post.keywords.map((kw, j) => (
                    <span key={j} className="kw-chip">{kw}</span>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, fontFamily: F.mono }}>
                  Est. monthly traffic: <span style={{ color: C.emerald, fontWeight: 600 }}>{post.estTraffic.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* INTEL TAB */}
        {state.activeTab === "intel" && (
          <div key="intel" style={{ animation: "panelIn 0.22s ease" }}>
            <div style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>Competitor Intelligence</div>
            <div style={{ fontSize: 13, color: C.textSecondary, fontFamily: F.sans, marginBottom: 20 }}>Claude monitors competitor activity and surfaces actionable alerts</div>
            {state.competitorAlerts.map((alert, i) => (
              <div key={i} className="data-card" style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                  background: `linear-gradient(145deg, ${C.bgOverlay}, ${C.bgRaised})`,
                  border: `1px solid ${C.borderMed}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 15, fontWeight: 700, color: C.gold, fontFamily: F.serif,
                }}>
                  {alert.competitor[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3, fontFamily: F.sans, color: C.textPrimary }}>{alert.competitor}</div>
                  <div style={{ fontSize: 12, color: C.textSecondary, fontFamily: F.sans }}>{alert.alert}</div>
                </div>
                <span style={{ fontSize: 10, color: C.textDim, whiteSpace: "nowrap", fontFamily: F.mono }}>{alert.time}</span>
              </div>
            ))}
          </div>
        )}

        {/* AUTOMATION LOG TAB */}
        {state.activeTab === "log" && (
          <div key="log" style={{ animation: "panelIn 0.22s ease" }}>
            {/* Header */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>Automation Log</div>
              <div style={{ fontSize: 13, color: C.textSecondary, fontFamily: F.sans }}>Read-only record of all automated analysis runs and actions</div>
            </div>

            {/* Platform filter */}
            <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: `1px solid ${C.borderDim}` }}>
              {[
                { key: "all",    label: "All" },
                { key: "google", label: "Google" },
                { key: "meta",   label: "Meta" },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setLogPlatform(key)}
                  style={{
                    padding: "10px 20px", border: "none", cursor: "pointer",
                    background: "transparent",
                    color: logPlatform === key ? C.gold : C.textMuted,
                    borderBottom: `2px solid ${logPlatform === key ? C.gold : "transparent"}`,
                    fontFamily: F.sans, fontSize: 12, fontWeight: 500,
                    transition: "all 0.15s", marginBottom: -1,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Skeleton loading */}
            {logLoading && [0, 1, 2, 3, 4].map(i => (
              <div key={i} className="data-card" style={{ marginBottom: 8, padding: "12px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 56, height: 10, borderRadius: 4, background: C.borderDim }} />
                  <div style={{ width: 40, height: 18, borderRadius: 99, background: C.borderDim }} />
                  <div style={{ flex: 1, height: 11, borderRadius: 4, background: C.borderDim }} />
                  <div style={{ width: 50, height: 18, borderRadius: 99, background: C.borderDim }} />
                </div>
              </div>
            ))}

            {/* Empty state */}
            {!logLoading && logData.length === 0 && (
              <div style={{ textAlign: "center", padding: "56px 20px", color: C.textMuted }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={C.borderMed} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 14 }}>
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <div style={{ fontFamily: F.sans, fontSize: 15, fontWeight: 600, color: C.textSecondary, marginBottom: 6 }}>
                  No automation activity yet
                </div>
                <div style={{ fontFamily: F.sans, fontSize: 13 }}>
                  Run an analysis from the Live Data tab to generate log entries.
                </div>
              </div>
            )}

            {/* Log rows */}
            {!logLoading && logData.length > 0 && (
              <div style={{ borderRadius: 10, border: `1px solid ${C.borderDim}`, overflow: "hidden" }}>
                {logData.map((entry, i) => {
                  const platform = entry.platform || (entry.metadata?.google_available ? "google_ads" : null);
                  const isGoogle = platform === "google_ads";
                  const isMeta   = platform === "meta_ads";
                  const status   = entry.status || "pending";
                  const ts = entry.created_at
                    ? new Date(entry.created_at).toLocaleString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                        hour: "numeric", minute: "2-digit", hour12: true,
                      }).replace(", ", " · ").replace(" AM", "am").replace(" PM", "pm")
                    : "—";

                  const statusStyle = {
                    complete: { bg: "rgba(22,163,74,0.08)",  color: "#16a34a", border: "rgba(22,163,74,0.2)"  },
                    success:  { bg: "rgba(22,163,74,0.08)",  color: "#16a34a", border: "rgba(22,163,74,0.2)"  },
                    error:    { bg: "rgba(192,39,45,0.08)",  color: C.gold,    border: "rgba(192,39,45,0.2)"  },
                    failed:   { bg: "rgba(192,39,45,0.08)",  color: C.gold,    border: "rgba(192,39,45,0.2)"  },
                    pending:  { bg: "rgba(107,114,128,0.08)", color: C.textMuted, border: "rgba(107,114,128,0.2)" },
                  }[status] || { bg: "rgba(107,114,128,0.08)", color: C.textMuted, border: "rgba(107,114,128,0.2)" };

                  return (
                    <div key={entry.id || i} style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "12px 18px",
                      borderBottom: i < logData.length - 1 ? `1px solid ${C.borderDim}` : "none",
                      background: i % 2 === 1 ? C.bgOverlay : C.bgSurface,
                      transition: "background 0.15s",
                    }}>
                      {/* Timestamp */}
                      <span style={{ fontFamily: F.mono, fontSize: 10, color: C.textDim, whiteSpace: "nowrap", minWidth: 148 }}>
                        {ts}
                      </span>

                      {/* Platform badge */}
                      {(isGoogle || isMeta) && (
                        <span style={{
                          padding: "2px 8px", borderRadius: 99, fontSize: 10, fontFamily: F.mono, fontWeight: 600,
                          background: isGoogle ? "rgba(192,39,45,0.08)" : "rgba(37,99,235,0.08)",
                          color: isGoogle ? C.gold : C.sapphire,
                          border: `1px solid ${isGoogle ? "rgba(192,39,45,0.2)" : "rgba(37,99,235,0.2)"}`,
                          whiteSpace: "nowrap", flexShrink: 0,
                        }}>
                          {isGoogle ? "Google" : "Meta"}
                        </span>
                      )}

                      {/* Action type / event type */}
                      {(entry.action_type || entry.event_type) && (
                        <span style={{ fontFamily: F.mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "1px", color: C.textDim, whiteSpace: "nowrap", flexShrink: 0 }}>
                          {(entry.action_type || entry.event_type || "").replace(/_/g, " ")}
                        </span>
                      )}

                      {/* Description */}
                      <span style={{ flex: 1, fontFamily: F.sans, fontSize: 12, color: C.textSecondary, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {entry.description || entry.campaign_name || "—"}
                      </span>

                      {/* Status badge */}
                      <span style={{
                        padding: "2px 9px", borderRadius: 99, fontSize: 10, fontFamily: F.mono, fontWeight: 600,
                        background: statusStyle.bg, color: statusStyle.color,
                        border: `1px solid ${statusStyle.border}`,
                        whiteSpace: "nowrap", flexShrink: 0,
                      }}>
                        {status}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* SETUP GUIDE TAB */}
        {state.activeTab === "setup" && (
          <div key="setup" style={{ animation: "panelIn 0.22s ease" }}>
            <div style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>Setup Guide</div>
            <div style={{ fontSize: 13, color: C.textSecondary, fontFamily: F.sans, marginBottom: 24 }}>Follow these steps to connect all your marketing channels</div>

            {[
              { step: 1,  title: "Get Claude Pro/Team Plan",       status: "required",    description: "You need Claude Pro ($20/mo) or Team plan to access Cowork. Go to claude.ai → Settings → Subscription." },
              { step: 2,  title: "Enable Cowork (Desktop)",        status: "required",    description: "Download Claude Desktop app → Settings → Enable Cowork. This lets Claude automate tasks on your computer." },
              { step: 3,  title: "Connect Google Ads API",         status: "integration", description: "Create a Google Ads API developer token at ads.google.com/aw/apicenter. Add GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID to Vercel env vars." },
              { step: 4,  title: "Connect Meta Marketing API",     status: "integration", description: "Go to developers.facebook.com → Create App → Marketing API. Add META_ACCESS_TOKEN and META_AD_ACCOUNT_ID to Vercel env vars." },
              { step: 5,  title: "Connect Google Search Console",  status: "integration", description: "Enable Search Console API in Google Cloud Console. Create service account credentials. Verify your site in Search Console." },
              { step: 6,  title: "Connect Your CMS",               status: "integration", description: "For WordPress: install the REST API plugin and generate an application password. For Webflow: get your API token from Account Settings." },
              { step: 7,  title: "Set Up MCP Servers",             status: "config",      description: "Configure MCP servers in Claude Desktop's config file to give Claude access to all your marketing APIs." },
              { step: 8,  title: "Create Brand Voice Document",    status: "config",      description: "Write a document with your brand tone, key messaging, target audience, and competitors. Upload to Claude as context." },
              { step: 9,  title: "Configure Automation Schedule",  status: "config",      description: "Set up daily/weekly automation prompts in Cowork: morning performance pull, weekly competitor scan, monthly content calendar." },
              { step: 10, title: "Test with Read-Only First",      status: "important",   description: "Start with read-only access. Let Claude analyze and recommend. Only enable write access (ad changes, publishing) after you trust the recommendations." },
            ].map((item, i) => (
              <div key={i} style={{
                background: `linear-gradient(145deg, ${C.bgRaised}, ${C.bgSurface})`,
                border: `1px solid ${C.borderDim}`, borderRadius: 12,
                padding: 16, marginBottom: 10, display: "flex", gap: 14,
              }}>
                <div className="step-icon" style={{
                  background: item.status === "required"  ? "rgba(212,168,67,0.10)" :
                              item.status === "important" ? "rgba(242,92,122,0.10)" :
                              "rgba(255,255,255,0.04)",
                  border: `1px solid ${
                    item.status === "required"  ? "rgba(212,168,67,0.28)" :
                    item.status === "important" ? "rgba(242,92,122,0.28)" :
                    C.borderDim
                  }`,
                  color: item.status === "required"  ? C.gold :
                         item.status === "important" ? C.rose : C.textSecondary,
                }}>{item.step}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5, fontFamily: F.sans, color: C.textPrimary }}>{item.title}</div>
                  <div style={{ fontSize: 12, color: C.textSecondary, lineHeight: 1.6, fontFamily: F.sans }}>{item.description}</div>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
