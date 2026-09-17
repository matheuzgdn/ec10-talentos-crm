import fs from 'node:fs/promises';
import {bookingPool} from '../api/_booking-db.ts';
if(!process.argv.includes('--apply'))throw Error('Use --apply somente com autorizacao explicita');
const sql=await fs.readFile(new URL('../supabase/migrations/20260916150000_agenda_schedule_rpc.sql',import.meta.url),'utf8');
await bookingPool.query(sql);
console.log(JSON.stringify({status:'applied',rpc:'public.crm_booking_availability',scheduleMetadata:true,slotLimit:2500}));
