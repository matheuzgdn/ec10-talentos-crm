import fs from 'node:fs';
import {bookingPool} from '../api/_booking-db.ts';
const {rows}=await bookingPool.query(`select count(*)::int n from public.organizations where slug='ec10-talentos' and status='active'`);
if(rows[0].n!==1)throw new Error('EC10 main database identity check failed');
await bookingPool.query(fs.readFileSync('supabase/migrations/20260916155000_bot_private_booking_links.sql','utf8'));
await bookingPool.query(fs.readFileSync('supabase/migrations/20260916160500_booking_athlete_video.sql','utf8'));
console.log(JSON.stringify({migrationApplied:true,mainEc10Verified:true}));
