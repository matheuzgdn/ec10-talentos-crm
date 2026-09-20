begin;

-- The commercial rota approved for in-chat Plan of Career bookings.
insert into whatsapp_bot.sellers(name,region,timezone,active,role,approved_at)
select 'Ericson','brasil','America/Sao_Paulo',true,'seller',now()
where not exists (
  select 1 from whatsapp_bot.sellers where lower(name)='ericson'
);

create table if not exists whatsapp_bot.ec10_chat_booking_schedule (
  service text not null check (service in ('plano_carreira','plano_internacional','eurocamp')),
  iso_weekday smallint not null check (iso_weekday between 1 and 7),
  local_time time not null,
  seller_id uuid not null references whatsapp_bot.sellers(id) on delete restrict,
  display_name text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key(service,iso_weekday,local_time)
);
alter table whatsapp_bot.ec10_chat_booking_schedule enable row level security;
revoke all on whatsapp_bot.ec10_chat_booking_schedule from public,anon,authenticated;
grant select,insert,update,delete on whatsapp_bot.ec10_chat_booking_schedule to service_role;

with candidates as (
  select s.id,coalesce(p.full_name,s.name) full_name,s.name,s.email
  from whatsapp_bot.sellers s
  left join public.profiles p on p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email)
  where s.active
), rota(iso_weekday,local_time,display_name,seller_id) as (
  values
    (1,'20:00'::time,'Sandro',(
      select id from candidates where lower(full_name) like '%sandro%' or lower(name) like '%sandro%'
      order by (lower(full_name)='sandro') desc limit 1
    )),
    (2,'20:00'::time,'Ericson',(
      select id from candidates where lower(name)='ericson' order by id limit 1
    )),
    (3,'20:00'::time,'Pablo',(
      select id from candidates where lower(full_name)='pablo jardins' or lower(name)='pablo jardins'
        or lower(name)='pablo' order by (lower(full_name)='pablo jardins') desc limit 1
    )),
    (4,'20:00'::time,'Cenoura',(
      select id from candidates where lower(full_name) like 'joao pedro%' or lower(email) like 'cenourinha%'
        or lower(name) like '%cenoura%' order by (lower(full_name) like 'joao pedro%') desc limit 1
    ))
)
insert into whatsapp_bot.ec10_chat_booking_schedule(service,iso_weekday,local_time,seller_id,display_name)
select 'plano_carreira',iso_weekday,local_time,seller_id,display_name from rota where seller_id is not null
on conflict(service,iso_weekday,local_time) do update set
  seller_id=excluded.seller_id,display_name=excluded.display_name,enabled=true,updated_at=now();

-- Make every rota seller visible to the CRM agenda trigger, without changing an
-- already configured personal schedule.
insert into whatsapp_bot.ec10_default_agenda(seller_id,organization_id,services,enabled,replace_on_manual)
select distinct r.seller_id,o.id,array['plano_carreira']::text[],false,false
from whatsapp_bot.ec10_chat_booking_schedule r
cross join public.organizations o
where r.service='plano_carreira' and o.slug='ec10-talentos' and o.status='active'
on conflict(seller_id) do nothing;

create or replace function whatsapp_bot.ec10_chat_booking_options(
  p_service text default 'plano_carreira',
  p_after timestamptz default null
)
returns table(
  seller_id uuid,display_name text,starts_at timestamptz,ends_at timestamptz,
  iso_date text,weekday_label text,date_label text
)
language sql stable security definer set search_path='' as $$
  with dates as (
    select d::date local_date
    from generate_series(
      timezone('America/Sao_Paulo',coalesce(p_after,now()))::date,
      timezone('America/Sao_Paulo',coalesce(p_after,now()))::date+35,
      interval '1 day'
    ) d
  ), available as (
    select s.seller_id,s.display_name,
      (d.local_date+s.local_time) at time zone 'America/Sao_Paulo' starts_at,
      ((d.local_date+s.local_time) at time zone 'America/Sao_Paulo')+interval '1 hour' ends_at,
      d.local_date,s.iso_weekday,
      row_number() over(partition by s.iso_weekday,s.local_time order by d.local_date) occurrence
    from whatsapp_bot.ec10_chat_booking_schedule s
    join dates d on extract(isodow from d.local_date)=s.iso_weekday
    join whatsapp_bot.sellers seller on seller.id=s.seller_id and seller.active
    where s.enabled and s.service=p_service
      and (d.local_date+s.local_time) at time zone 'America/Sao_Paulo'>coalesce(p_after,now())+interval '2 hours'
      and not whatsapp_bot.ec10_crm_time_conflict(
        s.seller_id,(d.local_date+s.local_time) at time zone 'America/Sao_Paulo',
        ((d.local_date+s.local_time) at time zone 'America/Sao_Paulo')+interval '1 hour'
      )
      and not exists (
        select 1 from whatsapp_bot.ec10_bookings b
        where b.seller_id=s.seller_id and b.status='confirmed'
          and b.starts_at<((d.local_date+s.local_time) at time zone 'America/Sao_Paulo')+interval '1 hour'
          and b.ends_at>(d.local_date+s.local_time) at time zone 'America/Sao_Paulo'
      )
  )
  select a.seller_id,a.display_name,a.starts_at,a.ends_at,
    to_char(a.local_date,'YYYY-MM-DD'),
    case a.iso_weekday when 1 then 'Segunda-feira' when 2 then 'Terça-feira'
      when 3 then 'Quarta-feira' when 4 then 'Quinta-feira'
      when 5 then 'Sexta-feira' when 6 then 'Sábado' else 'Domingo' end,
    to_char(a.local_date,'DD/MM')
  from available a where a.occurrence=1 order by a.starts_at limit 4
$$;

revoke all on function whatsapp_bot.ec10_chat_booking_options(text,timestamptz) from public,anon,authenticated;
grant execute on function whatsapp_bot.ec10_chat_booking_options(text,timestamptz) to service_role;

commit;
