import { callGustavoValidatedModel } from "../apps/bot/dist/gustavo-sdr.js";

try {
  const message = await callGustavoValidatedModel([
    {
      role: "system",
      content: "Teste isolado de disponibilidade. Responda de forma natural, sem ferramenta e com no máximo uma pergunta.",
    },
    { role: "user", content: "Quero entender como a EC10 ajuda um atleta de 14 anos." },
  ]);
  const hasContent = Boolean(String(message?.content || "").trim());
  const hasToolCall = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
  console.log(JSON.stringify({ status: "reply", hasContent, hasToolCall, noWhatsAppSent: true }));
  if (!hasContent && !hasToolCall) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({
    status: "controlled_error",
    reason: error instanceof Error ? error.message : "unknown_error",
    noWhatsAppSent: true,
  }));
}
