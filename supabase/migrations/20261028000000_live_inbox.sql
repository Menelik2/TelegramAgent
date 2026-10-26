-- Store the real Telegram Business inbox. Message text is private and exposed only via authenticated backend routes.
create table if not exists public.agent_messages (
  id bigint generated always as identity primary key,
  update_id text,
  telegram_message_id bigint,
  business_connection_id text not null,
  chat_id text not null,
  sender_id text,
  sender_name text not null default '',
  username text not null default '',
  direction text not null check (direction in ('incoming','outgoing')),
  message_text text not null check (char_length(message_text) <= 4096),
  created_at timestamptz not null default now()
);
create index if not exists agent_messages_chat_created_idx on public.agent_messages (chat_id, created_at desc);
create index if not exists agent_messages_created_idx on public.agent_messages (created_at desc);
create unique index if not exists agent_messages_update_direction_idx on public.agent_messages (update_id, direction) where update_id is not null;
alter table public.agent_messages enable row level security;
revoke all on public.agent_messages from anon, authenticated;
grant all on public.agent_messages to service_role;
