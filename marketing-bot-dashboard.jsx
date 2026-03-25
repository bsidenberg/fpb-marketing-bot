import { useState, useEffect, useReducer } from "react";

// ── Design tokens ──
const C = {
  bgBase:    "#161c2d",
  bgSurface: "#1e2640",
  bgRaised:  "#242c4a",
  bgOverlay: "#2a3356",
  bgInput:   "#1a2038",

  borderDim: "rgba(255,255,255,0.07)",
  borderMed: "rgba(255,255,255,0.12)",
  borderHi:  "rgba(255,255,255,0.20)",

  gold:     "#d4a843",
  goldLt:   "#f0c865",
  goldDk:   "#9a7428",
  goldGlow: "rgba(212,168,67,0.20)",

  textPrimary:   "#eef1fa",
  textSecondary: "#8fa0c8",
  textMuted:     "#4f6090",
  textDim:       "#2d3d68",

  emerald: "#22d472",
  sapphire: "#4d8ef0",
  amber:   "#f4a732",
  rose:    "#f25c7a",
  violet:  "#9d6ff5",
  teal:    "#22d4c8",
};
const F = {
  serif: "'Playfair Display', Georgia, serif",
  sans:  "'DM Sans', system-ui, sans-serif",
  mono:  "'DM Mono', monospace",
};

