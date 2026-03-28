import { useState, useEffect, useReducer, useCallback, useRef } from "react";

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

  @keyframes dotPulse {
    0%, 80%, 100% { transform: scale(0); opacity: 0.4; }
    40% { transform: scale(1); opacity: 1; }
  }
  .chat-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: #9ca3af; display: inline-block;
    animation: dotPulse 1.4s infinite ease-in-out;
  }
  .chat-dot:nth-child(1) { animation-delay: 0s; }
  .chat-dot:nth-child(2) { animation-delay: 0.2s; }
  .chat-dot:nth-child(3) { animation-delay: 0.4s; }

  .chat-bubble-user {
    background: #2b3a6b; color: #ffffff;
    border-radius: 18px 18px 4px 18px;
    padding: 10px 14px; max-width: 72%;
    font-family: 'Inter', sans-serif; font-size: 13px;
    line-height: 1.55; word-break: break-word;
  }
  .chat-bubble-assistant {
    background: #ffffff; color: #3a3a3a;
    border: 1px solid #e5e7eb;
    border-radius: 18px 18px 18px 4px;
    padding: 10px 14px; max-width: 100%;
    font-family: 'Inter', sans-serif; font-size: 13px;
    line-height: 1.55; word-break: break-word;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    white-space: pre-wrap;
  }
  .chat-input {
    flex: 1; background: #f9fafb;
    border: 1px solid #d1d5db; border-radius: 12px;
    padding: 10px 14px;
    font-family: 'Inter', sans-serif; font-size: 13px; color: #3a3a3a;
    resize: none; outline: none;
    min-height: 44px; max-height: 120px;
    transition: border-color 0.15s ease; line-height: 1.5;
  }
  .chat-input:focus { border-color: #2b3a6b; }
  .chat-input::placeholder { color: #9ca3af; }
  .chat-send-btn {
    width: 40px; height: 40px; align-self: flex-end;
    background: linear-gradient(135deg, #8b1a1e 0%, #c0272d 100%);
    border: none; border-radius: 10px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    transition: transform 0.15s ease, opacity 0.15s ease;
    box-shadow: 0 2px 8px rgba(192,39,45,0.3);
  }
  .chat-send-btn:hover:not(:disabled) { transform: translateY(-1px); }
  .chat-send-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
  .chat-chip {
    padding: 6px 13px; border-radius: 20px;
    font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 500;
    background: #f3f4f6; color: #374151;
    border: 1px solid #d1d5db; cursor: pointer;
    transition: all 0.14s ease; white-space: nowrap;
  }
  .chat-chip:hover { background: #e5e7eb; border-color: #9ca3af; color: #1f2937; }
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
  Chat: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  Send: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/>
      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
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

// ── Ad preview card ──
function AdPreviewCard({ adPreview, processedImage, onApprove, autoApproveEnabled, onAutoApproveToggle }) {
  const [activeTab,    setActiveTab]    = useState(adPreview?.formats?.[0] || 'meta_feed');
  const [publishing,   setPublishing]   = useState(false);
  const [publishResult,setPublishResult]= useState(null);
  const [publishError, setPublishError] = useState(null);
  const [countdown,    setCountdown]    = useState(null);

  const TAB_LABELS = { meta_feed: 'Feed', meta_story: 'Story', google_search: 'Search', google_display: 'Display' };

  // Auto-approve countdown
  useEffect(() => {
    if (!autoApproveEnabled || publishResult) return;
    let n = 3;
    setCountdown(n);
    const iv = setInterval(() => {
      n--;
      if (n <= 0) { clearInterval(iv); setCountdown(null); doPublish(); }
      else setCountdown(n);
    }, 1000);
    return () => clearInterval(iv);
  }, [autoApproveEnabled]); // eslint-disable-line

  const doPublish = async () => {
    setPublishing(true);
    setPublishError(null);
    try {
      const hasImg = adPreview.hasImage && processedImage;
      if (hasImg) {
        const ctaMap = { 'Get Quote': 'GET_QUOTE', 'Contact Us': 'CONTACT_US', 'Shop Now': 'SHOP_NOW' };
        const res  = await fetch('/api/meta-creative', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64:  processedImage.base64,
            mediaType:    processedImage.mediaType || 'image/jpeg',
            format:       processedImage.format    || 'feed',
            adName:       `FPB — ${adPreview.headline || 'Ad'} — ${new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`,
            headline:     adPreview.headline    || 'Get Your Free Quote Today',
            primaryText:  adPreview.primaryText || 'Florida Pole Barn Kits — Built for Florida.',
            callToAction: ctaMap[adPreview.cta] || 'LEARN_MORE',
          }),
        });
        const json = await res.json();
        if (json.success) {
          setPublishResult(json);
          if (onApprove) onApprove(json);
        } else {
          setPublishError(json.error || 'Upload failed');
        }
      } else {
        setPublishError('Google ad publishing coming soon — Meta ads require an image.');
      }
    } catch (e) {
      setPublishError(e.message);
    } finally {
      setPublishing(false);
    }
  };

  if (!adPreview) return null;

  const formats     = adPreview.formats || ['meta_feed'];
  const headline    = adPreview.headline    || 'Pole Barn Kits — Built for Florida';
  const primaryText = adPreview.primaryText || 'Florida Pole Barn Kits — Licensed & insured. Free quotes statewide.';
  const description = adPreview.description || 'Hurricane-rated. AG-exempt available.';
  const cta         = adPreview.cta         || 'Learn More';
  const displayUrl  = adPreview.displayUrl  || 'floridapolebarn.com';
  const hasImg      = adPreview.hasImage && !!processedImage;
  const imgSrc      = hasImg ? `data:image/jpeg;base64,${processedImage.base64}` : null;

  const visibleTabs = ['meta_feed','meta_story','google_search','google_display'].filter(t => formats.includes(t));
  const currentTab  = visibleTabs.includes(activeTab) ? activeTab : visibleTabs[0];

  const btnSel = { background: '#2b3a6b', color: '#ffffff', border: '1px solid #2b3a6b' };
  const btnOff = { background: '#f3f4f6', color: '#374151', border: '1px solid #dadce0' };

  return (
    <div style={{ marginTop: 12, maxWidth: 440, fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {visibleTabs.map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 500, transition: 'all 0.13s ease',
            ...(currentTab === t ? btnSel : btnOff),
          }}>{TAB_LABELS[t] || t}</button>
        ))}
      </div>

      {/* ── META FEED ── */}
      {currentTab === 'meta_feed' && (
        <div style={{ borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.12)', background: '#fff', maxWidth: 400 }}>
          <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e4e6ea', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#050505' }}>Florida Pole Barn</div>
              <div style={{ fontSize: 11, color: '#65676b' }}>Sponsored · 🌐</div>
            </div>
            <div style={{ color: '#65676b', fontSize: 18, cursor: 'pointer' }}>•••</div>
          </div>
          <div style={{ padding: '0 12px 10px', fontSize: 13, color: '#050505', lineHeight: 1.5 }}>
            {primaryText.length > 120 ? primaryText.slice(0, 120) + '…' : primaryText}
          </div>
          {imgSrc
            ? <img src={imgSrc} alt="ad" style={{ width: '100%', maxHeight: 210, objectFit: 'cover', display: 'block' }} />
            : <div style={{ width: '100%', height: 210, background: '#e4e6ea', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#90949c', fontSize: 12 }}>Image will appear here</div>
          }
          <div style={{ borderTop: '1px solid #e4e6ea', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f0f2f5' }}>
            <div>
              <div style={{ fontSize: 10, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{displayUrl}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#050505', marginTop: 2, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{headline}</div>
            </div>
            <button style={{ background: '#e4e6ea', border: 'none', borderRadius: 4, padding: '6px 12px', fontSize: 13, fontWeight: 600, color: '#050505', cursor: 'pointer', flexShrink: 0 }}>{cta}</button>
          </div>
          <div style={{ padding: '6px 12px', display: 'flex', borderTop: '1px solid #e4e6ea' }}>
            {['👍 Like', '💬 Comment', '↗ Share'].map((a, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 12, color: '#65676b', fontWeight: 600, padding: '4px 0', cursor: 'pointer' }}>{a}</div>
            ))}
          </div>
        </div>
      )}

      {/* ── META STORY ── */}
      {currentTab === 'meta_story' && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 200, height: 355, borderRadius: 14, overflow: 'hidden', background: '#000', position: 'relative', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
            {imgSrc
              ? <img src={imgSrc} alt="story" style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} />
              : <div style={{ position: 'absolute', inset: 0, background: '#1c1c1e' }} />
            }
            <div style={{ position: 'absolute', top: 8, left: 8, right: 8, height: 2, background: 'rgba(255,255,255,0.35)', borderRadius: 2 }}>
              <div style={{ width: '60%', height: '100%', background: '#fff', borderRadius: 2 }} />
            </div>
            <div style={{ position: 'absolute', top: 16, left: 8, right: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.3)', border: '1.5px solid #fff', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>Florida Pole Barn</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)' }}>Sponsored</div>
              </div>
            </div>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.78))', padding: '24px 12px 12px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4, lineHeight: 1.3 }}>{headline}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginBottom: 8, lineHeight: 1.4 }}>
                {primaryText.length > 80 ? primaryText.slice(0, 80) + '…' : primaryText}
              </div>
              <div style={{ textAlign: 'center' }}>
                <button style={{ background: 'transparent', border: '1.5px solid #fff', color: '#fff', borderRadius: 4, padding: '5px 14px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{cta}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── GOOGLE SEARCH ── */}
      {currentTab === 'google_search' && (
        <div style={{ background: '#fff', borderRadius: 8, padding: '14px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.12)', maxWidth: 400, fontFamily: 'Arial, sans-serif' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 10, border: '1px solid #006621', color: '#006621', borderRadius: 3, padding: '1px 4px', fontWeight: 700 }}>Ad</span>
            <span style={{ fontSize: 13, color: '#006621' }}>https://{displayUrl}</span>
          </div>
          <div
            style={{ fontSize: 18, color: '#1a0dab', cursor: 'pointer', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
          >
            {headline.length > 30 ? headline.slice(0, 30) + '…' : headline}
          </div>
          <div style={{ fontSize: 13, color: '#545454', lineHeight: 1.5 }}>
            {primaryText.length > 90 ? primaryText.slice(0, 90) + '…' : primaryText}
            {description && <span> {description}</span>}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            {['Free Quote', 'View Gallery'].map((s, i) => (
              <span key={i} style={{ fontSize: 12, color: '#1a0dab', border: '1px solid #dadce0', borderRadius: 16, padding: '3px 10px', cursor: 'pointer' }}>{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* ── GOOGLE DISPLAY ── */}
      {currentTab === 'google_display' && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 300, height: 250, borderRadius: 6, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', fontFamily: 'Arial, sans-serif' }}>
            <div style={{ flex: '0 0 55%', background: '#1a2444', position: 'relative', overflow: 'hidden' }}>
              {imgSrc
                ? <img src={imgSrc} alt="display" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 8, background: '#c0272d' }} />
              }
            </div>
            <div style={{ flex: 1, background: '#fff', padding: '8px 10px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#3a3a3a' }}>Florida Pole Barn</div>
                <div style={{ fontSize: 11, color: '#3a3a3a', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{headline}</div>
              </div>
              <button style={{ width: '100%', padding: '5px 0', background: '#c0272d', color: '#fff', border: 'none', borderRadius: 3, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>{cta}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── APPROVAL SECTION ── */}
      <div style={{ marginTop: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '14px 16px' }}>
        {publishResult ? (
          <div style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#16a34a', marginBottom: 4 }}>✓ Published to Meta</div>
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#6b7280', marginBottom: 6 }}>Creative ID: {publishResult.creativeId}</div>
            <a href={publishResult.previewUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'underline' }}>View in Ads Manager →</a>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#3a3a3a', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              Ad Preview — Ready to publish?
              {countdown !== null && (
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: '#c0272d', fontWeight: 700 }}>
                  Auto-publishing in {countdown}…
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button onClick={doPublish} disabled={publishing} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: publishing ? 'not-allowed' : 'pointer',
                background: publishing ? '#9ca3af' : 'linear-gradient(135deg, #8b1a1e 0%, #c0272d 100%)',
                color: '#fff', fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                {publishing ? (
                  <>
                    <span className="chat-dot" style={{ background: 'rgba(255,255,255,0.7)' }} />
                    <span className="chat-dot" style={{ background: 'rgba(255,255,255,0.7)', animationDelay: '0.2s' }} />
                    <span className="chat-dot" style={{ background: 'rgba(255,255,255,0.7)', animationDelay: '0.4s' }} />
                    <span style={{ marginLeft: 4 }}>Publishing…</span>
                  </>
                ) : 'Approve & Publish'}
              </button>
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('fpb:requestChanges', { detail: 'Please make these changes to the ad: ' }))}
                style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#374151', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              >Request Changes</button>
            </div>
            {publishError && (
              <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 8 }}>✗ {publishError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
              {autoApproveEnabled && (
                <span style={{ fontSize: 11, background: 'rgba(234,179,8,0.15)', color: '#92400e', border: '1px solid rgba(234,179,8,0.4)', borderRadius: 20, padding: '2px 8px' }}>
                  ⚠ AI will publish ads automatically
                </span>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <span style={{ fontSize: 11, color: '#6b7280' }}>Auto-publish</span>
                <div onClick={() => onAutoApproveToggle(!autoApproveEnabled)} style={{
                  width: 32, height: 18, borderRadius: 9, cursor: 'pointer', position: 'relative',
                  background: autoApproveEnabled ? '#2b3a6b' : '#d1d5db', transition: 'background 0.2s ease',
                }}>
                  <div style={{
                    position: 'absolute', top: 2, left: autoApproveEnabled ? 16 : 2,
                    width: 14, height: 14, borderRadius: '50%', background: '#fff',
                    transition: 'left 0.2s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }} />
                </div>
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Image processing panel ──
function ImageProcessPanel({ msgId, originalImage, panelState, updatePanel }) {
  const format    = panelState?.format    ?? 'feed';
  const overlayOn = panelState?.overlayOn ?? false;
  const overlayText = panelState?.overlayText ?? '';
  const overlayPos  = panelState?.overlayPos  ?? 'bottom';
  const overlayStyle = panelState?.overlayStyle ?? 'light';
  const processing  = panelState?.processing  ?? false;
  const result      = panelState?.result      ?? null;
  const error       = panelState?.error       ?? null;

  // Push-to-Meta form state
  const pushOpen      = panelState?.pushOpen      ?? false;
  const pushAdName    = panelState?.pushAdName    ?? `FPB ${format.charAt(0).toUpperCase() + format.slice(1)} — ${new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
  const pushHeadline  = panelState?.pushHeadline  ?? '';
  const pushBody      = panelState?.pushBody      ?? '';
  const pushCta       = panelState?.pushCta       ?? 'LEARN_MORE';
  const pushing       = panelState?.pushing       ?? false;
  const pushResult    = panelState?.pushResult    ?? null;
  const pushError     = panelState?.pushError     ?? null;

  const CTA_OPTIONS = [
    { key: 'LEARN_MORE',  label: 'Learn More'  },
    { key: 'GET_QUOTE',   label: 'Get Quote'   },
    { key: 'CONTACT_US',  label: 'Contact Us'  },
    { key: 'SHOP_NOW',    label: 'Shop Now'    },
  ];

  const FORMAT_LABELS = [
    { key: 'feed',     label: 'Feed',   sub: '1200×628' },
    { key: 'story',    label: 'Story',  sub: '1080×1920' },
    { key: 'square',   label: 'Square', sub: '1080×1080' },
    { key: 'original', label: 'Original', sub: 'as-is' },
  ];

  const handleProcess = async () => {
    if (!originalImage) return;
    updatePanel(msgId, { processing: true, error: null, result: null });

    const body = {
      imageData: { base64: originalImage.base64, mediaType: originalImage.mediaType },
      format,
      overlays: overlayOn && overlayText.trim()
        ? [{ text: overlayText.trim(), position: overlayPos, style: overlayStyle, fontSize: 'medium' }]
        : [],
    };

    try {
      const res  = await fetch('/api/image-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        updatePanel(msgId, { processing: false, result: json.processedImage });
      } else {
        updatePanel(msgId, { processing: false, error: json.error || 'Processing failed' });
      }
    } catch (e) {
      updatePanel(msgId, { processing: false, error: e.message });
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = `data:image/jpeg;base64,${result.base64}`;
    a.download = `fpb-ad-${format}-${Date.now()}.jpg`;
    a.click();
  };

  const handlePush = async () => {
    if (!result) return;
    updatePanel(msgId, { pushing: true, pushError: null, pushResult: null });
    try {
      const res  = await fetch('/api/meta-creative', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          imageBase64:  result.base64,
          mediaType:    result.mediaType || 'image/jpeg',
          format,
          adName:       pushAdName   || `FPB ${format} Ad`,
          headline:     pushHeadline || 'Get Your Free Quote Today',
          primaryText:  pushBody     || 'Florida Pole Barn Kits — Built for Florida.',
          callToAction: pushCta,
        }),
      });
      const json = await res.json();
      if (json.success) {
        updatePanel(msgId, { pushing: false, pushResult: json, pushOpen: false });
      } else {
        updatePanel(msgId, { pushing: false, pushError: `${json.error}${json.step ? ` (${json.step})` : ''}` });
      }
    } catch (e) {
      updatePanel(msgId, { pushing: false, pushError: e.message });
    }
  };

  const btnSel = { background: '#2b3a6b', color: '#ffffff', border: '1px solid #2b3a6b' };
  const btnOff = { background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db' };

  return (
    <div style={{
      marginTop: 10, background: '#f9fafb', border: '1px solid #e5e7eb',
      borderRadius: 12, padding: '14px 16px',
    }}>
      <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 600, color: '#3a3a3a', marginBottom: 12 }}>
        Process this image for Meta
      </div>

      {/* Format selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {FORMAT_LABELS.map(f => (
          <button
            key={f.key}
            onClick={() => updatePanel(msgId, { format: f.key })}
            style={{
              padding: '5px 11px', borderRadius: 8, cursor: 'pointer',
              fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 500,
              transition: 'all 0.13s ease',
              ...(format === f.key ? btnSel : btnOff),
            }}
          >
            {f.label}
            <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 4 }}>{f.sub}</span>
          </button>
        ))}
      </div>

      {/* Text overlay toggle */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontFamily: "'Inter', sans-serif", fontSize: 12, color: '#374151' }}>
          <input
            type="checkbox"
            checked={overlayOn}
            onChange={e => updatePanel(msgId, { overlayOn: e.target.checked })}
            style={{ accentColor: '#2b3a6b', width: 14, height: 14 }}
          />
          Add text overlay
        </label>

        {overlayOn && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              type="text"
              placeholder="Enter overlay text…"
              value={overlayText}
              onChange={e => updatePanel(msgId, { overlayText: e.target.value })}
              style={{
                padding: '7px 10px', borderRadius: 8,
                border: '1px solid #d1d5db', fontFamily: "'Inter', sans-serif",
                fontSize: 12, color: '#3a3a3a', background: '#ffffff', outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, textTransform: 'uppercase', letterSpacing: '1px', color: '#9ca3af', flexShrink: 0 }}>Position</span>
              {['top', 'center', 'bottom'].map(p => (
                <button key={p} onClick={() => updatePanel(msgId, { overlayPos: p })}
                  style={{ padding: '4px 9px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                    fontFamily: "'Inter', sans-serif", transition: 'all 0.13s ease',
                    ...(overlayPos === p ? btnSel : btnOff) }}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, textTransform: 'uppercase', letterSpacing: '1px', color: '#9ca3af', marginLeft: 8, flexShrink: 0 }}>Style</span>
              {[{ k: 'light', l: 'Light' }, { k: 'dark', l: 'Dark' }].map(s => (
                <button key={s.k} onClick={() => updatePanel(msgId, { overlayStyle: s.k })}
                  style={{ padding: '4px 9px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                    fontFamily: "'Inter', sans-serif", transition: 'all 0.13s ease',
                    ...(overlayStyle === s.k ? btnSel : btnOff) }}>
                  {s.l}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Process button */}
      <button
        onClick={handleProcess}
        disabled={processing}
        style={{
          width: '100%', padding: '9px 0', borderRadius: 10, border: 'none',
          background: processing ? '#9ca3af' : 'linear-gradient(135deg, #8b1a1e 0%, #c0272d 100%)',
          color: '#ffffff', fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
          cursor: processing ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          transition: 'opacity 0.15s ease',
        }}
      >
        {processing ? (
          <>
            <span className="chat-dot" style={{ background: 'rgba(255,255,255,0.7)' }} />
            <span className="chat-dot" style={{ background: 'rgba(255,255,255,0.7)', animationDelay: '0.2s' }} />
            <span className="chat-dot" style={{ background: 'rgba(255,255,255,0.7)', animationDelay: '0.4s' }} />
            <span style={{ marginLeft: 4 }}>Processing…</span>
          </>
        ) : 'Process Image'}
      </button>

      {/* Error */}
      {error && (
        <div style={{ marginTop: 8, fontFamily: "'Inter', sans-serif", fontSize: 12, color: '#dc2626' }}>
          ✗ {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{ marginTop: 12 }}>
          <img
            src={`data:image/jpeg;base64,${result.base64}`}
            alt="processed"
            style={{ width: '100%', borderRadius: 8, border: '1px solid #d1d5db', display: 'block' }}
          />
          <div style={{ marginTop: 6, fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#9ca3af' }}>
            {result.width}×{result.height}px · {result.fileSizeKB}KB
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>

            {/* Push success banner */}
            {pushResult && (
              <div style={{
                background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)',
                borderRadius: 8, padding: '10px 12px', marginBottom: 4,
              }}>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 600, color: '#16a34a', marginBottom: 4 }}>
                  ✓ Creative uploaded to Meta
                </div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#6b7280', marginBottom: 6 }}>
                  ID: {pushResult.creativeId}
                </div>
                <a
                  href={pushResult.previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: '#2563eb', textDecoration: 'underline' }}
                >
                  View in Meta Ads Manager →
                </a>
              </div>
            )}

            {/* Push error */}
            {pushError && (
              <div style={{ background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.22)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#dc2626', fontFamily: "'Inter', sans-serif" }}>
                ✗ {pushError}
              </div>
            )}

            {/* Push to Meta button */}
            {!pushResult && (
              <button
                onClick={() => updatePanel(msgId, { pushOpen: !pushOpen })}
                style={{
                  width: '100%', padding: '8px 0', borderRadius: 8, border: 'none',
                  background: '#2b3a6b', color: '#ffffff',
                  fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', transition: 'opacity 0.13s ease',
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                {pushOpen ? 'Cancel ↑' : 'Push to Meta as Ad'}
              </button>
            )}

            {/* Inline push form */}
            {pushOpen && !pushResult && (
              <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#9ca3af' }}>Ad Details</div>

                <input
                  type="text"
                  placeholder="Ad name (e.g. Pole Barn Kits — Feed — Mar 2026)"
                  value={pushAdName}
                  onChange={e => updatePanel(msgId, { pushAdName: e.target.value })}
                  style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid #d1d5db', fontFamily: "'Inter', sans-serif", fontSize: 12, color: '#3a3a3a', outline: 'none' }}
                />
                <input
                  type="text"
                  placeholder="Headline — Get Your Free Quote Today"
                  value={pushHeadline}
                  onChange={e => updatePanel(msgId, { pushHeadline: e.target.value })}
                  style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid #d1d5db', fontFamily: "'Inter', sans-serif", fontSize: 12, color: '#3a3a3a', outline: 'none' }}
                />
                <textarea
                  placeholder="Primary text — Florida Pole Barn Kits — Built to last. Licensed &amp; insured. Free quotes."
                  value={pushBody}
                  onChange={e => updatePanel(msgId, { pushBody: e.target.value })}
                  rows={3}
                  style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid #d1d5db', fontFamily: "'Inter', sans-serif", fontSize: 12, color: '#3a3a3a', outline: 'none', resize: 'vertical' }}
                />

                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {CTA_OPTIONS.map(c => (
                    <button key={c.key} onClick={() => updatePanel(msgId, { pushCta: c.key })}
                      style={{ padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                        fontFamily: "'Inter', sans-serif", transition: 'all 0.13s ease',
                        ...(pushCta === c.key ? btnSel : btnOff) }}>
                      {c.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={handlePush}
                  disabled={pushing}
                  style={{
                    width: '100%', padding: '9px 0', borderRadius: 8, border: 'none',
                    background: pushing ? '#9ca3af' : 'linear-gradient(135deg, #8b1a1e 0%, #c0272d 100%)',
                    color: '#ffffff', fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 600,
                    cursor: pushing ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  {pushing ? (
                    <>
                      <span className="chat-dot" style={{ background: 'rgba(255,255,255,0.7)' }} />
                      <span className="chat-dot" style={{ background: 'rgba(255,255,255,0.7)', animationDelay: '0.2s' }} />
                      <span className="chat-dot" style={{ background: 'rgba(255,255,255,0.7)', animationDelay: '0.4s' }} />
                      <span style={{ marginLeft: 4 }}>Uploading to Meta…</span>
                    </>
                  ) : 'Upload to Meta'}
                </button>
              </div>
            )}

            <button
              onClick={handleDownload}
              style={{
                width: '100%', padding: '8px 0', borderRadius: 8,
                border: '1px solid #d1d5db', background: '#ffffff', color: '#374151',
                fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 500,
                cursor: 'pointer', transition: 'background 0.13s ease',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
              onMouseLeave={e => e.currentTarget.style.background = '#ffffff'}
            >
              Download
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Chat action card ──
function ActionCard({ payload }) {
  const [status, setStatus] = useState("idle"); // idle | executing | done | error
  const [errorMsg, setErrorMsg] = useState(null);

  if (!payload) return null;

  const platformLabel = (p) => {
    if (["google", "google_ads"].includes(p)) return "Google Ads";
    if (["meta", "meta_ads"].includes(p)) return "Meta Ads";
    return p || "Unknown";
  };

  const handleConfirm = async () => {
    setStatus("executing");
    try {
      const res = await fetch("/api/execute-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform:   payload.platform,
          actionType: payload.action_type,
          campaignId: payload.campaign_id,
        }),
      });
      const json = await res.json();
      if (res.status === 400 || (json.success && !json.executed)) {
        setStatus("done");
      } else if (!res.ok) {
        throw new Error(json.error || "Execution failed");
      } else {
        setStatus("done");
      }
    } catch (err) {
      setStatus("error");
      setErrorMsg(err.message);
    }
  };

  return (
    <div style={{
      background: "#f9fafb", border: "1px solid #e5e7eb",
      borderRadius: 12, padding: "12px 14px", marginTop: 4,
      borderLeft: "3px solid #c0272d",
    }}>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, textTransform: "uppercase", letterSpacing: "1.5px", color: "#6b7280", marginBottom: 8 }}>
        Recommended Action
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#3a3a3a", marginBottom: 4 }}>
        {(payload.action_type || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
        {payload.campaign_name && (
          <span style={{ fontWeight: 400, color: "#6b7280" }}> · {payload.campaign_name}</span>
        )}
      </div>
      {payload.description && (
        <div style={{ fontSize: 12, color: "#374151", marginBottom: 10, lineHeight: 1.5 }}>{payload.description}</div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {status === "idle" && (
          <>
            <button className="btn-approve" onClick={handleConfirm} style={{ fontSize: 12 }}>Confirm</button>
            <button className="btn-reject" onClick={() => setStatus("done")} style={{ fontSize: 12 }}>Dismiss</button>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#9ca3af" }}>
              {platformLabel(payload.platform)}
            </span>
          </>
        )}
        {status === "executing" && (
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#6b7280", display: "flex", alignItems: "center", gap: 6 }}>
            <span className="spinner" style={{ borderColor: "rgba(0,0,0,0.15)", borderTopColor: "#2b3a6b" }} /> Executing…
          </span>
        )}
        {status === "done" && (
          <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>✓ Done</span>
        )}
        {status === "error" && (
          <span style={{ fontSize: 12, color: "#dc2626" }}>✗ {errorMsg || "Failed"}</span>
        )}
      </div>
    </div>
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
  const [executingIds, setExecutingIds] = useState(new Set());

  // ── Performance snapshot state (Overview) ──
  const [snapshotData, setSnapshotData] = useState(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  // ── Automation Log tab state ──
  const [logData, setLogData] = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logPlatform, setLogPlatform] = useState("all");

  // ── Chat tab state ──
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatFetching, setChatFetching] = useState(false);
  const [chatSessionId] = useState(() => crypto.randomUUID());
  const [pendingImage, setPendingImage] = useState(null); // { file, previewUrl, base64, mediaType }
  const [imagePanels, setImagePanels] = useState({}); // keyed by message id
  const [autoApproveEnabled, setAutoApproveEnabled] = useState(
    () => localStorage.getItem('fpb_auto_approve') === 'true'
  );
  const chatBottomRef = useRef(null);
  const fileInputRef = useRef(null);

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

  const normalizePlatform = (p) => {
    if (!p) return null;
    if (["google", "google_ads", "Google Ads"].includes(p)) return "google";
    if (["meta", "meta_ads", "Meta Ads", "Facebook Ads"].includes(p)) return "meta";
    return p;
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleApprove = async (action) => {
    const id = action.id;
    setExecutingIds(prev => new Set(prev).add(id));

    const platform   = normalizePlatform(action.platform);
    const actionType = action.action_type;
    const campaignId = action.campaign_id;

    try {
      const execRes = await fetch("/api/execute-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: id, platform, actionType, campaignId }),
      });
      const execJson = await execRes.json();

      if (execRes.status === 400) {
        // Unsupported platform or action type — expected for Meta etc. Fall back to PATCH.
        await fetch(`/api/actions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "approved" }),
        });
        showToast("✓ Approved (execution not supported yet for this action type)");
        setActionsData(prev => prev.filter(a => a.id !== id));
      } else if (!execRes.ok) {
        // 500 or unexpected — surface as failure, keep card
        throw new Error(execJson.error || "Execution request failed");
      } else if (execJson.executed) {
        // Execution succeeded
        const label = actionType === "pause_campaign" ? "Campaign paused" : "Campaign enabled";
        showToast(`✓ ${label}`);
        setActionsData(prev => prev.filter(a => a.id !== id));
      } else {
        // 200 but executed:false (API-side failure logged) — fall back to PATCH
        await fetch(`/api/actions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "approved" }),
        });
        showToast("✓ Approved (execution not supported yet for this action type)");
        setActionsData(prev => prev.filter(a => a.id !== id));
      }
    } catch {
      showToast("Execution failed — check Automation Log");
      // Do NOT remove card — let user retry
    } finally {
      setExecutingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const handleReject = async (id) => {
    setActionsData(prev => prev.filter(a => a.id !== id));
    showToast("Action rejected");
    try {
      await fetch(`/api/actions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected" }),
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

  // ── Chat: load history on mount ──
  const WELCOME_MSG = {
    id: "welcome", role: "assistant", message_type: "text",
    content: "Hi! I'm your FPB marketing AI. Ask me about your ad performance, campaign strategy, or request changes to your campaigns.",
  };
  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch(`/api/chat?sessionId=${chatSessionId}`);
        const json = await res.json();
        if (json.success && json.messages?.length > 0) {
          setChatMessages(json.messages);
        } else {
          setChatMessages([WELCOME_MSG]);
        }
      } catch {
        setChatMessages([WELCOME_MSG]);
      }
    })();
  }, [chatSessionId]); // eslint-disable-line

  // ── Chat: auto-scroll ──
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatFetching]);

  // ── Chat: handle image file select ──
  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (file.size > 5 * 1024 * 1024) {
      showToast("Image too large — max 5MB");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const base64 = dataUrl.split(",")[1];
      setPendingImage({ file, previewUrl, base64, mediaType: file.type });
    };
    reader.readAsDataURL(file);
  };

  // ── Chat: send message ──
  const sendMessage = async (text) => {
    const rawText = text || chatInput;
    const hasImage = !!pendingImage;
    const msg = rawText.trim() || (hasImage ? "Analyze this image for ad creative potential" : "");
    if (!msg || chatLoading || chatFetching) return;

    const imageSnapshot = pendingImage;
    setChatInput("");
    setPendingImage(null);

    const userMsg = {
      id: Date.now() + "-u", role: "user", content: msg, message_type: "text",
      previewUrl:     imageSnapshot?.previewUrl  || null,
      imageBase64:    imageSnapshot?.base64       || null,
      imageMediaType: imageSnapshot?.mediaType    || null,
    };
    setChatMessages(prev => [...prev, userMsg]);
    setChatLoading(true);

    try {
      const history = chatMessages.filter(m => m.role !== "system").map(m => ({
        role: m.role, content: m.content,
      }));

      const body1 = { message: msg, sessionId: chatSessionId, conversationHistory: history };
      if (imageSnapshot) body1.imageData = { base64: imageSnapshot.base64, mediaType: imageSnapshot.mediaType };

      const res1 = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body1),
      });
      const json1 = await res1.json();

      if (json1.type === "fetching") {
        setChatLoading(false);
        setChatFetching(true);

        const body2 = { message: msg, sessionId: chatSessionId, conversationHistory: history, includeAdData: true };
        if (imageSnapshot) body2.imageData = { base64: imageSnapshot.base64, mediaType: imageSnapshot.mediaType };

        const res2 = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body2),
        });
        const json2 = await res2.json();
        setChatFetching(false);

        if (json2.success) {
          setChatMessages(prev => [...prev, {
            id: Date.now() + "-a", role: "assistant",
            content: json2.reply, message_type: json2.messageType || "text",
            action_payload: json2.actionPayload || null,
            creative_ready: json2.creativeReady ?? null,
            adPreview:      json2.adPreview     || null,
          }]);
        }
      } else if (json1.success) {
        setChatMessages(prev => [...prev, {
          id: Date.now() + "-a", role: "assistant",
          content: json1.reply, message_type: json1.messageType || "text",
          action_payload: json1.actionPayload || null,
          creative_ready: json1.creativeReady ?? null,
          adPreview:      json1.adPreview     || null,
        }]);
      }
    } catch {
      setChatMessages(prev => [...prev, {
        id: Date.now() + "-err", role: "assistant", message_type: "text",
        content: "Something went wrong. Please try again.",
      }]);
    } finally {
      setChatLoading(false);
      setChatFetching(false);
    }
  };

  // ── Image panel state helpers ──
  const updatePanel = (msgId, patch) =>
    setImagePanels(prev => ({ ...prev, [msgId]: { ...prev[msgId], ...patch } }));

  // ── Get most recently processed image across all panels ──
  const getProcessedImageForSession = useCallback(() => {
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const panel = imagePanels[chatMessages[i]?.id];
      if (panel?.result) return panel.result;
    }
    return null;
  }, [chatMessages, imagePanels]);

  // ── Auto-approve persistence ──
  const handleAutoApproveToggle = (val) => {
    setAutoApproveEnabled(val);
    localStorage.setItem('fpb_auto_approve', String(val));
  };

  // ── Request Changes event (from AdPreviewCard "Request Changes" button) ──
  useEffect(() => {
    const handler = (e) => setChatInput(e.detail || 'Please make these changes to the ad: ');
    window.addEventListener('fpb:requestChanges', handler);
    return () => window.removeEventListener('fpb:requestChanges', handler);
  }, []);

  const pendingCount = state.actionQueue.filter(a => a.status === "pending").length;

  const tabs = [
    { id: "overview",  label: "Overview",                  icon: <Icons.BarChart /> },
    { id: "live",      label: "Live Data",                 icon: <Icons.Refresh /> },
    { id: "actions",   label: `Actions (${pendingCount})`, icon: <Icons.Zap /> },
    { id: "chat",      label: "Chat",                      icon: <Icons.Chat /> },
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
                    <LiveMetric label="Avg Frequency" value={facebookData.summary.frequency && parseFloat(facebookData.summary.frequency) > 0 ? facebookData.summary.frequency : "—"} color={C.gold} />
                    <LiveMetric label="Cost / Lead"   value={facebookData.summary.cpl != null ? `$${facebookData.summary.cpl}` : "—"}         color={C.violet} />
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
                      <button
                        onClick={() => handleApprove(a)}
                        disabled={executingIds.has(a.id)}
                        className="btn-approve"
                        style={{ opacity: executingIds.has(a.id) ? 0.7 : 1, minWidth: 90 }}
                      >
                        {executingIds.has(a.id) ? "Executing…" : "Approve"}
                      </button>
                      <button
                        onClick={() => handleReject(a.id)}
                        disabled={executingIds.has(a.id)}
                        className="btn-reject"
                      >
                        Reject
                      </button>
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

        {/* CHAT TAB */}
        {state.activeTab === "chat" && (
          <div key="chat" style={{ animation: "panelIn 0.22s ease" }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>AI Chat</div>
              <div style={{ fontSize: 13, color: C.textSecondary, fontFamily: F.sans }}>
                Ask about performance, request campaign changes, or get strategy advice
              </div>
            </div>

            <div style={{
              background: C.bgSurface, border: `1px solid ${C.borderDim}`, borderRadius: 16,
              display: "flex", flexDirection: "column", height: 580,
              boxShadow: "0 1px 6px rgba(0,0,0,0.07)", overflow: "hidden",
            }}>
              {/* Messages */}
              <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 12px" }}>

                {/* Suggested chips — only when ≤1 message (welcome only) */}
                {chatMessages.length <= 1 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                    {[
                      "How are my campaigns performing?",
                      "Which campaign should I pause?",
                      "Where is budget being wasted?",
                      "What's my best-performing ad?",
                    ].map((chip, i) => (
                      <button key={i} className="chat-chip" onClick={() => sendMessage(chip)}>{chip}</button>
                    ))}
                  </div>
                )}

                {/* Bubbles */}
                {chatMessages.map((msg, msgIdx) => {
                  if (msg.role === "user") {
                    return (
                      <div key={msg.id} style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14, flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                        {msg.previewUrl && (
                          <img
                            src={msg.previewUrl}
                            alt="uploaded"
                            style={{ width: 140, height: 100, objectFit: "cover", borderRadius: 10, border: `1px solid ${C.borderMed}` }}
                          />
                        )}
                        <div className="chat-bubble-user">{msg.content}</div>
                      </div>
                    );
                  }

                  const AiAvatar = () => (
                    <div style={{
                      flexShrink: 0, width: 28, height: 28, borderRadius: "50%",
                      background: "linear-gradient(135deg, #2b3a6b, #1a2444)",
                      display: "flex", alignItems: "center", justifyContent: "center", marginTop: 2,
                    }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/>
                      </svg>
                    </div>
                  );

                  // Find the original image from the preceding user message (used by both branches)
                  const prevMsg = msgIdx > 0 ? chatMessages[msgIdx - 1] : null;
                  const origImage = prevMsg?.imageBase64
                    ? { base64: prevMsg.imageBase64, mediaType: prevMsg.imageMediaType || 'image/jpeg' }
                    : null;

                  if (msg.message_type === "action_request" && msg.action_payload) {
                    const isProcessImage = msg.action_payload.action_type === "process_image";

                    // process_image: auto-pre-fill the panel and show it inline — no confirm button
                    if (isProcessImage && origImage) {
                      const p = msg.action_payload;
                      // Pre-fill panel with Claude's recommended settings (only on first render — don't overwrite user edits)
                      if (!imagePanels[msg.id]) {
                        updatePanel(msg.id, {
                          format:       p.format        || 'feed',
                          overlayOn:    !!p.overlay_text,
                          overlayText:  p.overlay_text  || '',
                          overlayPos:   p.overlay_position || 'bottom',
                          overlayStyle: p.overlay_style || 'light',
                        });
                      }
                      return (
                        <div key={msg.id} style={{ display: "flex", justifyContent: "flex-start", marginBottom: 14, gap: 10 }}>
                          <AiAvatar />
                          <div style={{ maxWidth: "80%" }}>
                            <div style={{ fontFamily: F.mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "1.5px", color: C.textDim, marginBottom: 5 }}>AI Assistant</div>
                            <div className="chat-bubble-assistant">{msg.content}</div>
                            <ImageProcessPanel
                              msgId={msg.id}
                              originalImage={origImage}
                              panelState={imagePanels[msg.id]}
                              updatePanel={updatePanel}
                            />
                          </div>
                        </div>
                      );
                    }

                    // All other action types: standard ActionCard
                    return (
                      <div key={msg.id} style={{ display: "flex", justifyContent: "flex-start", marginBottom: 14, gap: 10 }}>
                        <AiAvatar />
                        <div style={{ maxWidth: "80%" }}>
                          <div style={{ fontFamily: F.mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "1.5px", color: C.textDim, marginBottom: 5 }}>AI Assistant</div>
                          <div className="chat-bubble-assistant" style={{ marginBottom: 8 }}>{msg.content}</div>
                          <ActionCard payload={msg.action_payload} />
                          {msg.adPreview && (
                            <AdPreviewCard
                              adPreview={msg.adPreview}
                              processedImage={getProcessedImageForSession()}
                              onApprove={() => {}}
                              autoApproveEnabled={autoApproveEnabled}
                              onAutoApproveToggle={handleAutoApproveToggle}
                            />
                          )}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={msg.id} style={{ display: "flex", justifyContent: "flex-start", marginBottom: 14, gap: 10 }}>
                      <AiAvatar />
                      <div style={{ maxWidth: "80%" }}>
                        <div style={{ fontFamily: F.mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "1.5px", color: C.textDim, marginBottom: 5 }}>AI Assistant</div>
                        <div className="chat-bubble-assistant">{msg.content}</div>
                        {msg.creative_ready !== null && msg.creative_ready !== undefined && origImage && (
                          <ImageProcessPanel
                            msgId={msg.id}
                            originalImage={origImage}
                            panelState={imagePanels[msg.id]}
                            updatePanel={updatePanel}
                          />
                        )}
                        {msg.adPreview && (
                          <AdPreviewCard
                            adPreview={msg.adPreview}
                            processedImage={getProcessedImageForSession()}
                            onApprove={() => {}}
                            autoApproveEnabled={autoApproveEnabled}
                            onAutoApproveToggle={handleAutoApproveToggle}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Thinking bubble — shown immediately after send, before any response */}
                {chatLoading && !chatFetching && chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === "user" && (
                  <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 14, gap: 10 }}>
                    <div style={{
                      flexShrink: 0, width: 28, height: 28, borderRadius: "50%",
                      background: "linear-gradient(135deg, #2b3a6b, #1a2444)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/>
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontFamily: F.mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "1.5px", color: C.textDim, marginBottom: 5 }}>AI Assistant</div>
                      <div style={{
                        background: "#ffffff", border: "1px solid #e5e7eb",
                        borderRadius: "18px 18px 18px 4px", padding: "13px 16px",
                        display: "flex", gap: 5, alignItems: "center",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                      }}>
                        <span className="chat-dot" />
                        <span className="chat-dot" />
                        <span className="chat-dot" />
                        <span style={{ fontFamily: F.mono, fontSize: 9, color: C.textDim, marginLeft: 6 }}>Thinking…</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Fetching dots indicator */}
                {chatFetching && (
                  <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 14, gap: 10 }}>
                    <div style={{
                      flexShrink: 0, width: 28, height: 28, borderRadius: "50%",
                      background: "linear-gradient(135deg, #2b3a6b, #1a2444)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/>
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontFamily: F.mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "1.5px", color: C.textDim, marginBottom: 5 }}>AI Assistant</div>
                      <div style={{
                        background: "#ffffff", border: "1px solid #e5e7eb",
                        borderRadius: "18px 18px 18px 4px", padding: "13px 16px",
                        display: "flex", gap: 5, alignItems: "center",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                      }}>
                        <span className="chat-dot" />
                        <span className="chat-dot" />
                        <span className="chat-dot" />
                        <span style={{ fontFamily: F.mono, fontSize: 9, color: C.textDim, marginLeft: 6 }}>Fetching live ad data…</span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={chatBottomRef} />
              </div>

              {/* Input area */}
              <div style={{ borderTop: `1px solid ${C.borderDim}`, padding: "12px 16px", background: "#fafafa" }}>

                {/* Image preview */}
                {pendingImage && (
                  <div style={{ marginBottom: 10, position: "relative", display: "inline-block" }}>
                    <img
                      src={pendingImage.previewUrl}
                      alt="attachment preview"
                      style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.borderMed}`, display: "block" }}
                    />
                    <button
                      onClick={() => setPendingImage(null)}
                      style={{
                        position: "absolute", top: -6, right: -6,
                        width: 18, height: 18, borderRadius: "50%",
                        background: "#374151", border: "none", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#ffffff", fontSize: 10, fontWeight: 700, lineHeight: 1,
                      }}
                    >×</button>
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    style={{ display: "none" }}
                    onChange={handleImageSelect}
                  />

                  {/* Paperclip button */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={chatLoading || chatFetching}
                    style={{
                      width: 36, height: 36, border: "none", background: "none",
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      color: pendingImage ? C.sapphire : C.textMuted,
                      borderRadius: 8, flexShrink: 0, alignSelf: "flex-end",
                      transition: "color 0.14s ease",
                    }}
                    onMouseEnter={e => { if (!pendingImage) e.currentTarget.style.color = "#2b3a6b"; }}
                    onMouseLeave={e => { if (!pendingImage) e.currentTarget.style.color = C.textMuted; }}
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                    </svg>
                  </button>

                  <textarea
                    className="chat-input"
                    placeholder={pendingImage ? "Add a note or send as-is…" : "Ask about campaigns, strategy, or request changes…"}
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    rows={1}
                    disabled={chatLoading || chatFetching}
                  />
                  <button
                    className="chat-send-btn"
                    onClick={() => sendMessage()}
                    disabled={(!chatInput.trim() && !pendingImage) || chatLoading || chatFetching}
                  >
                    <Icons.Send />
                  </button>
                </div>
                <div style={{ marginTop: 6, fontFamily: F.mono, fontSize: 9, color: C.textDim, textAlign: "center" }}>
                  Enter to send · Shift+Enter for newline
                </div>
              </div>
            </div>
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
                      <span style={{ fontFamily: F.mono, fontSize: 10, color: C.textSecondary }}>CPL: <strong style={{ color: C.gold }}>{facebookData.summary.cpl != null ? `$${facebookData.summary.cpl}` : "—"}</strong></span>
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
