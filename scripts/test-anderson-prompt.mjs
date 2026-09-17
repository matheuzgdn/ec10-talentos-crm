import assert from 'node:assert/strict';
import fs from 'node:fs';
const ai=fs.readFileSync('apps/bot/src/ai.ts','utf8');
const index=fs.readFileSync('apps/bot/src/index.ts','utf8');
for(const item of ['Anderson','CHAMP','purchaseStage','investmentReadiness','journeyStage','conversationStyle','objectionCategory'])assert.ok(ai.includes(item),item);
for(const item of ['professionalAiSdr','anderson_sdr_started','crmRegistered','BOT_TEST_ALLOWED_PHONES'])assert.ok(index.includes(item),item);
assert.match(ai,/idade sozinha como prontidão/);
assert.match(ai,/nunca como interrogatório/);
console.log(JSON.stringify({checks:13,result:'passed',persona:'Anderson',qualification:'CHAMP-adapted',adaptiveConversation:true}));
