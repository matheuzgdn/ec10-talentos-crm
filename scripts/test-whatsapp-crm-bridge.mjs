import pg from "pg";

const { Client } = pg;

if (!process.env.DB_URL || !process.env.PGPASSWORD) {
  throw new Error("DB_URL and PGPASSWORD are required.");
}

const client = new Client({
  connectionString: process.env.DB_URL,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query("begin");
  const phone = `559999${Date.now()}`;
  const insertedClient = await client.query(
    `insert into whatsapp_bot.clients (phone, name, region, tags)
     values ($1, 'Teste automatizado', 'BR', array['eurocamp_latam'])
     returning id`,
    [phone],
  );
  const clientId = insertedClient.rows[0].id;

  const mirroredLead = await client.query(
    `select id, data->>'telefone' as phone, data->>'origem_captacao' as source
       from public.leads
      where data->>'whatsapp_client_id' = $1`,
    [clientId],
  );
  if (mirroredLead.rowCount !== 1) throw new Error("Client was not mirrored to CRM leads.");

  const whatsappMessageId = `test-${Date.now()}`;
  await client.query(
    `insert into whatsapp_bot.messages
       (client_id, direction, body, media_type, whatsapp_message_id)
     values ($1, 'inbound', 'Mensagem sintetica de teste', 'text', $2)
     returning id`,
    [clientId, whatsappMessageId],
  );

  const mirroredHistory = await client.query(
    `select id
       from public.historico_interacoes
      where data->>'whatsapp_message_id' = $1`,
    [whatsappMessageId],
  );
  if (mirroredHistory.rowCount !== 1) throw new Error("Message was not mirrored to CRM history.");

  const startedConversation = await client.query(
    `select
       data->>'status' as status,
       data->>'whatsapp_atendimento_status' as attendance_status,
       data->>'responsavel_atual' as owner
     from public.leads
     where data->>'whatsapp_client_id' = $1`,
    [clientId],
  );
  if (startedConversation.rows[0]?.status !== 'contato_realizado') {
    throw new Error('Inbound message did not start the diagnosis stage.');
  }
  if (startedConversation.rows[0]?.attendance_status !== 'aguardando_responsavel') {
    throw new Error('Inbound message did not enter the unassigned attendance queue.');
  }
  if (startedConversation.rows[0]?.owner) {
    throw new Error('Inbound message assigned a seller without an explicit CRM action.');
  }

  await client.query(
    `update whatsapp_bot.clients
     set athlete_age = 15,
         service_interest = 'eurocamp',
         tags = tags || array['ia_conversacional', 'temperatura_quente', 'ia_qualificado']::text[]
     where id = $1`,
    [clientId],
  );
  const aiProfile = await client.query(
    `select
       data->>'idade_atleta' as athlete_age,
       data->>'temperatura' as temperature,
       data->>'ia_sdr_ativa' as ai_active,
       data->>'ia_qualificacao_status' as qualification
     from public.leads
     where data->>'whatsapp_client_id' = $1`,
    [clientId],
  );
  if (aiProfile.rows[0]?.athlete_age !== '15'
    || aiProfile.rows[0]?.temperature !== 'quente'
    || aiProfile.rows[0]?.ai_active !== 'true'
    || aiProfile.rows[0]?.qualification !== 'qualificado') {
    throw new Error(`AI profile was not mirrored to CRM: ${JSON.stringify(aiProfile.rows[0])}`);
  }

  console.log(JSON.stringify({
    clientToLead: true,
    messageToHistory: true,
    diagnosisStarted: true,
    remainsUnassigned: true,
    aiProfileToCrm: true,
    transactionRolledBack: true,
  }));
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
