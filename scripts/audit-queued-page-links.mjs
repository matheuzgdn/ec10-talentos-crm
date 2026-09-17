import {bookingPool} from '../api/_booking-db.ts';

const cancel = process.argv.includes('--cancel');
const schemas = (await bookingPool.query(`
  select table_schema
  from information_schema.tables
  where table_name='outbound_messages'
    and table_schema in ('public','whatsapp_bot')
  order by table_schema
`)).rows.map(row => row.table_schema);

const pattern = 'https?://(www\\.)?(ec10talentos\\.com/(instagram|lp/|eurocamp|plano-de-carreira|planos-internacionais)|revelatalentos\\.com)';
const result = [];
for (const schema of schemas) {
  const before = Number((await bookingPool.query(
    `select count(*)::int as count from ${schema}.outbound_messages where status='queued' and coalesce(body,'') ~* $1`,
    [pattern],
  )).rows[0]?.count || 0);
  let cancelled = 0;
  if (cancel && before) {
    const update = await bookingPool.query(
      `update ${schema}.outbound_messages
       set status='cancelled', error_message=concat_ws(' | ',nullif(error_message,''),'Pagina promocional removida por decisao comercial em 2026-09-16')
       where status='queued' and coalesce(body,'') ~* $1`,
      [pattern],
    );
    cancelled = update.rowCount || 0;
  }
  const after = Number((await bookingPool.query(
    `select count(*)::int as count from ${schema}.outbound_messages where status='queued' and coalesce(body,'') ~* $1`,
    [pattern],
  )).rows[0]?.count || 0);
  result.push({schema, queuedBefore: before, cancelled, queuedAfter: after});
}
console.log(JSON.stringify({mode: cancel?'cancel':'audit', result}, null, 2));
