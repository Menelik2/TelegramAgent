-- Persist dashboard-selected AI provider/model without storing API keys.
create table if not exists public.agent_ai_settings (
  id integer primary key check (id = 1),
  provider text not null check (provider in ('gemini', 'openai')),
  model text not null,
  fallback_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint agent_ai_settings_model_provider_check check (
    (provider = 'gemini' and model in ('gemini-2.5-flash-lite', 'gemini-2.5-flash'))
    or
    (provider = 'openai' and model in ('gpt-4o-mini', 'gpt-4o'))
  )
);

alter table public.agent_ai_settings enable row level security;

insert into public.agent_ai_settings (id, provider, model, fallback_enabled)
values (1, 'gemini', 'gemini-2.5-flash-lite', true)
on conflict (id) do nothing;

-- Access is server-side only through the Supabase service-role key.
-- Do not create anon/authenticated policies for this table.
