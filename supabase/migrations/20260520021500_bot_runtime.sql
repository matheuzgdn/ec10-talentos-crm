create table if not exists public.bot_runtime (
  key text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.bot_runtime enable row level security;

drop policy if exists "public read bot runtime" on public.bot_runtime;
create policy "public read bot runtime"
on public.bot_runtime for select
to anon, authenticated
using (true);
