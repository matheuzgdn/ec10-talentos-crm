import pg from 'pg';
import {config} from '../apps/bot/dist/config.js';
const pool=new pg.Pool({connectionString:config.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false},max:1});
try {
  const result=await pool.query("select count(*)::int total,count(*) filter(where lower(email)='matheusgdn94@gmail.com')::int matching,count(*) filter(where role='superadmin')::int superadmins,count(*) filter(where is_active=true)::int active from public.profiles");
  console.log(JSON.stringify({restHost:config.SUPABASE_URL?new URL(config.SUPABASE_URL).hostname:null,dbHost:new URL(config.SUPABASE_DB_URL).hostname,profileCounts:result.rows[0],schema:config.BOT_DB_SCHEMA}));
} finally {await pool.end();}
