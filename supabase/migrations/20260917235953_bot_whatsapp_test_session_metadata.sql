alter table public.bot_lab_sessions
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.bot_lab_sessions.metadata is
  'Contexto estruturado das simulacoes e dos testes reais isolados do Gustavo.';

notify pgrst, 'reload schema';
