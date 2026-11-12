import { useEffect, useMemo, useState } from "react";
import { useWorkspaceInbox } from "./useWorkspaceInbox";
import WebhookPanel from "./WebhookPanel";
import TenantUsersPanel from "./TenantUsersPanel";
import { Bot, BrainCircuit, ContactRound, Users, Gauge, MessageCircle, Pause, Play, Search, Send, Settings2, ShieldCheck, Sparkles, Zap } from "lucide-react";

async function readJson(response: Response): Promise<Record<string, any>> {
  const raw = await response.text();
  if (!raw.trim()) {
    if (!response.ok) throw new Error(`API request failed (${response.status} ${response.statusText}). The server returned an empty response.`);
    throw new Error("The server returned an empty response instead of JSON. Check the API deployment and Vercel function logs.");
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, any>;
    throw new Error("The server returned an unexpected JSON format.");
  } catch (error) {
    if (error instanceof Error && (error.message.includes("empty response") || error.message.includes("unexpected JSON format"))) throw error;
    throw new Error(`API returned invalid JSON (HTTP ${response.status}). Check the Vercel function logs.`);
  }
}

type Status = { ok: boolean; automationEnabled: boolean; telegramConfigured: boolean; aiConfigured: boolean; aiProvider?: string | null; storageConfigured?: boolean; mode: string; lastWebhookAt?: string | null; lastActivityAt?: string | null; appBaseUrl?: string | null; ownerIdsConfigured?: boolean; features?: { replyDelayMs?: { min: number; max: number }; quietHours?: { enabled: boolean; startHour?: number; endHour?: number; timezone?: string }; dailyReplyLimit?: number | null } };
const nav = [{ label: "Overview", icon: Gauge }, { label: "Inbox", icon: MessageCircle }, { label: "Users", icon: Users }, { label: "AI personality", icon: Sparkles }, { label: "Contacts", icon: ContactRound }, { label: "Memory", icon: BrainCircuit }, { label: "Automation", icon: Zap }, { label: "Settings", icon: Settings2 }];

