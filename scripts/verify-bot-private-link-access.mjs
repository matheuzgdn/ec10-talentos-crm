import {createClient} from '@supabase/supabase-js';
import {config} from '../apps/bot/dist/config.js';
import {randomUUID,createHash} from 'node:crypto';
const supabase=createClient(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false},db:{schema:config.BOT_DB_SCHEMA}});
const {error}=await supabase.from('ec10_bot_booking_links').insert({
  access_token_hash:createHash('sha256').update(randomUUID()).digest('hex'),client_id:randomUUID(),
  service:'eurocamp',contact_name:'QA Access - nonexistent contact',contact_role:'responsavel'
});
if(error?.code!=='23503')throw new Error(`Unexpected write-access result: ${error?.code||'none'}`);
console.log(JSON.stringify({schema:config.BOT_DB_SCHEMA,botLinkWriteAccess:true,foreignKeyProtected:true,persistentRows:0}));
