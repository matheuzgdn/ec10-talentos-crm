import assert from "node:assert/strict";

const runtime = "/home/opc/cliente-whatsapp-crm/apps/bot/dist";
const g = await import(`${runtime}/gustavo-sdr.js?stress=${Date.now()}`);
const adapter = await import(`${runtime}/gemini-adapter.js?stress=${Date.now()}`);

const responsibleNames = [
  "Janderson Pena", "Bruno Silva", "Laura Oliveira", "Carlos Souza", "Ana Lima",
  "João Pereira", "Márcia Alves", "Rafael Santos", "Beatriz Costa", "Luís Ferreira",
];
const athleteNames = ["Heitor", "Marcelo", "Pedro", "Júlia", "Gabriel"];
const templates = [
  (responsible, athlete) => `Meu nome é ${responsible}, meu filho ${athlete} tem 12 anos`,
  (responsible, athlete) => `Eu sou ${responsible} e minha filha é ${athlete}`,
  (responsible, athlete) => `Me chamo ${responsible}, meu atleta ${athlete} treina em projeto`,
];

let parserChecks = 0;
for (const responsibleName of responsibleNames) {
  for (const athleteName of athleteNames) {
    for (const template of templates) {
      const parsed = g.namesFromRelationship(template(responsibleName, athleteName));
      assert.equal(parsed.responsibleName, responsibleName);
      assert.equal(parsed.athleteName, athleteName);
      parserChecks += 2;
    }
  }
}

let reconciliationChecks = 0;
for (const responsibleName of responsibleNames) {
  for (const athleteName of athleteNames) {
    const state = g.reconcileGustavoIdentity({
      name: responsibleName,
      athleteName,
      role: "responsavel",
      athleteAge: 12,
      guardianConfirmed: true,
      contactAdult: true,
      guardianEvidenceAt: "2026-09-17T08:00:00.000Z",
      schedulePhase: "awaiting_full_name",
    });
    assert.equal(state.responsibleName, responsibleName);
    assert.equal(state.athleteName, athleteName);
    assert.equal(g.bookingParticipantName(state), responsibleName);
    reconciliationChecks += 3;
  }
}

let replyChecks = 0;
for (const responsibleName of responsibleNames) {
  const firstName = responsibleName.split(" ")[0];
  const reply = adapter.repairNaturalReply({
    reply: "Perfeito. Qual é o seu nome completo?",
    state: { responsibleName: firstName, role: "responsavel", guardianConfirmed: true },
    latestInbound: "Pode ser",
  });
  assert.match(reply, new RegExp(`^${firstName},`));
  assert.match(reply, /sobrenome/i);
  replyChecks += 2;
}

console.log(JSON.stringify({
  passed: true,
  totalAssertions: parserChecks + reconciliationChecks + replyChecks,
  parserChecks,
  reconciliationChecks,
  replyChecks,
  noWhatsAppSent: true,
}));
