import {bookingPool} from '../api/_booking-db.ts';
const db=await bookingPool.connect();
try{
 await db.query('begin read only');
 for(const table of ['clients','bot_conversation_states','bot_dedupe_locks','outbound_messages'])console.log(JSON.stringify({table,columns:(await db.query(`select column_name,data_type from information_schema.columns where table_schema='whatsapp_bot' and table_name=$1 order by ordinal_position`,[table])).rows}));
 console.log(JSON.stringify({triggers:(await db.query(`select tgname,pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid='whatsapp_bot.clients'::regclass and not tgisinternal`)).rows}));
 console.log(JSON.stringify({lockTables:(await db.query(`select table_schema,table_name from information_schema.tables where table_name like '%dedupe%'`)).rows}));
 console.log(JSON.stringify({ageCompatibility:(await db.query(`select service,count(*)::int as incompatible from whatsapp_bot.ec10_bookings where (service='eurocamp' and athlete_age>19) or (service='plano_internacional' and athlete_age not between 20 and 25) group by service`)).rows}));
}finally{await db.query('rollback');db.release();}
