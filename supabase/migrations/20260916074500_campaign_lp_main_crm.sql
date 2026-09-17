begin;
create table if not exists whatsapp_bot.ec10_campaign_registrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  client_id uuid not null references whatsapp_bot.clients(id),
  crm_lead_id text not null references public.leads(id),
  event_id text not null unique,
  access_token_hash text not null unique,
  product_id text not null check (product_id in ('carreira','kids','juvenil','temporada')),
  contact_role text not null check (contact_role in ('responsavel','atleta')),
  contact_email text not null,
  country_code text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  capi_accepted_at timestamptz
);
alter table whatsapp_bot.ec10_campaign_registrations enable row level security;
revoke all on whatsapp_bot.ec10_campaign_registrations from anon, authenticated;
grant select, insert, update on whatsapp_bot.ec10_campaign_registrations to service_role;
create index if not exists campaign_registrations_client_idx
  on whatsapp_bot.ec10_campaign_registrations (client_id, created_at desc);
commit;
