import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { GUSTAVO_SEQUENCE_VERSION, gustavoCareerAudios } from "../apps/bot/dist/gustavo-sequence.js";
import {
  appendClientTags,
  createBotBookingLink,
  saveBotConversationState,
  scheduleOutboundAudioMessage,
  scheduleOutboundTextMessage,
} from "../apps/bot/dist/store.js";

dotenv.config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  override: true,
  quiet: true,
});

const apply = process.argv.includes("--apply");
const hoursArg = process.argv.find((value) => /^--hours=\d+$/.test(value));
const hours = Math.max(1, Math.min(72, Number(hoursArg?.split("=")[1] || 24)));
const staleArg = process.argv.find((value) => /^--stale-minutes=\d+$/.test(value));
const staleMinutes = Math.max(5, Math.min(1440, Number(staleArg?.split("=")[1] || 10)));
const recoveryTag = "recovery_audio_booking_20260918";
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase server configuration is required");

const whatsapp = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}).schema("whatsapp_bot");

function rows(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data || [];
}

function firstName(value) {
  const clean = String(value || "").replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  return clean.split(" ")[0] || "meu irmão";
}

function inferredRole(client, state) {
  if (["responsavel", "atleta"].includes(state?.role_answer)) return state.role_answer;
  const role = client.attribution_metadata?.ai_sdr?.speakerRole;
  if (["responsavel", "atleta"].includes(role)) return role;
  const tags = Array.isArray(client.tags) ? client.tags : [];
  if (tags.includes("responsavel_atleta")) return "responsavel";
  if (tags.includes("atleta")) return "atleta";
  return null;
}

function inferredAge(client, state) {
  for (const value of [client.athlete_age, state?.athlete_age]) {
    const age = Number(value);
    if (Number.isInteger(age) && age >= 8 && age <= 40) return age;
  }
  const tagAges = (Array.isArray(client.tags) ? client.tags : [])
    .map((tag) => String(tag).match(/^idade_(\d{1,2})$/)?.[1])
    .map(Number)
    .filter((age) => Number.isInteger(age) && age >= 8 && age <= 40);
  return tagAges.length === 1 ? tagAges[0] : null;
}

function scheduledAt(offsetSeconds) {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString();
}

const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();
const clients = rows(await whatsapp
  .from("clients")
  .select("id,phone,name,athlete_age,service_interest,bot_paused,tags,attribution_metadata,last_message_at")
  .eq("bot_instance_id", "main")
  .eq("bot_paused", false)
  .gte("last_message_at", since)
  .lte("last_message_at", staleBefore)
  .order("last_message_at", { ascending: false })
  .limit(100), "clients");

const eligible = [];
for (const client of clients) {
  const tags = Array.isArray(client.tags) ? client.tags.map(String) : [];
  const isCareerLead = client.service_interest === "plano_carreira"
    || tags.some((tag) => /plano_carreira|campanha_plano_carreira|funil_lp_campanhas_ec10/i.test(tag));
  if (!isCareerLead) continue;
  if (tags.includes(recoveryTag)) continue;
  if (tags.some((tag) => /opt.?out|nao_contatar|bloqueado|ia_transferencia_humana|ec10_reuniao_agendada/i.test(tag))) continue;

  const inbound = rows(await whatsapp.from("messages")
    .select("id,created_at")
    .eq("client_id", client.id)
    .eq("direction", "inbound")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1), "latest inbound")[0];
  if (!inbound) continue;

  const audio = await whatsapp.from("messages")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client.id)
    .eq("direction", "outbound")
    .in("media_type", ["audio", "audio_file"]);
  if (audio.error) throw new Error(`audio count: ${audio.error.message}`);
  if ((audio.count || 0) > 0) continue;

  const booking = await whatsapp.from("ec10_bookings")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client.id)
    .neq("status", "cancelled");
  if (booking.error) throw new Error(`booking count: ${booking.error.message}`);
  if ((booking.count || 0) > 0) continue;

  const state = rows(await whatsapp.from("bot_conversation_states")
    .select("stage,role_answer,athlete_age,age_group,service_interest,lead_page_url,metadata")
    .eq("client_id", client.id)
    .maybeSingle(), "conversation state");
  const stateRow = Array.isArray(state) ? state[0] : state;
  eligible.push({ client, state: stateRow || null, role: inferredRole(client, stateRow), age: inferredAge(client, stateRow) });
}

