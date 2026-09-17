import {bookingPool} from '../api/_booking-db.ts';
const db=await bookingPool.connect();
try{
 await db.query('begin read only');
 const id='b13498cb-b426-403a-a402-665241bfe572';
 console.log(JSON.stringify({current:(await db.query(`select direction,body,created_at from whatsapp_bot.messages where client_id=$1 order by created_at desc limit 12`,[id])).rows}));
 const archive=(await db.query(`select payload from app_private.ec10_maintenance_backups where target_id=$1 and reason='user-requested-bot-reset-preserve-card-and-booking' order by created_at desc limit 1`,[id])).rows[0];
 console.log(JSON.stringify({previousMessages:archive?.payload.messages.map((m:any)=>({direction:m.direction,body:m.body,created_at:m.created_at})),previousStage:archive?.payload.bot_conversation_states[0]?.stage,previousSdrVersion:archive?.payload.bot_conversation_states[0]?.metadata?.sdrVersion}));
}finally{await db.query('rollback');db.release();}
