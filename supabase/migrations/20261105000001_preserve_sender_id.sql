-- Keep contact sender_id stable when the latest message is outgoing or has empty sender_id.
create or replace function public.remember_agent_conversation() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into public.agent_conversations as c
    (business_connection_id, chat_id, sender_id, last_message_at, last_direction)
  values (
    new.business_connection_id,
    new.chat_id,
    coalesce(nullif(new.sender_id, ''), new.chat_id),
    new.created_at,
    new.direction
  )
  on conflict (business_connection_id, chat_id) do update
    set sender_id = case
          when excluded.sender_id is not null and excluded.sender_id <> '' then excluded.sender_id
          else c.sender_id
        end,
        last_message_at = excluded.last_message_at,
        last_direction = excluded.last_direction
    where excluded.last_message_at >= c.last_message_at;
  return new;
end;
$$;

-- Backfill empty sender_id from private chat_id (chat_id == user id).
update public.agent_conversations
set sender_id = chat_id
where (sender_id is null or sender_id = '')
  and chat_id ~ '^-?[0-9]{5,22}$';
