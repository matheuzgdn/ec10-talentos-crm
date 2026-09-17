import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { queueGustavoInbound } from "../apps/bot/dist/gustavo-sdr.js";

dotenv.config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  override: true,
  quiet: true,
});

const guardian = process.argv.includes("--guardian");
const apply = guardian || process.argv.includes("--apply");
const hoursArg = process.argv.find((value) => /^--hours=\d+$/.test(value));
const hours = Math.max(1, Math.min(72, Number(hoursArg?.split("=")[1] || 24)));
const staleArg = process.argv.find((value) => /^--stale-seconds=\d+$/.test(value));
const staleSeconds = Math.max(30, Math.min(3600, Number(staleArg?.split("=")[1] || (guardian ? 180 : 30))));
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase server configuration is required");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}).schema("whatsapp_bot");

function assert(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data || [];
}

const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
const clients = assert(await supabase
  .from("clients")
  .select("*")
  .eq("bot_instance_id", "main")
  .eq("bot_paused", false)
  .gte("last_message_at", since)
  .order("last_message_at", { ascending: false })
  .limit(50), "clients");

const candidates = [];
let attentionRequired = 0;
for (const client of clients) {
  const tags = Array.isArray(client.tags) ? client.tags : [];
  if (tags.some((tag) => /opt.?out|nao_contatar|bloqueado|ia_transferencia_humana/i.test(String(tag)))) continue;

  const inbound = assert(await supabase
    .from("messages")
    .select("body,created_at")
    .eq("client_id", client.id)
    .eq("direction", "inbound")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1), "latest inbound")[0];
  if (!inbound?.body) continue;
  if (Date.now() - Date.parse(inbound.created_at) < staleSeconds * 1000) continue;

  const outbound = assert(await supabase
    .from("messages")
    .select("created_at")
    .eq("client_id", client.id)
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(1), "latest outbound")[0];
  if (outbound?.created_at && Date.parse(outbound.created_at) >= Date.parse(inbound.created_at)) continue;

  const state = assert(await supabase
    .from("bot_conversation_states")
    .select("metadata")
    .eq("client_id", client.id)
    .maybeSingle(), "conversation state");
  const gustavo = state?.metadata?.gustavo || {};
  if (gustavo.pending === true || gustavo.handoff === true || gustavo.disqualified === true) continue;
  const guardianRecoveryCount = Number(gustavo.guardianRecoveryCount || 0);
  if (guardianRecoveryCount >= 3) {
    attentionRequired += 1;
    continue;
  }

  candidates.push({ client, inbound, state, guardianRecoveryCount });
}

if (apply) {
  for (const { client, inbound, state, guardianRecoveryCount } of candidates) {
    await queueGustavoInbound(client, `${client.phone}@c.us`, inbound.body);
    const refreshed = assert(await supabase
      .from("bot_conversation_states")
      .select("metadata")
      .eq("client_id", client.id)
      .maybeSingle(), "refreshed conversation state");
    const refreshedMetadata = refreshed?.metadata || state?.metadata || {};
    const refreshedGustavo = refreshedMetadata.gustavo || {};
    const updateResult = await supabase
      .from("bot_conversation_states")
      .update({
        metadata: {
          ...refreshedMetadata,
          gustavo: {
            ...refreshedGustavo,
            guardianRecoveryCount: guardianRecoveryCount + 1,
            guardianRecoveredAt: new Date().toISOString(),
          },
        },
      })
      .eq("client_id", client.id);
    if (updateResult.error) throw new Error(`guardian metadata: ${updateResult.error.message}`);
  }
}

console.log(JSON.stringify({
  mode: guardian ? "guardian" : apply ? "applied" : "dry-run",
  hours,
  staleSeconds,
  scanned: clients.length,
  recovered: apply ? candidates.length : 0,
  eligible: candidates.length,
  attentionRequired,
}));
