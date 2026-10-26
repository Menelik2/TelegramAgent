-- TelegramAgent persistence: apply in Supabase SQL editor or migrations workflow.
-- Service-role credentials must remain server-side only.
create table if not exists public.telegram_updates (
  update_id text primary key,
  payload_hash text not null,
  received_at timestamptz not null default now()
);

create table if not exists public.agent_events (
  id bigint generated always as identity primary key,
  kind text not null check (char_length(kind) <= 64),
  update_id text,
  sender_id text,
  chat_id text,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists agent_events_created_at_idx on public.agent_events (created_at desc);
create index if not exists agent_events_sender_id_idx on public.agent_events (sender_id);

alter table public.telegram_updates enable row level security;
alter table public.agent_events enable row level security;

-- No anon/authenticated policies are intentionally created. Backend uses service role.
revoke all on public.telegram_updates from anon, authenticated;
revoke all on public.agent_events from anon, authenticated;
grant all on public.telegram_updates to service_role;
grant all on public.agent_events to service_role;
