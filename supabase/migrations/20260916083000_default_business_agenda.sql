begin;
alter table whatsapp_bot.ec10_booking_slots add column if not exists source text not null default 'manual';
alter table whatsapp_bot.ec10_booking_slots add column if not exists enabled boolean not null default true;
alter table whatsapp_bot.ec10_booking_slots add column if not exists allowed_services text[] not null default '{}';
create table if not exists whatsapp_bot.ec10_default_agenda (
 seller_id uuid primary key references whatsapp_bot.sellers(id),
 organization_id uuid not null references public.organizations(id),
 services text[] not null,
 enabled boolean not null default false,
 manual_started_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table whatsapp_bot.ec10_default_agenda enable row level security;
revoke all on whatsapp_bot.ec10_default_agenda from anon,authenticated;
grant select,insert,update on whatsapp_bot.ec10_default_agenda to service_role;

-- Appointments in the actual CRM, not merely open availability, block a seller.
create or replace function whatsapp_bot.ec10_crm_time_conflict(p_seller uuid,p_start timestamptz,p_end timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 select exists (
  select 1 from public.tarefas t
  join whatsapp_bot.ec10_default_agenda a on a.organization_id=t.organization_id and a.seller_id=p_seller
  join whatsapp_bot.sellers s on s.id=a.seller_id
  where coalesce(t.data->>'status','pendente') not in ('cancelada','concluida')
   and (lower(coalesce(t.data->>'responsavel',''))=lower(s.email)
    or lower(coalesce(t.data->>'responsavel_nome',''))=lower(s.name)
    or exists(select 1 from public.profiles p where (p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email))
      and (lower(coalesce(t.data->>'responsavel',''))=lower(p.email) or lower(coalesce(t.data->>'responsavel_nome',''))=lower(p.full_name))))
   and t.data->>'data' ~ '^\d{4}-\d{2}-\d{2}$'
   and coalesce(t.data->>'horario',substring(t.data->>'descricao' from '\[(\d{2}:\d{2})\]')) ~ '^([01]\d|2[0-3]):[0-5]\d$'
   and ((t.data->>'data')::date + coalesce(t.data->>'horario',substring(t.data->>'descricao' from '\[(\d{2}:\d{2})\]'))::time) at time zone 'America/Sao_Paulo' < p_end
   and (((t.data->>'data')::date + coalesce(t.data->>'horario',substring(t.data->>'descricao' from '\[(\d{2}:\d{2})\]'))::time) at time zone 'America/Sao_Paulo')+interval '1 hour' > p_start
 );
$$;

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
   from generate_series(0,29) day cross join generate_series(8,17) hour
   where extract(isodow from timezone('America/Sao_Paulo',now())::date+day) between 1 and 5
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
declare v_slot uuid;p_end timestamptz:=p_start+interval '1 hour';
begin
 if p_service not in ('plano_carreira','plano_internacional','eurocamp') or p_start<now()+interval '2 hours' or p_start>now()+interval '60 days' then raise exception 'Programa ou horário inválido'; end if;
 if not exists(select 1 from whatsapp_bot.sellers where id=p_seller and active and (p_service<>'plano_internacional' or lower(name) like '%pablo%')) then raise exception 'Vendedor ou programa inválido';end if;
 perform pg_advisory_xact_lock(hashtext(p_seller::text));
 -- Soft-disable unreserved defaults. A confirmed booking is never removed.
 update whatsapp_bot.ec10_default_agenda set enabled=false,manual_started_at=coalesce(manual_started_at,now()),updated_at=now() where seller_id=p_seller;
 update whatsapp_bot.ec10_booking_slots sl set enabled=false
  where sl.seller_id=p_seller and sl.source='business_default' and sl.starts_at>now()
  and not exists(select 1 from whatsapp_bot.ec10_bookings b where b.slot_id=sl.id and b.status='confirmed');
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

-- Security is tied to the existing organization and seller identity. Owners can manage the team.
create or replace function public.crm_booking_availability(p_action text default 'list',p_seller_id uuid default null,p_service text default null,p_starts_at timestamptz default null,p_slot_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid;is_owner boolean;target uuid;result jsonb;
begin
 if auth.uid() is null then raise exception 'authentication required' using errcode='42501';end if;
 select id into org from public.organizations where slug='ec10-talentos' and status='active';
 if not app_private.is_organization_member(org) then raise exception 'organization access denied' using errcode='42501';end if;
 select exists(select 1 from public.organization_members om where om.organization_id=org and om.user_id=auth.uid() and om.status='active' and om.is_owner) into is_owner;
 if p_action in ('add','remove') then
  target:=coalesce(p_seller_id,(select s.id from whatsapp_bot.sellers s join public.profiles p on p.auth_user_id=auth.uid()
   where s.active and (s.auth_user_id=auth.uid() or lower(s.email)=lower(p.email)) limit 1));
  if target is null or not exists(select 1 from whatsapp_bot.ec10_default_agenda where seller_id=target and organization_id=org)
   or (not is_owner and not exists(select 1 from whatsapp_bot.sellers s join public.profiles p on p.auth_user_id=auth.uid()
     where s.id=target and (s.auth_user_id=auth.uid() or lower(s.email)=lower(p.email)))) then raise exception 'seller access denied' using errcode='42501';end if;
  if p_action='add' then result:=whatsapp_bot.ec10_open_manual_slot(target,p_service,p_starts_at);
  else
   perform pg_advisory_xact_lock(hashtext(target::text));
   if exists(select 1 from whatsapp_bot.ec10_bookings where slot_id=p_slot_id and status='confirmed') then raise exception 'Reserva confirmada não pode ser removida';end if;
   update whatsapp_bot.ec10_booking_slots set enabled=false where id=p_slot_id and seller_id=target;
   if not found then raise exception 'Horário não encontrado';end if;
   result:=jsonb_build_object('ok',true);
  end if;
  return result;
 elsif p_action<>'list' then raise exception 'action invalid';end if;
 return jsonb_build_object('isOwner',is_owner,'timezone','America/Sao_Paulo','businessHours','Segunda a sexta · 08h às 18h',
  'sellers',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',coalesce(p.full_name,s.name),'defaultEnabled',a.enabled,'manualStartedAt',a.manual_started_at,'services',a.services))
   from whatsapp_bot.ec10_default_agenda a join whatsapp_bot.sellers s on s.id=a.seller_id
   left join public.profiles p on p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email)
   where a.organization_id=org and s.active and (is_owner or s.auth_user_id=auth.uid() or exists(select 1 from public.profiles me where me.auth_user_id=auth.uid() and lower(me.email)=lower(s.email)))),'[]'::jsonb),
  'slots',coalesce((select jsonb_agg(x.data order by x.starts_at) from (
   select sl.starts_at,jsonb_build_object('id',sl.id,'sellerId',s.id,'sellerName',coalesce(p.full_name,s.name),'service',sl.service,'services',case when cardinality(sl.allowed_services)>0 then sl.allowed_services else array[sl.service] end,'startsAt',sl.starts_at,'endsAt',sl.ends_at,'source',sl.source,'booked',exists(select 1 from whatsapp_bot.ec10_bookings b where b.slot_id=sl.id and b.status='confirmed')) as data
   from whatsapp_bot.ec10_booking_slots sl join whatsapp_bot.ec10_default_agenda a on a.seller_id=sl.seller_id
   join whatsapp_bot.sellers s on s.id=sl.seller_id left join public.profiles p on p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email)
   where a.organization_id=org and sl.enabled and sl.starts_at>now() and sl.starts_at<now()+interval '30 days'
    and (is_owner or s.auth_user_id=auth.uid() or exists(select 1 from public.profiles me where me.auth_user_id=auth.uid() and lower(me.email)=lower(s.email)))
   order by sl.starts_at limit 1200
  ) x),'[]'::jsonb));
