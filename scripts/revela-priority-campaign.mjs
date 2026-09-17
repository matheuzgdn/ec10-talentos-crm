import pg from "pg";

const spreadsheetId = "1HUYB-9NuvpELSBFsE20wMhbxPTOhlF8zcm3GG85o6YM";
const sheetGid = "0";
const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${sheetGid}`;
const campaignTag = "campanha_revela_prioritario";
const campaignName = "Revela Talentos - acesso prioritario pos-live";

const message = `Olá! Aqui é da equipe Revela Talentos.

Após a nossa live de lançamento, vimos que você demonstrou interesse em entender como dar o próximo passo na carreira do atleta.

Por isso, você foi selecionado para receber acesso prioritário à nossa página exclusiva de serviços da Revela Talentos.

Nessa página, você vai encontrar as oportunidades disponíveis para atletas que querem mais visibilidade, orientação e caminhos reais dentro do futebol.

Acesse agora pelo link abaixo e veja qual opção faz mais sentido para o momento do atleta:

👉 https://ec10talentos.wixsite.com/website-10/checkout-1?checkoutId=ca727402-d61a-43e5-87f7-2bf948997f08&currency=BRL&contentAppId=324cf725-53d9-4bb2-b8f6-0c8ec9a77f45&contentComponentId=4ca49999-12ba-46d7-8dca-03ee4a6c1b7c

