import {bookingPool} from '../api/_booking-db.ts';
const db=await bookingPool.connect();
try{
  await db.query('begin read only');
  const rows=(await db.query(`select o.status,count(*)::integer as count from whatsapp_bot.outbound_messages o
    join whatsapp_bot.clients c on c.id=o.client_id left join whatsapp_bot.bot_conversation_states s on s.client_id=c.id
    where o.media_type in ('audio','audio_file') and o.media_path~*'(04_14-19_apresentacao|05_14-19_eurocamp|eurocamp)'
      and coalesce(s.athlete_age,c.athlete_age)>=18 and o.created_at>now()-interval '7 days'
    group by o.status order by o.status`)).rows;
  console.log(JSON.stringify({readOnly:true,lastSevenDays:true,adultEurocampAudioQueue:rows}));
}finally{await db.query('rollback');db.release();}
