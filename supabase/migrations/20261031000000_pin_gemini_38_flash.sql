-- Pin the Telegram Agent to Gemini 3.8 Flash only.
alter table public.agent_ai_settings drop constraint if exists agent_ai_settings_model_provider_check;
alter table public.agent_ai_settings add constraint agent_ai_settings_model_provider_check check (
  (provider = 'gemini' and model = 'gemini-3.8-flash')
  or (provider = 'openai' and model in ('gpt-4o-mini', 'gpt-4o'))
);
insert into public.agent_ai_settings (id, provider, model, fallback_enabled)
values (1, 'gemini', 'gemini-3.8-flash', false)
on conflict (id) do update set provider = 'gemini', model = 'gemini-3.8-flash', fallback_enabled = false, updated_at = now();