Essa liberação é para um grupo limitado de pessoas que acompanharam o lançamento.
Acesse enquanto a condição ainda está disponível.`;

const brazilianDdds = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99"
]);

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  const valueOf = (name, fallback) => {
    const prefix = `${name}=`;
    const found = process.argv.slice(2).find((item) => item.startsWith(prefix));
    return found ? found.slice(prefix.length) : fallback;
  };

  return {
    execute: args.has("--execute"),
    limit: Number(valueOf("--limit", "0")),
    startDelayMinutes: Number(valueOf("--start-delay-minutes", "2")),
    intervalSeconds: Number(valueOf("--interval-seconds", "45"))
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }

  const [headers, ...dataRows] = rows;
  return dataRows.map((values) => Object.fromEntries(headers.map((header, index) => [header.trim(), values[index]?.trim() ?? ""])));
}

function normalizeText(value) {
  return String(value ?? "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_\s]+/g, "")
    .trim();
}

function sourceMatches(value) {
  const source = normalizeText(value);
  return source === "revelatalentos" || source === "trafego";
}

function normalizePhone(input) {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55")) return digits;
  if (digits.length > 11) return digits;

  const ddd = digits.slice(0, 2);
  if ((digits.length === 10 || digits.length === 11) && brazilianDdds.has(ddd)) {
    return `55${digits}`;
  }

  return digits.length >= 10 ? digits : "";
}

function buildCandidates(rows) {
  const byPhone = new Map();
  const filtered = rows.filter((row) => sourceMatches(row.source));
  let invalidPhones = 0;

  for (const row of filtered) {
    const phone = normalizePhone(row.phone);
    if (!phone) {
      invalidPhones += 1;
      continue;
    }

    const current = byPhone.get(phone);
    const submittedAt = Date.parse(row.submitted_at || "");
    const currentSubmittedAt = Date.parse(current?.submitted_at || "");
    if (!current || (Number.isFinite(submittedAt) && submittedAt >= currentSubmittedAt)) {
      byPhone.set(phone, { ...row, phone });
    }
  }

  return {
    filteredRows: filtered.length,
    invalidPhones,
    duplicateRows: filtered.length - invalidPhones - byPhone.size,
    candidates: Array.from(byPhone.values()).sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)))
  };
}

async function ensureSchema(client) {
  await client.query(`
    alter table public.outbound_messages
      add column if not exists scheduled_at timestamptz
  `);
  await client.query(`
    create index if not exists outbound_status_scheduled_idx
    on public.outbound_messages(status, scheduled_at, created_at)
  `);
}

async function upsertCampaignLead(client, row) {
  const source = normalizeText(row.source) === "trafego" ? "trafego" : "revela-talentos";
  const tags = [campaignTag, `source_${source}`];
  const note = `Campanha: ${campaignName}\nOrigem da planilha: ${row.source || "sem source"}\nFluxo: ${row.flow || "sem flow"}\nPagina: ${row.page || "sem page"}`;

  const result = await client.query(
    `
      insert into public.clients
        (phone, name, source, traffic_source, service_interest, status, bot_paused, tags, notes, updated_at)
      values
        ($1, $2, 'manual', $3, 'plano_carreira', 'triagem', true, $4::text[], $5, now())
      on conflict (phone)
      do update set
        name = coalesce(public.clients.name, excluded.name),
        traffic_source = coalesce(excluded.traffic_source, public.clients.traffic_source),
        service_interest = case
          when public.clients.service_interest = 'nao_definido' then excluded.service_interest
          else public.clients.service_interest
        end,
        status = case
          when public.clients.status = 'novo' then 'triagem'::public.lead_status
          else public.clients.status
        end,
        bot_paused = true,
        tags = (
          select array(
            select distinct value
            from unnest(coalesce(public.clients.tags, '{}') || excluded.tags) as tags(value)
            where value is not null and value <> ''
          )
        ),
        notes = case
          when public.clients.tags @> array[$6]::text[] then public.clients.notes
          else trim(both E'\\n' from concat_ws(E'\\n\\n', nullif(public.clients.notes, ''), excluded.notes))
        end,
        updated_at = now()
      returning id, phone
    `,
    [row.phone, row.full_name || null, source, tags, note, campaignTag]
  );

  return result.rows[0];
}

async function alreadyQueuedOrSent(client, clientId) {
  const result = await client.query(
    `
      select exists (
        select 1
        from public.messages
        where client_id = $1
          and direction = 'outbound'
          and body = $2
      ) as exists
    `,
    [clientId, message]
  );
  return Boolean(result.rows[0]?.exists);
}

async function enqueueMessage(client, lead, scheduledAt, row) {
  await client.query(
    `
      insert into public.outbound_messages
        (client_id, phone, body, media_type, status, scheduled_at)
      values
        ($1, $2, $3, 'text', 'queued', $4)
    `,
    [lead.id, lead.phone, message, scheduledAt]
  );

  await client.query(
    `
      insert into public.messages
        (client_id, direction, body, media_type)
      values
        ($1, 'outbound', $2, 'text')
    `,
    [lead.id, message]
  );

  await client.query(
    `
      insert into public.traffic_events
        (client_id, phone, event_type, channel, platform, campaign_name, utm_source, metadata)
      values
        ($1, $2, 'campaign_revela_priority_queued', 'whatsapp', 'whatsapp', $3, $4, $5::jsonb)
    `,
    [
      lead.id,
      lead.phone,
      campaignName,
      row.source || null,
      JSON.stringify({
        spreadsheetId,
        sheetGid,
        flow: row.flow || null,
        page: row.page || null,
        scheduledAt
      })
    ]
  );
}

async function main() {
  const options = parseArgs();
  const response = await fetch(csvUrl);
  if (!response.ok) throw new Error(`Falha ao baixar planilha: ${response.status}`);

  const csv = await response.text();
  const rows = parseCsv(csv);
  const summary = buildCandidates(rows);
  const selected = options.limit > 0 ? summary.candidates.slice(0, options.limit) : summary.candidates;

  const baseSummary = {
    mode: options.execute ? "execute" : "dry-run",
    totalRows: rows.length,
    filteredRows: summary.filteredRows,
    duplicateRows: summary.duplicateRows,
    invalidPhones: summary.invalidPhones,
    uniqueEligiblePhones: summary.candidates.length,
    selectedForThisRun: selected.length,
    intervalSeconds: options.intervalSeconds,
    startDelayMinutes: options.startDelayMinutes
  };

  const connectionString = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.SUPABASE_DB_URL,
    process.env.PG_CONNECTION_STRING
  ].find(Boolean);

  if (!options.execute) {
    console.log(JSON.stringify(baseSummary, null, 2));
    return;
  }

  if (!connectionString) throw new Error("Variavel de conexao do banco nao encontrada.");

  const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
  let inserted = 0;
  let skippedAlreadySent = 0;

  try {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await ensureSchema(client);

      const startAt = Date.now() + options.startDelayMinutes * 60_000;
      for (const [index, row] of selected.entries()) {
        const lead = await upsertCampaignLead(client, row);
        if (await alreadyQueuedOrSent(client, lead.id)) {
          skippedAlreadySent += 1;
          continue;
        }

        const scheduledAt = new Date(startAt + inserted * options.intervalSeconds * 1000).toISOString();
        await enqueueMessage(client, lead, scheduledAt, row);
        inserted += 1;
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  console.log(JSON.stringify({
    ...baseSummary,
    inserted,
    skippedAlreadySent,
    firstScheduledAt: inserted ? new Date(Date.now() + options.startDelayMinutes * 60_000).toISOString() : null,
    lastScheduledAt: inserted ? new Date(Date.now() + options.startDelayMinutes * 60_000 + (inserted - 1) * options.intervalSeconds * 1000).toISOString() : null
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
