create table if not exists public.bot_instances (
  id text primary key
    check (id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  label text not null,
  description text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.bot_instances (id, label, description)
values
  ('main', 'WhatsApp principal', 'Numero WhatsApp ja configurado no CRM.'),
  ('mentoria_prime', 'WhatsApp Mentoria Prime', 'Segundo numero dedicado ao bot da Mentoria Esportiva Prime.')
on conflict (id)
do update set
  label = excluded.label,
  description = coalesce(public.bot_instances.description, excluded.description),
  updated_at = now();

alter table public.clients
  add column if not exists bot_instance_id text not null default 'main'
    references public.bot_instances(id);

alter table public.messages
  add column if not exists bot_instance_id text not null default 'main'
    references public.bot_instances(id);

alter table public.outbound_messages
  add column if not exists bot_instance_id text not null default 'main'
    references public.bot_instances(id);

alter table public.bot_conversation_states
  add column if not exists bot_instance_id text not null default 'main'
    references public.bot_instances(id);

alter table public.traffic_events
  add column if not exists bot_instance_id text not null default 'main'
    references public.bot_instances(id);

update public.clients
set bot_instance_id = 'main'
where bot_instance_id is null;

update public.messages
set bot_instance_id = 'main'
where bot_instance_id is null;

update public.outbound_messages
set bot_instance_id = 'main'
where bot_instance_id is null;

update public.bot_conversation_states
set bot_instance_id = 'main'
where bot_instance_id is null;

update public.traffic_events
set bot_instance_id = 'main'
where bot_instance_id is null;

create index if not exists clients_bot_instance_idx
on public.clients(bot_instance_id, updated_at desc);

create index if not exists messages_bot_instance_client_created_idx
on public.messages(bot_instance_id, client_id, created_at desc);

create index if not exists outbound_bot_instance_status_created_idx
on public.outbound_messages(bot_instance_id, status, coalesce(scheduled_at, created_at), created_at);

create index if not exists bot_conversation_states_instance_phone_idx
on public.bot_conversation_states(bot_instance_id, phone);

create index if not exists traffic_events_bot_instance_time_idx
on public.traffic_events(bot_instance_id, occurred_at desc);

alter table public.bot_instances enable row level security;

drop policy if exists "authenticated sellers read bot instances" on public.bot_instances;
create policy "authenticated sellers read bot instances"
on public.bot_instances for select
to authenticated
using (true);

drop policy if exists "public read active bot instances" on public.bot_instances;
create policy "public read active bot instances"
on public.bot_instances for select
to anon
using (active = true);
