import assert from "node:assert/strict";
import fs from "node:fs";
import {
  extractAthleteAge,
  isGuardianConfirmation,
  isPositiveInterest,
} from "../apps/bot/dist/ec10-flow.js";
import {
  conversationRole,
  safeLearningReply,
  singleQuestionReply,
} from "../apps/bot/src/ec10-learning.mjs";

const positiveReplies = ["s", "ss", "sim", "pode", "pode sim", "quero", "claro", "vamos", "bora", "ok", "blz", "beleza", "fechado"];
for (const value of positiveReplies) {
  assert.equal(isPositiveInterest(value), true, `confirmação curta não reconhecida: ${value}`);
}

assert.equal(isGuardianConfirmation("ss"), true);
assert.equal(extractAthleteAge("Meu filho tem 14 anos"), 14);
assert.equal(conversationRole("Sou o pai do Marcelo"), "responsavel");
assert.equal(conversationRole("Eu sou atleta e jogo no sub-15"), "atleta");

const oneQuestion = singleQuestionReply(
  "Ele joga em algum clube? Qual é o objetivo dele no futebol?",
  { age: 14, role: "responsavel" },
);
assert.ok((oneQuestion.match(/\?/g) || []).length <= 1, "mais de uma pergunta foi mantida");

const knownAge = singleQuestionReply("Qual é a idade do atleta?", {
  age: 15,
  role: "responsavel",
  fallback: "Vamos continuar pelo momento esportivo dele.",
});
assert.doesNotMatch(knownAge, /idade|quantos anos/i);

const knownRole = singleQuestionReply("Você é atleta ou responsável?", {
  age: 15,
  role: "responsavel",
  fallback: "Vamos continuar pelo momento esportivo dele.",
});
assert.doesNotMatch(knownRole, /atleta ou responsável/i);

for (const unsafe of [
  "update_qualification(reply='Qual é o nome do responsável?')",
  "```json\n{\"api_call\":\"update_qualification\"}\n```",
  "https://exemplo.com/agenda",
]) {
  assert.equal(safeLearningReply(unsafe), null, `conteúdo interno ou operacional aceito: ${unsafe.slice(0, 18)}`);
}

const indexSource = fs.readFileSync("apps/bot/src/index.ts", "utf8");
const aiSource = fs.readFileSync("apps/bot/src/ai.ts", "utf8");
const storeSource = fs.readFileSync("apps/bot/src/store.ts", "utf8");
const whatsappPatchSource = fs.readFileSync("scripts/patch-whatsapp-web.cjs", "utf8");
const primaryRouteSource = indexSource.match(/async function handleGustavoPrimaryRoute[\s\S]*?\n}\n\nasync function saveGustavoRecoveryPatch/)?.[0] || "";
assert.match(primaryRouteSource, /handleGustavoMandatorySequence\(/);
assert.match(primaryRouteSource, /withSdrCustomerTurn\(/);
assert.match(primaryRouteSource, /awaiting_booking_completion/);
assert.doesNotMatch(primaryRouteSource, /handleEc10SdrTurn\(/);
assert.doesNotMatch(aiSource, /exactLearningReply/);
assert.match(aiSource, /ai_text_provider_result/);
assert.match(indexSource, /withSdrCustomerTurn\(clientId,phone,\(\)=>handleEc10ConversationInternal/);
assert.doesNotMatch(indexSource, /:sdr_turn:\$\{sdrTurn\.turn\}/);
assert.match(indexSource, /stage:\s*"awaiting_booking_completion"/);
assert.match(indexSource, /guardianIdentityPreviouslyContradicted/);
assert.match(indexSource, /sanitizeBotOutboundBody/);
assert.match(indexSource, /findRecentSentAudio/);
assert.match(indexSource, /confirmGustavoV2OracleAudioDelivery/);
assert.match(primaryRouteSource, /gustavo_v2_ai_failover_started/);
assert.match(primaryRouteSource, /handleEc10AiConversation/);
assert.match(primaryRouteSource, /for\(let attempt=0;attempt<1/);
assert.match(primaryRouteSource, /gustavo_v2_audio_recovery_queued/);
assert.match(primaryRouteSource, /gustavo_v2_poll_recovery_queued/);
assert.match(indexSource, /checkBotPersistenceHealth/);
assert.match(indexSource, /status = persistence\.ok \? currentBotStatus : "degraded"/);
assert.match(indexSource, /recoverMissedInboundMessages/);
assert.match(indexSource, /Recovered missed WhatsApp inbound messages/);
assert.match(indexSource, /combinedBody = recovered\.map/);
assert.match(indexSource, /fetchRecentInboundRecoveryCandidates/);
assert.doesNotMatch(indexSource, /recoverMissedInboundMessages[\s\S]{0,1200}client\.getChats\(\)/);
assert.match(storeSource, /const botDbSchema = `\"\$\{config\.BOT_DB_SCHEMA\}\"`/);
assert.match(storeSource, /select 1 from \$\{botDbSchema\}\.clients limit 1/);
assert.doesNotMatch(
  storeSource,
  /public\.(?:bot_conversation_states|bot_dedupe_locks|bot_rules|bot_runtime|calls|clients|ec10_bot_booking_links|messages|outbound_messages|sellers|traffic_events|lead_status)/,
);
assert.match(whatsappPatchSource, /delete message\.__x_id/);

console.log(JSON.stringify({
  passed: positiveReplies.length + 30,
  total: positiveReplies.length + 30,
  noWhatsAppSent: true,
}, null, 2));
