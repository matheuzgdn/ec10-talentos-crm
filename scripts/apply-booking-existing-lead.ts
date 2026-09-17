import fs from 'node:fs';
import {bookingPool} from '../api/_booking-db.ts';
const db=await bookingPool.connect();
try{
 await db.query('begin');
 const org=(await db.query("select id from public.organizations where slug='ec10-talentos' and status='active'")).rows;
 if(org.length!==1||org[0].id!=='ec100000-0000-4000-8000-000000000001')throw new Error('Wrong organization');
 await db.query(`create table if not exists app_private.ec10_maintenance_backups(
   id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now(),
   reason text not null,target_id text,payload jsonb not null)`);
 await db.query('revoke all on app_private.ec10_maintenance_backups from public,anon,authenticated');
 const before=(await db.query("select pg_get_functiondef('app_private.sync_whatsapp_client_to_crm()'::regprocedure) as definition")).rows[0].definition;
 if(!before.includes('EC10_BOOKING_EXISTING_LEAD_ONLY'))await db.query(`insert into app_private.ec10_maintenance_backups(reason,target_id,payload) values('booking-existing-lead-only','app_private.sync_whatsapp_client_to_crm',jsonb_build_object('definition',$1::text))`,[before]);
 await db.query(fs.readFileSync(new URL('../supabase/migrations/20260916190000_booking_existing_lead_only.sql',import.meta.url),'utf8'));
 const after=(await db.query("select pg_get_functiondef('app_private.sync_whatsapp_client_to_crm()'::regprocedure) as definition")).rows[0].definition;
 if(!after.includes('EC10_BOOKING_EXISTING_LEAD_ONLY'))throw new Error('Guard missing');
 await db.query('commit');console.log(JSON.stringify({applied:true,existingLeadOnly:true,backup:true}));
}catch(e){await db.query('rollback');throw e;}finally{db.release();}
