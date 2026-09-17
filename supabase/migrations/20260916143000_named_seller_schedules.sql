begin;

alter table whatsapp_bot.ec10_default_agenda
  add column if not exists replace_on_manual boolean not null default true;

create table if not exists whatsapp_bot.ec10_default_agenda_windows (
  seller_id uuid not null references whatsapp_bot.sellers(id) on delete cascade,
  iso_weekday smallint not null check (iso_weekday between 1 and 7),
  start_hour smallint not null check (start_hour between 0 and 23),
  end_hour smallint not null check (end_hour between 1 and 24 and end_hour > start_hour),
  primary key (seller_id,iso_weekday,start_hour,end_hour)
);
alter table whatsapp_bot.ec10_default_agenda_windows enable row level security;
revoke all on whatsapp_bot.ec10_default_agenda_windows from public,anon,authenticated;
grant select,insert,update,delete on whatsapp_bot.ec10_default_agenda_windows to service_role;

-- João already has an active CRM identity. Link it instead of creating a second login.
insert into whatsapp_bot.sellers(auth_user_id,name,email,region,timezone,active,role,approved_at)
select p.auth_user_id,p.full_name,p.email,'brasil','America/Sao_Paulo',true,'seller',now()
from public.profiles p
join public.organization_members om on om.user_id=p.auth_user_id and om.status='active'
join public.organizations o on o.id=om.organization_id and o.slug='ec10-talentos' and o.status='active'
where lower(p.full_name) like 'joao pedro%'
  and not exists(select 1 from whatsapp_bot.sellers s where s.auth_user_id=p.auth_user_id or lower(s.email)=lower(p.email));

-- Augustin does not yet have a CRM identity. The owner can manage this agenda until it is linked.
insert into whatsapp_bot.sellers(name,region,timezone,active,role,approved_at)
select 'Augustin','brasil','America/Sao_Paulo',true,'seller',now()
where not exists(select 1 from whatsapp_bot.sellers s where lower(s.name) in ('augustin','agustin'));

with target as (
 select s.id,
  case when lower(coalesce(p.full_name,s.name)) like '%pablo%' then array['plano_internacional']::text[] else array['plano_carreira','eurocamp']::text[] end services
 from whatsapp_bot.sellers s
 left join public.profiles p on p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email)
 where lower(s.name) in ('augustin','agustin')
    or lower(coalesce(p.full_name,s.name)) like 'joao pedro%'
    or lower(coalesce(p.full_name,''))='pablo jardins'
)
insert into whatsapp_bot.ec10_default_agenda(seller_id,organization_id,services,enabled,manual_started_at,updated_at,replace_on_manual)
select t.id,o.id,t.services,true,null,now(),false
from target t cross join public.organizations o
where o.slug='ec10-talentos' and o.status='active'
on conflict(seller_id) do update set services=excluded.services,enabled=true,manual_started_at=null,updated_at=now(),replace_on_manual=false;

delete from whatsapp_bot.ec10_default_agenda_windows w
where exists (
 select 1 from whatsapp_bot.ec10_default_agenda a join whatsapp_bot.sellers s on s.id=a.seller_id
 left join public.profiles p on p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email)
 where a.seller_id=w.seller_id and (lower(s.name) in ('augustin','agustin') or lower(coalesce(p.full_name,s.name)) like 'joao pedro%' or lower(coalesce(p.full_name,''))='pablo jardins')
);

-- Augustin: every day, 14:00-19:00 (last one-hour start 18:00).
insert into whatsapp_bot.ec10_default_agenda_windows(seller_id,iso_weekday,start_hour,end_hour)
select s.id,d,14,19 from whatsapp_bot.sellers s cross join generate_series(1,7) d
where lower(s.name) in ('augustin','agustin');

-- João: Mon/Wed/Fri 14:00-22:00; Tue/Thu 15:00-22:00.
insert into whatsapp_bot.ec10_default_agenda_windows(seller_id,iso_weekday,start_hour,end_hour)
select s.id,d,case when d in (1,3,5) then 14 else 15 end,22
from whatsapp_bot.sellers s
left join public.profiles p on p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email)
cross join (values (1),(2),(3),(4),(5)) days(d)
where lower(coalesce(p.full_name,s.name)) like 'joao pedro%';

-- Pablo principal: every day, 08:00-20:00 (last one-hour start 19:00).
insert into whatsapp_bot.ec10_default_agenda_windows(seller_id,iso_weekday,start_hour,end_hour)
select s.id,d,8,20
from whatsapp_bot.sellers s
join public.profiles p on p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email)
cross join generate_series(1,7) d
where lower(p.full_name)='pablo jardins';

