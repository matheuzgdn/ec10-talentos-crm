import { bookingPool } from '../api/_booking-db.ts';

const db = await bookingPool.connect();
try {
  await db.query('begin read only');
  const contacts = await db.query(`select id, bot_paused, status, last_message_at
    from whatsapp_bot.clients where regexp_replace(phone, '\\D', '', 'g') like '%94432962'`);
  for (const c of contacts.rows) {
    const messages = await db.query(`select direction, body, media_type, whatsapp_message_id, whatsapp_ack, created_at
      from whatsapp_bot.messages where client_id=$1 order by created_at desc limit 12`, [c.id]);
    const states = await db.query(`select stage, athlete_age, metadata, last_inbound_at, last_outbound_at, updated_at
      from whatsapp_bot.bot_conversation_states where client_id=$1`, [c.id]);
    const events = await db.query(`select event_type, metadata, occurred_at
      from whatsapp_bot.traffic_events where client_id=$1 order by occurred_at desc limit 10`, [c.id]);
    const queue = await db.query(`select media_type,status,error_message,scheduled_at,whatsapp_ack
      from whatsapp_bot.outbound_messages where client_id=$1 and created_at>now()-interval '30 minutes' order by created_at desc limit 8`,[c.id]);
    console.log(JSON.stringify({contact:c, messages:messages.rows, states:states.rows, events:events.rows,queue:queue.rows}));
  }
  const fn = await db.query(`select pg_get_functiondef('public.crm_reset_whatsapp_contact(text)'::regprocedure) as definition`);
  console.log(JSON.stringify({resetRequiresSuperadmin: fn.rows[0].definition.includes('app_private.is_superadmin(auth.uid())')}));
  const other = await db.query(`select id from auth.users where not app_private.is_superadmin(id) limit 1`);
  if (other.rowCount) {
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [other.rows[0].id]);
    await db.query(`select set_config('request.jwt.claim.role','authenticated',true)`);
    await db.query('set local role authenticated');
    try {
      await db.query(`select public.crm_reset_whatsapp_contact('ec10-permission-test-nonexistent')`);
      console.log(JSON.stringify({nonSuperadminBlocked:false}));
    } catch(e) {
      console.log(JSON.stringify({nonSuperadminBlocked:e.code==='42501',code:e.code}));
    }
  }
} finally {
  await db.query('rollback');
  db.release();
}
