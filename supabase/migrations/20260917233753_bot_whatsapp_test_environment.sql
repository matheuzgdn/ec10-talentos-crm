-- Ambiente de teste real do Gustavo pelo WhatsApp.
-- O telefone autorizado e interceptado antes de entrar no CRM comercial.

create or replace function public.ec10_bot_lab_profile_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id
  from public.profiles profile
  where profile.auth_user_id = (select auth.uid())
    and profile.is_active = true
    and (
      lower(profile.email) = 'matheusgdn94@gmail.com'
      or profile.role in ('admin', 'superadmin')
    )
  limit 1
$$;

revoke all on function public.ec10_bot_lab_profile_id() from public, anon;
grant execute on function public.ec10_bot_lab_profile_id() to authenticated;

alter table public.bot_lab_sessions
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.bot_lab_whatsapp_testers (
  id uuid primary key default gen_random_uuid(),
  profile_id text not null references public.profiles(id) on delete cascade,
  phone text not null,
  display_name text,
  active boolean not null default true,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  last_message_at timestamptz,
  last_result text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bot_lab_whatsapp_testers_phone_format
    check (phone ~ '^[1-9][0-9]{9,14}$'),
  constraint bot_lab_whatsapp_testers_profile_unique unique (profile_id),
  constraint bot_lab_whatsapp_testers_phone_unique unique (phone)
);

create index if not exists bot_lab_whatsapp_testers_active_phone_idx
  on public.bot_lab_whatsapp_testers(phone, active, expires_at);

alter table public.bot_lab_whatsapp_testers enable row level security;

revoke all on table public.bot_lab_whatsapp_testers from anon, authenticated;
grant select, insert, update, delete on table public.bot_lab_whatsapp_testers to authenticated;

drop policy if exists bot_lab_whatsapp_testers_select_own on public.bot_lab_whatsapp_testers;
create policy bot_lab_whatsapp_testers_select_own
on public.bot_lab_whatsapp_testers
for select
to authenticated
using (profile_id = (select public.ec10_bot_lab_profile_id()));

drop policy if exists bot_lab_whatsapp_testers_insert_own on public.bot_lab_whatsapp_testers;
create policy bot_lab_whatsapp_testers_insert_own
on public.bot_lab_whatsapp_testers
for insert
to authenticated
with check (profile_id = (select public.ec10_bot_lab_profile_id()));

drop policy if exists bot_lab_whatsapp_testers_update_own on public.bot_lab_whatsapp_testers;
create policy bot_lab_whatsapp_testers_update_own
on public.bot_lab_whatsapp_testers
for update
to authenticated
using (profile_id = (select public.ec10_bot_lab_profile_id()))
with check (profile_id = (select public.ec10_bot_lab_profile_id()));

drop policy if exists bot_lab_whatsapp_testers_delete_own on public.bot_lab_whatsapp_testers;
create policy bot_lab_whatsapp_testers_delete_own
on public.bot_lab_whatsapp_testers
for delete
to authenticated
using (profile_id = (select public.ec10_bot_lab_profile_id()));

comment on table public.bot_lab_whatsapp_testers is
  'Telefones temporariamente autorizados a conversar com o Gustavo em modo de teste isolado, sem criar lead, reuniao ou automacao comercial.';

notify pgrst, 'reload schema';
