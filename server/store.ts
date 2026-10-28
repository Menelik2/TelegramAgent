const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const memoryEvents: AgentEvent[] = [];
const MAX_MEMORY_EVENTS = 500;

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
  if (!isPersistentStoreConfigured()) return true;
  const response = await supabaseRequest("telegram_updates", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      update_id: updateId,
      payload_hash: updateId.slice(0, 64)
    })
  });
  // Unique violation / conflict → already processed
  if (response.status === 409) return false;
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // If table missing older schema, do not block the webhook forever
    if (response.status === 404 || /does not exist|relation/i.test(body)) return true;
    throw new Error(`Supabase update claim failed (${response.status}).`);
  }
  return true;
}

export async function releaseUpdate(updateId: string): Promise<void> {
  if (!isPersistentStoreConfigured()) return;
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
      // Schema column is message_text (not text)
      message_text: message.text.slice(0, 4000),
      created_at: message.createdAt || new Date().toISOString()
    })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase message write failed (${response.status})${detail ? ": " + detail.slice(0, 200) : ""}`);
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

export async function listConversationMessages(chatId: string): Promise<AgentMessage[]> {
  if (!isPersistentStoreConfigured()) return [];
  const response = await supabaseRequest(
    `agent_messages?select=id,update_id,telegram_message_id,business_connection_id,chat_id,sender_id,sender_name,username,direction,message_text,created_at&chat_id=eq.${encodeURIComponent(chatId)}&order=created_at.asc&limit=200`
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase conversation read failed (${response.status})${detail ? ": " + detail.slice(0, 180) : ""}`);
  }
  const rows = await response.json() as Array<Record<string, unknown>>;
  return rows.map(mapMessageRow);
}

export async function listInbox(): Promise<InboxConversation[]> {
  if (!isPersistentStoreConfigured()) return [];
  const response = await supabaseRequest(
    "agent_messages?select=chat_id,business_connection_id,sender_id,sender_name,username,direction,message_text,created_at&order=created_at.desc&limit=500"
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase inbox read failed (${response.status})${detail ? ": " + detail.slice(0, 180) : ""}`);
  }
  const rows = await response.json() as Array<Record<string, unknown>>;
  const byChat = new Map<string, InboxConversation>();
  for (const row of rows) {
    const chatId = String(row.chat_id || "");
    if (!chatId) continue;
    const text = String(row.message_text ?? row.text ?? "");
    const existing = byChat.get(chatId);
    if (!existing) {
      byChat.set(chatId, {
        chatId,
        businessConnectionId: String(row.business_connection_id || "direct"),
        senderId: String(row.sender_id || ""),
        senderName: String(row.sender_name || row.username || chatId),
        username: String(row.username || ""),
        lastMessage: text.slice(0, 280),
        lastMessageAt: String(row.created_at || ""),
        lastDirection: row.direction === "outgoing" ? "outgoing" : "incoming",
        messageCount: 1
      });
    } else {
      existing.messageCount += 1;
      if (!existing.senderId && row.sender_id) existing.senderId = String(row.sender_id);
      if (row.direction === "incoming" && row.sender_id) {
        existing.senderId = String(row.sender_id);
        if (row.sender_name) existing.senderName = String(row.sender_name);
        if (row.username) existing.username = String(row.username);
      }
    }
  }
  return Array.from(byChat.values()).sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
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
  model: "gemini-2.5-flash-lite",
  fallbackEnabled: true
};

/** Read shared AI configuration from Supabase; never stores provider API keys. */
export async function getAiRuntimeSettings(): Promise<AiRuntimeSettings> {
  if (!isPersistentStoreConfigured()) return DEFAULT_AI_SETTINGS;
  const response = await supabaseRequest("agent_ai_settings?select=provider,model,fallback_enabled,updated_at&id=eq.1&limit=1");
  if (!response.ok) {
    if (response.status === 404) throw new Error("AI settings table is missing. Apply the latest Supabase migration.");
    throw new Error("Could not read AI runtime settings from persistent storage.");
  }
  const rows = await response.json() as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) return DEFAULT_AI_SETTINGS;
  const provider = row.provider === "openai" ? "openai" : "gemini";
  const model = typeof row.model === "string" ? row.model : DEFAULT_AI_SETTINGS.model;
  return {
    provider,
    model,
    fallbackEnabled: row.fallback_enabled === true,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined
  };
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
  if (!response.ok) throw new Error("Could not save AI model settings.");
  return { ...settings, updatedAt: new Date().toISOString() };
}
