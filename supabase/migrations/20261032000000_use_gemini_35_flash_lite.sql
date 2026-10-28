-- Switch runtime AI default to Gemini 3.5 Flash-Lite (higher free quota than full Flash).
alter table public.agent_ai_settings drop constraint if exists agent_ai_settings_model_provider_check;

alter table public.agent_ai_settings add constraint agent_ai_settings_model_provider_check check (
  (provider = 'gemini' and model in ('gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash'))
  or (provider = 'openai' and model in ('gpt-4o-mini', 'gpt-4o'))
);

insert into public.agent_ai_settings (id, provider, model, fallback_enabled)
values (1, 'gemini', 'gemini-3.5-flash-lite', false)
on conflict (id) do update
  set provider = 'gemini',
      model = 'gemini-3.5-flash-lite',
      fallback_enabled = false,
      updated_at = now();
