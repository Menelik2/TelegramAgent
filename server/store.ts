import { createHash } from "node:crypto";

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const memoryUpdates = new Set<string>();
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
      ...(init.headers || {})
    }
  });
}

/** Atomically claims an update using a unique DB constraint when Supabase is configured. */
export async function claimUpdate(updateId: string): Promise<boolean> {
  if (!isPersistentStoreConfigured()) {
    if (memoryUpdates.has(updateId)) return false;
    memoryUpdates.add(updateId);
    if (memoryUpdates.size > 10000) memoryUpdates.clear();
    return true;
  }
  const response = await supabaseRequest("telegram_updates?on_conflict=update_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ update_id: updateId, payload_hash: createHash("sha256").update(updateId).digest("hex") })
  });
  if (!response.ok) throw new Error(`Supabase update claim failed (${response.status}).`);
  const rows = await response.json() as unknown[];
  return rows.length > 0;
}

/** Release a claimed update after a known processing/delivery failure so Telegram retries can be handled. */
export async function releaseUpdate(updateId: string): Promise<void> {
  if (!isPersistentStoreConfigured()) {
    memoryUpdates.delete(updateId);
    return;
  }
  const response = await supabaseRequest(`telegram_updates?update_id=eq.${encodeURIComponent(updateId)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
  if (!response.ok) throw new Error(`Supabase update release failed (${response.status}).`);
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
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
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
  senderId?: string;
  senderName: string;
  username: string;
  direction: "incoming" | "outgoing";
  text: string;
  createdAt?: string;
};

export type InboxConversation = {
  chatId: string;
  senderId?: string;
  senderName: string;
  username: string;
  businessConnectionId: string;
  lastMessage: string;
  lastMessageAt: string;
  lastDirection: "incoming" | "outgoing";
  messageCount: number;
};

export async function recordMessage(message: AgentMessage): Promise<void> {
  if (!isPersistentStoreConfigured()) throw new Error("Configure Supabase to store the live inbox.");
  const response = await supabaseRequest("agent_messages", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      update_id: message.updateId || null,
      telegram_message_id: message.telegramMessageId ?? null,
      business_connection_id: message.businessConnectionId,
      chat_id: message.chatId,
      sender_id: message.senderId || null,
      sender_name: message.senderName.slice(0, 160),
      username: message.username.slice(0, 64),
      direction: message.direction,
      message_text: message.text.slice(0, 4096),
      ...(message.createdAt ? { created_at: message.createdAt } : {})
    })
  });
  if (response.status === 409) return;
  if (!response.ok) throw new Error(`Supabase message write failed (${response.status}).`);
}

export async function listInbox(): Promise<InboxConversation[]> {
  if (!isPersistentStoreConfigured()) throw new Error("Configure Supabase to load the live inbox.");
  const response = await supabaseRequest(
    "agent_messages?select=chat_id,sender_id,sender_name,username,business_connection_id,message_text,direction,created_at&order=created_at.desc&limit=2000"
  );
  if (!response.ok) throw new Error(`Supabase inbox read failed (${response.status}).`);
  const rows = await response.json() as Array<Record<string, unknown>>;

  type Acc = InboxConversation & { contactFromIncoming: boolean };
  const grouped = new Map<string, Acc>();

  for (const row of rows) {
    const chatId = String(row.chat_id);
    const direction: "incoming" | "outgoing" = row.direction === "outgoing" ? "outgoing" : "incoming";
    const senderId = row.sender_id ? String(row.sender_id) : undefined;
    const senderName = String(row.sender_name || row.username || chatId);
    const username = String(row.username || "");
    const businessConnectionId = String(row.business_connection_id || "direct");
    const text = String(row.message_text || "");
    const createdAt = String(row.created_at || new Date().toISOString());

    const existing = grouped.get(chatId);
    if (!existing) {
      grouped.set(chatId, {
        chatId,
        senderId,
        senderName,
        username,
        businessConnectionId,
        lastMessage: text,
        lastMessageAt: createdAt,
        lastDirection: direction,
        messageCount: 1,
        contactFromIncoming: direction === "incoming"
      });
      continue;
    }

    existing.messageCount += 1;

    if (direction === "incoming" && !existing.contactFromIncoming) {
      if (senderId) existing.senderId = senderId;
      if (senderName) existing.senderName = senderName;
      if (username) existing.username = username;
      existing.contactFromIncoming = true;
    }

    if (existing.businessConnectionId === "direct" && businessConnectionId !== "direct") {
      existing.businessConnectionId = businessConnectionId;
    }
  }

  return [...grouped.values()]
    .map(({ contactFromIncoming: _c, ...conversation }) => conversation)
    .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : a.lastMessageAt > b.lastMessageAt ? -1 : 0));
}

export async function listConversationMessages(chatId: string): Promise<AgentMessage[]> {
  if (!isPersistentStoreConfigured()) throw new Error("Configure Supabase to load conversation messages.");
  const response = await supabaseRequest(
    "agent_messages?select=id,update_id,telegram_message_id,business_connection_id,chat_id,sender_id,sender_name,username,direction,message_text,created_at&chat_id=eq." +
      encodeURIComponent(chatId) +
      "&order=created_at.asc&limit=400"
  );
  if (!response.ok) throw new Error(`Supabase conversation read failed (${response.status}).`);
  const rows = await response.json() as Array<Record<string, unknown>>;
  return rows.map(row => ({
    id: Number(row.id),
    updateId: row.update_id ? String(row.update_id) : undefined,
    telegramMessageId: row.telegram_message_id == null ? undefined : Number(row.telegram_message_id),
    businessConnectionId: String(row.business_connection_id),
    chatId: String(row.chat_id),
    senderId: row.sender_id ? String(row.sender_id) : undefined,
    senderName: String(row.sender_name || ""),
    username: String(row.username || ""),
    direction: (row.direction === "outgoing" ? "outgoing" : "incoming") as AgentMessage["direction"],
    text: String(row.message_text || ""),
    createdAt: String(row.created_at)
  }));
}

/** Latest event timestamp from persistent activity (survives cold starts). */
export async function getLastActivityAt(): Promise<string | null> {
  if (!isPersistentStoreConfigured()) {
    return memoryEvents[0]?.createdAt || null;
  }
  const response = await supabaseRequest("agent_events?select=created_at&order=created_at.desc&limit=1");
  if (!response.ok) return null;
  const rows = await response.json() as Array<{ created_at?: string }>;
  return rows[0]?.created_at ? String(rows[0].created_at) : null;
}
