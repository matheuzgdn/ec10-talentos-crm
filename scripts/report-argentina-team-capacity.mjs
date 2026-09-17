import pg from 'pg';

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function athleteKey(row) {
  const extra = row.extra_data || {};
  const athlete = normalizeText(extra.athlete_name || row.name);
  const phone = normalizePhone(row.phone || extra.phone);
  const email = normalizeText(row.email || extra.email);
  return athlete && phone ? `${athlete}|${phone}` : athlete && email ? `${athlete}|${email}` : row.id;
}

function canonicalPosition(value) {
  const position = normalizeText(value);
  if (!position) return 'Não informado';
  if (/(arqueir|arquero|goleir|porteir|goalkeeper)/.test(position)) return 'Goleiro';
  if (/(zagueir|zaguero|defens|lateral|central)/.test(position)) return 'Defensor';
  if (/(meia|medio|midfielder|armador|volante)/.test(position)) return 'Meio-campista';
  if (/(atac|delanter|ponta|extremo|centroavante|9|forward)/.test(position)) return 'Atacante';
  return value;
}

const { Client } = pg;
const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const { rows } = await client.query(`
    select id, name, email, phone, extra_data
    from public.international_leads
    where lower(country) = 'argentina'
      and extra_data ->> 'flow' = 'argentina_registration'
      and coalesce(extra_data ->> 'record_type', 'registration') <> 'payment_receipt'
    order by created_date asc
  `);

  const uniqueAthletes = new Map();
  for (const row of rows) {
    const key = athleteKey(row);
    if (!uniqueAthletes.has(key)) uniqueAthletes.set(key, row);
  }

  const positionFieldUsage = {};
  const positions = {};
  for (const row of uniqueAthletes.values()) {
    const extra = row.extra_data || {};
    const rawPosition = extra.position || extra.athlete_position || extra.posicao || extra.cargo || '';
    const usedField = ['position', 'athlete_position', 'posicao', 'cargo'].find((key) => extra[key]);
    if (usedField) positionFieldUsage[usedField] = (positionFieldUsage[usedField] || 0) + 1;
    const position = canonicalPosition(rawPosition);
    positions[position] = (positions[position] || 0) + 1;
  }

  console.log(JSON.stringify({
    form_submissions: rows.length,
    unique_athletes: uniqueAthletes.size,
    full_eleven_a_side_teams_by_headcount: Math.floor(uniqueAthletes.size / 11),
    athletes_left_after_full_teams: uniqueAthletes.size % 11,
    full_seven_a_side_teams_by_headcount: Math.floor(uniqueAthletes.size / 7),
    athletes_left_after_seven_a_side_teams: uniqueAthletes.size % 7,
    position_field_usage: positionFieldUsage,
    unique_athletes_by_position: positions,
  }, null, 2));
} finally {
  await client.end();
}
