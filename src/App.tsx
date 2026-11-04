import { useEffect, useMemo, useState } from "react";
import { useWorkspaceInbox } from "./useWorkspaceInbox";
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

type AdminTenant = { ownerId: string; automationEnabled: boolean; consentGiven: boolean; registeredAt: string; connections: number; readyConnections: number };
function TenantUsersPanel({ apiRequest }: { apiRequest: (path: string, init?: RequestInit) => Promise<Response> }) {
  const [users, setUsers] = useState<AdminTenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [viewOwner, setViewOwner] = useState("");
  const [threads, setThreads] = useState<Array<{connection_id:string;chat_id:string;last_at:string}>>([]);
  const [viewChat, setViewChat] = useState("");
  const [supportMessages, setSupportMessages] = useState<Array<{id:number;body:string;direction:string;created_at:string}>>([]);
  const [supportError, setSupportError] = useState("");
  const [supportLoading, setSupportLoading] = useState(false);
  const openSupport = async (ownerId:string) => {
    setViewOwner(ownerId);setViewChat("");setThreads([]);setSupportMessages([]);setSupportError("");setSupportLoading(true);
    try { const response=await apiRequest("/api/agent/tenant-inbox/"+encodeURIComponent(ownerId));const data=await readJson(response);if(!response.ok)throw new Error(data.error||"Access denied.");setThreads(data.conversations||[]); }
    catch(e){setSupportError(e instanceof Error?e.message:"Could not open support inbox.");}
    finally{setSupportLoading(false);}
  };
  const openThread = async (thread:{connection_id:string;chat_id:string}) => {
    setViewChat(thread.connection_id+"~"+thread.chat_id);setSupportMessages([]);setSupportError("");setSupportLoading(true);
    try {const response=await apiRequest("/api/agent/tenant-inbox/"+encodeURIComponent(viewOwner)+"/messages?connection="+encodeURIComponent(thread.connection_id)+"&chat="+encodeURIComponent(thread.chat_id));const data=await readJson(response);if(!response.ok)throw new Error(data.error||"Access denied.");setSupportMessages(data.messages||[]);}
    catch(e){setSupportError(e instanceof Error?e.message:"Could not open messages.");}
    finally{setSupportLoading(false);}
  };
  const load = async (nextOffset = 0) => {
    setLoading(true); setError("");
    try {
      const response = await apiRequest("/api/agent/tenant-users?offset=" + nextOffset);
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Unable to load users.");
      setEnabled(data.enabled !== false);
      setUsers(previous => nextOffset ? [...previous, ...(data.users || [])] : (data.users || []));
      setHasMore(data.hasMore === true);
      setOffset(Number(data.nextOffset || 0));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load users."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <div className="tenant-users-page">
    <div className="page-heading"><div><div className="eyebrow">ADMINISTRATOR</div><h1>Connected users</h1><p>Account status and connection health, without access to private messages.</p></div>
      <button className="secondary-button" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button></div>
    {!enabled ? <div className="notice-card"><ShieldCheck size={18}/><div><b>Multi-user mode is disabled</b><p>Enable multi-user accounts on the backend to list connected accounts.</p></div></div> : null}
    {error ? <div className="notice-card" role="alert"><ShieldCheck size={18}/><div><b>Unable to load users</b><p>{error}</p></div></div> : null}
    <div className="panel tenant-users-list">
      <div className="section-head"><h3>Registered accounts ({users.length}{hasMore ? "+" : ""})</h3><span className="helper-text">Private inboxes remain owner-only</span></div>
      {users.map(user => <div className="tenant-user-row" key={user.ownerId}>
        <div className="tenant-user-avatar"><Users size={18}/></div>
        <div className="tenant-user-details"><b>Telegram ID {user.ownerId}</b><span>Registered {user.registeredAt ? new Date(user.registeredAt).toLocaleDateString() : "—"}</span></div>
        <div className="tenant-user-status"><span className={user.automationEnabled ? "permission-chip enabled" : "permission-chip"}>{user.automationEnabled ? "Auto-reply on" : "Paused"}</span><span>{user.readyConnections}/{user.connections} connections ready</span><span>{user.consentGiven ? "Consent recorded" : "Consent pending"}</span><button className="secondary-button compact" disabled={supportLoading} onClick={()=>void openSupport(user.ownerId)}>View inbox (with permission)</button></div>
      </div>)}
      {viewOwner ? <section className="panel" style={{padding:16,marginTop:14}}><div className="section-head"><h3>Read-only support inbox · {viewOwner}</h3><button className="secondary-button compact" onClick={()=>{setViewOwner("");setThreads([]);setSupportMessages([]);setSupportError("");}}>Close</button></div>
        <p className="helper-text">Available only with the owner's explicit permission. Access is audited. Telegram messages cannot be sent or deleted here.</p>
        {supportError ? <p role="alert" className="helper-text">{supportError}</p> : null}
        {supportLoading ? <p className="helper-text">Loading…</p> : null}
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{threads.map(thread=><button className="secondary-button compact" key={thread.connection_id+"~"+thread.chat_id} onClick={()=>void openThread(thread)}>{thread.chat_id} · {new Date(thread.last_at).toLocaleDateString()}</button>)}</div>
        {!supportLoading && !supportError && threads.length===0 ? <p className="helper-text">No stored conversations available.</p> : null}
        {viewChat ? <div className="message-stream" style={{maxHeight:350,overflowY:"auto",marginTop:12}}>{supportMessages.map(message=><div className={"message-row "+(message.direction==="outgoing"?"outgoing":"")} key={message.id}><div className={"bubble "+(message.direction==="outgoing"?"bubble-ai":"bubble-them")}>{message.body}<time>{new Date(message.created_at).toLocaleString()}</time></div></div>)}</div> : null}
      </section> : null}
      {!loading && !users.length && !error ? <p className="helper-text">No registered accounts found.</p> : null}
      {hasMore ? <button className="secondary-button" disabled={loading} onClick={() => void load(offset)}>{loading ? "Loading…" : "Load more users"}</button> : null}
    </div>
  </div>;
}

export default function App() {
  const [page, setPage] = useState("Overview");
  const [query, setQuery] = useState("");
  const [automation, setAutomation] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [inboxFilter, setInboxFilter] = useState<"all" | "allowed" | "manual">("all");
  const [dashboardToken, setDashboardToken] = useState(() => window.sessionStorage.getItem("dashboardApiToken") || "");
  const [aiModel, setAiModel] = useState("gemini-3.5-flash-lite");
  const [aiModelTesting, setAiModelTesting] = useState(false);
  const [aiSettingsLoading, setAiSettingsLoading] = useState(false);
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [environmentOwners, setEnvironmentOwners] = useState<string[]>([]);
  const [configuredOwners, setConfiguredOwners] = useState<string[]>([]);
  const [dashboardOwners, setDashboardOwners] = useState<string[]>([]);
  const [ownerDraft, setOwnerDraft] = useState("");
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [ownerError, setOwnerError] = useState("");
  const [ownerIdsText, setOwnerIdsText] = useState("");
  const [ownerIdsLoading, setOwnerIdsLoading] = useState(false);
  const [ownerIdsSaving, setOwnerIdsSaving] = useState(false);
  const [ownerIdsError, setOwnerIdsError] = useState("");
  const apiBase = import.meta.env.VITE_API_BASE_URL || "";
  const apiRequest = (path: string, init: RequestInit = {}) => fetch(`${apiBase}${path}`, { ...init, headers: { ...(init.headers || {}), "x-dashboard-token": dashboardToken } });
  const [toast, setToast] = useState("");
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3500); };
  const inbox = useWorkspaceInbox(dashboardToken, apiBase, page === "Inbox", flash);
  const { selected, draft, setDraft, select: setSelectedId, refresh: refreshLiveInbox, loadOlder: loadOlderMessages, send: sendReply, toggle: toggleContact } = inbox;
  const { contacts, selectedId, live: inboxLive, loading: inboxRefreshing, error: inboxError, events: activityEvents, metrics: liveMetrics, sending: replySending, hasMore: historyHasMore, olderLoading: historyLoading } = inbox.state;
  const inboxLoading = inboxRefreshing || inbox.state.cleaning;
  useEffect(() => { if (!selectedId) setMobileChatOpen(false); }, [selectedId]);
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return contacts.filter(c => {
      if (q && !(c.name + " " + c.handle).toLowerCase().includes(q)) return false;
      if (inboxFilter === "allowed") return c.allowed;
      if (inboxFilter === "manual") return c.allowed === false;
      return true;
    });
  }, [contacts, query, inboxFilter]);
  useEffect(() => { fetch(`${apiBase}/api/status`).then(r => readJson(r)).then(value => { setStatus(value as Status); setAutomation(value.automationEnabled); }).catch(() => setStatus(null)); }, [apiBase]);
  useEffect(() => { if (dashboardToken) window.sessionStorage.setItem("dashboardApiToken", dashboardToken); else window.sessionStorage.removeItem("dashboardApiToken"); }, [dashboardToken]);
  useEffect(() => {
    if (!dashboardToken) return;
    let active = true;
    setAiSettingsLoading(true);
    apiRequest("/api/agent/ai-settings").then(async r => {
      const d = await readJson(r);
      if (!r.ok) throw new Error(d.error || "Could not load AI settings.");
      if (!active) return;
      // This dashboard currently exposes Gemini 3.5 Flash-Lite as its supported model.
      setAiModel("gemini-3.5-flash-lite");
    }).catch(() => { /* defaults remain */ })
      .finally(() => { if (active) setAiSettingsLoading(false); });
    return () => { active = false; };
  }, [dashboardToken, apiBase]);
  useEffect(() => {
    if (!dashboardToken) { setOwnerIdsText(""); return; }
    let active = true;
    setOwnerIdsLoading(true); setOwnerIdsError("");
    apiRequest("/api/agent/owner-ids").then(async response => {
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Unable to load owner IDs.");
      if (active) setOwnerIdsText((data.ownerIds || []).join("\n"));
    }).catch(error => { if (active) setOwnerIdsError(error instanceof Error ? error.message : "Unable to load owners."); })
      .finally(() => { if (active) setOwnerIdsLoading(false); });
    return () => { active = false; };
  }, [dashboardToken, apiBase]);
  const loadOwners = async () => {
    if (!dashboardToken) return;
    try {
      const response = await apiRequest("/api/agent/owners");
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Could not load owners.");
      setOwnerIds(Array.isArray(data.ownerIds) ? data.ownerIds : []);
      setEnvironmentOwners(Array.isArray(data.environmentOwners) ? data.environmentOwners : []);
      setConfiguredOwners(Array.isArray(data.configuredOwners) ? data.configuredOwners : []);
      setDashboardOwners(Array.isArray(data.dashboardOwners) ? data.dashboardOwners : []);
      setOwnerError("");
    } catch (error) { setOwnerError(error instanceof Error ? error.message : "Could not load owners."); }
  };
  useEffect(() => { if (dashboardToken) void loadOwners(); else { setOwnerIds([]); setEnvironmentOwners([]); setConfiguredOwners([]); setDashboardOwners([]); } }, [dashboardToken, apiBase]);
  const addOwner = async () => {
    const id = ownerDraft.trim();
    if (!/^[1-9][0-9]{0,19}$/.test(id)) { setOwnerError("Enter a valid numeric Telegram user ID."); return; }
    setOwnerBusy(true);
    try {
      const response = await apiRequest("/api/agent/owners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: id }) });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Could not add owner.");
      setOwnerDraft(""); await loadOwners(); flash("Owner added.");
    } catch (error) { setOwnerError(error instanceof Error ? error.message : "Could not add owner."); }
    finally { setOwnerBusy(false); }
  };
  const removeOwner = async (id: string) => {
    if (!window.confirm("Remove this Telegram owner from dashboard-managed permissions?")) return;
    setOwnerBusy(true);
    try {
      const response = await apiRequest("/api/agent/owners/" + encodeURIComponent(id), { method: "DELETE" });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Could not remove owner.");
      await loadOwners(); flash("Owner removed.");
    } catch (error) { setOwnerError(error instanceof Error ? error.message : "Could not remove owner."); }
    finally { setOwnerBusy(false); }
  };
  const saveOwnerIds = async () => {
    const ids = [...new Set(ownerIdsText.split(/[\s,;]+/).map(value => value.trim()).filter(Boolean))];
    if (!ids.length || ids.length > 100 || ids.some(id => !/^[1-9][0-9]{0,19}$/.test(id))) {
      setOwnerIdsError("Enter between 1 and 100 valid numeric Telegram user IDs."); return;
    }
    setOwnerIdsSaving(true); setOwnerIdsError("");
    try {
      const response = await apiRequest("/api/agent/owner-ids", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerIds: ids }) });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Could not save owner IDs.");
      setOwnerIdsText((data.ownerIds || ids).join("\n"));
      await loadOwners();
      flash("Saved " + ids.length + " Telegram Business owner IDs.");
    } catch (error) { setOwnerIdsError(error instanceof Error ? error.message : "Could not save owner IDs."); }
    finally { setOwnerIdsSaving(false); }
  };
  const clearInboxHistory = async () => {
    if (!dashboardToken || inboxLoading || replySending) return;
    const confirmation = window.prompt("Delete ONLY stored inbox message copies? Conversation IDs remain available. Original Telegram messages are unchanged. Type CLEAR HISTORY to confirm:");
    if (confirmation === "CLEAR HISTORY") await inbox.clear();
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
          <div className="page-heading"><div><div className="eyebrow">YOUR CONVERSATIONS</div><h1>Inbox</h1></div><div className="inbox-heading-actions"><button className="secondary-button" onClick={() => void clearInboxHistory()} disabled={inboxLoading || replySending || !dashboardToken} title="Permanently delete only stored message copies in Supabase; original Telegram chats remain untouched">Clear database copies</button><button className="secondary-button" onClick={() => void refreshLiveInbox()} disabled={inboxLoading || !dashboardToken}>{inboxLoading ? "Loading…" : "Refresh"}</button></div></div>
          {inbox.state.multiUser ? <div className="security-note"><ShieldCheck size={18}/><div><b>Administrator inbox</b><p>This workspace shows legacy conversations. Each connected account has its own private inbox: open /dashboard in the Telegram bot.</p><a href="/my-agent">Open my private dashboard</a></div></div> : null}
          <div className="inbox-toolbar"><div className="inbox-count"><b>{filtered.length}</b> <span>conversations</span>{inboxLive ? <span className="live-label"><i/> Live</span> : null}</div><div className="searchbox"><Search size={16}/><input aria-label="Search conversations" placeholder="Search people or usernames…" value={query} onChange={e => setQuery(e.target.value)}/>{query ? <button className="clear-search" onClick={() => setQuery("")} aria-label="Clear search">×</button> : null}</div></div><div className="inbox-layout"><section className={"inbox-list " + (mobileChatOpen ? "mobile-hidden" : "")}>
            <div className="filter-row">
              <button className={inboxFilter === "all" ? "filter-active" : ""} onClick={() => setInboxFilter("all")}>All</button>
              <button className={inboxFilter === "allowed" ? "filter-active" : ""} onClick={() => setInboxFilter("allowed")}>Auto-reply</button>
              <button className={inboxFilter === "manual" ? "filter-active" : ""} onClick={() => setInboxFilter("manual")}>Manual</button>
            </div>
            {inboxError ? <p className="helper-text" style={{padding:"8px 16px",color:"#b91c1c"}}>{inboxError}</p> : null}
            {!dashboardToken ? <p className="helper-text" style={{padding:"12px 16px"}}>Enter dashboard token in Settings to load live inbox.</p> : null}
            {inboxLoading && contacts.length === 0 ? <div className="inbox-empty"><span className="empty-icon">…</span><b>Loading conversations</b><p>Connecting to your Telegram inbox.</p></div> : null}{!inboxLoading && !inboxError && filtered.length === 0 ? <div className="inbox-empty"><span className="empty-icon"><MessageCircle size={20}/></span><b>{contacts.length ? "No matching conversations" : "Your inbox is empty"}</b><p>{contacts.length ? "Try another name or clear your search." : dashboardToken ? "New Telegram messages will appear here." : "Add your dashboard API token in Settings to load messages."}</p>{query ? <button className="text-link" onClick={() => setQuery("")}>Clear search</button> : null}</div> : null}{filtered.map(c => <button className={"conversation " + (selectedId === c.id ? "selected" : "")} key={c.id} onClick={() => { setSelectedId(c.id); setMobileChatOpen(true); }}><div className={"contact-avatar " + c.color}>{c.initials}</div><div className="conversation-copy"><div className="conversation-name"><b>{c.name}</b><time>{c.time}</time></div><p>{c.last || "No message text"}</p><div className="conversation-meta"><span className={c.allowed ? "permission-chip enabled" : "permission-chip"}>{c.allowed === null ? "Permissions unavailable" : c.allowed ? "AI enabled" : "Manual"}</span><span>{c.handle}</span></div></div></button>)}
          </section>
          {selected ? <section className={"chat-panel " + (mobileChatOpen ? "mobile-chat-active" : "")}><div className="chat-header"><button className="mobile-back-button" onClick={() => setMobileChatOpen(false)} aria-label="Back to conversations"><ArrowLeft size={18}/></button><div className={"contact-avatar " + selected.color}>{selected.initials}</div><div className="chat-contact"><b>{selected.name}</b><span>{selected.handle}</span></div><button className={"secondary-button compact " + (selected.allowed ? "pause-ai" : "allow-ai")} onClick={() => toggleContact(selected.id)} disabled={!selected.senderId || selected.allowed === null || inbox.state.permissionPending.includes(selected.senderId) || inbox.state.cleaning}>{selected.allowed ? <><Pause size={14}/> Pause AI</> : <><Play size={14}/> Allow AI</>}</button></div><div className="message-stream">{inbox.state.historyError ? <div role="alert" className="helper-text">{inbox.state.historyError}<button className="text-link" onClick={() => void refreshLiveInbox()}>Retry</button></div> : null}{inbox.state.historyLoading ? <p role="status" className="helper-text">Loading conversation…</p> : null}{historyHasMore ? <button className="secondary-button compact history-load-button" disabled={historyLoading} onClick={() => void loadOlderMessages()}>{historyLoading ? "Loading older messages…" : "Load older messages"}</button> : null}{selected.messages.length ? selected.messages.map(m => <div key={m.id} className={"message-row " + (m.from === "ai" ? "outgoing" : "")}><div className={"bubble " + (m.from === "ai" ? "bubble-ai" : "bubble-them")}>{m.text}<time>{m.time}</time></div></div>) : <div className="message-empty"><MessageCircle size={22}/><b>{inbox.state.historyLoading ? "Loading messages" : inbox.state.historyError ? "History unavailable" : "No stored messages"}</b><span>{inbox.state.historyLoading ? "Please wait…" : "Your Telegram conversation remains available. You can still send a reply."}</span></div>}</div><div className="reply-box"><textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder={"Message " + selected.name + "…"} rows={2} aria-label="Reply message" maxLength={4096} disabled={replySending || inbox.state.cleaning} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void sendReply(); } }}/><button className="send-button" onClick={() => void sendReply()} disabled={!draft.trim() || replySending || inbox.state.cleaning || !dashboardToken}><Send size={16}/> {replySending ? "Sending…" : "Send"}</button></div></section> : <section className={"chat-panel chat-placeholder " + (mobileChatOpen ? "mobile-chat-active" : "")}><MessageCircle size={28}/><b>Select a conversation</b><p>Choose someone from your inbox to read messages and reply.</p></section>}
          </div>
        </div> : page === "Users" ? <TenantUsersPanel apiRequest={apiRequest} />
        : page === "Settings" ? <div>
          <div className="page-heading"><h1>Settings</h1></div>
          <div className="panel settings-panel">
            <div className="security-note"><ShieldCheck size={18} /><div>
              <b>Dashboard authorization</b>
              <input className="form-control" type="password" value={dashboardToken} onChange={e => setDashboardToken(e.target.value)} placeholder="Paste dashboard API token" />
              <button className="secondary-button compact" style={{marginTop:10}} onClick={() => apiRequest("/api/agent/settings").then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Auth failed"); flash("Token verified."); void refreshLiveInbox(); }).catch(e => flash(e instanceof Error ? e.message : "Auth failed"))}>Verify token</button>
            </div></div>
            <div className="integration-row owner-settings-row">
              <div className="owner-settings-content">
                <b>Telegram Business owners</b>
                <p>Manage multiple authorized account owners. These IDs are not dashboard login credentials. Changes are saved in Supabase and apply to new webhook updates.</p>
                <label className="field-label" htmlFor="telegram-owner-ids">Telegram user IDs — one per line or comma-separated</label>
                <textarea id="telegram-owner-ids" className="form-control owner-ids-input" rows={6} value={ownerIdsText} onChange={e => setOwnerIdsText(e.target.value)} disabled={!dashboardToken || ownerIdsLoading || ownerIdsSaving} placeholder={"123456789\n987654321\n456789123"} />
                <p className="helper-text">{ownerIdsText.split(/[\s,;]+/).filter(Boolean).length} IDs entered · Up to 100 owners</p>
                {ownerIdsError ? <p role="alert" className="helper-text" style={{color:"#ffaaa0"}}>{ownerIdsError}</p> : null}
              </div>
              <button className="secondary-button compact" disabled={!dashboardToken || ownerIdsLoading || ownerIdsSaving} onClick={() => void saveOwnerIds()}>{ownerIdsSaving ? "Saving…" : ownerIdsLoading ? "Loading…" : "Save owners"}</button>
            </div>
            <div className="integration-row owner-settings">
              <div className="owner-settings-content"><b>Telegram owners</b>
                <p>Manage multiple authorized Telegram user IDs. The source label shows where each owner is managed. Vercel owners are protected; Saved settings owners are edited above; Dashboard owners can be removed here.</p>
                <div className="owner-add-row">
                  <input className="form-control" inputMode="numeric" aria-label="New Telegram owner ID" placeholder="Numeric Telegram user ID" value={ownerDraft} onChange={e => setOwnerDraft(e.target.value)} />
                  <button className="secondary-button compact" disabled={!dashboardToken || ownerBusy || !ownerDraft.trim()} onClick={() => void addOwner()}>Add owner</button>
                </div>
                {ownerError ? <p role="alert" className="helper-text" style={{color:"#f5a5a5"}}>{ownerError}</p> : null}
                <div className="owner-id-list">{ownerIds.map(id => {
                   const fromVercel = environmentOwners.includes(id);
                   const fromSavedSettings = configuredOwners.includes(id);
                   const fromDashboard = dashboardOwners.includes(id);
                   const source = fromVercel ? "Vercel" : fromSavedSettings ? "Saved settings" : fromDashboard ? "Dashboard" : "Authorized";
                   return <div className="owner-id-item" key={id}><code>{id}</code><span title={fromVercel ? "Configured in Vercel environment variables" : fromSavedSettings ? "Managed in the Telegram Business owners field above" : "Added through the dashboard"}>{source}</span>{fromDashboard && !fromVercel && !fromSavedSettings ? <button className="secondary-button compact" disabled={ownerBusy} onClick={() => void removeOwner(id)}>Remove</button> : null}</div>;
                 })}</div>
                {!ownerIds.length && <p className="helper-text">No owners loaded. Configure Supabase and apply the owner IDs migration.</p>}
              </div>
            </div>
            <div className="integration-row"><div><b>Telegram webhook</b><p>{status?.appBaseUrl || "APP_BASE_URL not set"}</p></div>
              <button className="secondary-button compact" disabled={!dashboardToken} onClick={() => apiRequest("/api/agent/telegram/configure-webhook", { method: "POST" }).then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Failed"); flash(d.message || "Webhook configured."); }).catch(e => flash(e instanceof Error ? e.message : "Webhook failed"))}>Configure webhook</button>
            </div>
            <div className="integration-row ai-model-settings"><div className="ai-model-copy"><b>AI model</b><p>{aiSettingsLoading ? "Loading saved model…" : "Choose the Gemini model used for Telegram replies."}</p>
              <label className="field-label" htmlFor="ai-model-select">Gemini model</label>
              <select id="ai-model-select" className="form-control" value={aiModel} onChange={e => { setAiModel(e.target.value); }}>
                <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite — fast and cost-efficient</option>
              </select>
              <p className="helper-text">Automatic model fallback is disabled. Replies use this selected model.</p>
            </div>
            <div className="ai-model-actions">
              <button className="secondary-button compact" disabled={!dashboardToken || aiSettingsLoading || aiModelTesting} onClick={() => {
                setAiModelTesting(true);
                apiRequest("/api/agent/ai-settings/test", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider:"gemini",model:aiModel})})
                  .then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Model test failed"); flash("Model test passed: " + (d.sample || "connection successful")); })
                  .catch(e => flash(e instanceof Error ? e.message : "Model test failed"))
                  .finally(() => setAiModelTesting(false));
              }}>{aiModelTesting ? "Testing…" : "Test model"}</button>
              <button className="secondary-button compact" disabled={!dashboardToken || aiSettingsLoading} onClick={() => apiRequest("/api/agent/ai-settings", {method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider:"gemini",model:aiModel,fallbackEnabled:false})}).then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Save failed"); flash("AI model saved."); }).catch(e => flash(e instanceof Error ? e.message : "Save failed"))}>Save model</button>
            </div></div>
            <div className="integration-row"><div><b>AI status</b><p>{status?.aiConfigured ? (status.aiProvider || "ready") : "Not configured"}</p></div></div>
          </div>
        </div>
        : page === "Contacts" ? <div>
          <div className="page-heading"><h1>Contacts</h1></div>
          {!dashboardToken ? <p className="helper-text">Enter token in Settings.</p> : <ContactsPanel apiRequest={apiRequest} readJson={readJson} flash={flash} />}
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
          {!dashboardToken ? (
            <div className="notice-card" style={{ marginBottom: 16 }}>
              <ShieldCheck size={18} />
              <div>
                <b>Dashboard token required for live data</b>
                <p>Go to Settings, paste your DASHBOARD_API_TOKEN, and tap Verify. Then metrics, inbox, and activity will load.</p>
                <button className="secondary-button compact" style={{ marginTop: 10 }} onClick={() => setPage("Settings")}>Open Settings</button>
              </div>
            </div>
          ) : null}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:20}}>
            <div className="panel" style={{padding:16}}><div className="eyebrow">MESSAGES</div><h2 style={{margin:0}}>{liveMetrics.messages}</h2></div>
            <div className="panel" style={{padding:16}}><div className="eyebrow">REPLIES</div><h2 style={{margin:0}}>{liveMetrics.replies}</h2></div>
            <div className="panel" style={{padding:16}}><div className="eyebrow">REVIEW</div><h2 style={{margin:0}}>{liveMetrics.review}</h2></div>
          </div>
          <div className="panel" style={{padding:16,marginBottom:16}}>
            <div className="permission-row"><div className="permission-copy"><b>Last webhook</b><span>{status?.lastWebhookAt ? new Date(status.lastWebhookAt).toLocaleString() : "No webhook received yet"}</span></div></div>
            <div className="permission-row"><div className="permission-copy"><b>Last activity</b><span>{status?.lastActivityAt ? new Date(status.lastActivityAt).toLocaleString() : "—"}</span></div></div>
            <div className="permission-row"><div className="permission-copy"><b>Storage</b><span>{status?.storageConfigured ? "Supabase connected" : "Not configured"}</span></div></div>
            <div className="permission-row"><div className="permission-copy"><b>Telegram</b><span>{status?.telegramConfigured ? "Configured" : "Missing token/secret"}</span></div></div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <button className="secondary-button" onClick={() => setPage("Inbox")}>Open inbox</button>
            {dashboardToken ? <button className="secondary-button" onClick={() => void refreshLiveInbox()} disabled={inboxLoading}>{inboxLoading ? "Refreshing…" : "Refresh live data"}</button> : null}
          </div>
          <div className="panel" style={{padding:16,marginTop:0}}>
            <h3 style={{marginTop:0}}>Recent activity</h3>
            {!dashboardToken ? <p className="helper-text">Enter the dashboard token in Settings to load activity.</p> : null}
            {dashboardToken && activityEvents.length === 0 ? <p className="helper-text">No events yet. When Telegram delivers messages, they appear here.</p> : null}
            <ul style={{listStyle:"none",padding:0,margin:0,maxHeight:280,overflow:"auto"}}>
              {activityEvents.slice(0,20).map((e,i) => (<li key={e.id ?? i} style={{padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}><b>{e.kind}</b> — {e.detail}{e.createdAt ? <span className="helper-text"> · {new Date(e.createdAt).toLocaleString()}</span> : null}</li>))}
            </ul>
          </div>
        </div>
        : <div className="page-heading"><h1>{page}</h1></div>}
      </div>
    </main>
    {toast ? <div className="toast">{toast}</div> : null}
  </div>;
}

