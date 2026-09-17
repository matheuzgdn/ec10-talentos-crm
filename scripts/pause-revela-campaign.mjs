import pg from "pg";

const campaignTag = "campanha_revela_prioritario";
const pausedUntil = "2099-01-01T00:00:00.000Z";
const message = [
  "Ol\u00e1! Aqui \u00e9 da equipe Revela Talentos.",
  "",
  "Ap\u00f3s a nossa live de lan\u00e7amento, vimos que voc\u00ea demonstrou interesse em entender como dar o pr\u00f3ximo passo na carreira do atleta.",
  "",
  "Por isso, voc\u00ea foi selecionado para receber acesso priorit\u00e1rio \u00e0 nossa p\u00e1gina exclusiva de servi\u00e7os da Revela Talentos.",
  "",
  "Nessa p\u00e1gina, voc\u00ea vai encontrar as oportunidades dispon\u00edveis para atletas que querem mais visibilidade, orienta\u00e7\u00e3o e caminhos reais dentro do futebol.",
  "",
  "Acesse agora pelo link abaixo e veja qual op\u00e7\u00e3o faz mais sentido para o momento do atleta:",
  "",
  "\u{1F449} https://ec10talentos.wixsite.com/website-10/_paylink/AZ5ihGoP",
  "",
  "Essa libera\u00e7\u00e3o \u00e9 para um grupo limitado de pessoas que acompanharam o lan\u00e7amento.",
  "Acesse enquanto a condi\u00e7\u00e3o ainda est\u00e1 dispon\u00edvel."
].join("\n");

const connectionString = [
  process.env.DATABASE_URL,
  process.env.POSTGRES_URL,
  process.env.POSTGRES_URL_NON_POOLING,
  process.env.SUPABASE_DB_URL,
  process.env.PG_CONNECTION_STRING
].find(Boolean);

if (!connectionString) throw new Error("missing database connection env");

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 30000
});

try {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const before = await client.query(
      `
        select o.status, count(*)::int as count
        from public.outbound_messages o
        join public.clients c on c.id = o.client_id
        where c.tags @> array[$1]::text[]
        group by o.status
        order by o.status
      `,
      [campaignTag]
    );

    const paused = await client.query(
      `
        update public.outbound_messages o
        set body = $1,
            scheduled_at = $2::timestamptz,
            error_message = null
        from public.clients c
        where c.id = o.client_id
          and c.tags @> array[$3]::text[]
          and o.status = 'queued'
        returning o.id, o.client_id
      `,
      [message, pausedUntil, campaignTag]
    );

    const messageHistory = await client.query(
      `
        update public.messages m
        set body = $1
        where m.direction = 'outbound'
          and m.body ilike '%Revela Talentos%'
          and exists (
            select 1
            from public.outbound_messages o
            join public.clients c on c.id = o.client_id
            where o.client_id = m.client_id
              and o.status = 'queued'
              and c.tags @> array[$2]::text[]
          )
      `,
      [message, campaignTag]
    );

    const after = await client.query(
      `
        select o.status, count(*)::int as count, min(o.scheduled_at) as first_scheduled, max(o.scheduled_at) as last_scheduled
        from public.outbound_messages o
        join public.clients c on c.id = o.client_id
        where c.tags @> array[$1]::text[]
        group by o.status
        order by o.status
      `,
      [campaignTag]
    );

    const encodingCheck = await client.query(
      `
        select
          count(*) filter (where o.status = 'queued' and o.body like '%?%')::int as queued_with_question_marks,
          count(*) filter (where o.status = 'queued' and o.body like $2)::int as queued_with_correct_link,
          count(*) filter (where o.status = 'queued' and o.scheduled_at = $3::timestamptz)::int as paused_queued
        from public.outbound_messages o
        join public.clients c on c.id = o.client_id
        where c.tags @> array[$1]::text[]
      `,
      [campaignTag, "%/_paylink/AZ5ihGoP%", pausedUntil]
    );

    await client.query("commit");

    console.log(JSON.stringify({
      before: before.rows,
      pausedQueuedOutbound: paused.rowCount,
      updatedQueuedMessageHistory: messageHistory.rowCount,
      after: after.rows,
      encodingCheck: encodingCheck.rows[0]
    }, null, 2));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
