import { bookingPool } from "../api/_booking-db.ts";

const requestedPhone = process.argv[2]?.replace(/\D/g, "");
if (!requestedPhone) throw new Error("Telefone obrigatorio");

const db = await bookingPool.connect();
try {
  const contactRows = (await db.query(
    `select id, phone, name, created_at, updated_at
       from whatsapp_bot.clients
      where app_private.whatsapp_phone_match_key(phone)
          = app_private.whatsapp_phone_match_key($1)
      order by created_at`,
    [requestedPhone],
  )).rows;

  const ids = contactRows.map((row) => row.id);
  const counts: Record<string, number> = {};
  if (ids.length) {
    for (const table of [
      "messages",
      "outbound_messages",
      "bot_conversation_states",
      "traffic_events",
      "ec10_bookings",
      "ec10_bot_booking_links",
    ]) {
      counts[table] = Number((await db.query(
        `select count(*)::int as count from whatsapp_bot.${table} where client_id = any($1::uuid[])`,
        [ids],
      )).rows[0].count);
    }
  }

  const leadCount = Number((await db.query(
    `select count(*)::int as count
       from public.leads
      where organization_id = app_private.ec10_organization_id()
        and app_private.whatsapp_phone_match_key(coalesce(data->>'telefone_e164', data->>'telefone'))
          = app_private.whatsapp_phone_match_key($1)`,
    [requestedPhone],
  )).rows[0].count);

  const inbound = ids.length
    ? (await db.query(
        `select max(created_at) as last_inbound_at
           from whatsapp_bot.messages
          where client_id = any($1::uuid[]) and direction = 'inbound'`,
        [ids],
      )).rows[0].last_inbound_at
    : null;

  console.log(JSON.stringify({
    requestedDigits: requestedPhone,
    matchedContacts: contactRows.map((row) => ({
      id: row.id,
      storedPhone: row.phone,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    counts: { ...counts, leads: leadCount },
    lastInboundAt: inbound,
  }, null, 2));
} finally {
  db.release();
}
