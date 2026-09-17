alter table public.outbound_messages
  add column if not exists scheduled_at timestamptz;

create index if not exists outbound_status_scheduled_idx
on public.outbound_messages(status, scheduled_at, created_at);
