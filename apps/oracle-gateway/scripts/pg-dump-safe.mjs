import { spawn } from "node:child_process";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const database = new URL(process.env.DATABASE_URL);
if (!/^postgres(ql)?:$/.test(database.protocol)) throw new Error("Invalid database protocol");

const env = {
  ...process.env,
  PGHOST: database.hostname,
  PGPORT: database.port || "5432",
  PGUSER: decodeURIComponent(database.username),
  PGPASSWORD: decodeURIComponent(database.password),
  PGDATABASE: decodeURIComponent(database.pathname.slice(1)),
  PGSSLMODE: database.searchParams.get("sslmode") || "require",
  PGCONNECT_TIMEOUT: "15",
};
delete env.DATABASE_URL;

const child = spawn(
  "/usr/pgsql-17/bin/pg_dump",
  ["--format=custom", "--no-owner", "--no-privileges"],
  { env, stdio: ["ignore", "inherit", "inherit"] },
);
child.on("error", (error) => {
  console.error(`pg_dump could not start: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : code ?? 1;
});
