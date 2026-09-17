create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'lead_status') then
    create type public.lead_status as enum (
      'novo',
      'triagem',
      'orcamento',
      'aguardando_cliente',
      'quente',
      'fechado',
      'perdido'
    );
  end if;
end
$$;

create table if not exists public.sellers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text,
  region text not null default 'brasil',
  timezone text not null default 'America/Sao_Paulo',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text,
  status public.lead_status not null default 'novo',
  region text,
  assigned_seller_id uuid references public.sellers(id) on delete set null,
  bot_paused boolean not null default false,
  notes text,
  tags text[] not null default '{}',
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text,
  media_type text not null default 'text',
  media_path text,
  whatsapp_message_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  phone text not null,
  body text,
  media_type text not null default 'text',
  media_path text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'cancelled')),
  error_message text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists public.bot_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trigger text not null,
  response_text text,
  response_audio_path text,
  priority integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists clients_status_idx on public.clients(status);
create index if not exists clients_assigned_seller_idx on public.clients(assigned_seller_id);
create index if not exists messages_client_created_idx on public.messages(client_id, created_at desc);
create index if not exists outbound_status_created_idx on public.outbound_messages(status, created_at asc);

alter table public.sellers enable row level security;
alter table public.clients enable row level security;
alter table public.messages enable row level security;
alter table public.outbound_messages enable row level security;
alter table public.bot_rules enable row level security;

drop policy if exists "authenticated sellers read sellers" on public.sellers;
create policy "authenticated sellers read sellers"
on public.sellers for select
to authenticated
using (true);

drop policy if exists "authenticated sellers read clients" on public.clients;
create policy "authenticated sellers read clients"
on public.clients for select
to authenticated
using (true);

drop policy if exists "authenticated sellers update clients" on public.clients;
create policy "authenticated sellers update clients"
on public.clients for update
to authenticated
using (true)
with check (true);

drop policy if exists "authenticated sellers read messages" on public.messages;
create policy "authenticated sellers read messages"
on public.messages for select
to authenticated
using (true);

drop policy if exists "authenticated sellers insert outbound messages" on public.outbound_messages;
create policy "authenticated sellers insert outbound messages"
on public.outbound_messages for insert
to authenticated
with check (true);

drop policy if exists "authenticated sellers read outbound messages" on public.outbound_messages;
create policy "authenticated sellers read outbound messages"
on public.outbound_messages for select
to authenticated
using (true);

drop policy if exists "authenticated sellers read bot rules" on public.bot_rules;
create policy "authenticated sellers read bot rules"
on public.bot_rules for select
to authenticated
using (true);
