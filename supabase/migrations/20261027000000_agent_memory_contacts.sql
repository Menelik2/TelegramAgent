-- Persistent owner-approved contacts, explicit memories, and agent preferences.
create table if not exists public.agent_contacts (
  sender_id text primary key,
  enabled boolean not null default false,
  note text not null default '',
  updated_at timestamptz not null default now()
);
create table if not exists public.agent_memories (
  id bigint generated always as identity primary key,
  memory text not null check (char_length(memory) between 1 and 1000),
  category text not null default 'preference' check (char_length(category) <= 64),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.agent_preferences (
  id integer primary key default 1 check (id = 1),
  tone text not null default 'warm, friendly, natural',
  language text not null default 'match the sender',
  reply_length text not null default 'concise',
  memory_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.agent_contacts enable row level security;
alter table public.agent_memories enable row level security;
alter table public.agent_preferences enable row level security;
revoke all on public.agent_contacts from anon, authenticated;
revoke all on public.agent_memories from anon, authenticated;
revoke all on public.agent_preferences from anon, authenticated;
grant all on public.agent_contacts to service_role;
grant all on public.agent_memories to service_role;
grant all on public.agent_preferences to service_role;
