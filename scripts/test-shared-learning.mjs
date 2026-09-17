import assert from 'node:assert/strict';
import {exactLearningReply,learningPrompt,singleQuestionReply,conversationRole,safeLearningReply} from '../apps/bot/dist/ec10-learning.mjs';
const base={examples:[{id:'safe-example',stage:'awaiting_age',athlete_age:16,speaker_role:'atleta',rating:'corrected',user_message:'Tenho 16 anos.',corrected_response:'Boa, irmão. Vamos olhar os caminhos certos junto com sua família.'}],materials:[{title:'Skill natural',status:'active',analysis:{kind:'skill'},raw_content:'Contextualize antes de perguntar.'}]};
assert.equal(exactLearningReply(base,{stage:'awaiting_age',age:16,role:'atleta',message:'tenho 16 anos!'})?.reply,base.examples[0].corrected_response);
for(const changed of [{stage:'diagnosing'},{age:20},{role:'responsavel'},{message:'Meu pai tem 16 anos'}]) {
  assert.equal(exactLearningReply(base,{stage:'awaiting_age',age:16,role:'atleta',message:'Tenho 16 anos.',...changed}),null);
}
assert.equal(exactLearningReply({examples:[{...base.examples[0],rating:'rejected'}]}, {stage:'awaiting_age',age:16,role:'atleta',message:'Tenho 16 anos.'}),null);
assert.equal(exactLearningReply({examples:[{...base.examples[0],corrected_response:'Pode agendar sozinho'}]}, {stage:'awaiting_age',age:16,role:'atleta',message:'Tenho 16 anos.'}),null);
assert.equal(exactLearningReply({examples:[{...base.examples[0],corrected_response:'R$ 399'}]}, {stage:'awaiting_age',age:16,role:'atleta',message:'Tenho 16 anos.'}),null);
assert.ok(learningPrompt(base,{stage:'awaiting_age',age:16,role:'atleta'}).includes('Contextualize antes'));
assert.ok(!learningPrompt({...base,materials:[{...base.materials[0],status:'inactive'}]},{stage:'awaiting_age',age:16,role:'atleta'}).includes('Contextualize antes'));
assert.equal(conversationRole('então é pra mim mesmo','outro'), 'atleta');
assert.equal(conversationRole('sou o pai','atleta'), 'responsavel');
assert.equal(conversationRole('14 anos estou querendo construir minha carreira','atleta'), 'atleta');
assert.equal(singleQuestionReply('Boa! Onde você treina? Há quanto tempo?',{}), 'Boa! Onde você treina?');
assert.equal(singleQuestionReply('Onde você treina e há quanto tempo?',{fallback:'Onde você treina?'}), 'Onde você treina?');
assert.equal(singleQuestionReply('Você é o atleta ou responsável por ele?',{role:'atleta',fallback:'Vamos ao próximo passo.'}), 'Vamos ao próximo passo.');
assert.equal(singleQuestionReply('Qual a sua idade?',{age:14,fallback:'Vamos ao próximo passo.'}), 'Vamos ao próximo passo.');
assert.equal(safeLearningReply('Qual a idade? Onde joga?'),null);
assert.ok(learningPrompt({materials:[{title:'Correção geral',status:'active',analysis:{kind:'attendance_correction'},raw_content:'Uma descoberta de cada vez.'}]},{}).includes('Uma descoberta de cada vez.'));
console.log('Shared learning: 19 checks passed; natural context, one discovery, corrections and safety.');