const summary = { responsibleOrAdult: 0, minorAthlete: 0, identityPending: 0, agePending: 0 };
for (const item of eligible) {
  if (!item.age) summary.agePending += 1;
  else if (item.role === "atleta" && item.age < 18) summary.minorAthlete += 1;
  else if (!item.role) summary.identityPending += 1;
  else summary.responsibleOrAdult += 1;
}

if (apply) {
  for (const { client, state, role, age } of eligible) {
    const name = firstName(client.name);
    const existingMetadata = state?.metadata && typeof state.metadata === "object" ? state.metadata : {};
    const common = { clientId: client.id, phone: client.phone, botInstanceId: "main" };

    if (!age) {
      await scheduleOutboundTextMessage({ ...common, scheduledAt: scheduledAt(1), body:
        `Oi, ${name}. Desculpa: nosso atendimento anterior não conseguiu concluir seu agendamento. Pra eu enviar os áudios certos do Eric e seguir para a reunião, qual é a idade do atleta?` });
      await saveBotConversationState({ clientId: client.id, phone: client.phone, stage: "awaiting_age", roleAnswer: role,
        athleteAge: null, serviceInterest: "plano_carreira", metadata: { ...existingMetadata,
          source: "gustavo_mandatory_sequence", gustavoSequenceVersion: GUSTAVO_SEQUENCE_VERSION,
          gustavoSequencePhase: "age", recoveryAppliedAt: new Date().toISOString() } });
      await appendClientTags(client.id, [recoveryTag, "aguardando_vendedor", "plano_carreira"]);
      continue;
    }

    await scheduleOutboundTextMessage({ ...common, scheduledAt: scheduledAt(1), body:
      `Oi, ${name}. Desculpa: nosso atendimento anterior não conseguiu concluir seu agendamento. Vou enviar agora os áudios do Eric Cena sobre o Plano de Carreira e, em seguida, o próximo passo.` });
    const audioPaths = gustavoCareerAudios(age).map((audio) => audio.audioPath);
    for (const [index, mediaPath] of audioPaths.entries()) {
      await scheduleOutboundAudioMessage({ ...common, mediaPath, scheduledAt: scheduledAt(5 + index * 6) });
    }

    const minorAthlete = role === "atleta" && age < 18;
    const unknownRole = !role;
    let phase = "booking";
    let stage = "awaiting_booking_completion";
    let bookingUrl = null;
    if (minorAthlete) {
      phase = "guardian_wait";
      stage = "awaiting_interest";
      await scheduleOutboundTextMessage({ ...common, scheduledAt: scheduledAt(18), body:
        "Como você é menor de idade, o pai, a mãe ou o responsável legal precisa continuar esta conversa e participar da reunião. Ele pode se identificar por aqui?" });
    } else if (unknownRole) {
      phase = "identity";
      stage = "awaiting_interest";
      await scheduleOutboundTextMessage({ ...common, scheduledAt: scheduledAt(18), body:
        "Pra eu liberar o agendamento do jeito certo: você é o atleta ou o responsável por ele?" });
    } else {
      const bookingName = String(client.name || (role === "responsavel" ? "Responsável do atleta" : "Atleta")).trim();
      bookingUrl = await createBotBookingLink({ clientId: client.id, service: "plano_carreira", name: bookingName, role });
      await scheduleOutboundTextMessage({ ...common, scheduledAt: scheduledAt(18), body:
        `Para concluir, escolha primeiro o dia e depois o horário da reunião:\n${bookingUrl}` });
    }

    await saveBotConversationState({ clientId: client.id, phone: client.phone, stage, roleAnswer: role,
      athleteAge: age, ageGroup: age <= 13 ? "8-13" : age <= 19 ? "14-19" : age <= 25 ? "20-25" : "26-plus",
      serviceInterest: "plano_carreira", metadata: { ...existingMetadata,
        source: "gustavo_mandatory_sequence", gustavoSequenceVersion: GUSTAVO_SEQUENCE_VERSION,
        gustavoSequencePhase: phase, ericAiAudioPathsSent: audioPaths,
        guardianConfirmed: role === "responsavel" && age < 18,
        ...(bookingUrl ? { bookingUrl } : {}), recoveryAppliedAt: new Date().toISOString() } });
    await appendClientTags(client.id, [recoveryTag, "aguardando_vendedor", "plano_carreira"]);
  }
}

console.log(JSON.stringify({ mode: apply ? "applied" : "dry-run", hours, staleMinutes, eligible: eligible.length, ...summary }));
