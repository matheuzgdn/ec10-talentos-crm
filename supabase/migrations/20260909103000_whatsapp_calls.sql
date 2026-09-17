create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  bot_instance_id text not null default 'main',
  whatsapp_call_id text not null,
  phone text not null,
  direction text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  call_type text not null default 'voice' check (call_type in ('voice', 'video')),
  status text not null default 'received' check (status in ('received', 'missed', 'rejected', 'completed')),
  started_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (bot_instance_id, whatsapp_call_id)
);

create index if not exists whatsapp_calls_client_started_idx
  on public.calls (client_id, started_at desc);

alter table public.calls enable row level security;

drop policy if exists "authenticated sellers read calls" on public.calls;
create policy "authenticated sellers read calls"
on public.calls for select
to authenticated
using (true);

grant select on public.calls to authenticated;
grant all on public.calls to service_role;
