import dotenv from 'dotenv';
import fs from 'node:fs';
const p=dotenv.parse(fs.readFileSync('.env'));
const status=await fetch(`http://127.0.0.1:${p.BOT_HTTP_PORT||8787}/health`).then(r=>r.json()).catch(()=>null);
console.log(JSON.stringify({schema:p.BOT_DB_SCHEMA,instance:p.BOT_INSTANCE_ID,port:p.BOT_HTTP_PORT,
  dbHost:p.SUPABASE_DB_URL?new URL(p.SUPABASE_DB_URL).hostname:null,
  publicPhone:p.EC10_PUBLIC_WHATSAPP_NUMBER,status:status?{ok:status.ok,status:status.status,updatedAt:status.updatedAt,instance:status.botInstanceId}:null}));