// ── Injected global styles ──
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }

  body {
    background: radial-gradient(ellipse at 20% 0%, #1e2a4a 0%, #161c2d 50%, #111728 100%);
    min-height: 100vh;
    font-family: 'DM Sans', system-ui, sans-serif;
    color: #eef1fa;
    position: relative;
    overflow-x: hidden;
  }
  body::before {
    content: '';
    position: fixed; inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E");
    opacity: 0.032; pointer-events: none; z-index: 0;
  }
  body::after {
    content: '';
    position: fixed; top: -20vh; left: 50%; transform: translateX(-50%);
    width: 700px; height: 400px;
    background: radial-gradient(ellipse, rgba(212,168,67,0.07) 0%, transparent 70%);
    pointer-events: none; z-index: 0;
  }
  #root { position: relative; z-index: 1; }

  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #242c4a; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #2a3356; }

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
    background: rgba(22,28,45,0.95);
    backdrop-filter: blur(28px);
    border-bottom: 1px solid rgba(255,255,255,0.07);
    padding: 0 24px;
    display: flex; align-items: center; justify-content: space-between;
    z-index: 10;
  }
  .app-header::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, #d4a843 30%, #f0c865 50%, #d4a843 70%, transparent);
    opacity: 0.5;
  }

  .logo-box {
    width: 38px; height: 38px;
    background: linear-gradient(145deg, #242c4a, #161c2d);
    border: 1px solid #9a7428;
    border-radius: 10px;
    box-shadow: 0 0 24px rgba(212,168,67,0.18), inset 0 1px 0 rgba(255,255,255,0.10);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }

  .nav-tab {
    display: flex; align-items: center; gap: 6px;
    padding: 12px 16px;
    border: none; cursor: pointer;
    background: transparent; color: #8fa0c8;
    border-bottom: 2px solid transparent;
    font-family: 'DM Sans', sans-serif;
    font-size: 12px; font-weight: 500;
    transition: all 0.18s ease;
    white-space: nowrap;
  }
  .nav-tab:hover:not(.active) { color: #eef1fa; background: rgba(255,255,255,0.04); }
  .nav-tab.active {
    color: #f0c865;
    border-bottom-color: #d4a843;
    background: rgba(212,168,67,0.06);
  }

  .metric-card {
    background: linear-gradient(145deg, #242c4a 0%, #1e2640 100%);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 16px;
    padding: 20px 22px;
    position: relative; overflow: hidden;
    box-shadow: 0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06);
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  }
  .metric-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 12px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08);
    border-color: rgba(255,255,255,0.18);
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
    background: linear-gradient(145deg, #242c4a, #1e2640);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px; padding: 16px;
    position: relative; overflow: hidden;
    transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
  }
  .data-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 10px 32px rgba(0,0,0,0.35);
    border-color: rgba(255,255,255,0.16);
  }
  .data-card::after {
    content: '';
    position: absolute; bottom: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, #9a7428, transparent);
    opacity: 0;
    transition: opacity 0.16s ease;
  }
  .data-card:hover::after { opacity: 1; }

  .live-card {
    background: linear-gradient(145deg, #242c4a, #1e2640);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px; padding: 18px 20px;
    position: relative; overflow: hidden;
  }
  .live-card .card-top-bar {
    position: absolute; top: 0; left: 0; right: 0; height: 2px;
  }

  .section-label {
    display: flex; align-items: center; gap: 10px;
    font-family: 'DM Mono', monospace;
    font-size: 9.5px; text-transform: uppercase; letter-spacing: 2px;
    color: #2d3d68; margin-bottom: 12px;
  }
  .section-label::after {
    content: ''; flex: 1; height: 1px;
    background: linear-gradient(90deg, rgba(255,255,255,0.08), transparent);
  }

  .activity-row {
    padding: 11px 18px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    transition: background 0.12s ease;
    display: flex; align-items: center; gap: 10px;
  }
  .activity-row:last-child { border-bottom: none; }
  .activity-row:hover { background: rgba(255,255,255,0.025); }

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
    background: rgba(244,167,50,0.10); color: #f4a732;
    border: 1px solid rgba(244,167,50,0.22);
  }
  .badge-rejected {
    background: rgba(242,92,122,0.10); color: #f25c7a;
    border: 1px solid rgba(242,92,122,0.22);
  }
  .badge-draft {
    background: rgba(77,142,240,0.10); color: #4d8ef0;
    border: 1px solid rgba(77,142,240,0.22);
  }

  .kw-chip {
    padding: 3px 9px; border-radius: 6px;
    font-family: 'DM Mono', monospace; font-size: 10px;
    background: rgba(255,255,255,0.05); color: #8fa0c8;
    border: 1px solid rgba(255,255,255,0.08);
    transition: all 0.14s ease; cursor: default;
  }
  .kw-chip:hover {
    border-color: rgba(212,168,67,0.32);
    color: #f0c865; background: rgba(212,168,67,0.07);
  }

  .btn-approve {
    background: rgba(34,212,114,0.10); border: 1px solid rgba(34,212,114,0.28);
    color: #22d472; padding: 5px 13px; border-radius: 8px;
    font-size: 11px; cursor: pointer; font-family: 'DM Sans', sans-serif;
    font-weight: 600; transition: background 0.14s ease;
  }
  .btn-approve:hover { background: rgba(34,212,114,0.18); }

  .btn-reject {
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.10);
    color: #4f6090; padding: 5px 13px; border-radius: 8px;
    font-size: 11px; cursor: pointer; font-family: 'DM Sans', sans-serif;
    transition: all 0.14s ease;
  }
  .btn-reject:hover { background: rgba(255,255,255,0.08); color: #8fa0c8; }

  .btn-approve-all {
    background: linear-gradient(135deg, #9a7428 0%, #d4a843 55%, #f0c865 100%);
    border: none; color: #111728;
    padding: 10px 22px; border-radius: 12px;
    font-size: 12px; font-weight: 700; cursor: pointer;
    font-family: 'DM Sans', sans-serif;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.20);
    transition: transform 0.16s ease, box-shadow 0.16s ease, opacity 0.16s ease;
  }
  .btn-approve-all:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(212,168,67,0.40), inset 0 1px 0 rgba(255,255,255,0.20);
    opacity: 0.94;
  }

  .btn-sync {
    background: linear-gradient(135deg, #9a7428 0%, #d4a843 55%, #f0c865 100%);
    border: none; color: #111728;
    padding: 9px 20px; border-radius: 10px;
    font-size: 12px; font-weight: 700; cursor: pointer;
    font-family: 'DM Sans', sans-serif;
    display: flex; align-items: center; gap: 7px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.20);
    transition: transform 0.16s ease, box-shadow 0.16s ease, opacity 0.16s ease;
  }
  .btn-sync:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(212,168,67,0.40), inset 0 1px 0 rgba(255,255,255,0.20);
    opacity: 0.94;
  }
  .btn-sync:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }

  .btn-view-live {
    background: rgba(212,168,67,0.08);
    border: 1px solid rgba(212,168,67,0.22);
    color: #d4a843; padding: 6px 14px; border-radius: 8px;
    font-size: 11px; font-weight: 600; cursor: pointer;
    font-family: 'DM Sans', sans-serif;
    display: inline-flex; align-items: center; gap: 6px;
    transition: all 0.14s ease;
  }
  .btn-view-live:hover {
    background: rgba(212,168,67,0.14);
    color: #f0c865;
    border-color: rgba(212,168,67,0.38);
  }

  .spinner {
    width: 14px; height: 14px;
    border: 2px solid rgba(17,23,40,0.3);
    border-top-color: #111728;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  .campaigns-table {
    width: 100%; border-collapse: collapse; margin-top: 12px;
  }
  .campaigns-table th {
    font-family: 'DM Mono', monospace; font-size: 9px; font-weight: 500;
    text-transform: uppercase; letter-spacing: 1.5px; color: #2d3d68;
    padding: 8px 12px; text-align: left;
    border-bottom: 1px solid rgba(255,255,255,0.07);
  }
  .campaigns-table td {
    font-family: 'DM Mono', monospace; font-size: 11px; color: #8fa0c8;
    padding: 9px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  .campaigns-table tr:last-child td { border-bottom: none; }
  .campaigns-table tr:hover td { background: rgba(255,255,255,0.02); }
  .campaigns-table td:first-child { color: #eef1fa; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 500; }

  .view-all-btn {
    background: none; border: none; color: #d4a843;
    font-size: 11px; cursor: pointer;
    font-family: 'DM Mono', monospace;
    display: flex; align-items: center; gap: 4px;
    transition: color 0.14s ease;
  }
  .view-all-btn:hover { color: #f0c865; }

  .step-icon {
    width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 700; font-family: 'DM Mono', monospace;
  }

  .stat-chip {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 20px; padding: 5px 13px;
    font-family: 'DM Mono', monospace; font-size: 11px; color: #8fa0c8;
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
      background: "rgba(255,255,255,0.03)",
      border: `1px solid rgba(255,255,255,0.07)`,
      borderRadius: 10, padding: "12px 14px",
    }}>
      <div style={{ fontFamily: F.mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "1.5px", color: C.textMuted, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color: color || C.textPrimary, lineHeight: 1 }}>{value}</div>
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
            <td style={{ color: C.amber }}>${c.spend != null && c.spend !== "" ? (parseFloat(c.spend) === 0 ? "0" : c.spend) : "—"}</td>
            <td>{c.clicks != null ? Number(c.clicks).toLocaleString() : "—"}</td>
            <td style={{ color: C.emerald }}>{c.conversions != null ? c.conversions : "—"}</td>
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

  const pendingCount = state.actionQueue.filter(a => a.status === "pending").length;

  const tabs = [
    { id: "overview",  label: "Overview",                  icon: <Icons.BarChart /> },
    { id: "live",      label: "Live Data",                 icon: <Icons.Refresh /> },
    { id: "actions",   label: `Actions (${pendingCount})`, icon: <Icons.Zap /> },
    { id: "channels",  label: "Channels",                  icon: <Icons.Globe /> },
    { id: "content",   label: "Content",                   icon: <Icons.Edit /> },
    { id: "intel",     label: "Intel",                     icon: <Icons.Eye /> },
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
                  <stop offset="0%" stopColor="#f0c865"/>
                  <stop offset="100%" stopColor="#9a7428"/>
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
        background: "rgba(22,28,45,0.80)", borderBottom: `1px solid ${C.borderDim}`,
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 14, marginBottom: 24 }}>
              {[
                { label: "Total Spend",     value: `$${state.metrics.totalSpend.toLocaleString()}`,   sub: "+12% vs last month",  color: C.violet,   spark: [1200,1800,2100,2400,3100,3800,4280] },
                { label: "Revenue",         value: `$${state.metrics.totalRevenue.toLocaleString()}`, sub: "Attributed",           color: C.emerald,  spark: [4200,6800,9400,11200,14500,16800,18940] },
                { label: "ROAS",            value: `${state.metrics.overallROAS}x`,                  sub: "Overall blended",      color: C.amber,    spark: [3.1,3.4,3.8,4.0,4.1,4.3,4.42] },
                { label: "Leads",           value: state.metrics.leadsThisWeek,                       sub: "This week",            color: C.teal,     spark: [42,58,71,89,95,112,127] },
                { label: "Conv. Rate",      value: `${state.metrics.conversionRate}%`,                sub: "Avg across channels",  color: C.sapphire, spark: [2.8,3.0,3.2,3.1,3.5,3.6,3.8] },
                { label: "Organic Traffic", value: state.metrics.organicTraffic.toLocaleString(),     sub: "Monthly visits",       color: C.rose,     spark: [7200,8100,9200,10100,10800,11600,12400] },
              ].map((kpi, i) => (
                <div key={i} className="metric-card">
                  <div className="card-top-bar" style={{ background: kpi.color }} />
                  <div className="card-glow" style={{ background: `radial-gradient(circle, ${kpi.color} 0%, transparent 70%)` }} />
                  <div className="card-corner" />
                  <div style={{ position: "relative", zIndex: 1 }}>
                    <div style={{ fontFamily: F.mono, fontSize: 10, textTransform: "uppercase", letterSpacing: "1.5px", color: C.textMuted, marginBottom: 10 }}>{kpi.label}</div>
                    <div style={{ fontFamily: F.serif, fontSize: 30, fontWeight: 700, color: C.textPrimary, letterSpacing: "-0.5px", lineHeight: 1, marginBottom: 8 }}>{kpi.value}</div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontFamily: F.mono, fontSize: 10, color: kpi.color }}>{kpi.sub}</span>
                      <Sparkline data={kpi.spark} color={kpi.color} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

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
              <div className="section-label" style={{ color: C.amber }}>Google Ads — Last 30 Days</div>
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
              <div className="section-label" style={{ color: C.sapphire }}>Facebook Ads — Last 30 Days</div>
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>Action Queue</div>
                <div style={{ fontSize: 13, color: C.textSecondary, fontFamily: F.sans }}>Claude analyzed your campaigns and recommends these actions</div>
              </div>
              {pendingCount > 0 && (
                <button onClick={() => dispatch({ type: "APPROVE_ALL" })} className="btn-approve-all">
                  Approve All ({pendingCount})
                </button>
              )}
            </div>

            {state.actionQueue.map(a => (
              <div key={a.id} className="data-card" style={{
                marginBottom: 10, display: "flex", alignItems: "center", gap: 12,
                opacity: a.status === "rejected" ? 0.38 : 1,
                transition: "opacity 0.3s",
              }}>
                <PriorityDot priority={a.priority} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, fontFamily: F.sans, color: C.textPrimary }}>{a.action}</div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontFamily: F.mono }}>{a.channel}</div>
                </div>
                <StatusBadge status={a.status} />
                {a.status === "pending" && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => dispatch({ type: "APPROVE_ACTION", payload: a.id })} className="btn-approve">Approve</button>
                    <button onClick={() => dispatch({ type: "REJECT_ACTION", payload: a.id })} className="btn-reject">Reject</button>
                  </div>
                )}
              </div>
            ))}
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
