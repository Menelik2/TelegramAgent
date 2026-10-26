-- Keep automation state durable across Vercel serverless invocations and cold starts.
alter table public.agent_preferences
  add column if not exists automation_enabled boolean not null default false;

-- Explicitly seed the singleton preferences row with automation disabled.
insert into public.agent_preferences (id, automation_enabled)
values (1, false)
on conflict (id) do nothing;
