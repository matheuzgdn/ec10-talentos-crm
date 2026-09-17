import {getBotConversationState,getClientAutomationStateByPhone,saveBotConversationState,scheduleOutboundTextMessage} from '../apps/bot/dist/store.js';
import {createClient} from '@supabase/supabase-js';
import {config} from '../apps/bot/dist/config.js';
const phone=String(process.argv[2] || process.env.EC10_TARGET_PHONE || '').replace(/\D/g, '');
if (!phone) throw new Error('Informe o telefone como argumento ou EC10_TARGET_PHONE.');
const c=await getClientAutomationStateByPhone(phone);const state=await getBotConversationState(phone);
if(!c||!state||c.bot_paused||state.completed_at||state.metadata?.meeting?.bookingId)throw new Error('Contact is missing, paused, or already booked; no changes made');
const question=`Sua agenda EC10 foi simplificada: primeiro o dia, depois o horário, com o plano e os dados preenchidos. Falta só o nome completo ${state.athlete_age<18?'do responsável que participará':'de quem participará'} da reunião. Qual é o nome? A confirmação chegará neste WhatsApp.`;
if(state.metadata?.bookingContactPending) {
  const supabase=createClient(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false},db:{schema:config.BOT_DB_SCHEMA}});
  const {data,error}=await supabase.from('outbound_messages').update({body:question}).eq('client_id',c.id).eq('status','queued')
    .eq('body','Sua agenda EC10 foi simplificada: primeiro o dia, depois o horário, com o plano e os dados preenchidos. Falta só o nome completo do responsável que participará da reunião. Qual é o nome? A confirmação chegará neste WhatsApp.').select('id');
  if(error)throw error;
  console.log(JSON.stringify({alreadyPending:true,queuedQuestionAdjusted:data.length,agePreserved:state.athlete_age}));process.exit(0);
}
await saveBotConversationState({clientId:c.id,phone:state.phone,stage:state.stage,
  roleAnswer:state.role_answer,athleteAge:state.athlete_age,ageGroup:state.age_group,serviceInterest:state.service_interest,
  leadPageUrl:state.lead_page_url,completedAt:state.completed_at,
  metadata:{...state.metadata,bookingContactPending:true,audioSequenceInProgress:false}});
await scheduleOutboundTextMessage({clientId:c.id,phone:state.phone,scheduledAt:new Date().toISOString(),
  body:question});
console.log(JSON.stringify({contactResumed:true,agePreserved:state.athlete_age,servicePreserved:state.service_interest,nameQuestionQueued:true}));
