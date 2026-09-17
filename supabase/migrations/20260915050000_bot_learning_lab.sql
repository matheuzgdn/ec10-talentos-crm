create table if not exists public.bot_lab_sessions (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.sellers(id) on delete cascade,
  name text not null default 'Nova simulacao',
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  current_stage text not null default 'awaiting_age',
  athlete_age integer check (athlete_age is null or athlete_age between 1 and 99),
  speaker_role text not null default 'responsavel' check (speaker_role in ('responsavel', 'atleta', 'outro')),
  service_interest text,
  system_version text not null default 'eric-audios-2026-09-14-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_lab_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.bot_lab_sessions(id) on delete cascade,
  direction text not null check (direction in ('user', 'assistant')),
  body text not null,
  stage text not null,
  audio_paths text[] not null default '{}',
  would_schedule boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.bot_training_examples (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.bot_lab_sessions(id) on delete set null,
  assistant_message_id uuid unique references public.bot_lab_messages(id) on delete set null,
  reviewed_by uuid not null references public.sellers(id) on delete cascade,
  stage text not null,
  athlete_age integer,
  speaker_role text,
  user_message text not null,
  assistant_response text not null,
  corrected_response text,
  rating text not null check (rating in ('approved', 'corrected', 'rejected')),
  source_version text not null default 'eric-audios-2026-09-14-v1',
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bot_lab_sessions_created_by_updated_idx
  on public.bot_lab_sessions(created_by, updated_at desc);
create index if not exists bot_lab_messages_session_created_idx
  on public.bot_lab_messages(session_id, created_at);
create index if not exists bot_training_examples_lookup_idx
  on public.bot_training_examples(rating, stage, athlete_age, updated_at desc);

comment on table public.bot_lab_sessions is 'Simulacoes isoladas do bot; nunca disparam WhatsApp, funil ou agenda.';
comment on table public.bot_training_examples is 'Exemplos supervisionados. Apenas approved/corrected podem orientar respostas futuras.';
