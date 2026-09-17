import pg from 'pg';

const suffix = String(process.argv[2] || '').replace(/\D/g, '');
if (!suffix) throw new Error('Informe o telefone, somente com os digitos conhecidos.');
if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL nao configurada.');

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  const contacts = await client.query(`
      select
        c.id,
        c.name,
        c.phone,
        c.last_message_at,
        c.service_interest,
        count(m.id)::int as message_count,
        max(m.created_at) as last_message,
        max(m.created_at) filter (where m.direction = 'inbound') as last_inbound
      from whatsapp_bot.clients c
      left join whatsapp_bot.messages m on m.client_id = c.id
      where regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like '%' || $1
      group by c.id, c.name, c.phone, c.last_message_at, c.service_interest
      order by c.last_message_at desc nulls last
    `, [suffix]);
  const leads = await client.query(`
      select
        id,
        data->>'nome_atleta' as name,
        data->>'telefone' as phone,
        data->>'status' as status,
        data->>'whatsapp_client_id' as whatsapp_client_id,
        data->>'ultima_mensagem_whatsapp' as last_message,
        data->>'ultima_direcao_whatsapp' as direction,
        updated_date
      from public.leads
      where regexp_replace(
        coalesce(data->>'telefone_e164', data->>'telefone', ''),
        '[^0-9]',
        '',
        'g'
      ) like '%' || $1
      order by updated_date desc
    `, [suffix]);
  const runtime = await client.query(`
      select key, payload, updated_at
      from whatsapp_bot.bot_runtime
      where key in ('bot_status', 'whatsapp_qr')
      order by key
    `);

  console.log(JSON.stringify({
    contacts: contacts.rows,
    leads: leads.rows,
    runtime: runtime.rows.map((row) => ({
      runtime_key: row.key,
      status: row.payload?.status || null,
      updated_at: row.updated_at,
      state: row.payload?.state || null,
      aiEnabled: row.payload?.aiEnabled ?? null,
      aiMode: row.payload?.aiMode || null,
      aiAudioEnabled: row.payload?.aiAudioEnabled ?? null,
      aiProvider: row.payload?.aiProvider || null,
      aiConfigured: row.payload?.aiConfigured ?? null,
    })),
  }, null, 2));
} finally {
  await client.end();
}
