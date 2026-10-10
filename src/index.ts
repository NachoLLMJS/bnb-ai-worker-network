import { resolve } from "node:path";
import { Pool } from "pg";
import { MemoryJobStore } from "./memory-job-store.js";
import { PostgresJobStore } from "./postgres-job-store.js";
import { buildServer } from "./server.js";
import { registerWeb } from "./web.js";
import { MemoryWorkerCredentialStore, PostgresWorkerCredentialStore } from "./worker-credential-store.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const databaseUrl = process.env.DATABASE_URL?.trim();
let store;
let workerCredentials;
if (databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false } });
  const postgres = new PostgresJobStore(pool);
  const credentials = new PostgresWorkerCredentialStore(pool);
  await postgres.initialize();
  await credentials.initialize();
  store = postgres;
  workerCredentials = credentials;
} else {
  if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is required in production");
  store = new MemoryJobStore();
  workerCredentials = new MemoryWorkerCredentialStore();
  await workerCredentials.initialize();
}

const app = await buildServer({
  store,
  userToken: required("USER_ACCESS_TOKEN"),
  adminToken: required("ADMIN_ACCESS_TOKEN"),
  workerToken: process.env.WORKER_ACCESS_TOKEN?.trim() || "",
  legacyWorkerTokenEnabled: process.env.LEGACY_WORKER_TOKEN_ENABLED?.trim().toLowerCase() === "true",
  workerCredentials,
  leaseSeconds: Number(process.env.LEASE_SECONDS || 120)
});

await registerWeb(app, resolve(process.cwd(), "public"));

const port = Number(process.env.PORT || 3000);
await app.listen({ host: "0.0.0.0", port });
