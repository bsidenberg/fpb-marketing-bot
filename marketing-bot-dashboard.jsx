import { useState, useEffect, useReducer } from "react";

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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
function Sparkline({ data, color = "#10b981", width = 80, height = 24 }) {
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
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Mini bar chart ──
function MiniBar({ values, labels, color = "#6366f1", height = 120 }) {
  const max = Math.max(...values);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height, padding: "0 4px" }}>
      {values.map((v, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, gap: 4 }}>
          <div style={{
            width: "100%",
            height: `${(v / max) * 100}%`,
            background: `linear-gradient(to top, ${color}, ${color}aa)`,
            borderRadius: 4,
            minHeight: 4,
            transition: "height 0.5s ease",
          }} />
          <span style={{ fontSize: 9, color: "#94a3b8", whiteSpace: "nowrap" }}>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

// ── Status badge ──
function StatusBadge({ status }) {
  const styles = {
    pending: { bg: "#fef3c7", color: "#92400e", label: "Pending" },
    approved: { bg: "#d1fae5", color: "#065f46", label: "Approved" },
    rejected: { bg: "#fee2e2", color: "#991b1b", label: "Rejected" },
    complete: { bg: "#d1fae5", color: "#065f46", label: "Complete" },
    waiting: { bg: "#fef3c7", color: "#92400e", label: "Waiting" },
    draft: { bg: "#e0e7ff", color: "#3730a3", label: "Draft" },
    review: { bg: "#fef3c7", color: "#92400e", label: "Review" },
    scheduled: { bg: "#d1fae5", color: "#065f46", label: "Scheduled" },
  };
  const s = styles[status] || styles.pending;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 10px", borderRadius: 99, fontSize: 11, fontWeight: 600,
      background: s.bg, color: s.color,
    }}>
      {status === "approved" && <Icons.Check />}
      {status === "waiting" && <Icons.Clock />}
      {s.label}
    </span>
  );
}

// ── Priority indicator ──
function PriorityDot({ priority }) {
  const colors = { high: "#ef4444", medium: "#f59e0b", low: "#6b7280" };
  return (
    <span style={{
      width: 8, height: 8, borderRadius: "50%",
      background: colors[priority] || colors.low,
      display: "inline-block", flexShrink: 0,
    }} />
  );
}

