create table if not exists whatsapp_bot.ec10_booking_slots (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references whatsapp_bot.sellers(id) on delete cascade,
  service text not null check (service in ('plano_carreira', 'plano_internacional', 'eurocamp')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (seller_id, starts_at)
);

create table if not exists whatsapp_bot.ec10_bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique references whatsapp_bot.ec10_booking_slots(id) on delete restrict,
  client_id uuid not null references whatsapp_bot.clients(id) on delete restrict,
  seller_id uuid not null references whatsapp_bot.sellers(id) on delete restrict,
  service text not null check (service in ('plano_carreira', 'plano_internacional', 'eurocamp')),
  contact_name text not null,
  contact_role text not null check (contact_role in ('atleta', 'responsavel')),
  athlete_age integer not null check (athlete_age between 8 and 25),
  phone text not null,
  access_token_hash text not null unique,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists ec10_booking_slots_service_time_idx on whatsapp_bot.ec10_booking_slots(service, starts_at);
create index if not exists ec10_bookings_seller_time_idx on whatsapp_bot.ec10_bookings(seller_id, starts_at);
create index if not exists ec10_bookings_phone_time_idx on whatsapp_bot.ec10_bookings(phone, starts_at);

alter table whatsapp_bot.ec10_booking_slots enable row level security;
alter table whatsapp_bot.ec10_bookings enable row level security;
