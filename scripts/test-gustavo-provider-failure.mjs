import assert from "node:assert/strict";

process.env.BOT_AI_ENABLED = "false";
const { generateEc10SalesReplyWithAi } = await import("../apps/bot/dist/ai.js");

const result = await generateEc10SalesReplyWithAi({
  message: "Quero entender como a EC10 ajuda um atleta de 14 anos.",
  athleteAge: 14,
  history: [],
});

assert.equal(result, null, "IA desabilitada deve falhar de forma controlada e sem resposta externa");
console.log(JSON.stringify({
  status: "controlled_error",
  reason: "ai_provider_unavailable",
  noWhatsAppSent: true,
}));

