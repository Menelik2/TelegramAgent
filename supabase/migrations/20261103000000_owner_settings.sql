-- Dashboard-managed Telegram Business owner IDs. Service-role access only.
create table if not exists public.agent_owner_settings (
  id integer primary key check (id = 1),
  owner_user_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.agent_owner_settings enable row level security;
-- No anon/authenticated policies: the backend uses the Supabase service role.
