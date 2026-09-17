import assert from "node:assert/strict";

const runtime = "/home/opc/cliente-whatsapp-crm/apps/bot/dist";
const g = await import(`${runtime}/gustavo-sdr.js?ai-battery=${Date.now()}`);
const adapter = await import(`${runtime}/gemini-adapter.js?ai-battery=${Date.now()}`);

const cases = [
  { label: "responsável e atleta na mesma frase", user: "Meu nome é Janderson e meu filho Heitor tem 12 anos", state: {}, expectedRole: "responsavel" },
  { label: "nome completo já conhecido", user: "Perfeito", state: { responsibleName: "Janderson Pena", name: "Janderson Pena", athleteName: "Heitor", role: "responsavel", athleteAge: 12, club: "escolinha", guardianConfirmed: true, contactAdult: true }, forbid: /nome completo|qual é seu nome/i },
  { label: "primeiro nome pede somente sobrenome", user: "Pode ser", state: { responsibleName: "Janderson", name: "Janderson", athleteName: "Heitor", role: "responsavel", athleteAge: 12, club: "escolinha", guardianConfirmed: true, contactAdult: true }, expect: /sobrenome/i },
  { label: "idade conhecida não repete", user: "Ele quer muito evoluir", state: { responsibleName: "Ana", role: "responsavel", athleteAge: 15 }, forbid: /idade|quantos anos/i },
  { label: "clube conhecido não repete", user: "Quero saber como funciona", state: { responsibleName: "Carlos", role: "responsavel", athleteAge: 14, club: "sem clube", guardianConfirmed: true, contactAdult: true }, forbid: /joga em algum clube|está sem clube/i },
  { label: "explica empresa", user: "O que é a EC10?", state: {}, expect: /consultoria|assessoria|carreira|desenvolvimento/i },
  { label: "localização", user: "Onde vocês ficam?", state: {}, expect: /Belo Horizonte|Gutierrez/i },
  { label: "preço", user: "Quanto custa?", state: { role: "responsavel", athleteAge: 13 }, expect: /reunião/i, forbid: /R\$|€|US\$/i },
  { label: "garantia", user: "Vocês garantem contrato em clube?", state: { role: "responsavel", athleteAge: 16 }, forbid: /garantimos|garantia de contrato/i },
  { label: "atleta menor", user: "Sou o atleta, tenho 15 anos e quero participar", state: {}, expect: /responsável|pai|mãe/i },
  { label: "responsável confirmado", user: "Sou a mãe dele", state: { athleteAge: 11 }, expectedRole: "responsavel" },
  { label: "já tem clube", user: "Meu filho já joga em clube", state: { role: "responsavel", athleteAge: 14 }, forbid: /qual clube|joga em algum clube/i },
  { label: "viagem separada", user: "O plano inclui passagem e hospedagem?", state: {}, expect: /separad|à parte|não inclui/i },
  { label: "outro produto", user: "Quero o Plano Internacional para mim", state: {}, expectedTool: "handoff_to_seller" },
  { label: "eurocamp", user: "Quero saber do Eurocamp", state: {}, expectedTool: "handoff_to_seller" },
  { label: "pedido humano", user: "Quero falar com uma pessoa", state: {}, expectedTool: "handoff_to_seller" },
  { label: "dúvida mentoria", user: "Como funciona a mentoria?", state: { role: "responsavel", athleteAge: 17, club: "sem clube", guardianConfirmed: true, contactAdult: true }, expect: /mentoria|Eric|família|orientação/i },
  { label: "sem interrogatório", user: "Estou só conhecendo por enquanto", state: { role: "responsavel", athleteAge: 12 }, forbid: /\?[^?]*\?/ },
];

let passed = 0;
const results = [];
for (const item of cases) {
  const started = Date.now();
  try {
    const deterministic = adapter.selectGustavoKnowledgeAction(item.user);
    let normalized;
    let safe;
    if (deterministic) {
      normalized = deterministic.kind === "handoff" ? { toolName: "handoff_to_seller" } : { toolName: null };
      safe = { ok: true, reply: deterministic.reply, state: item.state || {} };
    } else {
      const message = await g.callGustavoValidatedModel([
        { role: "system", content: `${await g.loadGustavoOperationalPrompt()}\nEstado operacional: ${JSON.stringify(item.state || {})}\nNunca repita fatos já conhecidos. Use as ferramentas quando necessário.` },
        { role: "user", content: item.user },
      ]);
      normalized = adapter.normalizeGeminiMessage(message);
      safe = adapter.resolveSafeReply({ message, state: item.state || {}, latestInbound: item.user });
    }
    assert.equal(safe.ok, true, JSON.stringify(safe.issues));
    if (item.expectedTool) assert.equal(normalized.toolName, item.expectedTool);
    if (item.expectedRole) {
      const facts = { ...adapter.factsFromInbound(item.user), ...g.namesFromRelationship(item.user) };
      assert.equal(facts.role || safe.state?.role, item.expectedRole);
    }
    if (item.expect) assert.match(safe.reply, item.expect);
    if (item.forbid) assert.doesNotMatch(safe.reply, item.forbid);
    assert.ok((String(safe.reply).replace(/https?:\/\/\S+/g, "").match(/\?/g) || []).length <= 1);
    assert.doesNotMatch(String(safe.reply), /```|api_call|update_qualification\s*\(/i);
    passed++;
    results.push({ label: item.label, passed: true, elapsedMs: Date.now() - started });
  } catch (error) {
    results.push({ label: item.label, passed: false, elapsedMs: Date.now() - started, error: error.message });
  }
}
console.log(JSON.stringify({ passed, total: cases.length, noWhatsAppSent: true, results }, null, 2));
if (passed !== cases.length) process.exitCode = 1;
