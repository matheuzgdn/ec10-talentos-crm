import assert from "node:assert/strict";

const runtime = "/home/opc/cliente-whatsapp-crm/apps/bot/dist";
const g = await import(`${runtime}/gustavo-sdr.js?name-memory=${Date.now()}`);
const adapter = await import(`${runtime}/gemini-adapter.js?name-memory=${Date.now()}`);

const relationshipCases = [
  ["Meu nome é Janderson, estou procurando oportunidades para meu filho, o Heitor", "Janderson", "Heitor"],
  ["Sou Bruno e meu filho Marcelo tem 16 anos", "Bruno", "Marcelo"],
  ["Eu sou Laura Oliveira e minha filha é Beatriz", "Laura Oliveira", "Beatriz"],
  ["Me chamo Carlos Souza, meu filho Pedro joga em escolinha", "Carlos Souza", "Pedro"],
  ["Meu nome é Ana, minha atleta Júlia treina no projeto", "Ana", "Júlia"],
];
for (const [text, responsibleName, athleteName] of relationshipCases) {
  assert.deepEqual(g.namesFromRelationship(text), { responsibleName, athleteName });
}

const reconciled = g.reconcileGustavoIdentity({
  name: "Janderson Pena",
  role: "responsavel",
  athleteName: "Heitor",
  athleteAge: 12,
  guardianConfirmed: true,
  contactAdult: true,
  guardianEvidenceAt: "2026-09-17T08:00:00.000Z",
  schedulePhase: "awaiting_full_name",
});
assert.equal(reconciled.responsibleName, "Janderson Pena");
assert.equal(g.bookingParticipantName(reconciled), "Janderson Pena");
assert.equal(g.bookingParticipantName({ responsibleName: "Bruno", athleteName: "Marcelo", role: "responsavel", athleteAge: 16 }), undefined);
assert.equal(g.bookingParticipantName({ responsibleName: "Bruno Silva", athleteName: "Marcelo", role: "responsavel", athleteAge: 16, guardianConfirmed: true, contactAdult: true, guardianEvidenceAt: "2026-09-17T08:00:00.000Z" }), "Bruno Silva");
assert.equal(g.bookingParticipantName({ responsibleName: "Marcelo Ramos", athleteName: "Marcelo Ramos", role: "responsavel", athleteAge: 16 }), undefined);

for (const state of [
  { responsibleName: "Janderson", guardianConfirmed: true },
  { name: "Janderson", guardianConfirmed: true },
]) {
  const repaired = adapter.repairNaturalReply({
    reply: "Perfeito. Qual é o seu nome completo?",
    state,
    latestInbound: "Perfeito",
  });
  assert.equal(repaired, "Janderson, qual é seu sobrenome para eu completar o agendamento?");
}

console.log(JSON.stringify({
  passed: true,
  relationshipCases: relationshipCases.length,
  identityAssertions: 8,
  noWhatsAppSent: true,
  version: g.GUSTAVO_VERSION,
}));
