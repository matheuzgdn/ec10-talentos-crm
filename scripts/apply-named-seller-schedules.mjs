import fs from 'node:fs/promises';
import {bookingPool} from '../api/_booking-db.ts';
if(!process.argv.includes('--apply'))throw Error('Use --apply somente com autorizacao explicita');
const org=(await bookingPool.query("select id from public.organizations where slug='ec10-talentos' and status='active'")).rows;
if(org.length!==1)throw Error('CRM principal EC10 nao confirmado');
const sql=await fs.readFile(new URL('../supabase/migrations/20260916143000_named_seller_schedules.sql',import.meta.url),'utf8');
await bookingPool.query(sql);
const rows=(await bookingPool.query(`
 select coalesce(p.full_name,s.name) name,a.services,a.enabled,a.replace_on_manual,
  jsonb_agg(jsonb_build_object('weekday',w.iso_weekday,'start',w.start_hour,'end',w.end_hour) order by w.iso_weekday) schedule,
  (select count(*)::int from whatsapp_bot.ec10_booking_slots sl where sl.seller_id=s.id and sl.enabled and sl.starts_at>now()) future_slots
 from whatsapp_bot.sellers s join whatsapp_bot.ec10_default_agenda a on a.seller_id=s.id
 join whatsapp_bot.ec10_default_agenda_windows w on w.seller_id=s.id
 left join public.profiles p on p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email)
 where lower(s.name) in ('augustin','agustin') or lower(coalesce(p.full_name,s.name)) like 'joao pedro%' or lower(coalesce(p.full_name,''))='pablo jardins'
 group by s.id,p.full_name,s.name,a.services,a.enabled,a.replace_on_manual order by name
`)).rows;
console.log(JSON.stringify({status:'applied',timezone:'America/Sao_Paulo',sellers:rows},null,2));
