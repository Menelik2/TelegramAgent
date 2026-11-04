begin;
create table public.tenant_accounts (
  owner_id text primary key check (owner_id ~ '^[1-9][0-9]{0,19}$'),
  enabled boolean not null default false,
  consent_at timestamptz,
  tone text not null default 'friendly, respectful, concise' check (length(tone) <= 160),
  language text not null default 'match the sender' check (length(language) <= 80),
  created_at timestamptz not null default now()
);
create table public.tenant_connections (
  id text primary key,
  owner_id text not null references public.tenant_accounts(owner_id),
  enabled boolean not null,
  can_reply boolean not null,
  unique(owner_id,id)
);
create table public.tenant_conversations (
  owner_id text not null,
  connection_id text not null,
  chat_id text not null,
  last_at timestamptz not null default now(),
  primary key(owner_id,connection_id,chat_id),
  foreign key(owner_id,connection_id) references public.tenant_connections(owner_id,id)
);
create table public.tenant_messages (
  id bigint generated always as identity primary key,
  owner_id text not null,
  connection_id text not null,
  chat_id text not null,
  direction text not null check (direction in ('incoming','outgoing')),
  body text not null check (length(body) <= 4096),
  telegram_id bigint,
  created_at timestamptz not null default now(),
  foreign key(owner_id,connection_id,chat_id) references public.tenant_conversations(owner_id,connection_id,chat_id)
);
create index tenant_messages_thread on public.tenant_messages(owner_id,connection_id,chat_id,created_at desc);
create table public.tenant_jobs (
  update_id text primary key,
  owner_id text not null,
  connection_id text not null,
  chat_id text not null,
  message_id bigint references public.tenant_messages(id) on delete set null,
  status text not null default 'pending' check(status in ('pending','processing','sending','sent','cancelled','failed','uncertain')),
  created_at timestamptz not null default now(),
  locked_at timestamptz,
  available_at timestamptz not null default (now()+interval '10 seconds'),
  foreign key(owner_id,connection_id,chat_id) references public.tenant_conversations(owner_id,connection_id,chat_id)
);
create index tenant_jobs_queue on public.tenant_jobs(status,created_at);
create table public.tenant_control_updates (update_id text primary key, owner_id text not null, created_at timestamptz not null default now());
create table public.tenant_daily_usage (
  owner_id text not null references public.tenant_accounts(owner_id),
  day date not null default current_date,
  used integer not null default 0,
  received integer not null default 0,
  primary key(owner_id,day)
);
-- Browser clients have no direct table or RPC access. Every backend operation uses
-- an owner verified from Telegram, with explicit owner filters and composite FKs.
do $$ declare t text; begin
  foreach t in array array['tenant_accounts','tenant_connections','tenant_conversations','tenant_messages','tenant_jobs','tenant_daily_usage','tenant_control_updates'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
grant usage, select on sequence public.tenant_messages_id_seq to service_role;

create function public.tenant_connect(p_owner text, p_connection text, p_enabled boolean, p_reply boolean)
returns void language plpgsql set search_path='' as $$
begin
  insert into public.tenant_accounts(owner_id) values(p_owner) on conflict do nothing;
  insert into public.tenant_connections as c(id,owner_id,enabled,can_reply) values(p_connection,p_owner,p_enabled,p_reply)
  on conflict(id) do update set enabled=excluded.enabled, can_reply=excluded.can_reply where c.owner_id=excluded.owner_id;
  if not found then raise exception 'Connection ownership mismatch'; end if;
  if not p_enabled or not p_reply then
    update public.tenant_jobs set status='cancelled' where owner_id=p_owner and connection_id=p_connection and status in ('pending','processing');
  end if;
end $$;

create function public.tenant_ingest(p_update text,p_connection text,p_chat text,p_text text,p_telegram bigint)
returns void language plpgsql set search_path='' as $$
declare who text; msg bigint; active boolean; received_count integer;
begin
  select c.owner_id,a.enabled into who,active from public.tenant_connections c join public.tenant_accounts a using(owner_id)
  where c.id=p_connection and c.enabled and c.can_reply and a.consent_at is not null;
  if who is null then return; end if;
  -- Serialize duplicate deliveries before creating any history copies.
  perform pg_advisory_xact_lock(hashtextextended(p_update,0));
  if exists(select 1 from public.tenant_jobs where update_id=p_update) then return; end if;
  insert into public.tenant_daily_usage as u(owner_id,day,received) values(who,current_date,1)
  on conflict(owner_id,day) do update set received=u.received+1 where u.received < 1000 returning received into received_count;
  if received_count is null then return; end if;
  insert into public.tenant_conversations(owner_id,connection_id,chat_id) values(who,p_connection,p_chat)
  on conflict(owner_id,connection_id,chat_id) do update set last_at=now();
  insert into public.tenant_messages(owner_id,connection_id,chat_id,direction,body,telegram_id)
  values(who,p_connection,p_chat,'incoming',p_text,p_telegram) returning id into msg;
  insert into public.tenant_jobs(update_id,owner_id,connection_id,chat_id,message_id,status)
  values(p_update,who,p_connection,p_chat,msg,case when active then 'pending' else 'cancelled' end);
end $$;

create function public.tenant_claim_job() returns setof public.tenant_jobs
language plpgsql set search_path='' as $$
declare job public.tenant_jobs;
begin
  update public.tenant_jobs set status='cancelled' where status='pending' and created_at < now()-interval '24 hours';
  -- Do not blindly resend after worker crashes: a send may already have succeeded.
  update public.tenant_jobs set status='uncertain' where status in ('processing','sending') and locked_at < now()-interval '5 minutes';
  select j.* into job from public.tenant_jobs j
  where j.status='pending' and j.available_at <= now() and not exists (
    select 1 from public.tenant_jobs older where older.connection_id=j.connection_id and older.chat_id=j.chat_id
    and older.status in ('pending','processing','sending','uncertain') and (older.created_at,older.update_id)<(j.created_at,j.update_id)
  ) order by j.created_at,j.update_id for update skip locked limit 1;
  if not found then return; end if;
  return query update public.tenant_jobs set status='processing',locked_at=now() where update_id=job.update_id returning *;
end $$;
create function public.tenant_budget(p_owner text,p_limit integer) returns boolean
language plpgsql set search_path='' as $$
declare n integer;
begin
  insert into public.tenant_daily_usage as u(owner_id,day,used) values(p_owner,current_date,1)
  on conflict(owner_id,day) do update set used=u.used+1 where u.used < greatest(1,least(p_limit,10000)) returning used into n;
  return n is not null;
end $$;
create function public.tenant_clear_history(p_owner text) returns bigint
language plpgsql set search_path='' as $$
declare n bigint;
begin
  update public.tenant_jobs set status='cancelled' where owner_id=p_owner and status in ('pending','processing');
  delete from public.tenant_messages where owner_id=p_owner;
  get diagnostics n = row_count;
  return n;
end $$;
create function public.tenant_register(p_owner text) returns void language sql set search_path='' as $$
  insert into public.tenant_accounts(owner_id) values(p_owner) on conflict do nothing;
$$;
revoke all on function public.tenant_register(text) from public,anon,authenticated;
grant execute on function public.tenant_register(text) to service_role;
create function public.tenant_control_claim(p_update text,p_owner text) returns boolean language plpgsql set search_path='' as $$
begin
  insert into public.tenant_control_updates(update_id,owner_id) values(p_update,p_owner) on conflict do nothing;
  return found;
end $$;
revoke all on function public.tenant_control_claim(text,text) from public,anon,authenticated;
grant execute on function public.tenant_control_claim(text,text) to service_role;
create index tenant_history_retention on public.tenant_messages(created_at);
create function public.tenant_retention() returns void language plpgsql set search_path='' as $$
begin
  update public.tenant_jobs set status='cancelled' where created_at < now()-interval '7 days' and status in ('pending','processing','uncertain');
  delete from public.tenant_messages where created_at < now()-interval '7 days';
  delete from public.tenant_jobs where created_at < now()-interval '7 days' and status in ('sent','cancelled','failed');
  delete from public.tenant_control_updates where created_at < now()-interval '7 days';
  delete from public.tenant_daily_usage where day < current_date-30;
end $$;
revoke all on function public.tenant_retention() from public,anon,authenticated;
grant execute on function public.tenant_retention() to service_role;
-- Restrict all newly defined functions, including the queue and cleanup, to backend.
revoke all on function public.tenant_connect(text,text,boolean,boolean), public.tenant_ingest(text,text,text,text,bigint), public.tenant_claim_job(), public.tenant_budget(text,integer), public.tenant_clear_history(text) from public,anon,authenticated;
grant execute on function public.tenant_connect(text,text,boolean,boolean), public.tenant_ingest(text,text,text,text,bigint), public.tenant_claim_job(), public.tenant_budget(text,integer), public.tenant_clear_history(text) to service_role;
commit;
