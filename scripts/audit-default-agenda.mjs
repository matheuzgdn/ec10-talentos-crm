import {bookingPool} from '../api/_booking-db.ts';
const db=await bookingPool.connect();
try{
 await db.query('begin read only');
 const columns=(await db.query("select table_schema,table_name,column_name,data_type from information_schema.columns where (table_schema='whatsapp_bot' and table_name in ('sellers','ec10_booking_slots','ec10_bookings')) or (table_schema='public' and table_name in ('tarefas','organization_members','profiles')) order by table_schema,table_name,ordinal_position")).rows;
 const sellers=(await db.query('select id,name,active from whatsapp_bot.sellers order by name')).rows;
 const funcs=(await db.query("select p.proname,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('crm_prepare_whatsapp_contact','crm_list_whatsapp_clients','current_organization_id','is_organization_admin')")).rows;
 const tables=(await db.query("select table_name from information_schema.tables where table_schema='public' and (table_name like '%member%' or table_name like '%tarefa%')")).rows;
 const mappings=(await db.query(`select s.id as seller_id,s.name,p.full_name,p.role,p.is_active,s.role as bot_role
  from whatsapp_bot.sellers s left join public.profiles p on p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email)
  order by s.name`)).rows;
 const privateFunctions=(await db.query("select p.proname,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname in ('is_organization_member','has_organization_role','is_platform_admin')")).rows;
 const members=(await db.query(`select p.full_name,p.role,om.is_owner,p.is_active from public.organization_members om join public.organizations o on o.id=om.organization_id
  join public.profiles p on p.auth_user_id=om.user_id where o.slug='ec10-talentos' and om.status='active'`)).rows;
 const guards=(await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and (p.proname like '%admin%' or p.proname like '%permission%' or p.proname like '%role%')")).rows;
 console.log(JSON.stringify({mappings,members,guards}));await db.query('rollback');
}finally{db.release();}
