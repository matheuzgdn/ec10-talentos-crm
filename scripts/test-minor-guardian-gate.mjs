import assert from 'node:assert/strict';
import * as gustavo from '/home/opc/cliente-whatsapp-crm/apps/bot/dist/gustavo-sdr.js';
import * as adapter from '/home/opc/cliente-whatsapp-crm/apps/bot/dist/gemini-adapter.js';

const landingIntro = 'Olá, EC10 Talentos! Sou Marcelo Ramos e enviei meu interesse em Plano de Carreira pela página da campanha.';
assert.deepEqual(gustavo.namesFromRelationship(landingIntro), { responsibleName: undefined, athleteName: undefined });
assert.equal(gustavo.contactNameFromSelfIntroduction(landingIntro), 'Marcelo Ramos');

const familyIntro = 'Meu nome é Janderson Pena, estou procurando oportunidades para meu filho, o Heitor';
assert.deepEqual(gustavo.namesFromRelationship(familyIntro), { responsibleName: 'Janderson Pena', athleteName: 'Heitor' });

assert.equal(gustavo.minorGuardianConfirmed({ athleteAge: 17, role: 'responsavel', responsibleName: 'Marcelo Ramos' }), false);
assert.equal(gustavo.minorGuardianConfirmed({ athleteAge: 17, role: 'responsavel', guardianConfirmed: true, contactAdult: true }), false);
assert.equal(gustavo.minorGuardianConfirmed({ athleteAge: 17, role: 'responsavel', guardianConfirmed: true, contactAdult: true, guardianEvidenceAt: '2026-09-17T08:00:00.000Z' }), true);
assert.equal(gustavo.bookingParticipantName({ athleteAge: 17, role: 'responsavel', responsibleName: 'Marcelo Ramos' }), undefined);
assert.equal(gustavo.bookingParticipantName({ athleteAge: 17, role: 'responsavel', responsibleName: 'Marcelo Ramos', guardianConfirmed: true, contactAdult: true, guardianEvidenceAt: '2026-09-17T08:00:00.000Z' }), 'Marcelo Ramos');

const inventedGuardian = adapter.resolveSafeReply({
  message: { tool_calls: [{ id: 't1', type: 'function', function: { name: 'update_qualification', arguments: JSON.stringify({
    reply: 'Perfeito. Posso enviar o link da reunião?',
    role: 'responsavel', guardianConfirmed: true, contactAdult: true,
  }) } }] },
  state: { athleteAge: 17, club: 'sem clube' },
  latestInbound: 'Pode ser',
  recentAssistantReplies: [],
});
assert.notEqual(inventedGuardian.state.role, 'responsavel');
assert.notEqual(inventedGuardian.state.guardianConfirmed, true);
assert.notEqual(inventedGuardian.state.contactAdult, true);

const explicitGuardian = adapter.resolveSafeReply({
  message: { tool_calls: [{ id: 't2', type: 'function', function: { name: 'update_qualification', arguments: JSON.stringify({ reply: 'Perfeito. Qual é seu nome completo?' }) } }] },
  state: { athleteAge: 17, club: 'sem clube' },
  latestInbound: 'Eu sou o pai dele',
  recentAssistantReplies: [],
});
assert.equal(explicitGuardian.state.role, 'responsavel');
assert.equal(explicitGuardian.state.guardianConfirmed, true);
assert.equal(explicitGuardian.state.contactAdult, true);

console.log(JSON.stringify({ passed: true, assertions: 14, version: gustavo.GUSTAVO_VERSION, noWhatsAppSent: true }));
