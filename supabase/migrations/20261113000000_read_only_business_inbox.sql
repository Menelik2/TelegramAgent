begin;

-- A connected Business bot may be permitted to read selected incoming chats
-- without Telegram granting send permission. Owner-opted-in inbox storage
-- must remain available in that case; AI replies must still be disabled.
create or replace function public.tenant_ingest(
  p_update text, p_connection text, p_chat text, p_text text, p_telegram bigint
)
returns void language plpgsql set search_path = '' as $$
declare
  who text;
  active boolean;
  reply_allowed boolean;
  allowed boolean;
  eligible boolean;
  msg bigint;
begin
  select c.owner_id, a.enabled and a.consent_at is not null, c.can_reply
    into who, active, reply_allowed
  from public.tenant_connections c
  join public.tenant_accounts a using (owner_id)
  where c.id = p_connection and c.enabled
    and (a.manual_inbox or a.consent_at is not null);
  if not found then return; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_update,0));
  if exists (select 1 from public.tenant_jobs where update_id = p_update) then return; end if;

  insert into public.tenant_daily_usage as u(owner_id,day,received)
    values(who,current_date,1)
  on conflict(owner_id,day)
    do update set received = u.received + 1 where u.received < 1000;
  if not found then return; end if;

  insert into public.tenant_conversations(owner_id,connection_id,chat_id)
    values(who,p_connection,p_chat)
  on conflict(owner_id,connection_id,chat_id)
    do update set last_at = now()
  returning ai_allowed into allowed;

  -- Never queue a reply for a read-only connection or a non-text media marker.
  eligible := active and allowed and reply_allowed
    and left(p_text, 8) <> '[Media] ';
  insert into public.tenant_messages(
    owner_id,connection_id,chat_id,direction,body,telegram_id,ai_context
  )
    values(who,p_connection,p_chat,'incoming',p_text,p_telegram,eligible)
  returning id into msg;

  -- Cancelled jobs preserve Telegram update deduplication for manual-only chats.
  insert into public.tenant_jobs(update_id,owner_id,connection_id,chat_id,message_id,status)
    values(p_update,who,p_connection,p_chat,msg,
           case when eligible then 'pending' else 'cancelled' end);
end $$;

revoke all on function public.tenant_ingest(text,text,text,text,bigint)
  from public, anon, authenticated;
grant execute on function public.tenant_ingest(text,text,text,text,bigint)
  to service_role;

notify pgrst, 'reload schema';
commit;
