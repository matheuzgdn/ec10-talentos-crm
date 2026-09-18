import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)), override: true, quiet: true });
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase server configuration is required");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).schema("whatsapp_bot");
const tag = "recovery_audio_booking_20260918";
const clientsResult = await db.from("clients").select("id").contains("tags", [tag]);
if (clientsResult.error) throw clientsResult.error;
const ids = (clientsResult.data || []).map((row) => row.id);
if (!ids.length) {
  console.log(JSON.stringify({ recoveredClients: 0 }));
  process.exit(0);
}
const queueResult = await db.from("outbound_messages").select("status,media_type,error_message").in("client_id", ids);
if (queueResult.error) throw queueResult.error;
const sentResult = await db.from("messages").select("media_type").in("client_id", ids).eq("direction", "outbound")
  .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
if (sentResult.error) throw sentResult.error;
const countBy = (items, keyName) => items.reduce((result, item) => {
  const keyValue = String(item[keyName] || "unknown");
  result[keyValue] = (result[keyValue] || 0) + 1;
  return result;
}, {});
console.log(JSON.stringify({
  recoveredClients: ids.length,
  queuedDeliveries: countBy(queueResult.data || [], "status"),
  sentMedia: countBy(sentResult.data || [], "media_type"),
  failureReasons: [...new Set((queueResult.data || []).filter((item) => item.status === "failed")
    .map((item) => String(item.error_message || "unknown").replace(/\d{4,}/g, "[number]")))],
}));
