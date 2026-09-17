alter table public.sellers
  add column if not exists role text not null default 'seller',
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists last_login_at timestamptz;

alter table public.sellers
  drop constraint if exists sellers_role_check;

alter table public.sellers
  add constraint sellers_role_check check (role in ('admin', 'seller'));

alter table public.clients
  add column if not exists service_interest text not null default 'plano_internacional',
  add column if not exists source text not null default 'whatsapp',
  add column if not exists pipeline_order integer not null default 0,
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists lead_score integer not null default 0;

alter table public.clients
  drop constraint if exists clients_service_interest_check;

alter table public.clients
  add constraint clients_service_interest_check
  check (service_interest in ('plano_internacional', 'plano_carreira', 'ambos', 'nao_definido'));

alter table public.clients
  drop constraint if exists clients_source_check;

alter table public.clients
  add constraint clients_source_check check (source in ('whatsapp', 'manual', 'indicacao', 'site'));

alter table public.bot_rules
  add column if not exists once_per_client boolean not null default false,
  add column if not exists cooldown_minutes integer not null default 1440;

update public.bot_rules
set once_per_client = true,
    cooldown_minutes = 1440
where trigger = '*';

create index if not exists sellers_auth_user_idx on public.sellers(auth_user_id);
create index if not exists sellers_active_role_idx on public.sellers(active, role);
create index if not exists clients_service_status_idx on public.clients(service_interest, status);
create index if not exists clients_follow_up_idx on public.clients(next_follow_up_at);
