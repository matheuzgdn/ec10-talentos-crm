alter table public.clients
  add column if not exists traffic_source text,
  add column if not exists traffic_campaign_id text,
  add column if not exists traffic_campaign_name text,
  add column if not exists traffic_adset_id text,
  add column if not exists traffic_ad_id text,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text,
  add column if not exists fbclid text,
  add column if not exists gclid text,
  add column if not exists attribution_metadata jsonb not null default '{}';

create table if not exists public.traffic_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  phone text,
  event_type text not null,
  channel text not null default 'whatsapp',
  platform text not null default 'meta_ads',
  service_interest text,
  athlete_age integer,
  age_group text,
  lead_status text,
  quality_score integer,
  value numeric(12,2),
  campaign_id text,
  campaign_name text,
  adset_id text,
  ad_id text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  fbclid text,
  gclid text,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists traffic_events_type_time_idx
on public.traffic_events(event_type, occurred_at desc);

create index if not exists traffic_events_client_time_idx
on public.traffic_events(client_id, occurred_at desc);

create index if not exists traffic_events_campaign_idx
on public.traffic_events(campaign_id, adset_id, ad_id);

create table if not exists public.lead_attribution (
  client_id uuid primary key references public.clients(id) on delete cascade,
  phone text,
  source text not null default 'whatsapp',
  platform text not null default 'meta_ads',
  channel text not null default 'whatsapp',
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  fbclid text,
  gclid text,
  landing_url text,
  first_touch_at timestamptz not null default now(),
  last_touch_at timestamptz not null default now(),
  metadata jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.traffic_campaign_snapshots (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'meta_ads',
  account_id text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  status text,
  date_start date not null,
  date_end date not null,
  spend numeric(12,2) not null default 0,
  impressions integer not null default 0,
  reach integer not null default 0,
  clicks integer not null default 0,
  conversations integer not null default 0,
  leads integer not null default 0,
  qualified_leads integer not null default 0,
  proposals integer not null default 0,
  purchases integer not null default 0,
  revenue numeric(12,2) not null default 0,
  ctr numeric(10,4) not null default 0,
  cpc numeric(12,4) not null default 0,
  cpl numeric(12,4) not null default 0,
  cpql numeric(12,4) not null default 0,
  roas numeric(12,4) not null default 0,
  raw_payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists traffic_campaign_snapshots_campaign_date_idx
on public.traffic_campaign_snapshots(campaign_id, date_start desc);

create table if not exists public.traffic_agent_recommendations (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null,
  recommendation_type text not null default 'analysis',
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'pending_approval' check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'applied')),
  confidence integer not null default 60,
  impact_area text not null default 'traffic',
  service_interest text,
  age_group text,
  campaign_id text,
  campaign_name text,
  reasoning text,
  evidence jsonb not null default '{}',
  suggested_action jsonb not null default '{}',
  created_by_agent text not null default 'crm_traffic_ai',
  created_by uuid references public.sellers(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.sellers(id) on delete set null
);

create index if not exists traffic_agent_recommendations_status_idx
on public.traffic_agent_recommendations(status, priority, created_at desc);

create table if not exists public.traffic_campaign_drafts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  objective text not null default 'OUTCOME_LEADS',
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'published', 'rejected', 'failed')),
  platform text not null default 'meta_ads',
  service_interest text not null default 'plano_carreira',
  budget_daily numeric(12,2),
  budget_total numeric(12,2),
  age_min integer,
  age_max integer,
  locations text[] not null default '{}',
  interests text[] not null default '{}',
  placements text[] not null default '{}',
  destination_url text,
  whatsapp_message text,
  copy_text text,
  creative_notes text,
  ai_rationale text,
  meta_payload jsonb not null default '{}',
  meta_campaign_id text,
  meta_adset_id text,
  meta_creative_id text,
  meta_ad_id text,
  publish_error text,
  created_by uuid references public.sellers(id) on delete set null,
  approved_by uuid references public.sellers(id) on delete set null,
  published_by uuid references public.sellers(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists traffic_campaign_drafts_status_idx
on public.traffic_campaign_drafts(status, created_at desc);

alter table public.traffic_events enable row level security;
alter table public.lead_attribution enable row level security;
alter table public.traffic_campaign_snapshots enable row level security;
alter table public.traffic_agent_recommendations enable row level security;
alter table public.traffic_campaign_drafts enable row level security;

drop policy if exists "authenticated sellers read traffic events" on public.traffic_events;
create policy "authenticated sellers read traffic events"
on public.traffic_events for select
to authenticated
using (true);

drop policy if exists "authenticated sellers read lead attribution" on public.lead_attribution;
create policy "authenticated sellers read lead attribution"
on public.lead_attribution for select
to authenticated
using (true);

drop policy if exists "authenticated sellers read traffic campaign snapshots" on public.traffic_campaign_snapshots;
create policy "authenticated sellers read traffic campaign snapshots"
on public.traffic_campaign_snapshots for select
to authenticated
using (true);

drop policy if exists "authenticated sellers read traffic recommendations" on public.traffic_agent_recommendations;
create policy "authenticated sellers read traffic recommendations"
on public.traffic_agent_recommendations for select
to authenticated
using (true);

drop policy if exists "authenticated sellers read traffic campaign drafts" on public.traffic_campaign_drafts;
create policy "authenticated sellers read traffic campaign drafts"
on public.traffic_campaign_drafts for select
to authenticated
using (true);
