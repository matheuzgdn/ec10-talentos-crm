begin;

create or replace function public.crm_booking_availability(
  p_action text default 'list',
  p_seller_id uuid default null,
  p_service text default null,
  p_starts_at timestamptz default null,
  p_slot_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  org uuid;
  is_owner boolean;
  can_view_team boolean;
  target uuid;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode='42501';
  end if;

  select id into org
  from public.organizations
  where slug='ec10-talentos' and status='active';

  if not app_private.is_organization_member(org) then
    raise exception 'organization access denied' using errcode='42501';
  end if;

  select exists(
    select 1
    from public.organization_members om
    where om.organization_id=org
      and om.user_id=auth.uid()
      and om.status='active'
      and om.is_owner
  ) into is_owner;

  select is_owner or exists(
    select 1
    from public.profiles p
    where p.auth_user_id=auth.uid()
      and p.is_active=true
      and p.role in ('admin','superadmin')
  ) into can_view_team;

  if p_action in ('add','remove') then
    target:=coalesce(p_seller_id,(
      select s.id
      from whatsapp_bot.sellers s
      join public.profiles p on p.auth_user_id=auth.uid()
      where s.active
        and (s.auth_user_id=auth.uid() or lower(s.email)=lower(p.email))
      limit 1
    ));

    if target is null
      or not exists(
        select 1
        from whatsapp_bot.ec10_default_agenda
        where seller_id=target and organization_id=org
      )
      or (
        not is_owner
        and not exists(
          select 1
          from whatsapp_bot.sellers s
          join public.profiles p on p.auth_user_id=auth.uid()
          where s.id=target
            and (s.auth_user_id=auth.uid() or lower(s.email)=lower(p.email))
        )
      )
    then
      raise exception 'seller access denied' using errcode='42501';
    end if;

    if p_action='add' then
      result:=whatsapp_bot.ec10_open_manual_slot(target,p_service,p_starts_at);
    else
      perform pg_advisory_xact_lock(hashtext(target::text));
      if exists(
        select 1
        from whatsapp_bot.ec10_bookings
        where slot_id=p_slot_id and status='confirmed'
      ) then
        raise exception 'Reserva confirmada não pode ser removida';
      end if;
      update whatsapp_bot.ec10_booking_slots
      set enabled=false
      where id=p_slot_id and seller_id=target;
      if not found then
        raise exception 'Horário não encontrado';
      end if;
      result:=jsonb_build_object('ok',true);
    end if;
    return result;
  elsif p_action<>'list' then
    raise exception 'action invalid';
  end if;

  return jsonb_build_object(
    'isOwner',is_owner,
    'canViewTeam',can_view_team,
    'timezone','America/Sao_Paulo',
    'businessHours','Grade individual por vendedor · reuniões de 1 hora',
    'sellers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',s.id,
        'name',coalesce(p.full_name,s.name),
        'defaultEnabled',a.enabled,
        'manualStartedAt',a.manual_started_at,
        'replaceOnManual',a.replace_on_manual,
        'services',a.services,
        'schedule',coalesce((
          select jsonb_agg(jsonb_build_object(
            'weekday',w.iso_weekday,
            'startHour',w.start_hour,
            'endHour',w.end_hour
          ) order by w.iso_weekday,w.start_hour)
          from whatsapp_bot.ec10_default_agenda_windows w
          where w.seller_id=s.id
        ),'[]'::jsonb)
      ) order by coalesce(p.full_name,s.name))
      from whatsapp_bot.ec10_default_agenda a
      join whatsapp_bot.sellers s on s.id=a.seller_id
      left join public.profiles p on p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email)
      where a.organization_id=org
        and s.active
        and (
          can_view_team
          or s.auth_user_id=auth.uid()
          or exists(
            select 1
            from public.profiles me
            where me.auth_user_id=auth.uid() and lower(me.email)=lower(s.email)
          )
        )
    ),'[]'::jsonb),
    'slots',coalesce((
      select jsonb_agg(x.data order by x.starts_at)
      from (
        select
          sl.starts_at,
          jsonb_build_object(
            'id',sl.id,
            'sellerId',s.id,
            'sellerName',coalesce(p.full_name,s.name),
            'service',sl.service,
            'services',case when cardinality(sl.allowed_services)>0 then sl.allowed_services else array[sl.service] end,
            'startsAt',sl.starts_at,
            'endsAt',sl.ends_at,
            'source',sl.source,
            'booked',exists(
              select 1
              from whatsapp_bot.ec10_bookings b
              where b.slot_id=sl.id and b.status='confirmed'
            )
          ) as data
        from whatsapp_bot.ec10_booking_slots sl
        join whatsapp_bot.ec10_default_agenda a on a.seller_id=sl.seller_id
        join whatsapp_bot.sellers s on s.id=sl.seller_id
        left join public.profiles p on p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email)
        where a.organization_id=org
          and sl.enabled
          and sl.starts_at>now()
          and sl.starts_at<now()+interval '30 days'
          and (
            can_view_team
            or s.auth_user_id=auth.uid()
            or exists(
              select 1
              from public.profiles me
              where me.auth_user_id=auth.uid() and lower(me.email)=lower(s.email)
            )
          )
        order by sl.starts_at
        limit 2500
      ) x
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.crm_booking_availability(text,uuid,text,timestamptz,uuid) from public,anon;
grant execute on function public.crm_booking_availability(text,uuid,text,timestamptz,uuid) to authenticated;

commit;
