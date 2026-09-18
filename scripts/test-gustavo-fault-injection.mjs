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
assert.match(indexSource, /withSdrCustomerTurn\(clientState\.id,clientState\.phone,\(\)=>handleEc10SdrTurn/);
assert.match(indexSource, /withSdrCustomerTurn\(clientId,phone,\(\)=>handleEc10ConversationInternal/);
assert.doesNotMatch(indexSource, /:sdr_turn:\$\{sdrTurn\.turn\}/);
assert.match(indexSource, /stage:\s*"awaiting_booking_completion"/);
assert.match(indexSource, /guardianIdentityPreviouslyContradicted/);
assert.match(indexSource, /sanitizeBotOutboundBody/);

console.log(JSON.stringify({
  passed: positiveReplies.length + 16,
  total: positiveReplies.length + 16,
  noWhatsAppSent: true,
}, null, 2));
