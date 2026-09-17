import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: "/home/opc/cliente-whatsapp-crm/.env", quiet: true });
const phone = String(process.argv[2] || "").replace(/\D/g, "");
if (!phone) throw new Error("phone_required");
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("supabase_config_missing");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  db: { schema: process.env.BOT_DB_SCHEMA || "public" },
});
const { namesFromRelationship, reconcileGustavoIdentity } = await import(
  `/home/opc/cliente-whatsapp-crm/apps/bot/dist/gustavo-sdr.js?repair=${Date.now()}`
);

const { data: clients, error: clientError } = await supabase
  .from("clients")
  .select("id,phone")
  .eq("phone", phone)
  .limit(1);
if (clientError) throw clientError;
const client = clients?.[0];
if (!client) throw new Error("client_not_found");

const [{ data: states, error: stateError }, { data: messages, error: messageError }] = await Promise.all([
  supabase.from("bot_conversation_states").select("id,metadata,role_answer,athlete_age").eq("client_id", client.id).limit(1),
  supabase.from("messages").select("body,created_at").eq("client_id", client.id).eq("direction", "inbound").order("created_at", { ascending: false }).limit(30),
]);
if (stateError) throw stateError;
if (messageError) throw messageError;
const state = states?.[0];
if (!state) throw new Error("state_not_found");

let responsibleName = state.metadata?.responsibleName || state.metadata?.gustavo?.responsibleName || "";
let athleteName = state.metadata?.athleteName || state.metadata?.gustavo?.athleteName || "";
for (const message of [...(messages || [])].reverse()) {
  const found = namesFromRelationship(String(message.body || "").replace(/^Áudio transcrito:\s*/i, ""));
  responsibleName ||= found.responsibleName || "";
  athleteName ||= found.athleteName || "";
}
const legacy = state.metadata?.gustavo?.name || "";
const reconciled = reconcileGustavoIdentity({
  ...(state.metadata?.gustavo || {}),
  name: legacy,
  responsibleName: responsibleName || undefined,
  athleteName: athleteName || undefined,
  role: state.metadata?.gustavo?.role || state.role_answer,
  athleteAge: state.metadata?.gustavo?.athleteAge || state.athlete_age,
});
if (!reconciled.responsibleName) throw new Error("responsible_name_not_recovered");

const metadata = {
  ...(state.metadata || {}),
  responsibleName: reconciled.responsibleName,
  ...(reconciled.athleteName ? { athleteName: reconciled.athleteName } : {}),
  gustavo: reconciled,
};
const { error: updateError } = await supabase
  .from("bot_conversation_states")
  .update({ metadata, role_answer: "responsavel", updated_at: new Date().toISOString() })
  .eq("id", state.id);
if (updateError) throw updateError;

console.log(JSON.stringify({
  repaired: true,
  responsibleNameStored: Boolean(reconciled.responsibleName),
  athleteNameStored: Boolean(reconciled.athleteName),
  schedulePhasePreserved: reconciled.schedulePhase || null,
  messageSent: false,
}));
