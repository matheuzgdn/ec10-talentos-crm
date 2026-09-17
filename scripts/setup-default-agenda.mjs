import fs from 'node:fs/promises';
import {bookingPool} from '../api/_booking-db.ts';
if(!process.argv.includes('--apply')&&!process.argv.includes('--enable'))throw Error('Explicit --apply or --enable required');
const db=await bookingPool.connect();
try{
 const org=(await db.query("select id from public.organizations where slug='ec10-talentos' and status='active'")).rows;
 if(org.length!==1)throw Error('Wrong CRM');
 if(process.argv.includes('--apply')){await db.query(await fs.readFile(new URL('../supabase/migrations/20260916083000_default_business_agenda.sql',import.meta.url),'utf8'));console.log('Migration applied; defaults not enabled yet');}
 if(process.argv.includes('--enable')){
  await db.query('begin');
  await db.query('update whatsapp_bot.ec10_default_agenda set enabled=true,updated_at=now() where organization_id=$1 and manual_started_at is null',[org[0].id]);
  const created=(await db.query('select whatsapp_bot.ec10_refresh_default_slots() as created')).rows[0].created;
  await db.query('commit');console.log(JSON.stringify({enabled:true,created,timezone:'America/Sao_Paulo',weekdays:'Monday-Friday',firstStart:'08:00',lastStart:'17:00',minutes:60}));
 }
}finally{db.release();}
