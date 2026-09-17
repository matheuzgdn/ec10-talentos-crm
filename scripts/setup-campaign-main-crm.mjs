import { bookingPool } from '../api/_booking-db.ts';
import fs from 'node:fs/promises';
const db=await bookingPool.connect();
try{
 await db.query('begin read only');
 const org=(await db.query("select id,slug,status from public.organizations where slug='ec10-talentos'")).rows;
 const columns=(await db.query("select table_schema,table_name,column_name,data_type from information_schema.columns where (table_schema='whatsapp_bot' and table_name in ('clients','bot_conversation_states','traffic_events')) or (table_schema='public' and table_name='leads')")).rows;
 const connections=(await db.query('select instance_id,status,ai_enabled,ai_provider,last_seen_at from public.whatsapp_connections')).rows;
 console.log(JSON.stringify({org,connections,columns}));
 await db.query('rollback');
 if(org.length!==1||org[0].status!=='active')throw Error('Wrong main CRM');
 if(process.argv.includes('--apply')){
  await db.query(await fs.readFile(new URL('../supabase/migrations/20260916074500_campaign_lp_main_crm.sql',import.meta.url),'utf8'));
  console.log(JSON.stringify({migration:'applied',table:'whatsapp_bot.ec10_campaign_registrations'}));
 }
}finally{db.release();}
