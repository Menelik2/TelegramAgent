-- Clear the dashboard inbox completely while leaving Telegram chats untouched.
-- The message count is returned for the dashboard confirmation message.
create or replace function public.clear_agent_message_history() returns bigint
language plpgsql set search_path = '' as $$
declare removed bigint;
begin
  delete from public.agent_messages;
  get diagnostics removed = row_count;
  delete from public.agent_conversations;
  return removed;
end;
$$;
revoke all on function public.clear_agent_message_history() from public, anon, authenticated;
grant execute on function public.clear_agent_message_history() to service_role;
