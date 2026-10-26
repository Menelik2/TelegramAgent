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
