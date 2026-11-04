-- Administrator support inbox access is optional, revocable and read-only.
alter table public.tenant_accounts add column if not exists admin_inbox_access boolean not null default false;
create table if not exists public.tenant_admin_inbox_audit (
 id bigint generated always as identity primary key,
 owner_id text not null references public.tenant_accounts(owner_id) on delete cascade,
 action text not null check (action in ('conversations','messages')),
 accessed_at timestamptz not null default now()
);
alter table public.tenant_admin_inbox_audit enable row level security;
revoke all on public.tenant_admin_inbox_audit from public, anon, authenticated;
grant select, insert on public.tenant_admin_inbox_audit to service_role;
grant usage, select on sequence public.tenant_admin_inbox_audit_id_seq to service_role;
create index if not exists tenant_admin_inbox_audit_owner_idx on public.tenant_admin_inbox_audit(owner_id,accessed_at desc);
