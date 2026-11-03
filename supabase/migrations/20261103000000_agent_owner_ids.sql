-- Additional authorized Telegram owners managed from the dashboard.
-- Environment variable owners remain configured separately.
create table if not exists public.agent_owner_ids (
  user_id text primary key check (user_id ~ '^[1-9][0-9]{0,19}$'),
  created_at timestamptz not null default now()
);
alter table public.agent_owner_ids enable row level security;
revoke all on public.agent_owner_ids from anon, authenticated;
