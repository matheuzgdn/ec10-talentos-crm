alter table public.traffic_campaign_drafts
  add column if not exists meta_campaign_id text,
  add column if not exists meta_adset_id text,
  add column if not exists meta_creative_id text,
  add column if not exists meta_ad_id text,
  add column if not exists publish_error text,
  add column if not exists published_by uuid references public.sellers(id) on delete set null;

