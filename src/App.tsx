import { useEffect, useMemo, useState } from "react";
import { isValidTelegramSenderId } from "./telegram-id";
import { Bot, BrainCircuit, ContactRound, Gauge, MessageCircle, Pause, Play, Search, Send, Settings2, ShieldCheck, Sparkles, Zap } from "lucide-react";

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
type Contact = { id: string; senderId?: string; name: string; handle: string; initials: string; color: string; last: string; time: string; unread?: number; allowed: boolean; messages: { from: "them" | "ai"; text: string; time: string }[] };
const initialContacts: Contact[] = [];
const nav = [{ label: "Overview", icon: Gauge }, { label: "Inbox", icon: MessageCircle }, { label: "AI personality", icon: Sparkles }, { label: "Contacts", icon: ContactRound }, { label: "Memory", icon: BrainCircuit }, { label: "Automation", icon: Zap }, { label: "Settings", icon: Settings2 }];

function MemoryPanel({ apiRequest, readJson, flash }: { apiRequest: (path: string, init?: RequestInit) => Promise<Response>; readJson: (r: Response) => Promise<Record<string, any>>; flash: (m: string) => void }) {
  const [items, setItems] = useState<Array<{ id: number; memory: string; category: string; createdAt?: string }>>([]);
  const [aiProvider, setAiProvider] = useState<"gemini" | "openai">("gemini");
  const [aiModel, setAiModel] = useState("gemini-2.5-flash-lite");
  const [aiFallback, setAiFallback] = useState(true);
  const [aiSettingsLoading, setAiSettingsLoading] = useState(false);
  const [aiSettingsSaving, setAiSettingsSaving] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiProviders, setAiProviders] = useState<Array<{id:"gemini"|"openai";label:string;configured:boolean;models:string[]}>>([]);
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
  const [tone, setTone] = useState(tones[1].id);
  const [language, setLanguage] = useState(languages[0].id);
  const [replyLength, setReplyLength] = useState(lengths[0].id);
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
          apiRequest("/api/agent/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: simIn.trim(), tone, language }) })
            .then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Failed"); setSimOut(d.escalated ? "(Needs owner review) " + (d.reason || "") : (d.reply || "")); })
            .catch(e => flash(e instanceof Error ? e.message : "Simulate failed")).finally(() => setSimBusy(false));
        }}>{simBusy ? "Thinking…" : "Generate test reply"}</button>
        {simOut ? <div className="notice-card" style={{ marginTop: 14 }}><Sparkles size={16} /><div><b>Sample reply</b><p style={{ whiteSpace: "pre-wrap" }}>{simOut}</p></div></div> : null}
      </div>
    </div>
  );
}

