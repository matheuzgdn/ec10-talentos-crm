import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {bookingPool} from '../api/_booking-db.ts';

const db=await bookingPool.connect();
let checks=0;
const ok=(condition,message)=>{assert.ok(condition,message);checks+=1;};
try{
 await db.query('begin');
 const baseline=Number((await db.query("select count(*)::int c from whatsapp_bot.ec10_bookings where status='confirmed' and starts_at>now()")).rows[0].c);
 let sql=await fs.readFile(new URL('../supabase/migrations/20260916143000_named_seller_schedules.sql',import.meta.url),'utf8');
 sql=sql.replace(/^\s*begin;\s*/i,'').replace(/\s*commit;\s*$/i,'');
 await db.query(sql);
 const targets=(await db.query(`
  select s.id,coalesce(p.full_name,s.name) name,a.services,a.enabled,a.replace_on_manual,
   count(w.*)::int windows
  from whatsapp_bot.sellers s
  join whatsapp_bot.ec10_default_agenda a on a.seller_id=s.id
  left join public.profiles p on p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email)
  left join whatsapp_bot.ec10_default_agenda_windows w on w.seller_id=s.id
  where lower(s.name) in ('augustin','agustin') or lower(coalesce(p.full_name,s.name)) like 'joao pedro%' or lower(coalesce(p.full_name,''))='pablo jardins'
  group by s.id,p.full_name,s.name,a.services,a.enabled,a.replace_on_manual order by name
 `)).rows;
 ok(targets.length===3,'Expected Augustin, Joao and main Pablo');
 const byName=Object.fromEntries(targets.map(row=>[String(row.name).toLowerCase(),row]));
 const augustin=targets.find(row=>/augustin|agustin/i.test(row.name));
 const joao=targets.find(row=>/joao|joão/i.test(row.name));
 const pablo=targets.find(row=>/pablo/i.test(row.name));
 ok(augustin?.windows===7,'Augustin must have seven weekdays');
 ok(joao?.windows===5,'Joao must have five weekdays');
 ok(pablo?.windows===7,'Pablo must have seven weekdays');
 ok(targets.every(row=>row.enabled&&!row.replace_on_manual),'Named schedules must remain enabled when an extra manual slot is added');
 ok(JSON.stringify(augustin.services)===JSON.stringify(['plano_carreira','eurocamp']),'Augustin services');
 ok(JSON.stringify(joao.services)===JSON.stringify(['plano_carreira','eurocamp']),'Joao services');
 ok(JSON.stringify(pablo.services)===JSON.stringify(['plano_internacional']),'Pablo service');
 const expected=(await db.query(`
  select coalesce(p.full_name,s.name) name,w.iso_weekday,w.start_hour,w.end_hour
  from whatsapp_bot.ec10_default_agenda_windows w join whatsapp_bot.sellers s on s.id=w.seller_id
  left join public.profiles p on p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email)
  where w.seller_id=any($1::uuid[]) order by name,w.iso_weekday
 `,[targets.map(row=>row.id)])).rows;
 ok(expected.filter(row=>/augustin|agustin/i.test(row.name)).every(row=>row.start_hour===14&&row.end_hour===19),'Augustin 14-19');
 ok(expected.filter(row=>/pablo/i.test(row.name)).every(row=>row.start_hour===8&&row.end_hour===20),'Pablo 8-20');
 ok(expected.filter(row=>/joao|joão/i.test(row.name)).every(row=>row.end_hour===22&&row.start_hour===( [1,3,5].includes(row.iso_weekday)?14:15)),'Joao weekly pattern');
 const invalid=Number((await db.query(`
  select count(*)::int c from whatsapp_bot.ec10_booking_slots sl
  where sl.seller_id=any($1::uuid[]) and sl.enabled and sl.source='business_default' and sl.starts_at>now()+interval '2 hours'
   and not exists(select 1 from whatsapp_bot.ec10_default_agenda_windows w where w.seller_id=sl.seller_id
    and w.iso_weekday=extract(isodow from sl.starts_at at time zone 'America/Sao_Paulo')
    and extract(hour from sl.starts_at at time zone 'America/Sao_Paulo')>=w.start_hour
    and extract(hour from sl.starts_at at time zone 'America/Sao_Paulo')<w.end_hour)
 `,[targets.map(row=>row.id)])).rows[0].c);
 ok(invalid===0,'No default slot outside named schedules');
 const counts=(await db.query(`select seller_id,count(*)::int c from whatsapp_bot.ec10_booking_slots where seller_id=any($1::uuid[]) and enabled and source='business_default' and starts_at>now()+interval '2 hours' group by seller_id`,[targets.map(row=>row.id)])).rows;
 ok(counts.length===3&&counts.every(row=>row.c>50),'All named schedules have customer slots');
 const extra=new Date(Date.now()+5*86400000);extra.setUTCHours(13,0,0,0);
 await db.query('select whatsapp_bot.ec10_open_manual_slot($1,$2,$3)',[augustin.id,'plano_carreira',extra.toISOString()]);
 const policy=(await db.query('select enabled,manual_started_at from whatsapp_bot.ec10_default_agenda where seller_id=$1',[augustin.id])).rows[0];
 ok(policy.enabled&&policy.manual_started_at===null,'Extra manual slot must not remove recurring named schedule');
 const after=Number((await db.query("select count(*)::int c from whatsapp_bot.ec10_bookings where status='confirmed' and starts_at>now()")).rows[0].c);
 ok(after===baseline,'Confirmed bookings preserved');
 await db.query('rollback');
 console.log(JSON.stringify({checks,result:'passed',targets:targets.map(row=>({name:row.name,windows:row.windows,services:row.services})),persistentChanges:0,confirmedBookingsPreserved:true},null,2));
}catch(error){await db.query('rollback').catch(()=>{});throw error;}finally{db.release();}
