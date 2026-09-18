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
      limit 30`,
    [phone],
  )).rows.reverse();
  const outbox = (await db.query(
    `select message_type, status, attempts, error_message, created_at, sent_at, delivered_at, read_at
       from whatsapp_bot.gustavo_v2_outbox
      where phone = $1
      order by created_at desc
      limit 30`,
    [phone],
  )).rows.reverse();
  const deliveryStatuses = (await db.query(
    `select status_item->>'id' as message_id,
            status_item->>'status' as status,
            status_item->>'timestamp' as meta_timestamp,
            event.created_at
       from whatsapp_bot.meta_webhook_events event
       cross join lateral jsonb_array_elements(coalesce(event.payload->'entry', '[]'::jsonb)) entry_item
       cross join lateral jsonb_array_elements(coalesce(entry_item->'changes', '[]'::jsonb)) change_item
       cross join lateral jsonb_array_elements(coalesce(change_item->'value'->'statuses', '[]'::jsonb)) status_item
      where status_item->>'recipient_id' = $1
      order by event.created_at desc
      limit 12`,
    [phone],
  )).rows.reverse();
  console.log(JSON.stringify({ found: Boolean(contact), contact, turns, outbox, deliveryStatuses }, null, 2));
  await db.query("rollback");
} catch (error) {
  await db.query("rollback").catch(() => undefined);
  throw error;
} finally {
  db.release();
}
