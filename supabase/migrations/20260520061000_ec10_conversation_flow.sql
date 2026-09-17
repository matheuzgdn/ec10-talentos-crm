create table if not exists public.bot_conversation_states (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  phone text not null unique,
  stage text not null default 'awaiting_interest'
    check (stage in ('awaiting_interest', 'awaiting_role', 'awaiting_age', 'completed')),
  role_answer text,
  athlete_age integer,
  age_group text check (age_group is null or age_group in ('8-13', '14-17', '18-plus')),
  service_interest text check (
    service_interest is null
    or service_interest in ('plano_internacional', 'plano_carreira', 'ambos', 'nao_definido')
  ),
  lead_page_url text,
  completed_at timestamptz,
  metadata jsonb not null default '{}',
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bot_conversation_states_client_idx
on public.bot_conversation_states(client_id);

create index if not exists bot_conversation_states_stage_idx
on public.bot_conversation_states(stage, updated_at desc);

alter table public.bot_conversation_states enable row level security;

drop policy if exists "authenticated sellers read bot conversation states"
on public.bot_conversation_states;

create policy "authenticated sellers read bot conversation states"
on public.bot_conversation_states for select
to authenticated
using (true);

drop policy if exists "authenticated sellers update bot conversation states"
on public.bot_conversation_states;

create policy "authenticated sellers update bot conversation states"
on public.bot_conversation_states for update
to authenticated
using (true)
with check (true);

update public.bot_rules
set active = false
where name = 'Boas-vindas inicial'
  and trigger = '*';
