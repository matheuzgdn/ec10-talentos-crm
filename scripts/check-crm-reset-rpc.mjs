import { bookingPool } from '../api/_booking-db.ts';

const result = await bookingPool.query(`
  select count(*)::int as count
  from pg_proc function
  join pg_namespace namespace on namespace.oid = function.pronamespace
  where namespace.nspname = 'public'
    and function.proname = 'crm_reset_whatsapp_contact'
`);
console.log(JSON.stringify({ resetRpcAvailable: result.rows[0]?.count === 1 }));
