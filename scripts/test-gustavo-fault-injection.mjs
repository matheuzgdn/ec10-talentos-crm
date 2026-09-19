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
assert.match(indexSource, /gustavo_v2_audio_not_delivered/);
assert.match(whatsappPatchSource, /delete message\.__x_id/);

console.log(JSON.stringify({
  passed: positiveReplies.length + 20,
  total: positiveReplies.length + 20,
  noWhatsAppSent: true,
}, null, 2));
