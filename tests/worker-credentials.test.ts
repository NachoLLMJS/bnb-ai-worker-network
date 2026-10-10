import { afterEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { MemoryJobStore } from "../src/memory-job-store.js";
import { buildServer } from "../src/server.js";
import { MemoryWorkerCredentialStore, PostgresWorkerCredentialStore } from "../src/worker-credential-store.js";

const servers: Awaited<ReturnType<typeof buildServer>>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });
const token = (character: string) => `bncw_${character.repeat(43)}`;

describe("individual worker credentials", () => {
  it("registers an idempotent worker-bound token, lists metadata, and revokes it", async () => {
    const credentials = new MemoryWorkerCredentialStore();
    const server = await buildServer({
      store: new MemoryJobStore(), userToken: "user-secret", adminToken: "admin-secret",
      workerToken: "legacy-worker-secret", legacyWorkerTokenEnabled: false,
      workerCredentials: credentials, leaseSeconds: 60
    });
    servers.push(server);

    const issuanceId = "10000000-0000-4000-8000-000000000001";
    const payload = { label: "Friend 1", workerId: "friend-worker-1", token: token("a") };
    const unauthorized = await server.inject({ method: "PUT", url: `/api/admin/worker-credentials/${issuanceId}`, payload });
    expect(unauthorized.statusCode).toBe(401);

    const registered = await server.inject({
      method: "PUT", url: `/api/admin/worker-credentials/${issuanceId}`,
      headers: { authorization: "Bearer admin-secret" }, payload
    });
    expect(registered.statusCode).toBe(201);
    expect(registered.headers["cache-control"]).toBe("no-store");
    expect(registered.json().credential).toMatchObject({ label: "Friend 1", workerId: payload.workerId, enabled: true, lastUsedAt: null });
    expect(JSON.stringify(registered.json())).not.toContain(payload.token);
    expect(JSON.stringify(registered.json())).not.toContain("tokenHash");

    const retried = await server.inject({ method: "PUT", url: `/api/admin/worker-credentials/${issuanceId}`, headers: { authorization: "Bearer admin-secret" }, payload });
    expect(retried.statusCode).toBe(200);
    expect(retried.json().credential.id).toBe(registered.json().credential.id);

    const spoofed = await server.inject({ method: "POST", url: "/api/worker/claim", headers: { authorization: `Bearer ${payload.token}`, "x-worker-id": "friend-worker-2" }, payload: { capabilities: ["text.ollama"] } });
    expect(spoofed.statusCode).toBe(401);
    const accepted = await server.inject({ method: "POST", url: "/api/worker/claim", headers: { authorization: `Bearer ${payload.token}`, "x-worker-id": payload.workerId }, payload: { capabilities: ["text.ollama"] } });
    expect(accepted.statusCode).toBe(204);

    const listed = await server.inject({ method: "GET", url: "/api/admin/worker-credentials", headers: { authorization: "Bearer admin-secret" } });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["cache-control"]).toBe("no-store");
    expect(listed.json().credentials[0]).toMatchObject({ label: "Friend 1", workerId: payload.workerId, lastUsedAt: expect.any(String) });
    expect(JSON.stringify(listed.json())).not.toContain(payload.token);
    expect(JSON.stringify(listed.json())).not.toContain("tokenHash");

    const credentialId = registered.json().credential.id as string;
    const revoked = await server.inject({ method: "POST", url: `/api/admin/worker-credentials/${credentialId}/revoke`, headers: { authorization: "Bearer admin-secret" } });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().credential.enabled).toBe(false);
    const rejected = await server.inject({ method: "POST", url: "/api/worker/claim", headers: { authorization: `Bearer ${payload.token}`, "x-worker-id": payload.workerId }, payload: { capabilities: ["text.ollama"] } });
    expect(rejected.statusCode).toBe(401);
  });

  it("can explicitly disable the universal legacy token", async () => {
    const server = await buildServer({
      store: new MemoryJobStore(), userToken: "user-secret", adminToken: "admin-secret",
      workerToken: "legacy-worker-secret", legacyWorkerTokenEnabled: false,
      workerCredentials: new MemoryWorkerCredentialStore(), leaseSeconds: 60
    });
    servers.push(server);
    const response = await server.inject({ method: "POST", url: "/api/worker/claim", headers: { authorization: "Bearer legacy-worker-secret", "x-worker-id": "legacy-worker" }, payload: { capabilities: ["text.ollama"] } });
    expect(response.statusCode).toBe(401);
  });

  it("persists only token hashes in PostgreSQL and authenticates only the bound worker", async () => {
    const db = newDb();
    const pg = db.adapters.createPg();
    const pool = new pg.Pool();
    const first = new PostgresWorkerCredentialStore(pool as never);
    await first.initialize();
    const input = { issuanceId: "20000000-0000-4000-8000-000000000002", label: "Friend 2", workerId: "friend-worker-2", token: token("b") };
    const registered = await first.register(input);

    const stored = await pool.query("SELECT token_hash, label, worker_id, enabled FROM worker_credentials");
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({ label: "Friend 2", worker_id: input.workerId, enabled: true });
    expect(stored.rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.rows[0].token_hash).not.toContain(input.token);

    const second = new PostgresWorkerCredentialStore(pool as never);
    await expect(second.authenticate(input.token, input.workerId)).resolves.toBe(true);
    await expect(second.authenticate(input.token, "friend-worker-3")).resolves.toBe(false);
    await expect(second.authenticate(token("x"), input.workerId)).resolves.toBe(false);
    const retry = await second.register(input);
    expect(retry).toMatchObject({ created: false, credential: { id: registered.credential.id } });
    await second.revoke(registered.credential.id);
    await expect(second.register(input)).rejects.toThrow("credential_revoked");
    const rotated = await second.register({ ...input, issuanceId: "20000000-0000-4000-8000-000000000003", token: token("c") });
    expect(rotated).toMatchObject({ created: true, credential: { workerId: input.workerId, enabled: true } });
    await pool.end();
  });
});
