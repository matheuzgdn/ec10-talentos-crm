begin;

-- A rota comercial é explícita e separada da linguagem do modelo. Assim a IA
-- não consegue inventar vendedor, dia ou horário.
create table if not exists whatsapp_bot.ec10_chat_booking_routes (
  route_key text not null check (route_key in ('es','international','career')),
  iso_weekday smallint not null check (iso_weekday between 1 and 7),
  local_time time not null default '20:00',
  seller_id uuid not null references whatsapp_bot.sellers(id) on delete restrict,
  display_name text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key(route_key,iso_weekday,local_time)
);

alter table whatsapp_bot.ec10_chat_booking_routes enable row level security;
revoke all on whatsapp_bot.ec10_chat_booking_routes from public,anon,authenticated;
grant select,insert,update,delete on whatsapp_bot.ec10_chat_booking_routes to service_role;

with selected(route_key,display_name,seller_id) as (
  values
    ('es','Augustin',(select id from whatsapp_bot.sellers where active and lower(name)='augustin' order by created_at limit 1)),
    ('international','Pablo',(select id from whatsapp_bot.sellers where active and lower(name) in ('pablo','pablo jardins','pablo1998.jardins') order by (lower(name)='pablo') desc,created_at limit 1)),
    ('career','Igor Jardins',(select id from whatsapp_bot.sellers where active and lower(name) like 'igor%' order by created_at limit 1))
), weekdays as (select generate_series(1,7)::smallint iso_weekday)
insert into whatsapp_bot.ec10_chat_booking_routes(route_key,iso_weekday,local_time,seller_id,display_name)
select s.route_key,w.iso_weekday,'20:00'::time,s.seller_id,s.display_name
from selected s cross join weekdays w where s.seller_id is not null
on conflict(route_key,iso_weekday,local_time) do update set
  seller_id=excluded.seller_id,display_name=excluded.display_name,enabled=true,updated_at=now();

do $$ begin
  if (select count(distinct route_key) from whatsapp_bot.ec10_chat_booking_routes where enabled)<3 then
    raise exception 'EC10 routed booking requires active Augustin, Pablo and Igor sellers';
  end if;
end $$;

insert into whatsapp_bot.ec10_default_agenda(seller_id,organization_id,services,enabled,replace_on_manual)
select distinct r.seller_id,o.id,array['plano_carreira','plano_internacional','eurocamp']::text[],false,false
from whatsapp_bot.ec10_chat_booking_routes r cross join public.organizations o
where r.enabled and o.slug='ec10-talentos' and o.status='active'
on conflict(seller_id) do update set services=excluded.services;

create or replace function whatsapp_bot.ec10_chat_booking_options_routed(
  p_service text,
  p_route_key text,
  p_after timestamptz default null
)
returns table(
  seller_id uuid,display_name text,route_key text,service text,
  starts_at timestamptz,ends_at timestamptz,iso_date text,weekday_label text,date_label text
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
    select r.seller_id,r.display_name,r.route_key,p_service service,
      (d.local_date+r.local_time) at time zone 'America/Sao_Paulo' starts_at,
      ((d.local_date+r.local_time) at time zone 'America/Sao_Paulo')+interval '1 hour' ends_at,
      d.local_date,r.iso_weekday
    from whatsapp_bot.ec10_chat_booking_routes r
    join dates d on extract(isodow from d.local_date)=r.iso_weekday
    join whatsapp_bot.sellers seller on seller.id=r.seller_id and seller.active
    where r.enabled and r.route_key=p_route_key and p_service in ('plano_carreira','plano_internacional','eurocamp')
      and (d.local_date+r.local_time) at time zone 'America/Sao_Paulo'>coalesce(p_after,now())+interval '2 hours'
      and not whatsapp_bot.ec10_crm_time_conflict(
        r.seller_id,(d.local_date+r.local_time) at time zone 'America/Sao_Paulo',
        ((d.local_date+r.local_time) at time zone 'America/Sao_Paulo')+interval '1 hour')
      and not exists (
        select 1 from whatsapp_bot.ec10_bookings b where b.seller_id=r.seller_id and b.status='confirmed'
          and b.starts_at<((d.local_date+r.local_time) at time zone 'America/Sao_Paulo')+interval '1 hour'
          and b.ends_at>(d.local_date+r.local_time) at time zone 'America/Sao_Paulo')
  )
  select a.seller_id,a.display_name,a.route_key,a.service,a.starts_at,a.ends_at,
    to_char(a.local_date,'YYYY-MM-DD'),
    case a.iso_weekday when 1 then 'Segunda-feira' when 2 then 'Terça-feira'
      when 3 then 'Quarta-feira' when 4 then 'Quinta-feira' when 5 then 'Sexta-feira'
      when 6 then 'Sábado' else 'Domingo' end,
    to_char(a.local_date,'DD/MM')
  from available a order by a.starts_at limit 7
$$;

revoke all on function whatsapp_bot.ec10_chat_booking_options_routed(text,text,timestamptz) from public,anon,authenticated;
grant execute on function whatsapp_bot.ec10_chat_booking_options_routed(text,text,timestamptz) to service_role;

commit;
