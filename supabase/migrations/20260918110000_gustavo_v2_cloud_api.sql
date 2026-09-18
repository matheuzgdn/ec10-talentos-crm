begin;

create schema if not exists whatsapp_bot;

create table if not exists whatsapp_bot.meta_webhook_events (
  id bigint generated always as identity primary key,
  event_hash text not null unique,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','done','dead')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists meta_webhook_events_pending_idx
  on whatsapp_bot.meta_webhook_events(status, available_at, id);

create table if not exists whatsapp_bot.gustavo_v2_inbox (
  id bigint generated always as identity primary key,
  meta_message_id text not null unique,
  phone text not null,
  message_type text not null,
  body text,
  raw_message jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','done','dead')),
  due_at timestamptz not null default now() + interval '3 seconds',
  attempts integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists gustavo_v2_inbox_pending_idx
  on whatsapp_bot.gustavo_v2_inbox(status, due_at, phone, id);

create table if not exists whatsapp_bot.gustavo_v2_contacts (
  phone text primary key,
  client_id uuid references whatsapp_bot.clients(id) on delete set null,
  state jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','human','completed','blocked')),
  version text not null default 'gustavo-v2',
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists whatsapp_bot.gustavo_v2_turns (
  id bigint generated always as identity primary key,
  phone text not null references whatsapp_bot.gustavo_v2_contacts(phone) on delete cascade,
  inbound_ids bigint[] not null default '{}',
  inbound_text text,
  response_text text,
  model text,
  latency_ms integer,
  state_before jsonb not null default '{}'::jsonb,
  state_after jsonb not null default '{}'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  status text not null default 'ok',
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists whatsapp_bot.gustavo_v2_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  phone text not null,
  message_type text not null check (message_type in ('text','audio')),
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','delivered','read','failed','dead')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  meta_message_id text unique,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz
);

create index if not exists gustavo_v2_outbox_pending_idx
  on whatsapp_bot.gustavo_v2_outbox(status, available_at, created_at);

alter table whatsapp_bot.meta_webhook_events enable row level security;
alter table whatsapp_bot.gustavo_v2_inbox enable row level security;
alter table whatsapp_bot.gustavo_v2_contacts enable row level security;
alter table whatsapp_bot.gustavo_v2_turns enable row level security;
alter table whatsapp_bot.gustavo_v2_outbox enable row level security;

revoke all on whatsapp_bot.meta_webhook_events from public, anon, authenticated;
revoke all on whatsapp_bot.gustavo_v2_inbox from public, anon, authenticated;
revoke all on whatsapp_bot.gustavo_v2_contacts from public, anon, authenticated;
revoke all on whatsapp_bot.gustavo_v2_turns from public, anon, authenticated;
revoke all on whatsapp_bot.gustavo_v2_outbox from public, anon, authenticated;

grant select, insert, update, delete on whatsapp_bot.meta_webhook_events to service_role;
grant select, insert, update, delete on whatsapp_bot.gustavo_v2_inbox to service_role;
grant select, insert, update, delete on whatsapp_bot.gustavo_v2_contacts to service_role;
grant select, insert, update, delete on whatsapp_bot.gustavo_v2_turns to service_role;
grant select, insert, update, delete on whatsapp_bot.gustavo_v2_outbox to service_role;
grant usage, select on all sequences in schema whatsapp_bot to service_role;

notify pgrst, 'reload schema';
commit;
