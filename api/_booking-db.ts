import pg from "pg";
import { SUPABASE_CA } from "./_supabase-ca.js";

let database: pg.Pool | null = null;

function getPool() {
  const connectionString = process.env.EC10_BOOKING_DB_URL;
  if (!connectionString) throw new Error("EC10_BOOKING_DB_URL nao configurada.");
  if (!database) {
    const url = new URL(connectionString);
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);
    database = new pg.Pool({
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: true, ca: process.env.SUPABASE_DB_SSL_CA || SUPABASE_CA },
      max: 1,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      allowExitOnIdle: true
    });
    database.on("error", () => { database = null; });
  }
  return database;
}

export const bookingPool = {
  query: <T extends pg.QueryResultRow = any>(text: string, params?: any[]) => getPool().query<T>(text, params),
  connect: () => getPool().connect()
};
