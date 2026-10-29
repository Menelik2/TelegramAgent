-- Persist MiniMe's persona in Supabase so it affects actual Telegram AI replies.
alter table public.agent_preferences
  add column if not exists minime_name text not null default 'Menelik',
  add column if not exists minime_status text not null default 'Active',
  add column if not exists minime_personality text[] not null default array['Warm','Patient','Focused','Caring']::text[],
  add column if not exists minime_energy text not null default 'Balanced',
  add column if not exists minime_values text[] not null default array['Quality','Relationships','Creativity']::text[],
  add column if not exists minime_words text not null default 'I treat everyone like a friend — warm and welcoming, never pushy.',
  add column if not exists minime_story text not null default '';
