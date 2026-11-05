import { operationSignal } from "./operation-deadline.js";
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const memoryEvents: AgentEvent[] = [];
const MAX_MEMORY_EVENTS = 500;
const memoryUpdateIds = new Set<string>();
const MAX_MEMORY_UPDATE_IDS = 10000;

export type AgentEvent = {
  id?: number;
  kind: string;
  updateId?: string;
  senderId?: string;
  chatId?: string;
  detail: string;
  createdAt?: string;
};

export function isPersistentStoreConfigured(): boolean {
  return Boolean(supabaseUrl && serviceKey);
}

async function supabaseRequest(path: string, init: RequestInit = {}): Promise<Response> {
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase persistence is not configured.");
  return fetch(`${supabaseUrl}/rest/v1/${path}`, {
    signal: operationSignal(15000),
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {})
    }
  });
}

/** Dedup Telegram updates using public.telegram_updates (requires payload_hash). */
export async function claimUpdate(updateId: string): Promise<boolean> {
  if (!isPersistentStoreConfigured()) {
    if (memoryUpdateIds.has(updateId)) return false;
    memoryUpdateIds.add(updateId);
    if (memoryUpdateIds.size > MAX_MEMORY_UPDATE_IDS) {
      const oldest = memoryUpdateIds.values().next().value;
      if (oldest !== undefined) memoryUpdateIds.delete(oldest);
    }
    return true;
  }
  const response = await supabaseRequest("telegram_updates", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      update_id: updateId,
      payload_hash: updateId.slice(0, 64)
    })
  });
  if (response.status === 409) return false;
  if (!response.ok) {
    throw new Error(`Supabase update claim failed (${response.status}).`);
  }
  return true;
}

