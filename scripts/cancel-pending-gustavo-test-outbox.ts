import { bookingPool } from "../api/_booking-db.ts";

const phone = process.argv[2]?.replace(/\D/g, "");
const allowed = new Set(["5531995391330", "553198526146"]);
if (!phone || !allowed.has(phone)) throw new Error("Cancelamento permitido somente para numeros do laboratorio Gustavo");

const db = await bookingPool.connect();
try {
  const result = await db.query(
    `update whatsapp_bot.gustavo_v2_outbox
        set status = 'dead', error_message = 'cancelled_live_test_stale_reply'
      where phone = $1 and status in ('queued', 'failed', 'sending')
      returning id`,
    [phone],
  );
  console.log(JSON.stringify({ pausedPendingReplies: result.rowCount }));
} finally {
  db.release();
}
