import {bookingPool} from '../api/_booking-db.ts';

const names = '%(augustin|agustin|joao|joão|pablo)%';
const profiles = await bookingPool.query(`
  select p.full_name as name,p.role,p.is_active,om.status as membership_status,om.is_owner,
    (p.auth_user_id is not null) as has_auth,
    (nullif(p.email,'') is not null) as has_email,
    exists(select 1 from whatsapp_bot.sellers s where s.auth_user_id=p.auth_user_id or lower(s.email)=lower(p.email)) as seller_linked
  from public.profiles p
  left join public.organization_members om on om.user_id=p.auth_user_id
  left join public.organizations o on o.id=om.organization_id and o.slug='ec10-talentos'
  where lower(p.full_name) similar to $1
  order by p.full_name
`, [names]);
const sellers = await bookingPool.query(`
  select s.name,s.active,s.role,(s.auth_user_id is not null) as has_auth,(nullif(s.email,'') is not null) as has_email,
    coalesce(p.full_name,'') as profile_name,
    exists(select 1 from whatsapp_bot.ec10_default_agenda a where a.seller_id=s.id) as has_agenda_policy,
    (select count(*)::int from whatsapp_bot.ec10_booking_slots sl where sl.seller_id=s.id and sl.enabled and sl.starts_at>now()) as future_slots,
    (select count(*)::int from whatsapp_bot.ec10_bookings b where b.seller_id=s.id and b.status='confirmed' and b.starts_at>now()) as future_bookings
  from whatsapp_bot.sellers s
  left join public.profiles p on p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email)
  where lower(s.name) similar to $1 or lower(coalesce(p.full_name,'')) similar to $1
  order by s.name
`, [names]);
const columns = await bookingPool.query(`select column_name,is_nullable,column_default from information_schema.columns where table_schema='whatsapp_bot' and table_name='sellers' order by ordinal_position`);
console.log(JSON.stringify({profiles:profiles.rows,sellers:sellers.rows,sellerColumns:columns.rows},null,2));