function MemoryPanel({ apiRequest, readJson, flash }: { apiRequest: (path: string, init?: RequestInit) => Promise<Response>; readJson: (r: Response) => Promise<Record<string, any>>; flash: (m: string) => void }) {
  const [items, setItems] = useState<Array<{ id: number; memory: string; category: string; createdAt?: string }>>([]);
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState("preference");
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    return apiRequest("/api/agent/memories").then(async r => {
      const d = await readJson(r);
      if (!r.ok) throw new Error(d.error || "Failed");
      setItems(d.memories || []);
    }).catch(e => flash(e instanceof Error ? e.message : "Could not load memories")).finally(() => setLoading(false));
  };
  useEffect(() => { void load(); }, []);
  const add = () => {
    if (draft.trim().length < 2) return;
    apiRequest("/api/agent/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memory: draft.trim(), category }) })
      .then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Failed"); setDraft(""); flash("Memory saved."); return load(); })
      .catch(e => flash(e instanceof Error ? e.message : "Save failed"));
  };
  return (
    <div>
      <div className="notice-card"><BrainCircuit size={18} /><div><b>Private memory for replies as you</b><p>Only facts you approve are used.</p></div></div>
      <div className="panel settings-panel" style={{ maxWidth: "100%" }}>
        <label className="field-label">Category</label>
        <div className="choice-grid">{["preference", "fact", "style", "boundary"].map(c => (<button key={c} type="button" className={"choice " + (category === c ? "choice-selected" : "")} onClick={() => setCategory(c)}>{c}</button>))}</div>
        <label className="field-label">Memory</label>
        <textarea className="form-control" style={{ maxWidth: "100%", minHeight: 72 }} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Short fact the agent should remember" />
        <button className="primary-button" style={{ marginTop: 16 }} onClick={add} disabled={draft.trim().length < 2}>Save memory</button>
      </div>
      <div className="panel" style={{ marginTop: 16, padding: "18px 22px" }}>
        <div className="section-head"><h3 style={{ margin: 0, fontSize: 14 }}>Saved memories</h3><button className="text-link" onClick={() => void load()}>Refresh</button></div>
        {loading && <p className="helper-text">Loading…</p>}
        {!loading && items.length === 0 && <p className="helper-text">No memories yet.</p>}
        {items.map(m => (
          <div className="memory-card" key={m.id}>
            <div><b>{m.category || "preference"}</b><p>{m.memory}</p></div>
            <button className="text-link" onClick={() => apiRequest("/api/agent/memories/" + m.id, { method: "DELETE" }).then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Failed"); flash("Deleted."); return load(); }).catch(e => flash(e instanceof Error ? e.message : "Delete failed"))}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PersonalityPanel({ apiRequest, readJson, flash }: { apiRequest: (path: string, init?: RequestInit) => Promise<Response>; readJson: (r: Response) => Promise<Record<string, any>>; flash: (m: string) => void }) {
  const tones = [
    { id: "warm, friendly, natural", label: "Warm & natural" },
    { id: "concise, calm, professional", label: "Calm professional" },
    { id: "playful, casual, light", label: "Playful" },
    { id: "direct, clear, brief", label: "Direct" }
  ];
  const languages = [
    { id: "match the sender; English message → English reply; Amharic → Amharic", label: "Match sender" },
    { id: "Amharic preferred when possible; still match if they write pure English", label: "Amharic preferred" },
    { id: "English preferred; still match if they write pure Amharic", label: "English preferred" },
    { id: "Always reply in the same language as the last message", label: "Mirror last message" }
  ];
  const lengths = [
    { id: "concise", label: "Concise" },
    { id: "medium", label: "Medium" },
    { id: "detailed when needed", label: "Detailed" }
  ];
  const [tone, setTone] = useState(tones[0].id);
  const [language, setLanguage] = useState(languages[0].id);
  const [replyLength, setReplyLength] = useState(lengths[1].id);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [simIn, setSimIn] = useState("");
  const [simOut, setSimOut] = useState("");
  const [simBusy, setSimBusy] = useState(false);
  const selectedToneId = tones.some(t => t.id === tone) ? tone : "";
  const selectedLanguageId = (() => {
    const lower = language.toLowerCase();
    if (lower.includes("mirror") || lower.includes("same language as the last")) return languages[3].id;
    if (lower.includes("amharic preferred")) return languages[1].id;
    if (lower.includes("english preferred")) return languages[2].id;
    if (lower.includes("match")) return languages[0].id;
    return languages.find(l => l.id === language)?.id || languages[0].id;
  })();
  const selectedLengthId = (() => {
    const lower = replyLength.toLowerCase();
    if (lower.includes("detail") || lower.includes("long")) return lengths[2].id;
    if (lower.includes("medium")) return lengths[1].id;
    return lengths[0].id;
  })();
  const load = () => {
    setLoading(true);
    return apiRequest("/api/agent/preferences").then(async r => {
      const d = await readJson(r);
      if (!r.ok) throw new Error(d.error || "Failed");
      const p = d.preferences || {};
      if (typeof p.tone === "string" && p.tone.trim()) setTone(p.tone.trim());
      if (typeof p.language === "string" && p.language.trim()) setLanguage(p.language.trim());
      if (typeof p.replyLength === "string" && p.replyLength.trim()) setReplyLength(p.replyLength.trim());
      if (typeof p.memoryEnabled === "boolean") setMemoryEnabled(p.memoryEnabled);
    }).catch(e => flash(e instanceof Error ? e.message : "Could not load preferences")).finally(() => setLoading(false));
  };
  useEffect(() => { void load(); }, []);
  const save = () => {
    setSaving(true);
    apiRequest("/api/agent/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tone: tone.slice(0, 100), language: language.slice(0, 100), replyLength: replyLength.slice(0, 40), memoryEnabled }) })
      .then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Failed"); flash("Personality saved."); return load(); })
      .catch(e => flash(e instanceof Error ? e.message : "Save failed")).finally(() => setSaving(false));
  };
  return (
    <div>
      <div className="notice-card"><Sparkles size={18} /><div><b>Replies should sound like you</b><p>Never mention being an AI or bot.</p></div></div>
      <div className="panel settings-panel" style={{ maxWidth: "100%" }}>
        <div className="panel-heading"><div><h3><Sparkles size={17} /> Voice & style</h3><p>These preferences guide every automatic reply.{loading ? " Loading…" : ""}</p></div></div>
        <label className="field-label">Tone</label>
        <div className="choice-grid">{tones.map(t => (<button key={t.id} type="button" className={"choice " + (selectedToneId === t.id ? "choice-selected" : "")} onClick={() => setTone(t.id)}>{t.label}</button>))}</div>
        <label className="field-label">Custom tone</label>
        <input className="form-control" value={tone} onChange={e => setTone(e.target.value)} />
        <label className="field-label">Language</label>
        <div className="choice-grid">{languages.map(t => (<button key={t.id} type="button" className={"choice " + (selectedLanguageId === t.id ? "choice-selected" : "")} onClick={() => setLanguage(t.id)}>{t.label}</button>))}</div>
        <label className="field-label">Reply length</label>
        <div className="choice-grid">{lengths.map(t => (<button key={t.id} type="button" className={"choice " + (selectedLengthId === t.id ? "choice-selected" : "")} onClick={() => setReplyLength(t.id)}>{t.label}</button>))}</div>
        <div className="toggle-row"><div><b>Use saved memories</b></div><button type="button" className={"secondary-button compact " + (memoryEnabled ? "running" : "")} onClick={() => setMemoryEnabled(v => !v)}>{memoryEnabled ? "On" : "Off"}</button></div>
        <button className="primary-button" onClick={save} disabled={saving || loading}>{saving ? "Saving…" : "Save personality"}</button>
      </div>
      <div className="panel settings-panel" style={{ maxWidth: "100%", marginTop: 16 }}>
        <div className="panel-heading"><div><h3>Test a reply</h3><p>Simulate without sending to Telegram.</p></div></div>
        <textarea className="form-control" style={{ minHeight: 64 }} value={simIn} onChange={e => setSimIn(e.target.value)} placeholder="Sample message from a contact" />
        <button className="secondary-button" style={{ marginTop: 12 }} disabled={simBusy || !simIn.trim()} onClick={() => {
          setSimBusy(true); setSimOut("");
          apiRequest("/api/agent/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: simIn.trim(), tone, language, replyLength }) })
            .then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Failed"); setSimOut(d.escalated ? "(Needs owner review) " + (d.reason || "") : (d.reply || "")); })
            .catch(e => flash(e instanceof Error ? e.message : "Simulate failed")).finally(() => setSimBusy(false));
        }}>{simBusy ? "Thinking…" : "Generate test reply"}</button>
        {simOut ? <div className="notice-card" style={{ marginTop: 14 }}><Sparkles size={16} /><div><b>Sample reply</b><p style={{ whiteSpace: "pre-wrap" }}>{simOut}</p></div></div> : null}
      </div>
    </div>
  );
}

function ContactsPanel({ apiRequest, readJson, flash }: { apiRequest: (path: string, init?: RequestInit) => Promise<Response>; readJson: (r: Response) => Promise<Record<string, any>>; flash: (m: string) => void }) {
  const [items, setItems] = useState<Array<{ senderId: string; enabled: boolean; note?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    return apiRequest("/api/agent/contacts").then(async r => {
      const d = await readJson(r);
      if (!r.ok) throw new Error(d.error || "Failed");
      setItems(d.contacts || []);
    }).catch(e => flash(e instanceof Error ? e.message : "Could not load contacts")).finally(() => setLoading(false));
  };
  useEffect(() => { void load(); }, []);
  return (
    <div>
      <div className="notice-card"><ContactRound size={18} /><div><b>Explicit allowlist only</b><p>Automatic replies only for contacts you allow.</p></div></div>
      <div className="panel" style={{ padding: "18px 22px" }}>
        <div className="section-head"><h3 style={{ margin: 0, fontSize: 14 }}>Allowed contacts</h3><button className="secondary-button compact" onClick={() => void load()}>Refresh</button></div>
        {loading && <p className="helper-text">Loading…</p>}
        {!loading && items.length === 0 && <p className="helper-text">No contacts yet. Allow them from Inbox.</p>}
        {items.map(c => (
          <div className="permission-row" key={c.senderId}>
            <div className="permission-copy"><b>Telegram ID {c.senderId}</b><span>{c.enabled ? "Auto-reply on" : "Manual only"}</span></div>
            <button className="secondary-button compact" onClick={() => apiRequest("/api/agent/contacts/" + encodeURIComponent(c.senderId), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !c.enabled }) }).then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Failed"); return load(); }).catch(e => flash(e instanceof Error ? e.message : "Update failed"))}>{c.enabled ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Allow</>}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState("Overview");
  const [query, setQuery] = useState("");
  const [automation, setAutomation] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [dashboardToken, setDashboardToken] = useState(() => window.sessionStorage.getItem("dashboardApiToken") || "");
  const [toast, setToast] = useState("");
  const [aiModel, setAiModel] = useState("gemini-3.5-flash-lite");
  const [aiSettingsLoading, setAiSettingsLoading] = useState(false);
  const [ownerIdsText, setOwnerIdsText] = useState("");
  const [ownerIdsLoading, setOwnerIdsLoading] = useState(false);
  const [ownerIdsSaving, setOwnerIdsSaving] = useState(false);
  const [ownerIdsError, setOwnerIdsError] = useState("");
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(""), 3200); };
  const apiBase = import.meta.env.VITE_API_BASE_URL || "";
  const apiRequest = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers || {});
    if (dashboardToken) headers.set("x-dashboard-token", dashboardToken);
    return fetch(`${apiBase}${path}`, { ...init, headers });
  };
  const inbox = useWorkspaceInbox(dashboardToken, apiBase, page === "Inbox" || page === "Overview", flash);
  const loadStatus = () => apiRequest("/api/status").then(async r => {
    const d = await readJson(r);
    if (!r.ok) throw new Error(d.error || "Status failed");
    setStatus(d as Status);
    setAutomation(Boolean(d.automationEnabled));
  }).catch(e => flash(e instanceof Error ? e.message : "Status failed"));
  useEffect(() => {
    if (dashboardToken) window.sessionStorage.setItem("dashboardApiToken", dashboardToken);
    else window.sessionStorage.removeItem("dashboardApiToken");
  }, [dashboardToken]);
  useEffect(() => { void loadStatus(); const t = window.setInterval(() => void loadStatus(), 30000); return () => window.clearInterval(t); }, [dashboardToken]);
  useEffect(() => {
    if (!dashboardToken) return;
    setAiSettingsLoading(true);
    apiRequest("/api/agent/ai-settings").then(async r => {
      const d = await readJson(r);
      if (r.ok && d.settings?.model) setAiModel(String(d.settings.model));
    }).catch(() => {}).finally(() => setAiSettingsLoading(false));
  }, [dashboardToken]);
  useEffect(() => {
    if (!dashboardToken) { setOwnerIdsText(""); return; }
    setOwnerIdsLoading(true);
    apiRequest("/api/agent/owner-ids").then(async r => {
      const d = await readJson(r);
      if (r.ok) setOwnerIdsText((d.ownerIds || []).join("\n"));
    }).catch(() => {}).finally(() => setOwnerIdsLoading(false));
  }, [dashboardToken]);
  const toggleAutomation = () => {
    if (!dashboardToken) { flash("Enter token in Settings."); return; }
    const path = automation ? "/api/agent/pause" : "/api/agent/resume";
    apiRequest(path, { method: "POST" }).then(async r => {
      const d = await readJson(r);
      if (!r.ok) throw new Error(d.error || "Request failed");
      setAutomation(Boolean(d.automationEnabled));
      flash(d.automationEnabled ? "Automation enabled." : "Automation paused.");
      void loadStatus();
    }).catch(e => flash(e instanceof Error ? e.message : "Failed"));
  };
  const emergencyStop = () => {
    if (!dashboardToken) return;
    apiRequest("/api/agent/emergency-stop", { method: "POST" }).then(async r => {
      const d = await readJson(r);
      if (!r.ok) throw new Error(d.error || "Failed");
      setAutomation(false);
      flash("Emergency stop applied.");
      void loadStatus();
    }).catch(e => flash(e instanceof Error ? e.message : "Failed"));
  };
  const saveOwnerIds = () => {
    const ids = [...new Set(ownerIdsText.split(/[\s,;]+/).map(v => v.trim()).filter(Boolean))];
    if (!ids.length || ids.length > 100 || ids.some(id => !/^[1-9][0-9]{0,19}$/.test(id))) {
      setOwnerIdsError("Enter 1–100 valid numeric Telegram user IDs.");
      return;
    }
    setOwnerIdsSaving(true); setOwnerIdsError("");
    apiRequest("/api/agent/owner-ids", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerIds: ids }) })
      .then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Save failed"); setOwnerIdsText((d.ownerIds || ids).join("\n")); flash("Owner IDs saved."); })
      .catch(e => setOwnerIdsError(e instanceof Error ? e.message : "Save failed"))
      .finally(() => setOwnerIdsSaving(false));
  };
  const contacts = inbox.state.contacts || [];
  const filtered = useMemo(() => {
    let list = contacts;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.handle.toLowerCase().includes(q) || (c.senderId || "").includes(q));
    }
    return list;
  }, [contacts, query]);
  return (
  <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Bot size={20} /></div><div><strong>telegram<span>agent</span></strong><small>PERSONAL AI</small></div></div>
      <div className="nav-label">Workspace</div>
      <nav>{nav.map(item => (
        <button key={item.label} type="button" className={"nav-item " + (page === item.label ? "active" : "")} onClick={() => setPage(item.label)} aria-current={page === item.label ? "page" : undefined}><item.icon size={16} aria-hidden /><span>{item.label}</span></button>
      ))}</nav>
      <div className="sidebar-bottom">
        <div className="token-box">
          <label className="field-label" htmlFor="sidebar-token">Dashboard token</label>
          <input id="sidebar-token" className="form-control" type="password" autoComplete="off" value={dashboardToken} onChange={e => setDashboardToken(e.target.value)} placeholder="Paste DASHBOARD_API_TOKEN" />
          <p className="helper-text">Required for Settings, Automation, Inbox.</p>
        </div>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="crumb">Workspace / <b>{page}</b></div><div className="connection-pill"><span className={"dot " + (status?.telegramConfigured ? "green" : "amber")}></span>{status?.telegramConfigured ? "Telegram connected" : "Telegram not connected"}</div></header>
      <div className="content">
        {page === "Overview" ? <div>
          <div className="page-heading"><div><div className="eyebrow">Control</div><h1>Overview</h1><p>Live agent health and automation.</p></div></div>
          {!dashboardToken ? <div className="notice-card"><ShieldCheck size={18} /><div><b>Dashboard token required</b><p>Paste DASHBOARD_API_TOKEN in the sidebar or Settings to load live data.</p></div></div> : null}
          <div className="stats-grid">
            <div className="stat-card"><div className="stat-label">Automation</div><div className="stat-value">{automation ? "On" : "Off"}</div></div>
            <div className="stat-card"><div className="stat-label">Telegram</div><div className="stat-value" style={{fontSize:18}}>{status?.telegramConfigured ? "OK" : "Missing"}</div></div>
            <div className="stat-card"><div className="stat-label">AI</div><div className="stat-value" style={{fontSize:16}}>{status?.aiConfigured ? (status.aiProvider || "Ready") : "Not set"}</div></div>
            <div className="stat-card"><div className="stat-label">Storage</div><div className="stat-value" style={{fontSize:16}}>{status?.storageConfigured ? "Persistent" : "Ephemeral"}</div></div>
          </div>
          <div className="panel" style={{ marginTop: 16 }}>
            <div className="toggle-row"><div><b>Automation</b><p>Pause or resume automatic replies.</p></div>
              <button type="button" className={"secondary-button compact " + (automation ? "running" : "")} onClick={toggleAutomation} disabled={!dashboardToken}>{automation ? "Pause" : "Start"}</button></div>
          </div>
        </div>
        : page === "Automation" ? <div>
          <div className="page-heading"><div><div className="eyebrow">Control</div><h1>Automation</h1><p>Start, pause, or emergency-stop automatic replies.</p></div></div>
          <div className="notice-card"><Zap size={18} /><div><b>Status: {automation ? "ON" : "OFF"}</b><p>{status?.aiProvider || "AI provider from server status"}</p></div></div>
          <div className="panel settings-panel">
            <button type="button" className={"primary-button " + (automation ? "running" : "")} onClick={toggleAutomation} disabled={!dashboardToken}>{automation ? "Pause automation" : "Start automation"}</button>
            <button type="button" className="danger-button" style={{ marginTop: 12 }} disabled={!dashboardToken} onClick={emergencyStop}>Emergency stop</button>
            <p className="helper-text">Resume requires Telegram + AI credentials and at least one allowed contact in Inbox.</p>
          </div>
          <div className="panel settings-panel" style={{ marginTop: 16 }}>
            <div className="panel-heading"><div><h3>Smart features</h3><p>Configured via Vercel environment variables.</p></div></div>
            <div className="permission-row"><div className="permission-copy"><b>Human reply delay</b><span>{status?.features?.replyDelayMs ? `${status.features.replyDelayMs.min}–${status.features.replyDelayMs.max} ms` : "~1.5–3s default"}</span></div></div>
            <div className="permission-row"><div className="permission-copy"><b>Quiet hours</b><span>{status?.features?.quietHours?.enabled ? `${status.features.quietHours.startHour}:00–${status.features.quietHours.endHour}:00` : "Off"}</span></div></div>
            <div className="permission-row"><div className="permission-copy"><b>Daily limit</b><span>{status?.features?.dailyReplyLimit ? `${status.features.dailyReplyLimit}/day` : "Unlimited"}</span></div></div>
          </div>
        </div>
        : page === "Settings" ? <div>
          <div className="page-heading"><div><div className="eyebrow">Configuration</div><h1>Settings</h1><p>Token, owners, AI model, and webhook tools.</p></div></div>
          <div className="panel settings-panel">
            <label className="field-label" htmlFor="settings-token">Dashboard API token</label>
            <input id="settings-token" className="form-control" type="password" autoComplete="off" value={dashboardToken} onChange={e => setDashboardToken(e.target.value)} placeholder="DASHBOARD_API_TOKEN" />
            <button type="button" className="secondary-button" style={{ marginTop: 12 }} onClick={() => void loadStatus()}>Verify & refresh status</button>
            <p className="helper-text">Must match DASHBOARD_API_TOKEN in Vercel. Sent as x-dashboard-token on every authenticated request.</p>
          </div>
          <div className="panel settings-panel" style={{ marginTop: 16 }}>
            <div className="panel-heading"><div><h3>Telegram Business owner IDs</h3><p>Authorized owner accounts that can connect the bot.</p></div></div>
            <label className="field-label" htmlFor="owner-ids">One ID per line or comma-separated</label>
            <textarea id="owner-ids" className="form-control" rows={5} style={{ maxWidth: "100%" }} value={ownerIdsText} onChange={e => setOwnerIdsText(e.target.value)} disabled={!dashboardToken || ownerIdsLoading || ownerIdsSaving} placeholder={"123456789\n987654321"} />
            {ownerIdsError ? <p className="helper-text" role="alert" style={{ color: "#ffb5c0" }}>{ownerIdsError}</p> : null}
            <button type="button" className="primary-button" style={{ marginTop: 12 }} disabled={!dashboardToken || ownerIdsSaving} onClick={saveOwnerIds}>{ownerIdsSaving ? "Saving…" : "Save owner IDs"}</button>
          </div>
          <div className="panel settings-panel" style={{ marginTop: 16 }}>
            <div className="panel-heading"><div><h3>AI model</h3><p>{aiSettingsLoading ? "Loading…" : "Gemini model used for replies."}</p></div></div>
            <input className="form-control" value={aiModel} onChange={e => setAiModel(e.target.value)} disabled={!dashboardToken} />
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" className="secondary-button compact" disabled={!dashboardToken || aiSettingsLoading} onClick={() => apiRequest("/api/agent/ai-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "gemini", model: aiModel, fallbackEnabled: false }) }).then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Save failed"); flash("AI model saved."); }).catch(e => flash(e instanceof Error ? e.message : "Save failed"))}>Save model</button>
              <button type="button" className="secondary-button compact" disabled={!dashboardToken} onClick={() => apiRequest("/api/agent/ai-settings/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "gemini", model: aiModel }) }).then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Test failed"); flash("Model test OK."); }).catch(e => flash(e instanceof Error ? e.message : "Test failed"))}>Test model</button>
            </div>
          </div>
          <div style={{ marginTop: 16 }}><WebhookPanel enabled={Boolean(dashboardToken)} apiRequest={apiRequest} readJson={readJson} /></div>
        </div>
        : page === "Users" ? <TenantUsersPanel apiRequest={apiRequest} />
        : page === "Contacts" ? <div><div className="page-heading"><h1>Contacts</h1></div>{!dashboardToken ? <p className="helper-text">Enter token in Settings.</p> : <ContactsPanel apiRequest={apiRequest} readJson={readJson} flash={flash} />}</div>
        : page === "Memory" ? <div><div className="page-heading"><h1>Memory</h1></div>{!dashboardToken ? <p className="helper-text">Enter token in Settings.</p> : <MemoryPanel apiRequest={apiRequest} readJson={readJson} flash={flash} />}</div>
        : page === "AI personality" ? <div><div className="page-heading"><h1>AI personality</h1></div>{!dashboardToken ? <p className="helper-text">Enter token in Settings.</p> : <PersonalityPanel apiRequest={apiRequest} readJson={readJson} flash={flash} />}</div>
        : page === "Inbox" ? <div>
          <div className="page-heading"><div><div className="eyebrow">Conversations</div><h1>Inbox</h1></div>
            <button type="button" className="secondary-button" onClick={() => void inbox.refresh()} disabled={!dashboardToken || inbox.state.loading}>{inbox.state.loading ? "Loading…" : "Refresh"}</button></div>
          {!dashboardToken ? <div className="notice-card"><ShieldCheck size={18} /><div><b>Token required</b><p>Enter the dashboard token to load conversations.</p></div></div> : null}
          {inbox.state.error ? <div className="notice-card" role="alert"><ShieldCheck size={18} /><div><b>Inbox error</b><p>{inbox.state.error}</p></div></div> : null}
          <div className="inbox-toolbar"><div className="inbox-count"><b>{filtered.length}</b> <span>conversations</span></div>
            <div className="searchbox"><Search size={16} /><input aria-label="Search" placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)} /></div></div>
          <div className="inbox-layout">
            <section className="inbox-list">
              {filtered.map(c => (
                <button key={c.id} type="button" className={"conversation " + (inbox.state.selectedId === c.id ? "selected" : "")} onClick={() => inbox.select(c.id)}>
                  <div className="contact-avatar">{c.initials}</div>
                  <div className="conversation-copy"><div className="conversation-name"><b>{c.name}</b><time>{c.time}</time></div><p>{c.last}</p>
                    <div className="conversation-tags"><span className={c.allowed ? "tag enabled" : "tag paused"}>{c.allowed ? "Auto-reply" : "Manual"}</span></div></div>
                </button>
              ))}
              {!filtered.length && dashboardToken && !inbox.state.loading ? <div className="empty-state"><b>No conversations</b><p>Messages appear here when Telegram delivers them.</p></div> : null}
            </section>
            <section className="chat-panel">
              {inbox.selected ? <>
                <div className="chat-header"><div className="chat-contact"><b>{inbox.selected.name}</b><span>{inbox.selected.handle}</span></div>
                  <button type="button" className="secondary-button compact" onClick={() => void inbox.toggle(inbox.selected!.id)}>{inbox.selected.allowed ? <><Pause size={14} /> Pause AI</> : <><Play size={14} /> Allow AI</>}</button></div>
                <div className="message-stream">{inbox.selected.messages.map(m => (
                  <div key={m.id} className={"message-row " + (m.from === "ai" ? "outgoing" : "")}><div className={"bubble " + (m.from === "ai" ? "bubble-ai" : "bubble-them")}>{m.text}<time>{m.time}</time></div></div>
                ))}</div>
                <div className="reply-box">
                  <textarea value={inbox.draft} onChange={e => inbox.setDraft(e.target.value)} rows={2} placeholder="Manual reply…" disabled={inbox.state.sending} />
                  <div className="reply-tools"><span className="helper-text" style={{ margin: 0 }}>Sends as you via Telegram</span>
                    <button type="button" className="send-button" onClick={() => void inbox.send()} disabled={!inbox.draft.trim() || inbox.state.sending}><Send size={16} /> {inbox.state.sending ? "Sending…" : "Send"}</button></div>
                </div>
              </> : <div className="empty-state"><b>Select a conversation</b><p>Choose a chat from the list to read and reply.</p></div>}
            </section>
          </div>
        </div>
        : <div className="page-heading"><h1>{page}</h1></div>}
      </div>
    </main>
    {toast ? <div className="toast">{toast}</div> : null}
  </div>
  );
}