export async function releaseUpdate(updateId: string): Promise<void> {
  if (!isPersistentStoreConfigured()) {
    memoryUpdateIds.delete(updateId);
    return;
  }
  await supabaseRequest(`telegram_updates?update_id=eq.${encodeURIComponent(updateId)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  }).catch(() => undefined);
}

export async function recordEvent(event: AgentEvent): Promise<void> {
  const safeEvent = {
    kind: event.kind.slice(0, 64),
    update_id: event.updateId || null,
    sender_id: event.senderId || null,
    chat_id: event.chatId || null,
    detail: event.detail.slice(0, 500)
  };
  if (!isPersistentStoreConfigured()) {
    memoryEvents.unshift({ ...event, createdAt: new Date().toISOString() });
    if (memoryEvents.length > MAX_MEMORY_EVENTS) memoryEvents.length = MAX_MEMORY_EVENTS;
    return;
  }
  const response = await supabaseRequest("agent_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(safeEvent)
  });
  if (!response.ok) throw new Error(`Supabase event write failed (${response.status}).`);
}

export async function listEvents(limit = 50): Promise<AgentEvent[]> {
  const safeLimit = Math.max(1, Math.min(300, Math.floor(limit)));
  if (!isPersistentStoreConfigured()) return memoryEvents.slice(0, safeLimit);
  const response = await supabaseRequest(`agent_events?select=id,kind,update_id,sender_id,chat_id,detail,created_at&order=created_at.desc&limit=${safeLimit}`);
  if (!response.ok) throw new Error(`Supabase event read failed (${response.status}).`);
  const rows = await response.json() as Array<Record<string, unknown>>;
  return rows.map(row => ({
    id: Number(row.id),
    kind: String(row.kind),
    updateId: row.update_id ? String(row.update_id) : undefined,
    senderId: row.sender_id ? String(row.sender_id) : undefined,
    chatId: row.chat_id ? String(row.chat_id) : undefined,
    detail: String(row.detail),
    createdAt: String(row.created_at)
  }));
}

export type AgentMessage = {
  id?: number;
  updateId?: string;
  telegramMessageId?: number;
  businessConnectionId: string;
  chatId: string;
  senderId: string;
  senderName: string;
  username: string;
  direction: "incoming" | "outgoing";
  text: string;
  createdAt?: string;
};

export type InboxConversation = {
  conversationId: string;
  chatId: string;
  businessConnectionId: string;
  senderId: string;
  senderName: string;
  username: string;
  lastMessage: string;
  lastMessageAt: string;
  lastDirection: "incoming" | "outgoing";
  messageCount: number;
};

/** Stable, collision-free identifier for one Telegram destination and business connection. */
export function conversationId(connectionId: string, chatId: string): string {
  return encodeURIComponent(connectionId) + "~" + encodeURIComponent(chatId);
}
export function parseConversationId(value: string): { connectionId: string; chatId: string } | null {
  const index = value.indexOf("~");
  if (index < 1) return /^-?[0-9]{1,22}$/.test(value) ? { connectionId: "direct", chatId: value } : null;
  try {
    const connectionId = decodeURIComponent(value.slice(0, index));
    const chatId = decodeURIComponent(value.slice(index + 1));
    return connectionId && /^-?[0-9]{1,22}$/.test(chatId) ? { connectionId, chatId } : null;
  } catch { return null; }
}

export async function recordMessage(message: AgentMessage): Promise<void> {
  if (!isPersistentStoreConfigured()) return;
  const response = await supabaseRequest("agent_messages", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      update_id: message.updateId || null,
      telegram_message_id: message.telegramMessageId ?? null,
      business_connection_id: message.businessConnectionId,
      chat_id: message.chatId,
      sender_id: message.senderId,
      sender_name: message.senderName.slice(0, 120),
      username: message.username.slice(0, 64),
      direction: message.direction,
      message_text: message.text.slice(0, 4000),
      created_at: message.createdAt || new Date().toISOString()
    })
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({})) as { code?: string };
    // Telegram retries after downstream failures. An already saved copy must not
    // trap the update in a permanent 503 loop. Verify the exact destination and
    // content before accepting a unique conflict; unrelated failures still throw.
    if (response.status === 409 && failure.code === "23505" && message.updateId) {
      const existing = await supabaseRequest(`agent_messages?select=business_connection_id,chat_id,sender_id,direction,message_text,telegram_message_id&update_id=eq.${encodeURIComponent(message.updateId)}&direction=eq.${message.direction}&limit=2`);
      if (existing.ok) {
        const rows = await existing.json() as Array<Record<string, unknown>>;
        const row = rows[0];
        if (rows.length === 1 && row.business_connection_id === message.businessConnectionId &&
            row.chat_id === message.chatId && row.sender_id === message.senderId &&
            row.direction === message.direction && row.message_text === message.text.slice(0, 4000) &&
            (row.telegram_message_id ?? null) === (message.telegramMessageId ?? null)) return;
      }
    }
    throw new Error(`Supabase message write failed (${response.status}).`);
  }
}

function mapMessageRow(row: Record<string, unknown>): AgentMessage {
  const text = String(row.message_text ?? row.text ?? "");
  return {
    id: Number(row.id),
    updateId: row.update_id ? String(row.update_id) : undefined,
    telegramMessageId: row.telegram_message_id != null ? Number(row.telegram_message_id) : undefined,
    businessConnectionId: String(row.business_connection_id || ""),
    chatId: String(row.chat_id),
    senderId: String(row.sender_id || ""),
    senderName: String(row.sender_name || ""),
    username: String(row.username || ""),
    direction: row.direction === "outgoing" ? "outgoing" : "incoming",
    text,
    createdAt: String(row.created_at || "")
  };
}

export async function listConversationMessages(chatId: string, offset = 0, limit = 100, connectionId?: string): Promise<AgentMessage[]> {
  if (!isPersistentStoreConfigured()) return [];
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const response = await supabaseRequest(
    `agent_messages?select=id,update_id,telegram_message_id,business_connection_id,chat_id,sender_id,sender_name,username,direction,message_text,created_at&chat_id=eq.${encodeURIComponent(chatId)}${connectionId ? "&business_connection_id=eq." + encodeURIComponent(connectionId) : ""}&order=created_at.desc&limit=${safeLimit}&offset=${safeOffset}`
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase conversation read failed (${response.status})${detail ? ": " + detail.slice(0, 180) : ""}`);
  }
  const rows = await response.json() as Array<Record<string, unknown>>;
  return rows.reverse().map(mapMessageRow);
}