// ── Main component ──
export default function MarketingBotDashboard() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [now, setNow] = useState(new Date());
  const [botPulse, setBotPulse] = useState(true);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    const p = setInterval(() => setBotPulse(v => !v), 2000);
    return () => { clearInterval(t); clearInterval(p); };
  }, []);

  const pendingCount = state.actionQueue.filter(a => a.status === "pending").length;

  const tabs = [
    { id: "overview", label: "Overview", icon: <Icons.BarChart /> },
    { id: "actions", label: `Actions (${pendingCount})`, icon: <Icons.Zap /> },
    { id: "channels", label: "Channels", icon: <Icons.Globe /> },
    { id: "content", label: "Content", icon: <Icons.Edit /> },
    { id: "intel", label: "Intel", icon: <Icons.Eye /> },
    { id: "setup", label: "Setup Guide", icon: <Icons.Settings /> },
  ];

  const font = "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace";

  return (
    <div style={{
      fontFamily: font,
      background: "#0a0e1a",
      color: "#e2e8f0",
      minHeight: "100vh",
      padding: 0,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      {/* ── HEADER ── */}
      <div style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)",
        borderBottom: "1px solid #1e293b",
        padding: "16px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #6366f1, #a855f7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: botPulse ? "0 0 20px #6366f166" : "0 0 8px #6366f133",
            transition: "box-shadow 1.5s ease",
          }}>
            <Icons.Bot />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>MARKETING AI</div>
            <div style={{ fontSize: 10, color: "#6366f1", fontWeight: 500 }}>POWERED BY CLAUDE COWORK</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 12px", borderRadius: 99,
            background: "#065f4622", border: "1px solid #065f4644",
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%", background: "#10b981",
              boxShadow: botPulse ? "0 0 8px #10b981" : "0 0 3px #10b981",
              transition: "box-shadow 1.5s ease",
            }} />
            <span style={{ fontSize: 11, color: "#10b981", fontWeight: 600 }}>LIVE</span>
          </div>
          <span style={{ fontSize: 11, color: "#64748b" }}>
            {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </div>

      {/* ── TABS ── */}
      <div style={{
        display: "flex", gap: 2, padding: "0 24px",
        background: "#0f1629", borderBottom: "1px solid #1e293b",
        overflowX: "auto",
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => dispatch({ type: "SET_TAB", payload: tab.id })}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "12px 16px", border: "none", cursor: "pointer",
              background: state.activeTab === tab.id ? "#1e293b" : "transparent",
              color: state.activeTab === tab.id ? "#e2e8f0" : "#64748b",
              borderBottom: state.activeTab === tab.id ? "2px solid #6366f1" : "2px solid transparent",
              fontSize: 12, fontWeight: 500, fontFamily: font,
              transition: "all 0.2s ease",
              whiteSpace: "nowrap",
            }}
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
          <div>
            {/* KPI Row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 24 }}>
              {[
                { label: "TOTAL SPEND", value: `$${state.metrics.totalSpend.toLocaleString()}`, sub: "This month", color: "#f59e0b", spark: [1200, 1800, 2100, 2400, 3100, 3800, 4280] },
                { label: "REVENUE", value: `$${state.metrics.totalRevenue.toLocaleString()}`, sub: "Attributed", color: "#10b981", spark: [4200, 6800, 9400, 11200, 14500, 16800, 18940] },
                { label: "ROAS", value: `${state.metrics.overallROAS}x`, sub: "Overall", color: "#6366f1", spark: [3.1, 3.4, 3.8, 4.0, 4.1, 4.3, 4.42] },
                { label: "LEADS", value: state.metrics.leadsThisWeek, sub: "This week", color: "#ec4899", spark: [42, 58, 71, 89, 95, 112, 127] },
                { label: "CVR", value: `${state.metrics.conversionRate}%`, sub: "Avg conversion", color: "#14b8a6", spark: [2.8, 3.0, 3.2, 3.1, 3.5, 3.6, 3.8] },
                { label: "ORGANIC", value: state.metrics.organicTraffic.toLocaleString(), sub: "Monthly visits", color: "#8b5cf6", spark: [7200, 8100, 9200, 10100, 10800, 11600, 12400] },
              ].map((kpi, i) => (
                <div key={i} style={{
                  background: "#111827", border: "1px solid #1e293b", borderRadius: 10,
                  padding: 16, position: "relative", overflow: "hidden",
                }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: "#64748b", letterSpacing: "0.1em", marginBottom: 8 }}>{kpi.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: kpi.color, marginBottom: 2 }}>{kpi.value}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 10, color: "#475569" }}>{kpi.sub}</span>
                    <Sparkline data={kpi.spark} color={kpi.color} />
                  </div>
                </div>
              ))}
            </div>

            {/* Action queue preview + Automation log */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#f59e0b" }}>
                    {pendingCount} ACTIONS PENDING APPROVAL
                  </span>
                  <button onClick={() => dispatch({ type: "SET_TAB", payload: "actions" })} style={{
                    background: "none", border: "none", color: "#6366f1", fontSize: 11, cursor: "pointer",
                    fontFamily: font, display: "flex", alignItems: "center", gap: 4,
                  }}>
                    View all <Icons.ChevRight />
                  </button>
                </div>
                {state.actionQueue.filter(a => a.status === "pending").slice(0, 3).map(a => (
                  <div key={a.id} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 0", borderBottom: "1px solid #1e293b",
                    fontSize: 11,
                  }}>
                    <PriorityDot priority={a.priority} />
                    <span style={{ color: "#94a3b8", flex: 1 }}>{a.action}</span>
                    <span style={{ color: "#475569", fontSize: 10 }}>{a.channel}</span>
                  </div>
                ))}
              </div>

              <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 12 }}>AUTOMATION LOG — TODAY</div>
                <div style={{ maxHeight: 180, overflow: "auto" }}>
                  {state.automationLog.map((log, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "6px 0", borderBottom: "1px solid #1e293b11",
                      fontSize: 11,
                    }}>
                      <span style={{ color: "#475569", width: 60, flexShrink: 0 }}>{log.time}</span>
                      <StatusBadge status={log.status} />
                      <span style={{ color: "#94a3b8" }}>{log.action}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Channel performance bars */}
            <div style={{ marginTop: 16, background: "#111827", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 12 }}>CHANNEL SPEND VS REVENUE</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                <MiniBar
                  values={[2100, 1680, 0, 0, 500]}
                  labels={["Google", "Meta", "SEO", "Blog", "Local"]}
                  color="#ef4444"
                  height={100}
                />
                <MiniBar
                  values={[7980, 7056, 2200, 890, 814]}
                  labels={["Google", "Meta", "SEO", "Blog", "Local"]}
                  color="#10b981"
                  height={100}
                />
              </div>
              <div style={{ display: "flex", gap: 24, marginTop: 8, justifyContent: "center" }}>
                <span style={{ fontSize: 10, color: "#ef4444", display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: "#ef4444", display: "inline-block" }} /> Spend
                </span>
                <span style={{ fontSize: 10, color: "#10b981", display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: "#10b981", display: "inline-block" }} /> Revenue
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ACTIONS TAB */}
        {state.activeTab === "actions" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Action Queue</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>Claude analyzed your campaigns and recommends these actions</div>
              </div>
              {pendingCount > 0 && (
                <button onClick={() => dispatch({ type: "APPROVE_ALL" })} style={{
                  background: "linear-gradient(135deg, #6366f1, #a855f7)",
                  border: "none", color: "#fff", padding: "8px 20px", borderRadius: 8,
                  fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font,
                }}>
                  Approve All ({pendingCount})
                </button>
              )}
            </div>

            {state.actionQueue.map(a => (
              <div key={a.id} style={{
                background: "#111827", border: "1px solid #1e293b", borderRadius: 10,
                padding: 16, marginBottom: 8,
                display: "flex", alignItems: "center", gap: 12,
                opacity: a.status === "rejected" ? 0.4 : 1,
                transition: "opacity 0.3s",
              }}>
                <PriorityDot priority={a.priority} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{a.action}</div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>{a.channel}</div>
                </div>
                <StatusBadge status={a.status} />
                {a.status === "pending" && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => dispatch({ type: "APPROVE_ACTION", payload: a.id })} style={{
                      background: "#065f46", border: "1px solid #10b981", color: "#10b981",
                      padding: "4px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: font,
                    }}>Approve</button>
                    <button onClick={() => dispatch({ type: "REJECT_ACTION", payload: a.id })} style={{
                      background: "#1e293b", border: "1px solid #334155", color: "#94a3b8",
                      padding: "4px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: font,
                    }}>Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* CHANNELS TAB */}
        {state.activeTab === "channels" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              {
                name: "Google Ads", icon: <Icons.Google />, color: "#f59e0b",
                stats: [
                  { l: "Spend", v: `$${state.channels.googleAds.spend}` },
                  { l: "Clicks", v: state.channels.googleAds.clicks.toLocaleString() },
                  { l: "Conversions", v: state.channels.googleAds.conversions },
                  { l: "CPA", v: `$${state.channels.googleAds.cpa}` },
                  { l: "ROAS", v: `${state.channels.googleAds.roas}x` },
                ],
                spark: [1200, 1400, 1650, 1800, 1950, 2000, 2100],
              },
              {
                name: "Facebook Ads", icon: <Icons.Facebook />, color: "#3b82f6",
                stats: [
                  { l: "Spend", v: `$${state.channels.facebookAds.spend}` },
                  { l: "Reach", v: state.channels.facebookAds.reach.toLocaleString() },
                  { l: "Conversions", v: state.channels.facebookAds.conversions },
                  { l: "CPA", v: `$${state.channels.facebookAds.cpa}` },
                  { l: "ROAS", v: `${state.channels.facebookAds.roas}x` },
                ],
                spark: [900, 1100, 1250, 1400, 1500, 1600, 1680],
              },
              {
                name: "SEO", icon: <Icons.Search />, color: "#10b981",
                stats: [
                  { l: "Organic Visits", v: state.channels.seo.organicVisits.toLocaleString() },
                  { l: "Keywords Tracked", v: state.channels.seo.keywords },
                  { l: "Top 10 Rankings", v: state.channels.seo.top10 },
                  { l: "Avg Position", v: state.channels.seo.avgPosition },
                ],
                spark: [7200, 8100, 9200, 10100, 10800, 11600, 12400],
              },
              {
                name: "Blog / Content", icon: <Icons.Edit />, color: "#8b5cf6",
                stats: [
                  { l: "Posts This Month", v: state.channels.blog.posts },
                  { l: "Total Views", v: state.channels.blog.views.toLocaleString() },
                  { l: "Avg Time on Page", v: state.channels.blog.avgTimeOnPage },
                  { l: "Top Post", v: state.channels.blog.topPost },
                ],
                spark: [4200, 5100, 5800, 6400, 7200, 8000, 8900],
              },
              {
                name: "GEO / Local SEO", icon: <Icons.Globe />, color: "#ec4899",
                stats: [
                  { l: "Map Impressions", v: state.channels.geo.impressions.toLocaleString() },
                  { l: "Phone Calls", v: state.channels.geo.calls },
                  { l: "Directions", v: state.channels.geo.directions },
                  { l: "Review Score", v: `${state.channels.geo.reviews} ★` },
                ],
                spark: [3200, 3600, 4100, 4500, 4900, 5200, 5600],
              },
            ].map((ch, i) => (
              <div key={i} style={{
                background: "#111827", border: "1px solid #1e293b", borderRadius: 10, padding: 16,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{ color: ch.color }}>{ch.icon}</div>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{ch.name}</span>
                  <div style={{ marginLeft: "auto" }}>
                    <Sparkline data={ch.spark} color={ch.color} width={60} height={20} />
                  </div>
                </div>
                {ch.stats.map((s, j) => (
                  <div key={j} style={{
                    display: "flex", justifyContent: "space-between",
                    padding: "4px 0", borderBottom: j < ch.stats.length - 1 ? "1px solid #1e293b" : "none",
                    fontSize: 11,
                  }}>
                    <span style={{ color: "#64748b" }}>{s.l}</span>
                    <span style={{ fontWeight: 600 }}>{s.v}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* CONTENT TAB */}
        {state.activeTab === "content" && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Content Pipeline</div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 16 }}>Claude identifies keyword opportunities and drafts optimized content</div>
            {state.blogQueue.map((post, i) => (
              <div key={i} style={{
                background: "#111827", border: "1px solid #1e293b", borderRadius: 10,
                padding: 16, marginBottom: 8,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{post.title}</div>
                  <StatusBadge status={post.status} />
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  {post.keywords.map((kw, j) => (
                    <span key={j} style={{
                      padding: "2px 8px", borderRadius: 4, fontSize: 10,
                      background: "#1e293b", color: "#94a3b8",
                    }}>{kw}</span>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: "#64748b" }}>
                  Est. monthly traffic: <span style={{ color: "#10b981", fontWeight: 600 }}>{post.estTraffic.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* INTEL TAB */}
        {state.activeTab === "intel" && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Competitor Intelligence</div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 16 }}>Claude monitors competitor activity and surfaces actionable alerts</div>
            {state.competitorAlerts.map((alert, i) => (
              <div key={i} style={{
                background: "#111827", border: "1px solid #1e293b", borderRadius: 10,
                padding: 16, marginBottom: 8,
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: "#1e293b", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 700, color: "#f59e0b", flexShrink: 0,
                }}>
                  {alert.competitor[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{alert.competitor}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{alert.alert}</div>
                </div>
                <span style={{ fontSize: 10, color: "#475569", whiteSpace: "nowrap" }}>{alert.time}</span>
              </div>
            ))}
          </div>
        )}

        {/* SETUP GUIDE TAB */}
        {state.activeTab === "setup" && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Setup Guide</div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 20 }}>Follow these steps to connect all your marketing channels</div>

            {[
              {
                step: 1,
                title: "Get Claude Pro/Team Plan",
                status: "required",
                description: "You need Claude Pro ($20/mo) or Team plan to access Cowork. Go to claude.ai → Settings → Subscription.",
              },
              {
                step: 2,
                title: "Enable Cowork (Desktop)",
                status: "required",
                description: "Download Claude Desktop app → Settings → Enable Cowork. This lets Claude automate tasks on your computer.",
              },
              {
                step: 3,
                title: "Connect Google Ads API",
                status: "integration",
                description: "Create a Google Ads API developer token at ads.google.com/aw/apicenter. You'll need your Customer ID and a refresh token via OAuth2.",
              },
              {
                step: 4,
                title: "Connect Meta Marketing API",
                status: "integration",
                description: "Go to developers.facebook.com → Create App → Marketing API. Generate a long-lived access token. Note your Ad Account ID.",
              },
              {
                step: 5,
                title: "Connect Google Search Console",
                status: "integration",
                description: "Enable Search Console API in Google Cloud Console. Create service account credentials. Verify your site in Search Console.",
              },
              {
                step: 6,
                title: "Connect Your CMS",
                status: "integration",
                description: "For WordPress: install the REST API plugin and generate an application password. For Webflow: get your API token from Account Settings.",
              },
              {
                step: 7,
                title: "Set Up MCP Servers",
                status: "config",
                description: "Configure MCP servers in Claude Desktop's config file to give Claude access to all your marketing APIs.",
              },
              {
                step: 8,
                title: "Create Brand Voice Document",
                status: "config",
                description: "Write a document with your brand tone, key messaging, target audience, and competitors. Upload to Claude as context.",
              },
              {
                step: 9,
                title: "Configure Automation Schedule",
                status: "config",
                description: "Set up daily/weekly automation prompts in Cowork: morning performance pull, weekly competitor scan, monthly content calendar.",
              },
              {
                step: 10,
                title: "Test with Read-Only First",
                status: "important",
                description: "Start with read-only access. Let Claude analyze and recommend. Only enable write access (ad changes, publishing) after you trust the recommendations.",
              },
            ].map((item, i) => (
              <div key={i} style={{
                background: "#111827", border: "1px solid #1e293b", borderRadius: 10,
                padding: 16, marginBottom: 8,
                display: "flex", gap: 12,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: item.status === "required" ? "#6366f122" : item.status === "important" ? "#f59e0b22" : "#1e293b",
                  border: `1px solid ${item.status === "required" ? "#6366f144" : item.status === "important" ? "#f59e0b44" : "#334155"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 700,
                  color: item.status === "required" ? "#6366f1" : item.status === "important" ? "#f59e0b" : "#94a3b8",
                }}>{item.step}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{item.title}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>{item.description}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
