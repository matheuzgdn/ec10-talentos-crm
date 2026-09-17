import {bookingPool} from '../api/_booking-db.ts';
const db=await bookingPool.connect();
try{
  await db.query('begin read only');
  const {rows}=await db.query(`select b.id,b.client_id,b.service,b.contact_role,b.starts_at,b.ends_at,b.status,b.created_at,s.name as seller_name,
    c.bot_paused,c.status as client_status,c.bot_instance_id,c.phone as saved_phone
    from whatsapp_bot.ec10_bookings b join whatsapp_bot.clients c on c.id=b.client_id
    join whatsapp_bot.sellers s on s.id=b.seller_id
    where regexp_replace(b.phone,'[^0-9]','','g') like '%94432962' order by b.created_at desc limit 5`);
  for(const booking of rows){
    const queue=(await db.query(`select id,body,status,error_message,created_at,scheduled_at,sent_at,whatsapp_message_id,whatsapp_ack,whatsapp_send_attempts,media_path
      from whatsapp_bot.outbound_messages where client_id=$1 order by created_at desc limit 8`,[booking.client_id])).rows;
    const messages=(await db.query(`select direction,body,created_at,whatsapp_ack,whatsapp_message_id from whatsapp_bot.messages
      where client_id=$1 order by created_at desc limit 8`,[booking.client_id])).rows;
    const events=(await db.query(`select event_type,metadata,occurred_at from whatsapp_bot.traffic_events where client_id=$1
      order by occurred_at desc limit 8`,[booking.client_id])).rows;
    console.log(JSON.stringify({booking,queue,messages,events}));
  }
  console.log(JSON.stringify({matchingBookings:rows.length}));
  const contacts=(await db.query(`select c.id,c.phone,c.name,c.bot_paused,
    (select whatsapp_message_id from whatsapp_bot.messages m where m.client_id=c.id order by created_at desc limit 1) as latest_message_id
    from whatsapp_bot.clients c where regexp_replace(c.phone,'[^0-9]','','g') like '%94432962'`)).rows;
  console.log(JSON.stringify({phoneVariants:contacts}));
}finally{await db.query('rollback');db.release();}