function ContactsPanel({ apiRequest, readJson, flash, setPage }: { apiRequest: (path: string, init?: RequestInit) => Promise<Response>; readJson: (r: Response) => Promise<Record<string, any>>; flash: (m: string) => void; setPage: (p: string) => void }) {
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
  const [contacts, setContacts] = useState(initialContacts);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [automation, setAutomation] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [activityEvents, setActivityEvents] = useState<Array<{id?:number;kind:string;detail:string;createdAt?:string}>>([]);
  const [liveMetrics, setLiveMetrics] = useState({ messages: 0, replies: 0, review: 0 });
  const [inboxLive, setInboxLive] = useState(false);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxFilter, setInboxFilter] = useState<"all" | "allowed" | "manual">("all");
  const [inboxError, setInboxError] = useState("");
  const [webhookInfo, setWebhookInfo] = useState<{ expectedUrl?: string | null; matchesExpected?: boolean; webhook?: { url?: string; pending_update_count?: number; last_error_message?: string } } | null>(null);
  const [dashboardToken, setDashboardToken] = useState(() => window.sessionStorage.getItem("dashboardApiToken") || "");
  const apiBase = import.meta.env.VITE_API_BASE_URL || "";
  const apiRequest = (path: string, init: RequestInit = {}) => fetch(`${apiBase}${path}`, { ...init, headers: { ...(init.headers || {}), "x-dashboard-token": dashboardToken } });
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState("");
  const selected = contacts.find(c => c.id === selectedId);
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return contacts.filter(c => {
      if (q && !(c.name + " " + c.handle).toLowerCase().includes(q)) return false;
      if (inboxFilter === "allowed") return c.allowed;
      if (inboxFilter === "manual") return !c.allowed;
      return true;
    });
  }, [contacts, query, inboxFilter]);
  useEffect(() => { fetch(`${apiBase}/api/status`).then(r => readJson(r)).then((value: Status) => { setStatus(value); setAutomation(value.automationEnabled); }).catch(() => setStatus(null)); }, [apiBase]);
  useEffect(() => { if (dashboardToken) window.sessionStorage.setItem("dashboardApiToken", dashboardToken); else window.sessionStorage.removeItem("dashboardApiToken"); }, [dashboardToken]);
  useEffect(() => {
    if (!dashboardToken) return;
    let active = true;
    setAiSettingsLoading(true);
    apiRequest("/api/agent/ai-settings").then(async r => {
      const d = await readJson(r);
      if (!r.ok) throw new Error(d.error || "Could not load AI settings.");
      if (!active) return;
      const s = d.settings || {};
      setAiProvider(s.provider === "openai" ? "openai" : "gemini");
      setAiModel(s.model || "gemini-2.5-flash-lite");
      setAiFallback(s.fallbackEnabled !== false);
      setAiProviders(d.providers || []);
    }).catch(e => { if (active) flash(e instanceof Error ? e.message : "Could not load AI settings."); })
      .finally(() => { if (active) setAiSettingsLoading(false); });
    return () => { active = false; };
  }, [dashboardToken, apiBase]);
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };
  const refreshLiveInbox = async () => {
    if (!dashboardToken) { flash("Enter your dashboard API token in Settings first."); return; }
    setInboxLoading(true); setInboxError("");
    try {
      const [inboxResponse, contactsResponse, activityResponse] = await Promise.all([apiRequest("/api/inbox"), apiRequest("/api/agent/contacts"), apiRequest("/api/activity?limit=100")]);
      const inboxData = await readJson(inboxResponse);
      if (!inboxResponse.ok) throw new Error(inboxData.error || "Live inbox could not be loaded.");
      const contactData = contactsResponse.ok ? await readJson(contactsResponse) : { contacts: [] };
      if (activityResponse.ok) {
        const activityData = await readJson(activityResponse);
        const events = (activityData.events || []) as Array<{id?:number;kind:string;detail:string;createdAt?:string}>;
        setActivityEvents(events);
        setLiveMetrics({
          messages: (inboxData.conversations || []).reduce((total: number, item: {messageCount?:number}) => total + Number(item.messageCount || 0), 0),
          replies: events.filter(event => event.kind === "reply_sent" || event.kind === "manual_reply_sent").length,
          review: events.filter(event => event.kind === "owner_review_required" || event.kind === "blocked" || event.kind === "delivery_failed").length
        });
      }
      const permissions = new Map<string, boolean>((contactData.contacts || []).map((x: {senderId:string;enabled:boolean}) => [x.senderId, x.enabled]));
      const colors = ["lilac", "blue", "mint", "peach"];
      const mapped: Contact[] = (inboxData.conversations || []).map((item: {chatId:string;senderId?:string;senderName:string;username:string;lastMessage:string;lastMessageAt:string;lastDirection:string}, i:number) => ({
        id: item.chatId, senderId: item.senderId, name: item.senderName || item.username || item.chatId,
        handle: item.username ? "@" + item.username : (item.senderId ? "id " + item.senderId : item.chatId),
        initials: (item.senderName || item.username || item.chatId).split(/\s+/).slice(0,2).map((s:string)=>s[0]).join("").toUpperCase() || "?",
        color: colors[i % colors.length], last: item.lastMessage,
        time: item.lastMessageAt ? new Date(item.lastMessageAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "",
        unread: item.lastDirection === "incoming" ? 1 : undefined,
        allowed: item.senderId ? permissions.get(item.senderId) === true : false, messages: []
      }));
      setInboxLive(true);
      setContacts(mapped);
      setSelectedId(previous => mapped.some(item => item.id === previous) ? previous : (mapped[0]?.id || ""));
      flash(mapped.length ? "Live Telegram inbox loaded." : "No conversations yet.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live inbox unavailable.";
      setInboxError(message); flash(message);
    } finally { setInboxLoading(false); }
  };
  useEffect(() => {
    if (!dashboardToken) { setInboxLive(false); setContacts([]); setSelectedId(""); return; }
    const timer = window.setTimeout(() => { void refreshLiveInbox(); }, 700);
    return () => window.clearTimeout(timer);
  }, [dashboardToken, apiBase]);
  useEffect(() => {
    if (page !== "Inbox" || !inboxLive || !selectedId || !dashboardToken) return;
    let active = true;
    apiRequest("/api/inbox/" + encodeURIComponent(selectedId) + "/messages").then(async response => {
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Could not load conversation.");
      if (!active) return;
      setContacts(previous => previous.map(contact => contact.id === selectedId ? { ...contact, messages: (data.messages || []).map((m: {direction:string;text:string;createdAt?:string}) => ({ from: m.direction === "outgoing" ? "ai" as const : "them" as const, text: m.text, time: m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "" })) } : contact));
    }).catch(error => { if (active) flash(error instanceof Error ? error.message : "Could not load conversation."); });
    return () => { active = false; };
  }, [page, inboxLive, selectedId, dashboardToken]);
  const toggleContact = (id: string) => {
    const contact = contacts.find(item => item.id === id);
    if (!contact?.senderId) return;
    const enabled = !contact.allowed;
    apiRequest("/api/agent/contacts/" + encodeURIComponent(contact.senderId), {method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled})})
      .then(async response => { const data = await readJson(response); if (!response.ok) throw new Error(data.error || "Permission update failed."); setContacts(previous => previous.map(item => item.id === id ? {...item,allowed:enabled}:item)); flash(enabled ? "Contact allowed." : "Contact set to manual-only."); })
      .catch(error => flash(error instanceof Error ? error.message : "Permission update failed."));
  };
  const sendDemo = async () => {
    if (!draft.trim() || !selected) return;
    try {
      const response = await apiRequest("/api/inbox/" + encodeURIComponent(selected.id) + "/reply", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:draft.trim()})});
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Telegram reply failed.");
      setDraft(""); flash("Reply sent."); await refreshLiveInbox();
    } catch (error) { flash(error instanceof Error ? error.message : "Telegram reply failed."); }
  };
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Bot size={21}/></div><div><strong>telegram<span>agent</span></strong><small>PERSONAL AI</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{nav.map(item => <button key={item.label} onClick={() => setPage(item.label)} className={"nav-item " + (page === item.label ? "active" : "")}><item.icon size={18}/><span>{item.label}</span></button>)}</nav>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="crumb">Workspace / <b>{page}</b></div><div className="connection-pill"><span className={"dot " + (status?.telegramConfigured ? "green" : "amber")}></span>{status?.telegramConfigured ? "Telegram connected" : "Telegram not connected"}</div></header>
      <div className="content">
        {page === "Inbox" ? <div className="inbox-page">
          <div className="page-heading"><div><div className="eyebrow">YOUR CONVERSATIONS</div><h1>Inbox</h1></div><button className="secondary-button" onClick={() => void refreshLiveInbox()} disabled={inboxLoading}>{inboxLoading ? "Loading…" : "Refresh"}</button></div>
          <div className="inbox-layout"><section className="inbox-list"><div className="searchbox"><Search size={16}/><input placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)}/></div>
            <div className="filter-row">
              <button className={inboxFilter === "all" ? "filter-active" : ""} onClick={() => setInboxFilter("all")}>All</button>
              <button className={inboxFilter === "allowed" ? "filter-active" : ""} onClick={() => setInboxFilter("allowed")}>Auto-reply</button>
              <button className={inboxFilter === "manual" ? "filter-active" : ""} onClick={() => setInboxFilter("manual")}>Manual</button>
            </div>
            {inboxError ? <p className="helper-text" style={{padding:"8px 16px",color:"#b91c1c"}}>{inboxError}</p> : null}
            {filtered.map(c => <button className={"conversation " + (selectedId === c.id ? "selected" : "")} key={c.id} onClick={() => setSelectedId(c.id)}><div className={"contact-avatar " + c.color}>{c.initials}</div><div className="conversation-copy"><div className="conversation-name"><b>{c.name}</b><time>{c.time}</time></div><p>{c.last}</p></div></button>)}
          </section>
          {selected ? <section className="chat-panel"><div className="chat-header"><div className={"contact-avatar " + selected.color}>{selected.initials}</div><div className="chat-contact"><b>{selected.name}</b><span>{selected.handle}</span></div><button className="secondary-button compact" onClick={() => toggleContact(selected.id)}>{selected.allowed ? "Pause AI" : "Allow AI"}</button></div><div className="message-stream">{selected.messages.map((m,i) => <div key={i} className={"message-row " + (m.from === "ai" ? "outgoing" : "")}><div className={"bubble " + (m.from === "ai" ? "bubble-ai" : "bubble-them")}>{m.text}<time>{m.time}</time></div></div>)}</div><div className="reply-box"><textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Write a reply…" rows={2}/><button className="send-button" onClick={() => void sendDemo()} disabled={!draft.trim()}><Send size={16}/> Send</button></div></section> : <section className="chat-panel"><p className="helper-text" style={{padding:40}}>Select a conversation.</p></section>}
          </div>
        </div> : page === "Settings" ? <div>
          <div className="page-heading"><h1>Settings</h1></div>
          <div className="panel settings-panel">
            <div className="security-note"><ShieldCheck size={18} /><div>
              <b>Dashboard authorization</b>
              <input className="form-control" type="password" value={dashboardToken} onChange={e => setDashboardToken(e.target.value)} placeholder="Paste dashboard API token" />
              <button className="secondary-button compact" style={{marginTop:10}} onClick={() => apiRequest("/api/agent/settings").then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Auth failed"); flash("Token verified."); }).catch(e => flash(e instanceof Error ? e.message : "Auth failed"))}>Verify token</button>
            </div></div>
            <div className="integration-row"><div><b>Telegram webhook</b><p>{status?.appBaseUrl || "APP_BASE_URL not set"}</p></div>
              <button className="secondary-button compact" disabled={!dashboardToken} onClick={() => apiRequest("/api/agent/telegram/configure-webhook", { method: "POST" }).then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Failed"); flash(d.message || "Webhook configured."); }).catch(e => flash(e instanceof Error ? e.message : "Webhook failed"))}>Configure webhook</button>
            </div>
            <div className="integration-row"><div><b>AI status</b><p>{status?.aiConfigured ? (status.aiProvider || "ready") : "Not configured"} · settings are stored server-side</p></div></div>
            <div className="panel" style={{marginTop:18,padding:20}}>
              <div className="panel-heading"><div><h3>AI provider & model</h3><p>Choose which model generates new Telegram replies.</p></div></div>
              {!dashboardToken ? <p className="helper-text">Enter and verify your dashboard API token to manage AI settings.</p> : <>
                <label className="field-label">Provider</label>
                <select className="form-control" value={aiProvider} disabled={aiSettingsLoading || aiSettingsSaving} onChange={e => {
                  const next = e.target.value as "gemini" | "openai";
                  setAiProvider(next);
                  const available = aiProviders.find(p => p.id === next)?.models || [];
                  setAiModel(available[0] || (next === "gemini" ? "gemini-2.5-flash-lite" : "gpt-4o-mini"));
                }}>
                  {aiProviders.map(p => <option key={p.id} value={p.id}>{p.label}{p.configured ? "" : " — API key not configured"}</option>)}
                </select>
                <label className="field-label" style={{marginTop:14}}>Model</label>
                <select className="form-control" value={aiModel} disabled={aiSettingsLoading || aiSettingsSaving} onChange={e => setAiModel(e.target.value)}>
                  {(aiProviders.find(p => p.id === aiProvider)?.models || (aiProvider === "gemini" ? ["gemini-2.5-flash-lite","gemini-2.5-flash"] : ["gpt-4o-mini","gpt-4o"])).map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <label className="permission-row" style={{marginTop:14,cursor:"pointer"}}>
                  <div className="permission-copy"><b>Automatic fallback</b><span>Try the alternate model if the selected model fails.</span></div>
                  <input type="checkbox" checked={aiFallback} onChange={e => setAiFallback(e.target.checked)} disabled={aiSettingsSaving}/>
                </label>
                <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:18}}>
                  <button className="primary-button" disabled={aiSettingsLoading || aiSettingsSaving} onClick={() => {
                    setAiSettingsSaving(true);
                    apiRequest("/api/agent/ai-settings", {method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider:aiProvider,model:aiModel,fallbackEnabled:aiFallback})})
                      .then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Save failed."); flash("AI model settings saved. New replies will use " + aiModel + "."); })
                      .catch(e => flash(e instanceof Error ? e.message : "Could not save AI settings."))
                      .finally(() => setAiSettingsSaving(false));
                  }}>{aiSettingsSaving ? "Saving…" : "Save model settings"}</button>
                  <button className="secondary-button" disabled={aiSettingsLoading || aiSettingsSaving || aiTesting} onClick={() => {
                    setAiTesting(true);
                    apiRequest("/api/agent/ai-settings/test", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider:aiProvider,model:aiModel})})
                      .then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Connection test failed."); flash("Connection successful: " + d.model); })
                      .catch(e => flash(e instanceof Error ? e.message : "Connection test failed."))
                      .finally(() => setAiTesting(false));
                  }}>{aiTesting ? "Testing…" : "Test connection"}</button>
                </div>
                <p className="helper-text" style={{marginTop:12}}>API keys are configured on the server in Vercel and are never displayed here. Provider changes require the matching server-side API key.</p>
              </>}
            </div>
          </div>
        </div>
        : page === "Contacts" ? <div>
          <div className="page-heading"><h1>Contacts</h1></div>
          {!dashboardToken ? <p className="helper-text">Enter token in Settings.</p> : <ContactsPanel apiRequest={apiRequest} readJson={readJson} flash={flash} setPage={setPage} />}
        </div>
        : page === "Memory" ? <div>
          <div className="page-heading"><h1>Memory</h1></div>
          {!dashboardToken ? <p className="helper-text">Enter token in Settings.</p> : <MemoryPanel apiRequest={apiRequest} readJson={readJson} flash={flash} />}
        </div>
        : page === "AI personality" ? <div>
          <div className="page-heading"><h1>AI personality</h1></div>
          {!dashboardToken ? <p className="helper-text">Enter token in Settings.</p> : <PersonalityPanel apiRequest={apiRequest} readJson={readJson} flash={flash} />}
        </div>
        : page === "Automation" ? <div>
          <div className="page-heading"><h1>Automation</h1></div>
          <div className="notice-card"><Zap size={18} /><div><b>Status: {automation ? "ON" : "OFF"}</b></div></div>
          <div className="panel settings-panel">
            <button className={"primary-button " + (automation ? "running" : "")} onClick={() => { if (!dashboardToken) { flash("Enter token in Settings."); return; } const next = !automation; apiRequest(next ? "/api/agent/resume" : "/api/agent/pause", { method: "POST" }).then(async r => { const data = await readJson(r); if (!r.ok) throw new Error(data.error || "Request failed"); setAutomation(data.automationEnabled); flash(data.automationEnabled ? "Enabled." : "Paused."); }).catch(error => flash(error instanceof Error ? error.message : "Failed")); }}>{automation ? "Pause automation" : "Start automation"}</button>
            <button className="danger-button compact" style={{marginTop:12}} disabled={!dashboardToken} onClick={() => apiRequest("/api/agent/emergency-stop", { method: "POST" }).then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Failed"); setAutomation(false); flash("Emergency stop applied."); }).catch(e => flash(e instanceof Error ? e.message : "Failed"))}>Emergency stop</button>
          </div>
          <div className="panel settings-panel" style={{ marginTop: 16 }}>
            <div className="panel-heading"><div><h3>Smart features</h3><p>Set in Vercel environment variables.</p></div></div>
            <div className="permission-row"><div className="permission-copy"><b>Human reply delay</b><span>{status?.features?.replyDelayMs ? `${status.features.replyDelayMs.min}–${status.features.replyDelayMs.max} ms` : "~1.2–3.2s default"}</span></div></div>
            <div className="permission-row"><div className="permission-copy"><b>Quiet hours</b><span>{status?.features?.quietHours?.enabled ? `${status.features.quietHours.startHour}:00–${status.features.quietHours.endHour}:00 (${status.features.quietHours.timezone})` : "Off"}</span></div></div>
            <div className="permission-row"><div className="permission-copy"><b>Daily limit</b><span>{status?.features?.dailyReplyLimit ? `${status.features.dailyReplyLimit}/day` : "Unlimited"}</span></div></div>
            <div className="permission-row"><div className="permission-copy"><b>AI provider</b><span>{status?.aiProvider || (status?.aiConfigured ? "configured" : "not configured")}</span></div></div>
          </div>
        </div>
        : page === "Overview" ? <div>
          <div className="page-heading"><h1>Overview</h1><p>Automation {automation ? "ON" : "OFF"} · AI {status?.aiProvider || (status?.aiConfigured ? "ready" : "missing")}</p></div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:20}}>
            <div className="panel" style={{padding:16}}><div className="eyebrow">MESSAGES</div><h2 style={{margin:0}}>{liveMetrics.messages}</h2></div>
            <div className="panel" style={{padding:16}}><div className="eyebrow">REPLIES</div><h2 style={{margin:0}}>{liveMetrics.replies}</h2></div>
            <div className="panel" style={{padding:16}}><div className="eyebrow">REVIEW</div><h2 style={{margin:0}}>{liveMetrics.review}</h2></div>
          </div>
          <button className="secondary-button" onClick={() => setPage("Inbox")}>Open inbox</button>
          <div className="panel" style={{padding:16,marginTop:16}}>
            <h3 style={{marginTop:0}}>Recent activity</h3>
            <ul style={{listStyle:"none",padding:0,margin:0,maxHeight:280,overflow:"auto"}}>
              {activityEvents.slice(0,20).map((e,i) => (<li key={e.id ?? i} style={{padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}><b>{e.kind}</b> — {e.detail}</li>))}
            </ul>
          </div>
        </div>
        : <div className="page-heading"><h1>{page}</h1></div>}
      </div>
    </main>
    {toast ? <div className="toast">{toast}</div> : null}
  </div>;
}
