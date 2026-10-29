import type { AgentPreferences, AgentContact, AgentMemory } from './profile-types.js';
const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
function configured() { return Boolean(base && key); }
let automationFallback = false;

/** Persist automation state because Vercel functions may be cold-started or run concurrently. */
export async function getAutomationEnabled(): Promise<boolean> {
  if (!configured()) return automationFallback;
  const r = await request('agent_preferences?select=automation_enabled&id=eq.1&limit=1');
  if (!r.ok) throw new Error('Automation state could not be loaded. Apply the latest Supabase migrations.');
  const rows = await r.json() as Array<{ automation_enabled?: boolean }>;
  return rows[0]?.automation_enabled === true;
}

export async function setAutomationEnabled(enabled: boolean): Promise<void> {
  if (!configured()) {
    automationFallback = enabled;
    return;
  }
  const r = await request('agent_preferences?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: 1, automation_enabled: enabled, updated_at: new Date().toISOString() })
  });
  if (!r.ok) throw new Error('Automation state could not be saved. Apply the latest Supabase migrations.');
  automationFallback = enabled;
}
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
  const r = await request('agent_contacts?on_conflict=sender_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ sender_id: c.senderId, enabled: c.enabled, note: (c.note || '').slice(0, 200), updated_at: new Date().toISOString() }) });
  if (!r.ok) throw new Error('Contact permission could not be saved.');
}
export async function listMemories(): Promise<AgentMemory[]> {
  if (!configured()) return [];
  const r = await request('agent_memories?select=id,memory,category,enabled,created_at&order=created_at.desc&limit=100');
  if (!r.ok) throw new Error('AI memories could not be loaded.');
  return (await r.json() as any[]).map(x => ({ id: Number(x.id), memory: String(x.memory || ''), category: String(x.category || 'preference'), enabled: Boolean(x.enabled), createdAt: String(x.created_at || '') }));
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
  const fallback: AgentPreferences = { tone: 'concise, calm, professional', language: 'match the sender; English message → English reply; Amharic → Amharic', replyLength: 'concise', memoryEnabled: true };
  if (!configured()) return fallback;
  const r = await request('agent_preferences?select=tone,language,reply_length,memory_enabled&id=eq.1&limit=1');
  if (!r.ok) throw new Error('Agent preferences could not be loaded.');
  const x = (await r.json() as any[])[0];
  return x ? { tone: String(x.tone || fallback.tone), language: String(x.language || fallback.language), replyLength: String(x.reply_length || fallback.replyLength), memoryEnabled: x.memory_enabled !== false } : fallback;
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

export type MiniMeProfile = { name: string; status: string; personality: string[]; energy: string; values: string[]; words: string; story: string };
export const DEFAULT_MINIME_PROFILE: MiniMeProfile = {
  name: 'Menelik', status: 'Active', personality: ['Warm','Patient','Focused','Caring'], energy: 'Balanced',
  values: ['Quality','Relationships','Creativity'], words: 'I treat everyone like a friend — warm and welcoming, never pushy.', story: ''
};
export async function getMiniMeProfile(): Promise<MiniMeProfile> {
  if (!configured()) throw new Error('MiniMe profile requires Supabase persistence. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  const r = await request('agent_preferences?select=minime_name,minime_status,minime_personality,minime_energy,minime_values,minime_words,minime_story&id=eq.1&limit=1');
  if (!r.ok) throw new Error('MiniMe profile could not be loaded. Apply supabase/migrations/20261029000000_minime_profile.sql.');
  const x = (await r.json() as any[])[0];
  if (!x) return DEFAULT_MINIME_PROFILE;
  return { name: String(x.minime_name || DEFAULT_MINIME_PROFILE.name), status: String(x.minime_status || DEFAULT_MINIME_PROFILE.status),
    personality: Array.isArray(x.minime_personality) ? x.minime_personality.map(String).slice(0,4) : DEFAULT_MINIME_PROFILE.personality,
    energy: String(x.minime_energy || DEFAULT_MINIME_PROFILE.energy),
    values: Array.isArray(x.minime_values) ? x.minime_values.map(String).slice(0,3) : DEFAULT_MINIME_PROFILE.values,
    words: String(x.minime_words || ''), story: String(x.minime_story || '') };
}
export async function saveMiniMeProfile(p: MiniMeProfile): Promise<void> {
  if (!configured()) throw new Error('MiniMe profile requires Supabase persistence. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  const r = await request('agent_preferences?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: 1, minime_name: p.name.slice(0,80), minime_status: p.status, minime_personality: p.personality.slice(0,4),
      minime_energy: p.energy, minime_values: p.values.slice(0,3), minime_words: p.words.slice(0,300), minime_story: p.story.slice(0,1200), updated_at: new Date().toISOString() }) });
  if (!r.ok) throw new Error('MiniMe profile could not be saved. Check that the MiniMe migration has been applied.');
}
