import "dotenv/config";
import pg from "pg";

const phone = process.argv[2]?.replace(/\D/g, "");
if (!phone) {
  throw new Error("Uso: node scripts/reset-whatsapp-contact-by-phone.mjs <telefone>");
}

if (!process.env.SUPABASE_DB_URL) {
  throw new Error("SUPABASE_DB_URL nao configurado.");
}

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

await client.connect();

try {
  await client.query("begin");

  const before = await client.query(
    `
      select
        c.id,
        c.phone,
        s.stage,
        s.athlete_age,
        s.updated_at as state_updated_at,
        count(m.id)::int as message_count,
        max(m.created_at) as last_message_at
      from whatsapp_bot.clients c
      left join whatsapp_bot.bot_conversation_states s on s.client_id = c.id
      left join whatsapp_bot.messages m on m.client_id = c.id
      where app_private.whatsapp_phone_match_key(c.phone)
        = app_private.whatsapp_phone_match_key($1)
      group by c.id, c.phone, s.stage, s.athlete_age, s.updated_at
    `,
    [phone]
  );

  const removed = await client.query(
    `
      with matching_clients as materialized (
        select id
        from whatsapp_bot.clients
        where app_private.whatsapp_phone_match_key(phone)
          = app_private.whatsapp_phone_match_key($1)
      ),
      removed_outbound as (
        delete from whatsapp_bot.outbound_messages
        where client_id in (select id from matching_clients)
        returning id
      ),
      removed_messages as (
        delete from whatsapp_bot.messages
        where client_id in (select id from matching_clients)
        returning id
      ),
      removed_states as (
        delete from whatsapp_bot.bot_conversation_states
        where client_id in (select id from matching_clients)
           or app_private.whatsapp_phone_match_key(phone)
             = app_private.whatsapp_phone_match_key($1)
        returning client_id
      ),
      removed_events as (
        delete from whatsapp_bot.traffic_events
        where client_id in (select id from matching_clients)
           or app_private.whatsapp_phone_match_key(phone)
             = app_private.whatsapp_phone_match_key($1)
        returning id
      ),
      removed_clients as (
        delete from whatsapp_bot.clients
        where id in (select id from matching_clients)
        returning id
      ),
      removed_leads as (
        delete from public.leads
        where app_private.whatsapp_phone_match_key(
          coalesce(data->>'telefone_e164', data->>'telefone')
        ) = app_private.whatsapp_phone_match_key($1)
        returning id
      )
      select
        (select count(*) from removed_outbound)::int as outbound,
        (select count(*) from removed_messages)::int as messages,
        (select count(*) from removed_states)::int as states,
        (select count(*) from removed_events)::int as events,
        (select count(*) from removed_clients)::int as clients,
        (select count(*) from removed_leads)::int as leads
    `,
    [phone]
  );

  await client.query("commit");
  console.log(JSON.stringify({ before: before.rows, removed: removed.rows[0] }, null, 2));
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
