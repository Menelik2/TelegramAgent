begin;

alter table public.tenant_conversations add column ai_allowed boolean not null default false;
alter table public.tenant_accounts add column manual_inbox boolean not null default false;
-- Records whether this removable text was eligible for AI when it arrived.
alter table public.tenant_messages add column ai_context boolean not null default false;

-- The old account switch did not record consent for individual chats.
update public.tenant_jobs set status = 'cancelled' where status in ('pending','processing');

create function public.tenant_set_chat_ai(p_owner text, p_connection text, p_chat text, p_allowed boolean)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.tenant_conversations c set ai_allowed = p_allowed
  where c.owner_id = p_owner and c.connection_id = p_connection and c.chat_id = p_chat
    and (not p_allowed or exists (
      select 1 from public.tenant_connections b join public.tenant_accounts a using (owner_id)
      where b.id = c.connection_id and b.owner_id = c.owner_id
        and b.enabled and b.can_reply and a.consent_at is not null
    ));
  if not found then return false; end if;

  if not p_allowed then
    update public.tenant_jobs set status = 'cancelled'
    where owner_id = p_owner and connection_id = p_connection and chat_id = p_chat
      and status in ('pending','processing');
  end if;
  return true;
end $$;

-- Used immediately before the provider call. A rapid pause and re-enable
-- cannot revive a cancelled job. The final send still claims processing -> sending.
create function public.tenant_prepare_ai_reply(p_owner text, p_connection text, p_chat text, p_update text, p_limit integer)
returns text language plpgsql set search_path = '' as $$
begin
  -- Match ingest's usage-then-conversation lock order, including after midnight.
  insert into public.tenant_daily_usage(owner_id,day) values(p_owner,current_date)
  on conflict(owner_id,day) do nothing;
  perform 1 from public.tenant_daily_usage where owner_id = p_owner and day = current_date for update;
  if not exists (
    select 1 from public.tenant_jobs j
    join public.tenant_conversations c using (owner_id, connection_id, chat_id)
    join public.tenant_accounts a using (owner_id)
    join public.tenant_connections b on b.id = j.connection_id and b.owner_id = j.owner_id
    where j.update_id = p_update and j.owner_id = p_owner and j.connection_id = p_connection
      and j.chat_id = p_chat and j.status = 'processing' and j.message_id is not null
      and c.ai_allowed and a.enabled and a.consent_at is not null and b.enabled and b.can_reply
    for share of c
  ) then return 'cancelled'; end if;
  -- Reserve quota only for an eligible job, after the last permission check.
  if not public.tenant_budget(p_owner, p_limit) then return 'failed'; end if;
  return 'ready';
end $$;

revoke all on function public.tenant_set_chat_ai(text,text,text,boolean),
  public.tenant_prepare_ai_reply(text,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.tenant_set_chat_ai(text,text,text,boolean),
  public.tenant_prepare_ai_reply(text,text,text,text,integer) to service_role;

create or replace function public.tenant_ingest(p_update text,p_connection text,p_chat text,p_text text,p_telegram bigint)
returns void language plpgsql set search_path = '' as $$
declare
  who text;
  active boolean;
  allowed boolean;
  eligible boolean;
  msg bigint;
begin
  select c.owner_id, a.enabled and a.consent_at is not null into who, active
  from public.tenant_connections c join public.tenant_accounts a using (owner_id)
  where c.id = p_connection and c.enabled and c.can_reply and (a.manual_inbox or a.consent_at is not null);
  if not found then return; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_update,0));
  if exists (select 1 from public.tenant_jobs where update_id = p_update) then return; end if;
  insert into public.tenant_daily_usage as u(owner_id,day,received) values(who,current_date,1)
  on conflict(owner_id,day) do update set received = u.received+1 where u.received < 1000;
  if not found then return; end if;

  -- This upsert locks the same conversation row as tenant_set_chat_ai.
  insert into public.tenant_conversations(owner_id,connection_id,chat_id) values(who,p_connection,p_chat)
  on conflict(owner_id,connection_id,chat_id) do update set last_at = now()
  returning ai_allowed into allowed;
  eligible := active and allowed;
  insert into public.tenant_messages(owner_id,connection_id,chat_id,direction,body,telegram_id,ai_context)
  values(who,p_connection,p_chat,'incoming',p_text,p_telegram,eligible) returning id into msg;
  -- Cancelled rows deduplicate Telegram redelivery without scheduling AI.
  insert into public.tenant_jobs(update_id,owner_id,connection_id,chat_id,message_id,status)
  values(p_update,who,p_connection,p_chat,msg,case when eligible then 'pending' else 'cancelled' end);
end $$;

notify pgrst, 'reload schema';
commit;
