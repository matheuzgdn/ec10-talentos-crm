import dotenv from "dotenv";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env", quiet: true });

const search = process.argv[2]?.trim();
if (!search) throw new Error("Informe parte do nome para a busca somente leitura.");

if (process.env.SUPABASE_DB_URL) {
  const pool = new pg.Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
  try {
  await pool.query("begin read only");
  const { rows } = await pool.query(
    `select c.id,
            c.phone,
            c.name,
            c.attribution_metadata->'ai_sdr' as ai_sdr,
            s.stage,
            s.role_answer,
            s.athlete_age,
            s.metadata,
            m.direction,
            m.body,
            m.created_at
       from public.messages m
       join public.clients c on c.id = m.client_id
       left join public.bot_conversation_states s on s.client_id = c.id
      where m.created_at > now() - interval '6 hours'
        and (m.body ilike $1 or c.name ilike $1)
      order by m.created_at asc
      limit 40`,
    [`%${search}%`],
  );
  console.log(JSON.stringify(rows, null, 2));
  await pool.query("rollback");
  } finally {
    await pool.end();
  }
} else {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_DB_URL ou credenciais server-side do Supabase não configuradas.");
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    db: { schema: process.env.BOT_DB_SCHEMA || "public" },
  });
  const { data: messages, error: messageError } = await supabase
    .from("messages")
    .select("client_id,direction,body,created_at")
    .ilike("body", `%${search}%`)
    .gte("created_at", new Date(Date.now() - 6 * 60 * 60_000).toISOString())
    .order("created_at", { ascending: true })
    .limit(40);
  if (messageError) throw messageError;
  const clientIds = [...new Set((messages ?? []).map((row) => row.client_id))];
  const [{ data: clients, error: clientError }, { data: states, error: stateError }] = await Promise.all([
    clientIds.length
      ? supabase.from("clients").select("id,phone,name,attribution_metadata").in("id", clientIds)
      : Promise.resolve({ data: [], error: null }),
    clientIds.length
      ? supabase.from("bot_conversation_states").select("client_id,stage,role_answer,athlete_age,metadata").in("client_id", clientIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (clientError) throw clientError;
  if (stateError) throw stateError;
  const byClient = new Map((clients ?? []).map((row) => [row.id, row]));
  const stateByClient = new Map((states ?? []).map((row) => [row.client_id, row]));
  console.log(JSON.stringify((messages ?? []).map((message) => {
    const client = byClient.get(message.client_id) ?? {};
    const state = stateByClient.get(message.client_id) ?? {};
    return {
      clientId: message.client_id,
      phone: client.phone,
      name: client.name,
      aiSdr: client.attribution_metadata?.ai_sdr ?? null,
      stage: state.stage ?? null,
      roleAnswer: state.role_answer ?? null,
      athleteAge: state.athlete_age ?? null,
      metadata: state.metadata ?? null,
      direction: message.direction,
      body: message.body,
      createdAt: message.created_at,
    };
  }), null, 2));
}
