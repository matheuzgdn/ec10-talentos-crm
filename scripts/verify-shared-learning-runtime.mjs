import {config} from '../apps/bot/dist/config.js';
import {fetchEc10LearningBase} from '../apps/bot/dist/store.js';
import {exactLearningReply,LEARNING_VERSION,safeLearningReply} from '../apps/bot/dist/ec10-learning.mjs';
const base=await fetchEc10LearningBase();
const reusable=base.examples.find(item=>item.rating==='corrected' && item.updated_at && safeLearningReply(item.corrected_response));
const exact=reusable?exactLearningReply(base,{stage:reusable.stage,age:reusable.athlete_age,role:reusable.speaker_role||'outro',message:reusable.user_message}):null;
console.log(JSON.stringify({version:LEARNING_VERSION,instance:config.BOT_INSTANCE_ID,mode:config.BOT_AI_MODE,corrected:base.examples.filter(item=>item.rating==='corrected').length,approved:base.examples.filter(item=>item.rating==='approved').length,activeSkills:base.materials.filter(item=>item.analysis?.kind==='skill').length,activeAttendanceCorrections:base.materials.filter(item=>item.analysis?.kind==='attendance_correction').length,literalVerified:!!exact && exact.reply===reusable.corrected_response,realMessagesSent:0},null,2));
process.exit(exact?0:2);
