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

  it("publishes only explicitly public jobs through the unauthenticated explorer", async () => {
    const server = await buildServer({
      store: new MemoryJobStore(),
      userToken: "user-secret",
      adminToken: "admin-secret",
      workerToken: "worker-secret",
      leaseSeconds: 60
    });
    servers.push(server);

    const catalog = await server.inject({ method: "GET", url: "/api/services" });
    expect(catalog.statusCode).toBe(200);

    let createdPrivateId = "";
    for (const [key, prompt, isPublic] of [
      ["private-job", "Private customer request", false],
      ["public-job", "Create a public network greeting", true]
    ] as const) {
      const created = await server.inject({
        method: "POST",
        url: "/api/jobs",
        headers: { authorization: "Bearer user-secret", "idempotency-key": key },
        payload: { prompt, serviceId: "text.ollama", isPublic }
      });
      expect(created.statusCode).toBe(201);
      if (!isPublic) createdPrivateId = created.json().id;

      const claim = await server.inject({
        method: "POST",
        url: "/api/worker/claim",
        headers: { authorization: "Bearer worker-secret", "x-worker-id": `worker-${key}` },
        payload: { capabilities: ["text.ollama"] }
      });
      const leased = claim.json();
      await server.inject({
        method: "POST",
        url: `/api/worker/attempts/${leased.attempt.id}/complete`,
        headers: { authorization: "Bearer worker-secret", "x-worker-id": `worker-${key}` },
        payload: { leaseToken: leased.leaseToken, output: `${prompt} completed` }
      });
    }

    const explorer = await server.inject({ method: "GET", url: "/api/explorer/jobs" });
    expect(explorer.statusCode).toBe(200);
    expect(explorer.json().jobs).toHaveLength(1);
    expect(explorer.json().jobs[0]).toMatchObject({
      prompt: "Create a public network greeting",
      serviceId: "text.ollama",
      state: "succeeded",
      output: null
    });
    expect(explorer.json().jobs[0]).not.toHaveProperty("userId");
    expect(explorer.json().jobs[0]).not.toHaveProperty("idempotencyKey");
    expect(explorer.json().jobs[0]).not.toHaveProperty("currentAttemptId");

    const publicId = explorer.json().jobs[0].id;
    const detail = await server.inject({ method: "GET", url: `/api/explorer/jobs/${publicId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      job: {
        id: publicId,
        prompt: "Create a public network greeting",
        serviceId: "text.ollama",
        state: "succeeded",
        output: "Create a public network greeting completed"
      },
      work: {
        claimedAt: expect.any(String),
        completedAt: expect.any(String)
      }
    });
    expect(JSON.stringify(detail.json())).not.toMatch(/worker-public-job|leaseToken|idempotencyKey|userId|currentAttemptId/);

    const privateJob = await server.inject({ method: "GET", url: `/api/explorer/jobs/${createdPrivateId}` });
    expect(privateJob.statusCode).toBe(404);
  });

  it("accepts a published image artifact while keeping large data URLs out of explorer lists", async () => {
    const server = await buildServer({
      store: new MemoryJobStore(), userToken: "user-secret", adminToken: "admin-secret", workerToken: "worker-secret", leaseSeconds: 60
    });
    servers.push(server);
    const created = await server.inject({ method: "POST", url: "/api/jobs", headers: { authorization: "Bearer user-secret", "idempotency-key": "public-image" }, payload: { prompt: "Generate a map", serviceId: "image.openai.gpt-image-2", isPublic: true } });
    const claim = await server.inject({ method: "POST", url: "/api/worker/claim", headers: { authorization: "Bearer worker-secret", "x-worker-id": "image-worker" }, payload: { capabilities: ["image.openai.gpt-image-2"] } });
    const artifact = `data:image/webp;base64,${"a".repeat(150_000)}`;
    const completed = await server.inject({ method: "POST", url: `/api/worker/attempts/${claim.json().attempt.id}/complete`, headers: { authorization: "Bearer worker-secret", "x-worker-id": "image-worker" }, payload: { leaseToken: claim.json().leaseToken, output: artifact } });
    expect(completed.statusCode).toBe(200);
    const explorer = await server.inject({ method: "GET", url: "/api/explorer/jobs" });
    expect(explorer.json().jobs[0]).toMatchObject({ id: created.json().id, output: null });
    const detail = await server.inject({ method: "GET", url: `/api/explorer/jobs/${created.json().id}` });
    expect(detail.json().job.output).toBe(artifact);
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