/** Permanently remove only the dashboard's stored message copies. This never calls Telegram. */
export async function clearStoredInboxHistory(): Promise<number> {
  if (!isPersistentStoreConfigured()) throw new Error("Supabase persistence is not configured.");
  const response = await supabaseRequest("rpc/clear_agent_message_history", {
    method: "POST", body: "{}"
  });
  if (!response.ok) throw new Error(`Supabase inbox cleanup failed (${response.status}). Apply the conversation metadata migration before cleanup.`);
  const count: unknown = await response.json();
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) throw new Error("Invalid inbox cleanup result.");
  return count;
}

function mapConversationRow(row: Record<string, unknown>): InboxConversation {
  const connectionId = String(row.business_connection_id);
  const chatId = String(row.chat_id);
  return {
    conversationId: conversationId(connectionId, chatId), chatId,
    businessConnectionId: connectionId,
    senderId: String(row.sender_id || ""),
    senderName: String(row.sender_name || row.username || chatId),
    username: String(row.username || ""),
    lastMessage: String(row.message_text || "").slice(0, 280),
    lastMessageAt: String(row.last_message_at),
    lastDirection: row.last_direction === "outgoing" ? "outgoing" : "incoming",
    messageCount: Number(row.message_count || 0)
  };
}

export async function listInbox(): Promise<InboxConversation[]> {
  if (!isPersistentStoreConfigured()) return [];
  const conversations: InboxConversation[] = [];
  // Page metadata, not message history; busy chats cannot hide older destinations.
  for (let offset = 0; ; offset += 500) {
    const response = await supabaseRequest(`agent_inbox?select=*&order=last_message_at.desc,business_connection_id.asc,chat_id.asc&limit=500&offset=${offset}`);
    if (!response.ok) throw new Error(response.status === 404 ? "Inbox metadata is missing. Apply migration 20261104000000_inbox_conversations.sql in Supabase, then refresh." : `Supabase inbox read failed (${response.status}).`);
    const rows = await response.json() as Array<Record<string, unknown>>;
    conversations.push(...rows.map(mapConversationRow));
    if (rows.length < 500) return conversations;
  }
}

/** Exact destination lookup, independent of dashboard pagination and stored history. */
export async function getInboxConversation(connectionId: string, chatId: string): Promise<InboxConversation | null> {
  if (!isPersistentStoreConfigured()) return null;
  const response = await supabaseRequest(`agent_inbox?select=*&business_connection_id=eq.${encodeURIComponent(connectionId)}&chat_id=eq.${encodeURIComponent(chatId)}&limit=1`);
  if (!response.ok) throw new Error(`Supabase conversation lookup failed (${response.status}).`);
  const rows = await response.json() as Array<Record<string, unknown>>;
  return rows[0] ? mapConversationRow(rows[0]) : null;
}

export async function getLastActivityAt(): Promise<string | null> {
  if (!isPersistentStoreConfigured()) {
    return memoryEvents[0]?.createdAt || null;
  }
  const response = await supabaseRequest("agent_events?select=created_at&order=created_at.desc&limit=1");
  if (!response.ok) return null;
  const rows = await response.json() as Array<{ created_at?: string }>;
  return rows[0]?.created_at || null;
}

export type AiRuntimeSettings = {
  provider: "gemini" | "openai";
  model: string;
  fallbackEnabled: boolean;
  updatedAt?: string;
};

