begin;
alter table whatsapp_bot.ec10_bot_booking_links add column if not exists origin_phone text;
alter table whatsapp_bot.ec10_bot_booking_links add column if not exists booking_id uuid references whatsapp_bot.ec10_bookings(id) on delete set null;
update whatsapp_bot.ec10_bot_booking_links l set origin_phone=c.phone from whatsapp_bot.clients c where c.id=l.client_id and l.origin_phone is null;
alter table whatsapp_bot.ec10_bot_booking_links alter column origin_phone set not null;

create or replace function whatsapp_bot.ec10_lock_booking_origin() returns trigger
language plpgsql set search_path=pg_catalog,whatsapp_bot as $$
begin
  if TG_OP='INSERT' then
    select phone into new.origin_phone from whatsapp_bot.clients where id=new.client_id;
  elsif new.client_id is distinct from old.client_id or new.origin_phone is distinct from old.origin_phone then
    raise exception 'Booking WhatsApp origin is immutable';
  end if;
  if new.booking_id is not null and not exists(select 1 from whatsapp_bot.ec10_bookings where id=new.booking_id and client_id=new.client_id and service=new.service) then
    raise exception 'Booking must belong to the original contact and program';
  end if;
  return new;
end $$;
drop trigger if exists ec10_booking_origin on whatsapp_bot.ec10_bot_booking_links;
create trigger ec10_booking_origin before insert or update on whatsapp_bot.ec10_bot_booking_links for each row execute function whatsapp_bot.ec10_lock_booking_origin();
notify pgrst,'reload schema';
commit;