end;
$$;
revoke all on function whatsapp_bot.ec10_crm_time_conflict(uuid,timestamptz,timestamptz),whatsapp_bot.ec10_refresh_default_slots(),whatsapp_bot.ec10_open_manual_slot(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function whatsapp_bot.ec10_crm_time_conflict(uuid,timestamptz,timestamptz),whatsapp_bot.ec10_refresh_default_slots(),whatsapp_bot.ec10_open_manual_slot(uuid,text,timestamptz) to service_role;
revoke all on function public.crm_booking_availability(text,uuid,text,timestamptz,uuid) from public,anon;
grant execute on function public.crm_booking_availability(text,uuid,text,timestamptz,uuid) to authenticated;

create or replace function whatsapp_bot.ec10_mirror_booking_to_crm_agenda()
returns trigger language plpgsql security definer set search_path='' as $$
declare org uuid;s whatsapp_bot.sellers;lead_id text;payload jsonb;
begin
 select organization_id into org from whatsapp_bot.ec10_default_agenda where seller_id=new.seller_id;
 if org is null then select id into org from public.organizations where slug='ec10-talentos' and status='active';end if;
 select * into s from whatsapp_bot.sellers where id=new.seller_id;
 select id into lead_id from public.leads where organization_id=org and data->>'whatsapp_client_id'=new.client_id::text limit 1;
 payload:=jsonb_build_object('tipo','reuniao_comercial','descricao','Reunião EC10 · '||replace(new.service,'_',' ')||' · '||new.contact_name,
  'data',to_char(new.starts_at at time zone 'America/Sao_Paulo','YYYY-MM-DD'),'horario',to_char(new.starts_at at time zone 'America/Sao_Paulo','HH24:MI'),
  'responsavel',s.email,'responsavel_nome',coalesce((select full_name from public.profiles where auth_user_id=s.auth_user_id or lower(email)=lower(s.email) limit 1),s.name),
  'atleta_id',lead_id,'atleta_nome',new.contact_name,'lead_id',lead_id,'booking_id',new.id,'booking_service',new.service,
  'source','booking_ec10','status',case when new.status='confirmed' then 'pendente' else 'cancelada' end,'duracao_minutos',60);
 insert into public.tarefas(id,organization_id,data,created_by,updated_by)
  values('booking-'||new.id::text,org,payload,'agenda-cliente','agenda-cliente')
  on conflict(id) do update set data=excluded.data,updated_date=now(),updated_by='agenda-cliente';
 return new;
end;
$$;
drop trigger if exists ec10_booking_crm_agenda on whatsapp_bot.ec10_bookings;
create trigger ec10_booking_crm_agenda after insert or update of status on whatsapp_bot.ec10_bookings for each row execute function whatsapp_bot.ec10_mirror_booking_to_crm_agenda();

insert into whatsapp_bot.ec10_default_agenda(seller_id,organization_id,services)
select s.id,o.id,case when s.id='1ea8d156-f49c-4412-96f4-1ebd4d3a2f9c' then array['plano_internacional'] else array['plano_carreira','eurocamp'] end
from whatsapp_bot.sellers s cross join public.organizations o
where o.slug='ec10-talentos' and s.active and s.id in ('02a15ec2-254f-43c6-a429-042ba18d85fa','901d659f-1423-4c81-9213-949f4f3fb8e8','1ea8d156-f49c-4412-96f4-1ebd4d3a2f9c')
on conflict(seller_id) do nothing;
commit;