const DEFAULT_AI_SETTINGS: AiRuntimeSettings = {
  provider: "gemini",
  model: "gemini-3.5-flash-lite",
  fallbackEnabled: false
};

/** Read shared AI configuration from Supabase; never stores provider API keys. */
export async function getAiRuntimeSettings(): Promise<AiRuntimeSettings> {
  if (!isPersistentStoreConfigured()) return DEFAULT_AI_SETTINGS;
  try {
    const response = await supabaseRequest("agent_ai_settings?select=provider,model,fallback_enabled,updated_at&id=eq.1&limit=1", { signal: operationSignal(15000) });
    if (!response.ok) {
      return {
        ...DEFAULT_AI_SETTINGS,
        provider: (process.env.AI_PROVIDER || "").trim().toLowerCase() === "openai" ? "openai" : "gemini",
        model:
          (process.env.AI_PROVIDER || "").trim().toLowerCase() === "openai"
            ? (process.env.OPENAI_MODEL?.trim() || "gpt-4o")
            : (process.env.GEMINI_MODEL?.trim() || DEFAULT_AI_SETTINGS.model)
      };
    }
    const rows = await response.json() as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) {
      return {
        ...DEFAULT_AI_SETTINGS,
        provider: (process.env.AI_PROVIDER || "").trim().toLowerCase() === "openai" ? "openai" : "gemini",
        model:
          (process.env.AI_PROVIDER || "").trim().toLowerCase() === "openai"
            ? (process.env.OPENAI_MODEL?.trim() || "gpt-4o")
            : (process.env.GEMINI_MODEL?.trim() || DEFAULT_AI_SETTINGS.model)
      };
    }
    const provider = row.provider === "openai" ? "openai" : "gemini";
    const model = typeof row.model === "string" && row.model.trim() ? row.model.trim() : DEFAULT_AI_SETTINGS.model;
    return {
      provider,
      model,
      fallbackEnabled: row.fallback_enabled === true,
      updatedAt: row.updated_at ? String(row.updated_at) : undefined
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

/** Upsert validated non-secret model preferences. */
export async function saveAiRuntimeSettings(settings: AiRuntimeSettings): Promise<AiRuntimeSettings> {
  if (!isPersistentStoreConfigured()) throw new Error("AI model settings require Supabase persistence. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  const response = await supabaseRequest("agent_ai_settings?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      id: 1,
      provider: settings.provider,
      model: settings.model,
      fallback_enabled: settings.fallbackEnabled,
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (/does not exist|relation|404|PGRST/i.test(detail) || response.status === 404) {
      throw new Error("AI settings table or model constraint is missing/outdated. Run the latest migration in supabase/migrations in Supabase SQL Editor.");
    }
    throw new Error("Could not save AI model settings." + (detail ? " " + detail.slice(0, 120) : ""));
  }
  return { ...settings, updatedAt: new Date().toISOString() };
}

/** Additional dashboard-managed owners. Environment owners are never modified. */
export async function listDashboardOwnerIds(): Promise<string[]> {
  const response = await supabaseRequest("agent_owner_ids?select=user_id&order=created_at.asc&limit=500");
  if (!response.ok) throw new Error("Could not load owner IDs. Apply migration 20261103000000_agent_owner_ids.sql.");
  const rows = await response.json() as Array<{ user_id: string }>;
  return rows.map(row => String(row.user_id));
}
export async function addDashboardOwnerId(userId: string): Promise<void> {
  const response = await supabaseRequest("agent_owner_ids", {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId })
  });
  if (!response.ok) throw new Error("Could not add owner ID.");
}
export async function removeDashboardOwnerId(userId: string): Promise<void> {
  const response = await supabaseRequest("agent_owner_ids?user_id=eq." + encodeURIComponent(userId), {
    method: "DELETE", headers: { Prefer: "return=minimal" }
  });
  if (!response.ok) throw new Error("Could not remove owner ID.");
}

