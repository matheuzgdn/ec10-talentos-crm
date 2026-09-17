import {bookingPool} from '../api/_booking-db.ts';
const db=await bookingPool.connect();
try {
 await db.query('begin read only');
 const org=(await db.query("select id,slug from public.organizations where slug='ec10-talentos' and status='active'")).rows;
 if(org.length!==1)throw new Error('EC10 organization identity is ambiguous');
 const phone='559294432962';
 const contacts=(await db.query(`select c.id,c.phone,c.name,c.bot_instance_id,c.bot_paused,c.status,s.stage,
  (select count(*)::int from whatsapp_bot.messages m where m.client_id=c.id) as messages
  from whatsapp_bot.clients c left join whatsapp_bot.bot_conversation_states s on s.client_id=c.id
  where app_private.whatsapp_phone_match_key(c.phone)=app_private.whatsapp_phone_match_key($1)`,[phone])).rows;
 const leads=(await db.query(`select id,created_date,data->>'nome_atleta' as name,data->>'responsavel' as guardian,data->>'status' as status,
  data->>'whatsapp_client_id' as client_id,data->>'whatsapp_crm_client_id' as legacy_client_id,data->>'booking_id' as booking_id,
  data->>'telefone' as phone from public.leads where organization_id=$2 and
  (app_private.whatsapp_phone_match_key(coalesce(data->>'telefone_e164',data->>'telefone'))=app_private.whatsapp_phone_match_key($1)
   or data->>'whatsapp_client_id'=any($3::text[])) order by created_date`,[phone,org[0].id,contacts.map(c=>c.id)])).rows;
 const bookings=(await db.query(`select id,client_id,contact_name,status,service,starts_at,seller_id from whatsapp_bot.ec10_bookings
  where client_id=any($1::uuid[]) order by created_at desc`,[contacts.map(c=>c.id)])).rows;
 console.log(JSON.stringify({organization:org[0],contacts,leads,bookings}));
 const triggers=(await db.query(`select n.nspname as schema,c.relname as table,t.tgname as trigger,p.oid,p.proname
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  join pg_proc p on p.oid=t.tgfoid where not t.tgisinternal and
  ((n.nspname='whatsapp_bot' and c.relname in ('clients','ec10_bookings','bot_conversation_states')) or
   (n.nspname='public' and c.relname in ('leads','tarefas'))) order by n.nspname,c.relname,t.tgname`)).rows;
 console.log(JSON.stringify({triggers}));
 for(const t of triggers.filter(t=>/sync|mirror|lead|crm/.test(t.proname))) {
  console.log(JSON.stringify({function:t.proname,definition:(await db.query('select pg_get_functiondef($1) as definition',[t.oid])).rows[0].definition}));
 }
 console.log(JSON.stringify({constraints:(await db.query(`select conname,pg_get_constraintdef(oid) as definition
   from pg_constraint where conrelid='whatsapp_bot.ec10_bookings'::regclass and contype='c'`)).rows}));
}finally{await db.query('rollback');db.release();}
