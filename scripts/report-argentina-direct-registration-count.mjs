import pg from 'pg';

function cleanText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cleanPhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function day(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : null;
}

const { Client } = pg;
const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const direct = await client.query(`
    select id, name, email, phone, status, created_date, extra_data
    from public.international_leads
    where lower(country) = 'argentina'
      and extra_data ->> 'flow' = 'argentina_registration'
      and coalesce(extra_data ->> 'record_type', 'registration') <> 'payment_receipt'
    order by created_date asc
  `);
  const receipts = await client.query(`
    select id, status, created_date, extra_data
    from public.international_leads
    where lower(country) = 'argentina'
      and extra_data ->> 'flow' = 'argentina_payment_receipt_validation'
      and extra_data ->> 'record_type' = 'payment_receipt'
  `);

  const athletes = new Set();
  const paymentStatuses = {};
  const registrationsByDay = {};

  for (const row of direct.rows) {
    const extra = row.extra_data || {};
    const athlete = cleanText(extra.athlete_name || row.name);
    const phone = cleanPhone(row.phone || extra.phone);
    const email = cleanText(row.email || extra.email);
    const identity = athlete && phone ? `${athlete}|${phone}` : athlete && email ? `${athlete}|${email}` : row.id;
    athletes.add(identity);

    const paymentStatus = cleanText(extra.payment_status || row.status || 'sem_status') || 'sem_status';
    paymentStatuses[paymentStatus] = (paymentStatuses[paymentStatus] || 0) + 1;

    const date = day(row.created_date);
    if (date) registrationsByDay[date] = (registrationsByDay[date] || 0) + 1;
  }

  const receiptStatuses = {};
  for (const row of receipts.rows) {
    const extra = row.extra_data || {};
    const receiptStatus = cleanText(extra.payment_status || row.status || 'sem_status') || 'sem_status';
    receiptStatuses[receiptStatus] = (receiptStatuses[receiptStatus] || 0) + 1;
  }

  console.log(JSON.stringify({
    checked_at_brt: new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date()),
    direct_argentina_form_submissions: direct.rows.length,
    unique_athletes_by_name_and_contact: athletes.size,
    direct_registration_payment_statuses: paymentStatuses,
    payment_receipt_submissions: receipts.rows.length,
    payment_receipt_statuses: receiptStatuses,
    registrations_by_day: registrationsByDay,
  }, null, 2));
} finally {
  await client.end();
}
