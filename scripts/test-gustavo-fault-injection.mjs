import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveSafeReply } from "../apps/bot/dist/gemini-adapter.js";
import { shortAffirmative, shortAffirmativeContext } from "../apps/bot/dist/gustavo-sdr.js";

const cases = [
  {
    label: "tool call em texto",
    message: { content: "update_qualification(reply='Qual é o nome do responsável?')" },
    state: { athleteAge: 14 },
  },
  {
    label: "json cercado por código",
    message: { content: "```json\n{\"api_call\":\"update_qualification\",\"arguments\":{\"reply\":\"Você é o responsável adulto por ele?\"}}\n```" },
    state: { athleteAge: 14 },
  },
  {
    label: "duas perguntas na mesma resposta",
    message: { content: "Ele joga em algum clube? Qual é o objetivo dele no futebol?" },
    state: { athleteAge: 14, role: "responsavel" },
  },
  {
    label: "idade já conhecida",
    message: { content: "Qual é a idade do atleta?" },
    state: { athleteAge: 15, role: "responsavel" },
  },
  {
    label: "resposta vazia",
    message: { content: "" },
    state: { athleteAge: 15, role: "responsavel" },
  },
  {
    label: "resposta repetida",
    message: { content: "A EC10 acompanha o desenvolvimento do atleta. Ele joga em algum clube hoje?" },
    state: { athleteAge: 15, role: "responsavel" },
    recentAssistantReplies: ["A EC10 acompanha o desenvolvimento do atleta."],
  },
];

const results = [];
for (const value of ["s", "ss", "sim", "pode", "pode sim", "quero", "claro", "vamos", "bora", "ok", "blz", "beleza", "fechado"]) {
  assert.equal(shortAffirmative(value), true, `confirmação curta não reconhecida: ${value}`);
}
for (const value of ["não", "talvez", "quanto custa?", "sim, mas quero entender o valor"]) {
  assert.equal(shortAffirmative(value), false, `falso positivo de confirmação: ${value}`);
}
assert.equal(shortAffirmativeContext("ss", "Você é o pai, a mãe ou o responsável adulto por ele?"), "guardian_confirmed");
assert.equal(shortAffirmativeContext("sim", "Posso te enviar o link para escolher o dia e o horário?"), "booking_link");
assert.equal(shortAffirmativeContext("ss", "Ele joga em algum clube hoje?"), "affirmative");
for (const item of cases) {
  const result = resolveSafeReply({
    message: item.message,
    state: item.state,
    recentAssistantReplies: item.recentAssistantReplies || [],
    latestInbound: "Quero saber mais",
  });
  assert.equal(result.ok, true, `${item.label}: ${result.issues?.join(",")}`);
  assert.ok(String(result.reply || "").trim(), `${item.label}: resposta vazia`);
  assert.ok((String(result.reply).match(/\?/g) || []).length <= 1, `${item.label}: mais de uma pergunta`);
  assert.doesNotMatch(String(result.reply), /```|api_call|update_qualification\s*\(/i, `${item.label}: código interno exposto`);
  if (item.label === "idade já conhecida") assert.doesNotMatch(String(result.reply), /idade|quantos anos/i);
  results.push({ label: item.label, passed: true });
}

const indexSource = fs.readFileSync("apps/bot/src/index.ts", "utf8");
assert.match(indexSource, /withSdrCustomerTurn\(lead\.id[\s\S]{0,180}processGustavoBatch/);
assert.match(indexSource, /after:sdrTurn\?\.turn/);

console.log(JSON.stringify({
  passed: results.length + 22,
  total: cases.length + 22,
  noWhatsAppSent: true,
  results,
}, null, 2));
