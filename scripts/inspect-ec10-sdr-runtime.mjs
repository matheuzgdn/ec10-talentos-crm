import fs from 'node:fs';
import crypto from 'node:crypto';
import {config} from '../apps/bot/dist/config.js';
import {eligibleSdrOffers,SDR_VERSION} from '../apps/bot/dist/sdr-flow.js';
const status=JSON.parse(fs.readFileSync('runtime/bot-status.json','utf8'));
const files=['apps/bot/src/index.ts','apps/bot/src/ai.ts','apps/bot/src/ec10-flow.ts','apps/bot/src/sdr-flow.ts'];
console.log(JSON.stringify({version:SDR_VERSION,status:status.status,instance:config.BOT_INSTANCE_ID,schema:config.BOT_DB_SCHEMA,aiMode:config.BOT_AI_MODE,aiEnabled:config.BOT_AI_ENABLED,aiProvider:config.BOT_AI_PROVIDER,hashes:Object.fromEntries(files.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),audioFiles:[...new Set([8,14,18,22].flatMap(age=>eligibleSdrOffers(age).map(o=>o.audioPath)).filter(Boolean))].map(p=>({path:p,exists:fs.existsSync(p)}))}));
