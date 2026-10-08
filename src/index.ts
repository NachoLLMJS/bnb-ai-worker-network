import { resolve } from "node:path";
import { Pool } from "pg";
import { MemoryJobStore } from "./memory-job-store.js";
import { PostgresJobStore } from "./postgres-job-store.js";
import { buildServer } from "./server.js";
import { registerWeb } from "./web.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const databaseUrl = process.env.DATABASE_URL?.trim();
let store;
if (databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false } });
  const postgres = new PostgresJobStore(pool);
  await postgres.initialize();
  store = postgres;
} else {
  if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is required in production");
  store = new MemoryJobStore();
}

const app = await buildServer({
  store,
  userToken: required("USER_ACCESS_TOKEN"),
  adminToken: required("ADMIN_ACCESS_TOKEN"),
  workerToken: required("WORKER_ACCESS_TOKEN"),
  leaseSeconds: Number(process.env.LEASE_SECONDS || 120)
});

await registerWeb(app, resolve(process.cwd(), "public"));

const port = Number(process.env.PORT || 3000);
await app.listen({ host: "0.0.0.0", port });
