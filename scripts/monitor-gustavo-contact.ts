import { bookingPool } from "../api/_booking-db.ts";

const requestedPhone = process.argv[2]?.replace(/\D/g, "");
if (!requestedPhone) throw new Error("Telefone obrigatorio");

const db = await bookingPool.connect();
try {
  await db.query("begin read only");
  const contacts = (await db.query(
    `select c.id, c.name, c.bot_paused, c.status, c.last_message_at,
            c.athlete_age, c.service_interest,
            s.stage, s.last_inbound_at, s.last_outbound_at, s.updated_at as state_updated_at,
            s.metadata
       from whatsapp_bot.clients c
       left join whatsapp_bot.bot_conversation_states s on s.client_id = c.id
      where c.bot_instance_id = 'main'
        and app_private.whatsapp_phone_match_key(c.phone)
          = app_private.whatsapp_phone_match_key($1)
      order by c.updated_at desc`,
    [requestedPhone],
  )).rows;

  if (!contacts.length) {
    console.log(JSON.stringify({ found: false, messages: [], bookings: [], failedOutbound: [] }));
  } else {
    const ids = contacts.map((row) => row.id);
    const messages = (await db.query(
      `select direction, body, media_type, created_at
         from whatsapp_bot.messages
        where client_id = any($1::uuid[])
        order by created_at desc
        limit 16`,
      [ids],
    )).rows.reverse();
    const failedOutbound = (await db.query(
      `select status, error_message, body, created_at, sent_at, whatsapp_ack, whatsapp_ack_at
         from whatsapp_bot.outbound_messages
        where client_id = any($1::uuid[])
          and (status = 'failed' or error_message is not null)
        order by created_at desc
        limit 5`,
      [ids],
    )).rows;
    const bookings = (await db.query(
      `select service, contact_role, athlete_age, starts_at, status, created_at
         from whatsapp_bot.ec10_bookings
        where client_id = any($1::uuid[])
        order by created_at desc
        limit 3`,
      [ids],
    )).rows;
    const states = contacts.map((row) => ({
      name: row.name,
      botPaused: row.bot_paused,
      status: row.status,
      lastMessageAt: row.last_message_at,
      athleteAge: row.athlete_age,
      serviceInterest: row.service_interest,
      stage: row.stage,
      lastInboundAt: row.last_inbound_at,
      lastOutboundAt: row.last_outbound_at,
      stateUpdatedAt: row.state_updated_at,
      gustavoPending: row.metadata?.gustavo?.pending === true,
      gustavoDueAt: row.metadata?.gustavo?.dueAt ?? null,
      gustavoLastError: row.metadata?.gustavo?.lastError ?? null,
    }));
    console.log(JSON.stringify({ found: true, states, messages, bookings, failedOutbound }, null, 2));
  }
  await db.query("rollback");
} catch (error) {
  await db.query("rollback");
  throw error;
} finally {
  db.release();
}
