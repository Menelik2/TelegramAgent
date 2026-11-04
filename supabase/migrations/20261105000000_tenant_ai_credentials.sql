-- Per-account encrypted Gemini keys. Only server-side service-role queries can access these rows.
create table if not exists public.tenant_ai_credentials (
  owner_id text primary key references public.tenant_accounts(owner_id) on delete cascade,
  model text not null default 'gemini-3.5-flash-lite' check (model = 'gemini-3.5-flash-lite'),
  secret_ciphertext text not null,
  updated_at timestamptz not null default now()
);
alter table public.tenant_ai_credentials enable row level security;
revoke all on public.tenant_ai_credentials from anon, authenticated;
-- No public RLS policies. Service role bypasses RLS only on the server.
