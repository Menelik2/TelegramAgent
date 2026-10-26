import type { AgentPreferences, AgentContact, AgentMemory } from './profile-types.js';
const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
function configured() { return Boolean(base && key); }
async function request(path: string, init: RequestInit = {}) {
  if (!base || !key) throw new Error('Supabase persistence is not configured.');
  return fetch(`${base}/rest/v1/${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
}
export function isProfileStoreConfigured() { return configured(); }
export async function listContacts(): Promise<AgentContact[]> {
  if (!configured()) return [];
  const r = await request('agent_contacts?select=sender_id,enabled,note,updated_at&order=updated_at.desc');
  if (!r.ok) throw new Error('Contact permissions could not be loaded.');
  return (await r.json() as any[]).map(x => ({ senderId: String(x.sender_id), enabled: Boolean(x.enabled), note: String(x.note || ''), updatedAt: String(x.updated_at) }));
}
export async function setContact(c: AgentContact): Promise<void> {
  const r = await request('agent_contacts?on_conflict=sender_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ sender_id: c.senderId, enabled: c.enabled, note: c.note.slice(0, 200), updated_at: new Date().toISOString() }) });
  if (!r.ok) throw new Error('Contact permission could not be saved.');
}
export async function listMemories(): Promise<AgentMemory[]> {
  if (!configured()) return [];
  const r = await request('agent_memories?select=id,memory,category,enabled,created_at&order=created_at.desc&limit=100');
  if (!r.ok) throw new Error('AI memories could not be loaded.');
  return (await r.json() as any[]).map(x => ({ id: Number(x.id), memory: String(x.memory), category: String(x.category), enabled: Boolean(x.enabled), createdAt: String(x.created_at) }));
}
export async function addMemory(memory: string, category = 'preference') {
  const r = await request('agent_memories', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ memory: memory.slice(0, 1000), category: category.slice(0, 64), enabled: true }) });
  if (!r.ok) throw new Error('AI memory could not be saved.');
}
export async function deleteMemory(id: number) {
  const r = await request(`agent_memories?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  if (!r.ok) throw new Error('AI memory could not be deleted.');
}
export async function getPreferences(): Promise<AgentPreferences> {
  const fallback: AgentPreferences = { tone: 'warm, friendly, natural', language: 'match the sender', replyLength: 'concise', memoryEnabled: true };
  if (!configured()) return fallback;
  const r = await request('agent_preferences?select=tone,language,reply_length,memory_enabled&id=eq.1&limit=1');
  if (!r.ok) throw new Error('Agent preferences could not be loaded.');
  const x = (await r.json() as any[])[0];
  return x ? { tone: String(x.tone), language: String(x.language), replyLength: String(x.reply_length), memoryEnabled: Boolean(x.memory_enabled) } : fallback;
}
export async function savePreferences(p: AgentPreferences) {
  const r = await request('agent_preferences?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: 1, tone: p.tone.slice(0, 100), language: p.language.slice(0, 100), reply_length: p.replyLength.slice(0, 40), memory_enabled: p.memoryEnabled, updated_at: new Date().toISOString() }) });
  if (!r.ok) throw new Error('Agent preferences could not be saved.');
}
export async function getEnabledMemories(): Promise<string[]> {
  if (!configured()) return [];
  const r = await request('agent_memories?select=memory&enabled=eq.true&order=created_at.desc&limit=30');
  if (!r.ok) throw new Error('AI memories could not be loaded.');
  return (await r.json() as any[]).map(x => String(x.memory).slice(0, 1000));
}
