import assert from 'node:assert/strict';
import {
  extractExplicitGustavoAge,
  extractGustavoSelfName,
  gustavoCareerAudios,
  gustavoIdentityPrompt,
  gustavoOpeningMessage,
  gustavoPendingQuestion,
  parseGustavoFamiliarity,
  parseGustavoRole,
  parseGustavoYesNo,
} from '../apps/bot/dist/gustavo-sequence.js';

const registered={registered:true,leadName:'Bruno Almeida',role:'responsavel',athleteAge:14};
const newLead={registered:false,leadName:null,role:null,athleteAge:null};

assert.match(gustavoOpeningMessage(newLead),/Sou o Gustavo/);
assert.match(gustavoOpeningMessage(newLead),/Voce ja conhece/);
assert.equal((gustavoOpeningMessage(newLead).match(/\?/g)||[]).length,1);

assert.match(gustavoIdentityPrompt(registered),/responsavel/);
assert.match(gustavoIdentityPrompt(registered),/14 anos/);
assert.equal((gustavoIdentityPrompt(registered).match(/\?/g)||[]).length,1);

assert.equal(parseGustavoFamiliarity('Ainda não conheço vocês'),false);
assert.equal(parseGustavoFamiliarity('Sim, já acompanho a EC10'),true);
assert.equal(parseGustavoRole('sou a mãe do Marcelo'),'responsavel');
assert.equal(parseGustavoRole('eu sou o atleta'),'atleta');
assert.equal(parseGustavoYesNo('pode mandar o link'),true);
assert.equal(parseGustavoYesNo('não consegui ouvir'),false);

assert.equal(extractExplicitGustavoAge('ele tem 14 anos'),14);
assert.equal(extractExplicitGustavoAge('14'),14);
assert.equal(extractExplicitGustavoAge('somos uma empresa de futebol'),null);
assert.equal(extractExplicitGustavoAge('quero uma reunião'),null);
assert.equal(extractGustavoSelfName('Meu nome é Bruno Almeida e sou o pai'),'Bruno Almeida');

const childAudios=gustavoCareerAudios(10);
const teenAudios=gustavoCareerAudios(15);
const adultAudios=gustavoCareerAudios(20);
assert.equal(childAudios.length,2);
assert.equal(teenAudios.length,2);
assert.equal(adultAudios.length,2);
assert.ok(teenAudios.every(item=>!item.audioPath.includes('eurocamp')));
assert.ok(adultAudios.every(item=>!item.audioPath.includes('eurocamp')));
assert.match(gustavoPendingQuestion('audio_confirmation',registered),/ouvir os audios/);
assert.match(gustavoPendingQuestion('meeting_interest',registered),/marcar uma reuniao/);

for(const phase of ['company_familiarity','identity_confirmation','identity','age','audio_confirmation','meeting_interest']) {
  const message=gustavoPendingQuestion(phase,registered);
  assert.ok((message.match(/\?/g)||[]).length<=1,`${phase} must have at most one question`);
}

console.log('Gustavo mandatory sequence: all assertions passed.');
