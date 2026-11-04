begin;
-- Serialize migration/backfill with writes. No messages are deleted by this migration.
lock table public.agent_messages in share row exclusive mode;
create table public.agent_conversations (
  business_connection_id text not null,
  chat_id text not null,
  sender_id text not null default '',
  last_message_at timestamptz not null,
  last_direction text not null check (last_direction in ('incoming', 'outgoing')),
  primary key (business_connection_id, chat_id)
);
alter table public.agent_conversations enable row level security;
revoke all on public.agent_conversations from anon, authenticated;
grant all on public.agent_conversations to service_role;

-- No names, usernames, previews, message IDs, or authorization flags are retained.
insert into public.agent_conversations
select distinct on (business_connection_id, chat_id)
  business_connection_id, chat_id, coalesce(sender_id, ''), created_at, direction
from public.agent_messages
order by business_connection_id, chat_id, created_at desc, id desc;

create function public.remember_agent_conversation() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into public.agent_conversations as c
    (business_connection_id, chat_id, sender_id, last_message_at, last_direction)
  values (new.business_connection_id, new.chat_id, coalesce(new.sender_id, ''), new.created_at, new.direction)
  on conflict (business_connection_id, chat_id) do update
    set sender_id = excluded.sender_id,
        last_message_at = excluded.last_message_at,
        last_direction = excluded.last_direction
    where excluded.last_message_at >= c.last_message_at;
  return new;
end;
$$;
revoke all on function public.remember_agent_conversation() from public, anon, authenticated;
create trigger agent_message_remember_conversation after insert on public.agent_messages
for each row execute function public.remember_agent_conversation();

create index agent_messages_destination_created_idx
on public.agent_messages (business_connection_id, chat_id, created_at desc, id desc);
create view public.agent_inbox with (security_invoker = true) as
select c.*, coalesce(m.sender_name, '') as sender_name,
  coalesce(m.username, '') as username, coalesce(m.message_text, '') as message_text,
  (select count(*) from public.agent_messages h
   where h.business_connection_id = c.business_connection_id and h.chat_id = c.chat_id) as message_count
from public.agent_conversations c
left join lateral (
  select sender_name, username, message_text from public.agent_messages h
  where h.business_connection_id = c.business_connection_id and h.chat_id = c.chat_id
  order by created_at desc, id desc limit 1
) m on true;
revoke all on public.agent_inbox from public, anon, authenticated;
grant select on public.agent_inbox to service_role;

-- A single transaction returns the actual count without returning deleted content/IDs.
-- Concurrent inserts retain metadata atomically via the trigger, even during cleanup.
create function public.clear_agent_message_history() returns bigint
language plpgsql set search_path = '' as $$
declare removed bigint;
begin
  delete from public.agent_messages;
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.clear_agent_message_history() from public, anon, authenticated;
grant execute on function public.clear_agent_message_history() to service_role;
commit;
