create table if not exists public.crm_auth_users (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references public.sellers(id) on delete cascade,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists public.crm_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.crm_auth_users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz
);

create index if not exists crm_auth_users_email_idx on public.crm_auth_users(lower(email));
create index if not exists crm_auth_sessions_user_idx on public.crm_auth_sessions(user_id);
create index if not exists crm_auth_sessions_expires_idx on public.crm_auth_sessions(expires_at);

alter table public.crm_auth_users enable row level security;
alter table public.crm_auth_sessions enable row level security;
