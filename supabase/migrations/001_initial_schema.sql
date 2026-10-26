create extension if not exists pgcrypto;
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.agent_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  automation_enabled boolean not null default false,
  reply_mode text not null default 'allowlist' check (reply_mode in ('off','allowlist','custom')),
  tone text not null default 'warm and friendly',
  language text not null default 'English + Amharic',
  memory_enabled boolean not null default true,
  quiet_hours jsonb not null default '{"enabled":true,"start":"22:00","end":"08:00"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  telegram_user_id text not null,
  display_name text not null default '',
  allowed boolean not null default false,
  custom_tone text,
  created_at timestamptz not null default now(),
  unique(user_id, telegram_user_id)
);
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  telegram_chat_id text not null,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, telegram_chat_id)
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  telegram_message_id text,
  direction text not null check (direction in ('incoming','outgoing')),
  body text not null default '',
  delivery_status text not null default 'received' check (delivery_status in ('received','queued','sent','failed','blocked','escalated')),
  created_at timestamptz not null default now(),
  unique(user_id, telegram_message_id)
);
create table if not exists public.memory_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  category text not null default 'preference',
  approved boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists contacts_owner_allowed_idx on public.contacts(user_id, allowed);
create index if not exists conversations_owner_last_message_idx on public.conversations(user_id, last_message_at desc);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at desc);
create index if not exists memory_owner_approved_idx on public.memory_entries(user_id, approved);
create index if not exists audit_logs_owner_created_idx on public.audit_logs(user_id, created_at desc);
alter table public.profiles enable row level security;
alter table public.agent_settings enable row level security;
alter table public.contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memory_entries enable row level security;
alter table public.audit_logs enable row level security;
create policy "profiles are self-owned" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "agent settings are self-owned" on public.agent_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "contacts are self-owned" on public.contacts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "conversations are self-owned" on public.conversations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "messages are self-owned" on public.messages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "memories are self-owned" on public.memory_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "audit logs are self-owned" on public.audit_logs for select using (auth.uid() = user_id);
