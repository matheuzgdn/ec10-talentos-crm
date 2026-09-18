import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)), override: true, quiet: true });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase server configuration is required");

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
}).schema("whatsapp_bot");

const tag = "recovery_audio_booking_20260918";
const clientsResult = await db.from("clients").select("id").contains("tags", [tag]);
if (clientsResult.error) throw clientsResult.error;

const clientIds = (clientsResult.data || []).map((row) => row.id);
if (!clientIds.length) {
  console.log(JSON.stringify({ requeued: 0, reason: "no_recovery_clients" }));
  process.exit(0);
}

const failuresResult = await db
  .from("outbound_messages")
  .select("id")
  .in("client_id", clientIds)
  .eq("status", "failed")
  .ilike("error_message", "%Data passed to getter must include an id property%");
if (failuresResult.error) throw failuresResult.error;

const messageIds = (failuresResult.data || []).map((row) => row.id);
if (!messageIds.length) {
  console.log(JSON.stringify({ requeued: 0, reason: "no_matching_failures" }));
  process.exit(0);
}

const updateResult = await db
  .from("outbound_messages")
  .update({
    status: "queued",
    error_message: null,
    whatsapp_send_attempts: 0,
    scheduled_at: new Date().toISOString(),
  })
  .in("id", messageIds)
  .eq("status", "failed")
  .select("id");
if (updateResult.error) throw updateResult.error;

console.log(JSON.stringify({ requeued: updateResult.data?.length || 0 }));
