import assert from "node:assert/strict";
import {
  configuredAiPlatform,
  generateEc10SalesReplyWithAi,
} from "../apps/bot/dist/ai.js";

assert.equal(configuredAiPlatform(), "gemini", "Gemini precisa ser o provedor principal neste teste");

const blocked = "a ec10 começa pelo planejamento da carreira, respeitando o momento do atleta e da família";
const unsafe = /```|api_call|update_qualification\s*\(|"arguments"\s*:/i;
const history = [];
let profile = {};
let knownAge = null;

const turns = [
  "Boa noite, sou Bruno Ramos, pai do Marcelo. Quero conhecer melhor a EC10.",
  "O Marcelo tem 14 anos e está sem clube no momento.",
  "O sonho dele é jogar profissionalmente, mas estamos perdidos sobre o caminho certo.",
];

for (const message of turns) {
  const reply = await generateEc10SalesReplyWithAi({
    message,
    athleteAge: knownAge,
    history,
    profile,
    learningStage: knownAge ? "awaiting_interest" : "awaiting_age",
  });
  assert.ok(reply?.reply, `Gemini não respondeu ao turno: ${message}`);
  assert.doesNotMatch(reply.reply.toLocaleLowerCase("pt-BR"), new RegExp(blocked));
  assert.doesNotMatch(reply.reply, unsafe);
  assert.ok((reply.reply.match(/\?/g) || []).length <= 1, "Gemini enviou mais de uma pergunta");
  knownAge = reply.athleteAge ?? knownAge;
  profile = {
    ...profile,
    speakerRole: reply.speakerRole,
    responsibleName: reply.responsibleName || profile.responsibleName,
    athleteName: reply.athleteName || profile.athleteName,
    guardianConfirmed: reply.guardianConfirmed || profile.guardianConfirmed,
    mainPain: reply.mainPain || profile.mainPain,
    primaryObjective: reply.primaryObjective || profile.primaryObjective,
  };
  history.push({ direction: "inbound", body: message, mediaType: "text" });
  history.push({ direction: "outbound", body: reply.reply, mediaType: "text" });
}

assert.equal(knownAge, 14, "Gemini não preservou a idade do atleta");
console.log(JSON.stringify({
  ok: true,
  provider: configuredAiPlatform(),
  turns: turns.length,
  ageRemembered: knownAge,
  noWhatsAppSent: true,
}));
