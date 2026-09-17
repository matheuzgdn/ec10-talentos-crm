begin;
create table if not exists whatsapp_bot.ec10_bot_booking_links (
  access_token_hash text primary key,
  client_id uuid not null references whatsapp_bot.clients(id) on delete cascade,
  service text not null check(service in ('plano_carreira','plano_internacional','eurocamp')),
  contact_name text not null,
  contact_role text not null check(contact_role in ('responsavel','atleta')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '7 days'
);
create index if not exists ec10_bot_booking_links_client_idx on whatsapp_bot.ec10_bot_booking_links(client_id);
alter table whatsapp_bot.ec10_bot_booking_links enable row level security;
revoke all on whatsapp_bot.ec10_bot_booking_links from public, anon, authenticated;
grant select,insert,update,delete on whatsapp_bot.ec10_bot_booking_links to service_role;
notify pgrst,'reload schema';
commit;
