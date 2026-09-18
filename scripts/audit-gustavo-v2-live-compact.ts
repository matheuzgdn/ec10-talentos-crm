import { bookingPool } from "../api/_booking-db.ts";

const phone = process.argv[2]?.replace(/\D/g, "");
if (!phone) throw new Error("Telefone obrigatorio");

const db = await bookingPool.connect();
try {
  await db.query("begin read only");
  const contact = (await db.query(
    `select phone, state, status, last_error, updated_at
       from whatsapp_bot.gustavo_v2_contacts
      where phone = $1`,
    [phone],
  )).rows[0] ?? null;
  const turns = (await db.query(
    `select inbound_text, response_text, latency_ms, validation, status, error_message, created_at
       from whatsapp_bot.gustavo_v2_turns
      where phone = $1
      order by created_at desc
      limit 6`,
    [phone],
  )).rows;
  const outboxCounts = (await db.query(
    `select status, count(*)::int as total
       from whatsapp_bot.gustavo_v2_outbox
      where phone = $1
      group by status
      order by status`,
    [phone],
  )).rows;
  const recentOutbox = (await db.query(
    `select id, message_type, status, attempts, error_message, created_at, sent_at
       from whatsapp_bot.gustavo_v2_outbox
      where phone = $1
      order by created_at desc
      limit 8`,
    [phone],
  )).rows;
  const recentDead = (await db.query(
    `select phone, message_type, attempts, error_message, created_at
       from whatsapp_bot.gustavo_v2_outbox
      where status = 'dead'
      order by created_at desc
      limit 10`,
  )).rows;
  const bookings = (await db.query(
    `select b.id, b.service, b.contact_name, b.contact_role, b.athlete_age,
            b.starts_at, b.ends_at, b.status, b.created_at, s.name as seller_name
       from whatsapp_bot.ec10_bookings b
       left join whatsapp_bot.sellers s on s.id = b.seller_id
      where app_private.whatsapp_phone_match_key(b.phone)
          = app_private.whatsapp_phone_match_key($1)
      order by b.created_at desc
      limit 5`,
    [phone],
  )).rows;
  console.log(JSON.stringify({ contact, turns, outboxCounts, recentOutbox, bookings, recentDead }, null, 2));
  await db.query("rollback");
} catch (error) {
  await db.query("rollback").catch(() => undefined);
  throw error;
} finally {
  db.release();
}
