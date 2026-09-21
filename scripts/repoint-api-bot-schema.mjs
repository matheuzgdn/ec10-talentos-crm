import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const botTables = [
  'bot_conversation_states', 'bot_dedupe_locks', 'bot_runtime', 'clients',
  'crm_auth_sessions', 'crm_auth_users', 'lead_attribution', 'messages',
  'outbound_messages', 'sellers', 'traffic_agent_recommendations',
  'traffic_campaign_drafts', 'traffic_campaign_snapshots', 'traffic_events',
];
const apiDir = path.resolve(import.meta.dirname, '..', 'api');
let filesChanged = 0;
let replacements = 0;
for (const entry of await readdir(apiDir)) {
  if (!entry.endsWith('.ts')) continue;
  const file = path.join(apiDir, entry);
  const before = await readFile(file, 'utf8');
  let after = before;
  for (const table of botTables) {
    const original = `public.${table}`;
    const count = after.split(original).length - 1;
    after = after.replaceAll(original, `whatsapp_bot.${table}`);
    replacements += count;
  }
  if (after === before) continue;
  await writeFile(file, after);
  filesChanged++;
}
console.log(JSON.stringify({ filesChanged, replacements }));
