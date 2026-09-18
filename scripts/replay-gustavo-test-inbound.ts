import { randomUUID } from "node:crypto";
import { bookingPool } from "../api/_booking-db.ts";

const phone = process.argv[2]?.replace(/\D/g, "");
const allowed = new Set(["5531995391330", "553198526146"]);
if (!phone || !allowed.has(phone)) throw new Error("Replay permitido somente para numeros do laboratorio Gustavo");

const db = await bookingPool.connect();
try {
  await db.query("begin");
  const contact = (await db.query(
    "select phone from whatsapp_bot.gustavo_v2_contacts where phone = $1 for update",
    [phone],
  )).rows[0];
  if (!contact) throw new Error("Contato V2 do laboratorio nao encontrado");
  const latest = (await db.query(
    `select m.body
       from whatsapp_bot.messages m
       join whatsapp_bot.clients c on c.id = m.client_id
      where app_private.whatsapp_phone_match_key(c.phone) = app_private.whatsapp_phone_match_key($1)
        and m.direction = 'inbound' and m.body is not null
      order by m.created_at desc
      limit 1`,
    [phone],
  )).rows[0];
  if (!latest?.body) throw new Error("Ultima mensagem do laboratorio nao encontrada");
  const id = `lab-replay-${randomUUID()}`;
  await db.query(
    `insert into whatsapp_bot.gustavo_v2_inbox(meta_message_id, phone, message_type, body, raw_message, due_at)
     values ($1, $2, 'text', $3, jsonb_build_object('source', 'lab-replay'), now())`,
    [id, phone, latest.body],
  );
  await db.query("commit");
  console.log(JSON.stringify({ replayQueued: true, body: latest.body }));
} catch (error) {
  await db.query("rollback").catch(() => undefined);
  throw error;
} finally {
  db.release();
}
