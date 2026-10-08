import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { MemoryJobStore } from "../src/memory-job-store.js";

const servers: Awaited<ReturnType<typeof buildServer>>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });

describe("HTTP API", () => {
  it("keeps user jobs private and lets an authorized worker complete one", async () => {
    const server = await buildServer({
      store: new MemoryJobStore(),
      userToken: "user-secret",
      adminToken: "admin-secret",
      workerToken: "worker-secret",
      leaseSeconds: 60
    });
    servers.push(server);

    const unauthorized = await server.inject({ method: "GET", url: "/api/jobs" });
    expect(unauthorized.statusCode).toBe(401);

    const created = await server.inject({
      method: "POST",
      url: "/api/jobs",
      headers: { authorization: "Bearer user-secret", "idempotency-key": "job-1" },
      payload: { prompt: "Write a greeting" }
    });
    expect(created.statusCode).toBe(201);

    const claim = await server.inject({
      method: "POST",
      url: "/api/worker/claim",
      headers: { authorization: "Bearer worker-secret", "x-worker-id": "worker-1" }
    });
    expect(claim.statusCode).toBe(200);
    const leased = claim.json();

    const completed = await server.inject({
      method: "POST",
      url: `/api/worker/attempts/${leased.attempt.id}/complete`,
      headers: { authorization: "Bearer worker-secret", "x-worker-id": "worker-1" },
      payload: { leaseToken: leased.leaseToken, output: "Hello from the worker" }
    });
    expect(completed.statusCode).toBe(200);

    const list = await server.inject({
      method: "GET",
      url: "/api/jobs",
      headers: { authorization: "Bearer user-secret" }
    });
    expect(list.json().jobs[0].output).toBe("Hello from the worker");
  });
});
