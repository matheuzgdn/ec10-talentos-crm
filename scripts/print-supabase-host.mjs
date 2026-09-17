import dotenv from "dotenv";
dotenv.config({ quiet: true });
console.log(JSON.stringify({ host: new URL(process.env.SUPABASE_URL ?? "http://missing").hostname, schema: process.env.SUPABASE_SCHEMA ?? "public" }));
