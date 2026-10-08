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

  it("publishes the service catalog and routes jobs only to matching workers", async () => {
    const server = await buildServer({
      store: new MemoryJobStore(),
      userToken: "user-secret",
      adminToken: "admin-secret",
      workerToken: "worker-secret",
      leaseSeconds: 60
    });
    servers.push(server);

    const catalog = await server.inject({ method: "GET", url: "/api/services", headers: { authorization: "Bearer user-secret" } });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().services.map((service: { id: string }) => service.id)).toContain("text.openai.sol");

    const created = await server.inject({
      method: "POST",
      url: "/api/jobs",
      headers: { authorization: "Bearer user-secret", "idempotency-key": "fable-job" },
      payload: { prompt: "Write dialogue", serviceId: "text.anthropic.fable" }
    });
    expect(created.json()).toMatchObject({ serviceId: "text.anthropic.fable" });

    const wrongWorker = await server.inject({
      method: "POST",
      url: "/api/worker/claim",
      headers: { authorization: "Bearer worker-secret", "x-worker-id": "ollama-worker" },
      payload: { capabilities: ["text.ollama"] }
    });
    expect(wrongWorker.statusCode).toBe(204);

    const fableWorker = await server.inject({
      method: "POST",
      url: "/api/worker/claim",
      headers: { authorization: "Bearer worker-secret", "x-worker-id": "fable-worker" },
      payload: { capabilities: ["text.anthropic.fable"] }
    });
    expect(fableWorker.statusCode).toBe(200);
    expect(fableWorker.json().job.serviceId).toBe("text.anthropic.fable");
  });
});
