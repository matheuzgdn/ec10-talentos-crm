import "dotenv/config";
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL ausente.");

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 10000
});

try {
  const timeoutRetry = await pool.query(
    `
      update public.outbound_messages
      set status = 'queued',
          error_message = null,
          scheduled_at = now() + interval '5 minutes'
      where media_path like 'ec10_followup:%'
        and status = 'failed'
        and error_message like 'Runtime.callFunctionOn timed out%'
      returning id
    `
  );

  const invalidClients = await pool.query(
    `
      select distinct client_id
      from public.outbound_messages
      where status = 'failed'
        and error_message = 'Numero nao registrado ou indisponivel no WhatsApp.'
    `
  );

  let cancelledInvalid = 0;
  let taggedInvalid = 0;
  for (const row of invalidClients.rows) {
    const cancelled = await pool.query(
      `
        update public.outbound_messages
        set status = 'cancelled',
            error_message = 'Envio cancelado: numero sem WhatsApp registrado.'
        where client_id = $1
          and status = 'queued'
        returning id
      `,
      [row.client_id]
    );
    cancelledInvalid += cancelled.rowCount || 0;

    const tagged = await pool.query(
      `
        update public.clients
        set tags = (
              select array(
                select distinct value
                from unnest(coalesce(public.clients.tags, '{}') || $2::text[]) as tags(value)
                where value is not null and value <> ''
              )
            ),
            updated_at = now()
        where id = $1
        returning id
      `,
      [row.client_id, ["whatsapp_indisponivel", "ec10_followup_cancelado"]]
    );
    taggedInvalid += tagged.rowCount || 0;
  }

  console.log(JSON.stringify({
    timeoutRetried: timeoutRetry.rowCount || 0,
    invalidClients: invalidClients.rowCount || 0,
    cancelledInvalid,
    taggedInvalid
  }, null, 2));
} finally {
  await pool.end();
}