create or replace function whatsapp_bot.ec10_refresh_default_slots()
returns integer language plpgsql security definer set search_path='' as $$
declare a record; n integer; total integer:=0;
begin
 for a in select d.* from whatsapp_bot.ec10_default_agenda d join whatsapp_bot.sellers s on s.id=d.seller_id
   where d.enabled and s.active and d.manual_started_at is null order by d.seller_id
 loop
  perform pg_advisory_xact_lock(hashtext(a.seller_id::text));
  if not exists(select 1 from whatsapp_bot.ec10_default_agenda d where d.seller_id=a.seller_id and d.enabled and d.manual_started_at is null) then continue; end if;
  insert into whatsapp_bot.ec10_booking_slots(seller_id,service,starts_at,ends_at,source,enabled,allowed_services)
  select a.seller_id,a.services[1],v.starts_at,v.starts_at+interval '1 hour','business_default',true,a.services
  from (
   select ((timezone('America/Sao_Paulo',now())::date+day)+make_time(hour,0,0)) at time zone 'America/Sao_Paulo' as starts_at
   from generate_series(0,29) day
   join whatsapp_bot.ec10_default_agenda_windows w on w.seller_id=a.seller_id
    and w.iso_weekday=extract(isodow from timezone('America/Sao_Paulo',now())::date+day)
   cross join lateral generate_series(w.start_hour,w.end_hour-1) hour
   union all
   select ((timezone('America/Sao_Paulo',now())::date+day)+make_time(hour,0,0)) at time zone 'America/Sao_Paulo' as starts_at
   from generate_series(0,29) day cross join generate_series(8,17) hour
   where extract(isodow from timezone('America/Sao_Paulo',now())::date+day) between 1 and 5
    and not exists(select 1 from whatsapp_bot.ec10_default_agenda_windows w where w.seller_id=a.seller_id)
  ) v where v.starts_at>now()+interval '2 hours'
   and not whatsapp_bot.ec10_crm_time_conflict(a.seller_id,v.starts_at,v.starts_at+interval '1 hour')
   and not exists(select 1 from whatsapp_bot.ec10_booking_slots sl where sl.seller_id=a.seller_id
     and sl.starts_at<v.starts_at+interval '1 hour' and sl.ends_at>v.starts_at)
  on conflict do nothing;
  get diagnostics n=row_count;total:=total+n;
 end loop;
 return total;
end;
$$;

create or replace function whatsapp_bot.ec10_open_manual_slot(p_seller uuid,p_service text,p_start timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_slot uuid;p_end timestamptz:=p_start+interval '1 hour';v_replace boolean:=true;
begin
 if p_service not in ('plano_carreira','plano_internacional','eurocamp') or p_start<now()+interval '2 hours' or p_start>now()+interval '60 days' then raise exception 'Programa ou horário inválido'; end if;
 if not exists(select 1 from whatsapp_bot.sellers where id=p_seller and active and (p_service<>'plano_internacional' or lower(name) like '%pablo%')) then raise exception 'Vendedor ou programa inválido';end if;
 perform pg_advisory_xact_lock(hashtext(p_seller::text));
 select replace_on_manual into v_replace from whatsapp_bot.ec10_default_agenda where seller_id=p_seller;
 if coalesce(v_replace,true) then
  update whatsapp_bot.ec10_default_agenda set enabled=false,manual_started_at=coalesce(manual_started_at,now()),updated_at=now() where seller_id=p_seller;
  update whatsapp_bot.ec10_booking_slots sl set enabled=false
   where sl.seller_id=p_seller and sl.source='business_default' and sl.starts_at>now()
   and not exists(select 1 from whatsapp_bot.ec10_bookings b where b.slot_id=sl.id and b.status='confirmed');
 end if;
 if whatsapp_bot.ec10_crm_time_conflict(p_seller,p_start,p_end)
  or exists(select 1 from whatsapp_bot.ec10_booking_slots sl where sl.seller_id=p_seller and sl.starts_at<p_end and sl.ends_at>p_start
    and (sl.enabled or exists(select 1 from whatsapp_bot.ec10_bookings b where b.slot_id=sl.id and b.status='confirmed'))) then raise exception 'Já existe um compromisso ou horário nesse intervalo';end if;
 select id into v_slot from whatsapp_bot.ec10_booking_slots where seller_id=p_seller and starts_at=p_start and source='business_default' and not enabled limit 1;
 if v_slot is not null then
  update whatsapp_bot.ec10_booking_slots set service=p_service,source='manual',enabled=true,allowed_services='{}',ends_at=p_end where id=v_slot;
 else
  insert into whatsapp_bot.ec10_booking_slots(seller_id,service,starts_at,ends_at,source) values(p_seller,p_service,p_start,p_end,'manual') returning id into v_slot;
 end if;
 return jsonb_build_object('id',v_slot,'startsAt',p_start,'endsAt',p_end,'service',p_service,'source','manual');
end;
$$;

-- Reconcile only free default slots for these three sellers; confirmed meetings are never disabled.
update whatsapp_bot.ec10_booking_slots sl set enabled=false
where sl.source='business_default' and sl.starts_at>now()
 and exists(select 1 from whatsapp_bot.ec10_default_agenda_windows w where w.seller_id=sl.seller_id)
 and not exists(select 1 from whatsapp_bot.ec10_default_agenda_windows w
   where w.seller_id=sl.seller_id
    and w.iso_weekday=extract(isodow from sl.starts_at at time zone 'America/Sao_Paulo')
    and extract(hour from sl.starts_at at time zone 'America/Sao_Paulo')>=w.start_hour
    and extract(hour from sl.starts_at at time zone 'America/Sao_Paulo')<w.end_hour
    and extract(minute from sl.starts_at at time zone 'America/Sao_Paulo')=0)
 and not exists(select 1 from whatsapp_bot.ec10_bookings b where b.slot_id=sl.id and b.status='confirmed');

update whatsapp_bot.ec10_booking_slots sl
set enabled=true,service=a.services[1],allowed_services=a.services,ends_at=sl.starts_at+interval '1 hour'
from whatsapp_bot.ec10_default_agenda a
where a.seller_id=sl.seller_id and sl.source='business_default' and sl.starts_at>now()
 and exists(select 1 from whatsapp_bot.ec10_default_agenda_windows w
   where w.seller_id=sl.seller_id
    and w.iso_weekday=extract(isodow from sl.starts_at at time zone 'America/Sao_Paulo')
    and extract(hour from sl.starts_at at time zone 'America/Sao_Paulo')>=w.start_hour
    and extract(hour from sl.starts_at at time zone 'America/Sao_Paulo')<w.end_hour
    and extract(minute from sl.starts_at at time zone 'America/Sao_Paulo')=0);

select whatsapp_bot.ec10_refresh_default_slots();
commit;
