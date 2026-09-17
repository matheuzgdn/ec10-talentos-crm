import {bookingPool} from '../api/_booking-db.ts';
const db=await bookingPool.connect();
try{
 await db.query('begin read only');
 const result=(await db.query(`select c.bot_paused,s.stage,
   (select count(*)::int from public.leads l where l.organization_id=app_private.ec10_organization_id()
     and (l.data->>'whatsapp_client_id'=c.id::text or app_private.whatsapp_phone_match_key(coalesce(l.data->>'telefone_e164',l.data->>'telefone'))=app_private.whatsapp_phone_match_key(c.phone))) as matching_cards,
   (select count(*)::int from whatsapp_bot.ec10_bookings b where b.client_id=c.id and b.status='confirmed') as confirmed_bookings,
   (select count(*)::int from whatsapp_bot.messages m where m.client_id=c.id) as messages_since_reset,
   position('EC10_BOOKING_EXISTING_LEAD_ONLY' in pg_get_functiondef('app_private.sync_whatsapp_client_to_crm()'::regprocedure))>0 as booking_guard
   from whatsapp_bot.clients c join whatsapp_bot.bot_conversation_states s on s.client_id=c.id
   where c.id='b13498cb-b426-403a-a402-665241bfe572'`)).rows[0];
 if(!result||result.matching_cards!==1||result.confirmed_bookings!==1||!result.booking_guard||result.bot_paused)throw new Error('Verification failed');
 console.log(JSON.stringify(result));
}finally{await db.query('rollback');db.release();}
