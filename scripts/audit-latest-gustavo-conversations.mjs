import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), override: true, quiet: true });
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase service configuration is required');
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const bot = supabase.schema('whatsapp_bot');

function rows(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data || [];
}

function contactKey(id) {
  return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 10);
}

function compactMetadata(metadata) {
  const value = metadata && typeof metadata === 'object' ? metadata : {};
  const gustavo = value.gustavo && typeof value.gustavo === 'object' ? value.gustavo : {};
  return {
    responsibleNameKnown: Boolean(value.responsibleName || value.guardianName || gustavo.responsibleName),
    athleteNameKnown: Boolean(value.athleteName || gustavo.athleteName),
    guardianConfirmed: Boolean(value.guardianConfirmed || gustavo.guardianConfirmed),
    meetingRequested: Boolean(value.meetingRequested || gustavo.meetingRequested),
    decisionMakerConfirmed: Boolean(value.decisionMakerConfirmed || gustavo.decisionMakerConfirmed),
    schedulePhase: value.schedulePhase || gustavo.schedulePhase || null,
    handoffRequested: Boolean(value.handoffRequested || gustavo.handoffRequested),
    sdrVersion: value.sdrVersion || gustavo.sdrVersion || null,
    lastAiError: value.lastAiError || gustavo.lastAiError || null,
  };
}

const since = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
const clients = rows(await bot
  .from('clients')
  .select('id,last_message_at,bot_paused,status')
  .gte('last_message_at', since)
  .order('last_message_at', { ascending: false })
  .limit(20), 'clients');

const output = [];
for (const client of clients) {
  const state = rows(await bot
    .from('bot_conversation_states')
    .select('stage,role_answer,athlete_age,service_interest,last_inbound_at,last_outbound_at,updated_at,metadata')
    .eq('client_id', client.id)
    .maybeSingle(), 'state');
  const messages = rows(await bot
    .from('messages')
    .select('direction,body,media_type,whatsapp_ack,created_at')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false })
    .limit(24), 'messages').reverse();
  if (!messages.some(message => message.direction === 'inbound')) continue;
  const queue = rows(await bot
    .from('outbound_messages')
    .select('status,media_type,error_message,whatsapp_ack,created_at,scheduled_at')
    .eq('client_id', client.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(12), 'queue');
  const bookingResult = await bot
    .from('ec10_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id);
  if (bookingResult.error) throw new Error(`bookings: ${bookingResult.error.message}`);

  output.push({
    contactKey: contactKey(client.id),
    lastMessageAt: client.last_message_at,
    botPaused: client.bot_paused,
    status: client.status,
    state: {
      stage: state?.stage || null,
      role: state?.role_answer || null,
      athleteAge: state?.athlete_age || null,
      service: state?.service_interest || null,
      lastInboundAt: state?.last_inbound_at || null,
      lastOutboundAt: state?.last_outbound_at || null,
      updatedAt: state?.updated_at || null,
      metadata: compactMetadata(state?.metadata),
    },
    bookingCount: Number(bookingResult.count || 0),
    messages,
    queue,
  });
}

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), count: output.length, conversations: output }));
