import { useEffect, useMemo, useState } from "react";
import { useWorkspaceInbox } from "./useWorkspaceInbox";
import WebhookPanel from "./WebhookPanel";
import TenantUsersPanel from "./TenantUsersPanel";
import { ArrowLeft, Bot, BrainCircuit, ContactRound, Users, Gauge, MessageCircle, Pause, Play, Search, Send, Settings2, ShieldCheck, Sparkles, Zap } from "lucide-react";

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
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [inboxFilter, setInboxFilter] = useState<"all" | "allowed" | "manual">("all");
  const [dashboardToken, setDashboardToken] = useState(() => window.sessionStorage.getItem("dashboardApiToken") || "");
  const [toast, setToast] = useState("");
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(""), 3200); };
  const apiRequest = (path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});
    if (dashboardToken) headers.set("Authorization", "Bearer " + dashboardToken);
    return fetch(path, { ...init, headers });
  };
  const inbox = useWorkspaceInbox(apiRequest, readJson, flash);
  const loadStatus = () => apiRequest("/api/status").then(async r => {
    const d = await readJson(r);
    if (!r.ok) throw new Error(d.error || "Status failed");
    setStatus(d as Status);
    setAutomation(Boolean(d.automationEnabled));
  }).catch(e => flash(e instanceof Error ? e.message : "Status failed"));
  useEffect(() => { void loadStatus(); const t = window.setInterval(() => void loadStatus(), 30000); return () => window.clearInterval(t); }, [dashboardToken]);
  const filtered = useMemo(() => {
    let list = inbox.conversations || [];
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((c: any) => String(c.chatId || "").includes(q) || String(c.senderId || "").includes(q) || String(c.lastPreview || "").toLowerCase().includes(q));
    }
    if (inboxFilter === "allowed") list = list.filter((c: any) => c.allowAi);
    if (inboxFilter === "manual") list = list.filter((c: any) => !c.allowAi);
    return list;
  }, [inbox.conversations, query, inboxFilter]);
  return (
  <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><Bot size={20} /><span>Telegram Agent</span></div>
      <nav>{nav.map(item => (
        <button key={item.label} className={"nav-item " + (page === item.label ? "active" : "")} onClick={() => setPage(item.label)}><item.icon size={16} />{item.label}</button>
      ))}</nav>
      <div className="sidebar-foot">
        <label className="field-label">Dashboard token</label>
        <input className="form-control" type="password" value={dashboardToken} onChange={e => { setDashboardToken(e.target.value); window.sessionStorage.setItem("dashboardApiToken", e.target.value); }} placeholder="API bearer token" />
        <button className="secondary-button compact" style={{ marginTop: 8 }} onClick={() => void loadStatus()}>Refresh status</button>
      </div>
    </aside>
    <main className="main-pane">
      <div className="page-body">
        {page === "Overview" ? <div>
          <div className="page-heading"><div><div className="eyebrow">CONTROL</div><h1>Overview</h1><p>Live agent health and automation.</p></div></div>
          <div className="stat-grid">
            <div className="stat-card"><b>Automation</b><span>{automation ? "On" : "Off"}</span></div>
            <div className="stat-card"><b>Telegram</b><span>{status?.telegramConfigured ? "Configured" : "Missing"}</span></div>
            <div className="stat-card"><b>AI</b><span>{status?.aiConfigured ? (status.aiProvider || "Ready") : "Not set"}</span></div>
            <div className="stat-card"><b>Storage</b><span>{status?.storageConfigured ? "Persistent" : "Ephemeral"}</span></div>
          </div>
          <div className="panel" style={{ marginTop: 16, padding: 18 }}>
            <div className="toggle-row"><div><b>Automation</b><p className="helper-text">Pause or resume automatic replies.</p></div>
              <button className={"secondary-button compact " + (automation ? "running" : "")} onClick={() => apiRequest("/api/agent/automation", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !automation }) }).then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Failed"); setAutomation(Boolean(d.enabled)); flash(d.enabled ? "Automation on" : "Automation paused"); }).catch(e => flash(e instanceof Error ? e.message : "Failed"))}>{automation ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Resume</>}</button></div>
          </div>
          <WebhookPanel apiRequest={apiRequest} readJson={readJson} flash={flash} />
        </div> : page === "Inbox" ? <div>
          <div className="page-heading"><div><div className="eyebrow">MESSAGES</div><h1>Inbox</h1><p>Private chats and manual replies.</p></div>
            <button className="secondary-button" onClick={() => void inbox.refresh()}>Refresh</button></div>
          {inbox.error ? <div className="notice-card" role="alert"><ShieldCheck size={18} /><div><b>Inbox error</b><p>{inbox.error}</p></div></div> : null}
          <div className="inbox-layout">
            <div className="inbox-list panel">
              <input className="form-control" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search chats" />
              <div className="choice-grid" style={{ marginTop: 10 }}>
                {["all", "allowed", "manual"].map(f => <button key={f} type="button" className={"choice " + (inboxFilter === f ? "choice-selected" : "")} onClick={() => setInboxFilter(f as any)}>{f}</button>)}
              </div>
              {(filtered || []).map((c: any) => (
                <button key={c.conversationId || c.chatId} className={"inbox-row " + (inbox.selectedId === (c.conversationId || c.chatId) ? "active" : "")} onClick={() => void inbox.selectConversation(c)}>
                  <b>{c.chatId}</b><span>{c.lastPreview || "—"}</span>
                </button>
              ))}
            </div>
            <div className="inbox-thread panel">
              {inbox.selectedId ? <>
                <div className="section-head"><h3>Chat {inbox.selectedChatId || inbox.selectedId}</h3>
                  <button className="secondary-button compact" onClick={() => void inbox.toggleAllowAi()}>{inbox.selectedAllowAi ? "AI on" : "Allow AI"}</button></div>
                <div className="message-stream">{(inbox.messages || []).map((m: any) => (
                  <div key={m.id} className={"message-row " + (m.direction === "outgoing" ? "outgoing" : "")}><div className={"bubble " + (m.direction === "outgoing" ? "bubble-ai" : "bubble-them")}>{m.body || m.text}<time>{m.createdAt || m.created_at}</time></div></div>
                ))}</div>
                <div className="reply-box">
                  <textarea value={inbox.draft || ""} onChange={e => inbox.setDraft(e.target.value)} rows={2} placeholder="Manual reply…" />
                  <button className="send-button" onClick={() => void inbox.sendReply()} disabled={!inbox.draft?.trim()}><Send size={16} /> Send</button>
                </div>
              </> : <p className="helper-text">Select a conversation.</p>}
            </div>
          </div>
        </div> : page === "Users" ? <TenantUsersPanel apiRequest={apiRequest} />
        : page === "AI personality" ? <PersonalityPanel apiRequest={apiRequest} readJson={readJson} flash={flash} />
        : page === "Contacts" ? <ContactsPanel apiRequest={apiRequest} readJson={readJson} flash={flash} />
        : page === "Memory" ? <MemoryPanel apiRequest={apiRequest} readJson={readJson} flash={flash} />
        : page === "Automation" ? <div className="page-heading"><h1>Automation</h1><p>Use Overview to pause or resume.</p></div>
        : page === "Settings" ? <div className="page-heading"><h1>Settings</h1><p>Token is in the sidebar. Webhook tools are on Overview.</p></div>
        : <div className="page-heading"><h1>{page}</h1></div>}
      </div>
    </main>
    {toast ? <div className="toast">{toast}</div> : null}
  </div>
  );
}
