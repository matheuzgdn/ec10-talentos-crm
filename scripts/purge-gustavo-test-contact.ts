import { bookingPool } from "../api/_booking-db.ts";

const phone = process.argv[2]?.replace(/\D/g, "");
const apply = process.argv.includes("--apply");
const commercialTest = process.argv.includes("--commercial-test");
if (!phone) throw new Error("Telefone obrigatorio");
const allowedTestPhones = new Set([
  "5531995391330",
  ...(commercialTest ? ["553198526146"] : []),
]);
if (!allowedTestPhones.has(phone)) {
  throw new Error("Limpeza recusada: use somente o numero dedicado ao laboratorio Gustavo");
}

const db = await bookingPool.connect();
try {
  await db.query(apply ? "begin" : "begin read only");
  const lock = apply ? "for update" : "";
  const contacts = (await db.query(
    `select * from whatsapp_bot.clients
      where app_private.whatsapp_phone_match_key(phone)
          = app_private.whatsapp_phone_match_key($1) ${lock}`,
    [phone],
  )).rows;
  if (contacts.length !== 1 || contacts[0].bot_instance_id !== "main") {
    throw new Error("Contato ausente ou ambiguo; nenhuma exclusao realizada");
  }
  const contact = contacts[0];
  const leads = (await db.query(
    `select * from public.leads
      where organization_id = app_private.ec10_organization_id()
        and (data->>'whatsapp_client_id' = $1::text
          or data->>'whatsapp_crm_client_id' = $1::text
          or app_private.whatsapp_phone_match_key(coalesce(data->>'telefone_e164', data->>'telefone'))
            = app_private.whatsapp_phone_match_key($2)) ${lock}`,
    [contact.id, phone],
  )).rows;
  if (leads.length > 1) throw new Error("Mais de um card correspondente; nenhuma exclusao realizada");

  const snapshot: Record<string, any[]> = { clients: contacts, leads };
  const childTables = [
    "messages",
    "outbound_messages",
    "bot_conversation_states",
    "calls",
    "lead_attribution",
    "traffic_events",
    "ec10_bookings",
    "ec10_bot_booking_links",
    "ec10_campaign_registrations",
  ];
  for (const table of childTables) {
    const hasPhone = [
      "outbound_messages",
      "bot_conversation_states",
      "calls",
      "lead_attribution",
      "traffic_events",
      "ec10_bookings",
    ].includes(table);
    snapshot[table] = (await db.query(
      `select * from whatsapp_bot.${table}
        where client_id = $1
        ${hasPhone ? "or app_private.whatsapp_phone_match_key(phone) = app_private.whatsapp_phone_match_key($2)" : ""}
        ${lock}`,
      hasPhone ? [contact.id, phone] : [contact.id],
    )).rows;
  }
  snapshot.gustavo_v2_contacts = (await db.query(
    "select * from whatsapp_bot.gustavo_v2_contacts where phone = $1",
    [phone],
  )).rows;
  snapshot.gustavo_v2_inbox = (await db.query(
    "select * from whatsapp_bot.gustavo_v2_inbox where phone = $1",
    [phone],
  )).rows;
  snapshot.gustavo_v2_outbox = (await db.query(
    "select * from whatsapp_bot.gustavo_v2_outbox where phone = $1",
    [phone],
  )).rows;
  snapshot.gustavo_v2_turns = (await db.query(
    "select * from whatsapp_bot.gustavo_v2_turns where phone = $1",
    [phone],
  )).rows;

  const identifiers = [
    contact.id,
    ...leads.map((lead) => lead.id),
    ...snapshot.ec10_bookings.map((booking) => booking.id),
  ];
  const taskIds = snapshot.ec10_bookings.map((booking) => `booking-${booking.id}`);
  snapshot.tarefas = (await db.query(
    `select t.* from public.tarefas t
      where organization_id = app_private.ec10_organization_id()
        and (id = any($1::text[])
          or exists (
            select 1 from jsonb_path_query(t.data, '$.**') value
            where value #>> '{}' = any($2::text[])
          )) ${lock}`,
    [taskIds, identifiers],
  )).rows;

  const counts = Object.fromEntries(
    Object.entries(snapshot).map(([table, rows]) => [table, rows.length]),
  );
  if (!apply) {
    await db.query("rollback");
    console.log(JSON.stringify({ targetResolved: true, counts }, null, 2));
  } else {
    const backup = (await db.query(
      `insert into app_private.ec10_maintenance_backups(reason, target_id, payload)
       values ('user-requested-complete-gustavo-test-contact-purge', $1, $2::jsonb)
       returning id`,
      [contact.id, JSON.stringify(snapshot)],
    )).rows[0].id;

    await db.query(
      `delete from public.tarefas
        where organization_id = app_private.ec10_organization_id()
          and id = any($1::text[])`,
      [snapshot.tarefas.map((task) => task.id)],
    );
    await db.query("delete from whatsapp_bot.gustavo_v2_outbox where phone = $1", [phone]);
    await db.query("delete from whatsapp_bot.gustavo_v2_inbox where phone = $1", [phone]);
    await db.query("delete from whatsapp_bot.gustavo_v2_contacts where phone = $1", [phone]);
    await db.query(
      `delete from whatsapp_bot.ec10_campaign_registrations
        where client_id = $1 or crm_lead_id::text = any($2::text[])`,
      [contact.id, leads.map((lead) => lead.id)],
    );
    await db.query("delete from whatsapp_bot.ec10_bot_booking_links where client_id = $1", [contact.id]);
    await db.query(
      "delete from whatsapp_bot.ec10_bookings where id = any($1::uuid[])",
      [snapshot.ec10_bookings.map((booking) => booking.id)],
    );
    for (const table of [
      "outbound_messages",
      "bot_conversation_states",
      "calls",
      "lead_attribution",
      "traffic_events",
    ]) {
      await db.query(
        `delete from whatsapp_bot.${table}
          where client_id = $1
            or app_private.whatsapp_phone_match_key(phone)
              = app_private.whatsapp_phone_match_key($2)`,
        [contact.id, phone],
      );
    }
    await db.query("delete from whatsapp_bot.clients where id = $1", [contact.id]);
    await db.query(
      `delete from public.leads
        where organization_id = app_private.ec10_organization_id()
          and id = any($1::text[])`,
      [leads.map((lead) => lead.id)],
    );

    const remaining = (await db.query(
      `select
        (select count(*)::int from whatsapp_bot.clients
          where app_private.whatsapp_phone_match_key(phone) = app_private.whatsapp_phone_match_key($1)) clients,
        (select count(*)::int from public.leads
          where organization_id = app_private.ec10_organization_id()
            and (data->>'whatsapp_client_id' = $2::text
              or app_private.whatsapp_phone_match_key(coalesce(data->>'telefone_e164', data->>'telefone'))
                = app_private.whatsapp_phone_match_key($1))) cards,
        (select count(*)::int from whatsapp_bot.messages where client_id = $2::uuid) messages,
        (select count(*)::int from whatsapp_bot.ec10_bookings where client_id = $2::uuid) bookings,
        (select count(*)::int from whatsapp_bot.gustavo_v2_contacts where phone = $1) gustavo_v2_contacts,
        (select count(*)::int from whatsapp_bot.gustavo_v2_inbox where phone = $1) gustavo_v2_inbox,
        (select count(*)::int from whatsapp_bot.gustavo_v2_outbox where phone = $1) gustavo_v2_outbox`,
      [phone, contact.id],
    )).rows[0];
    if (Object.values(remaining).some((value) => value !== 0)) {
      throw new Error("Falha na verificacao final; exclusao revertida");
    }
    await db.query("commit");
    console.log(JSON.stringify({
      deleted: true,
      counts,
      remaining,
      backupAvailable: true,
      backupId: backup,
    }, null, 2));
  }
} catch (error) {
  await db.query("rollback");
  throw error;
} finally {
  db.release();
}
