import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { MemoryJobStore } from "../src/memory-job-store.js";
import { MemoryWorkerCredentialStore } from "../src/worker-credential-store.js";

const servers: Awaited<ReturnType<typeof buildServer>>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });

describe("HTTP API", () => {
  it("rejects weak or reused open-worker signing keys", async () => {
    const base = {
      store: new MemoryJobStore(), userToken: "u".repeat(43), adminToken: "a".repeat(43),
      workerToken: "w".repeat(43), legacyWorkerTokenEnabled: false,
      workerCredentials: new MemoryWorkerCredentialStore(), leaseSeconds: 60
    };
    await expect(buildServer({ ...base, openWorkerSigningKey: "short" })).rejects.toThrow("OPEN_WORKER_SIGNING_KEY");
    await expect(buildServer({ ...base, openWorkerSigningKey: `${"A".repeat(42)}B` })).rejects.toThrow("OPEN_WORKER_SIGNING_KEY");
    await expect(buildServer({ ...base, openWorkerSigningKey: base.adminToken })).rejects.toThrow("OPEN_WORKER_SIGNING_KEY");
  });

  it("lets any operator enroll a worker without a pre-issued code and use the returned private identity", async () => {
    const credentials = new MemoryWorkerCredentialStore();
    await credentials.initialize();
    const server = await buildServer({
      store: new MemoryJobStore(),
      userToken: "user-secret",
      adminToken: "admin-secret", openWorkerSigningKey: "s".repeat(43),
      workerToken: "",
      legacyWorkerTokenEnabled: false,
      workerCredentials: credentials,
      leaseSeconds: 60
    });
    servers.push(server);

    const enrolled = await server.inject({
      method: "POST",
      url: "/api/workers/enroll",
      payload: { name: "Amigo 3" }
    });
    expect(enrolled.statusCode).toBe(201);
    expect(enrolled.headers["cache-control"]).toBe("no-store");
    expect(enrolled.json()).toMatchObject({ name: "Amigo 3" });
    expect(enrolled.json().workerId).toMatch(/^amigo-3-[a-f0-9]{32}$/);
    expect(enrolled.json().workerToken).toMatch(/^bncw_[A-Za-z0-9_-]{43}$/);
    expect(await credentials.list()).toHaveLength(0);

    const verified = await server.inject({
      method: "POST", url: "/api/workers/verify",
      headers: { authorization: `Bearer ${enrolled.json().workerToken}`, "x-worker-id": enrolled.json().workerId }
    });
    expect(verified.statusCode).toBe(204);

    const created = await server.inject({
      method: "POST",
      url: "/api/requests",
      payload: { prompt: "Write a short greeting" }
    });
    expect(created.statusCode).toBe(201);

    const claim = await server.inject({
      method: "POST",
      url: "/api/worker/claim",
      headers: {
        authorization: `Bearer ${enrolled.json().workerToken}`,
        "x-worker-id": enrolled.json().workerId
      },
      payload: { capabilities: ["text.ollama"], acceptPublicRequests: true }
    });
    expect(claim.statusCode).toBe(200);

    const mismatched = await server.inject({
      method: "POST",
      url: "/api/worker/claim",
      headers: {
        authorization: `Bearer ${enrolled.json().workerToken}`,
        "x-worker-id": `${enrolled.json().workerId.slice(0, -1)}${enrolled.json().workerId.endsWith("0") ? "1" : "0"}`
      },
      payload: { capabilities: ["text.ollama"], acceptPublicRequests: true }
    });
    expect(mismatched.statusCode).toBe(401);

    const revoked = await server.inject({
      method: "POST",
      url: `/api/admin/open-workers/${enrolled.json().workerId}/revoke`,
      headers: { authorization: "Bearer admin-secret" }
    });
    expect(revoked.statusCode).toBe(204);
    expect(await credentials.isOpenWorkerRevoked(enrolled.json().workerId)).toBe(true);

    const rejectedAfterRevocation = await server.inject({
      method: "POST", url: "/api/workers/verify",
      headers: { authorization: `Bearer ${enrolled.json().workerToken}`, "x-worker-id": enrolled.json().workerId }
    });
    expect(rejectedAfterRevocation.statusCode).toBe(401);
  });

  it("bounds open enrollment and does not charge malformed requests against the allowance", async () => {
    const server = await buildServer({
      store: new MemoryJobStore(), userToken: "user-secret", adminToken: "admin-secret", openWorkerSigningKey: "s".repeat(43),
      workerToken: "", legacyWorkerTokenEnabled: false, workerCredentials: new MemoryWorkerCredentialStore(), leaseSeconds: 60
    });
    servers.push(server);
    for (let index = 0; index < 8; index += 1) {
      expect((await server.inject({ method: "POST", url: "/api/workers/enroll", payload: {} })).statusCode).toBe(400);
    }
    for (let index = 0; index < 5; index += 1) {
      expect((await server.inject({ method: "POST", url: "/api/workers/enroll", payload: { name: `Worker ${index}` } })).statusCode).toBe(201);
    }
    expect((await server.inject({ method: "POST", url: "/api/workers/enroll", payload: { name: "Worker 6" } })).statusCode).toBe(429);
  });

  it("keeps user jobs private and lets an authorized worker complete one", async () => {
    const server = await buildServer({
      store: new MemoryJobStore(),
      userToken: "user-secret",
      adminToken: "admin-secret", openWorkerSigningKey: "s".repeat(43),
      workerToken: "worker-secret",
      legacyWorkerTokenEnabled: true,
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

  it("lets anyone request a private job without a key while only authenticated workers can claim and complete it", async () => {
    const server = await buildServer({
      store: new MemoryJobStore(),
      userToken: "user-secret",
      adminToken: "admin-secret", openWorkerSigningKey: "s".repeat(43),
      workerToken: "worker-secret",
      legacyWorkerTokenEnabled: true,
      leaseSeconds: 60
    });
    servers.push(server);

    const created = await server.inject({
      method: "POST",
      url: "/api/requests",
      payload: { prompt: "Summarize this public request" }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().job).toMatchObject({ state: "queued", isPublic: false });
    expect(created.json().requesterToken).toHaveLength(43);
    expect(created.json().job).not.toHaveProperty("userId");
    expect(created.json().job).not.toHaveProperty("requesterTokenHash");

    const jobId = created.json().job.id;
    const requesterToken = created.json().requesterToken;
    const explorer = await server.inject({ method: "GET", url: "/api/explorer/jobs" });
    expect(explorer.json().jobs).toHaveLength(0);

    const anonymousClaim = await server.inject({ method: "POST", url: "/api/worker/claim", payload: { capabilities: ["text.ollama"] } });
    expect(anonymousClaim.statusCode).toBe(401);

    const defaultWorkerClaim = await server.inject({
      method: "POST",
      url: "/api/worker/claim",
      headers: { authorization: "Bearer worker-secret", "x-worker-id": "private-only-worker" },
      payload: { capabilities: ["text.ollama"] }
    });
    expect(defaultWorkerClaim.statusCode).toBe(204);

    const claim = await server.inject({
      method: "POST",
      url: "/api/worker/claim",
      headers: { authorization: "Bearer worker-secret", "x-worker-id": "public-request-worker" },
      payload: { capabilities: ["text.ollama"], acceptPublicRequests: true }
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().job).not.toHaveProperty("userId");
    expect(claim.json().job).not.toHaveProperty("requesterTokenHash");

    const completed = await server.inject({
      method: "POST",
      url: `/api/worker/attempts/${claim.json().attempt.id}/complete`,
      headers: { authorization: "Bearer worker-secret", "x-worker-id": "public-request-worker" },
      payload: { leaseToken: claim.json().leaseToken, output: "Public request completed" }
    });
    expect(completed.statusCode).toBe(200);

    const wrongToken = await server.inject({ method: "GET", url: `/api/requests/${jobId}`, headers: { "x-request-token": "x".repeat(43) } });
    expect(wrongToken.statusCode).toBe(404);
    const status = await server.inject({ method: "GET", url: `/api/requests/${jobId}`, headers: { "x-request-token": requesterToken } });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ state: "succeeded", output: "Public request completed", isPublic: false });
  });

  it("rate limits public job requests without turning requester access into a shared key", async () => {
    const server = await buildServer({
      store: new MemoryJobStore(),
      userToken: "user-secret",
      adminToken: "admin-secret", openWorkerSigningKey: "s".repeat(43),
      workerToken: "worker-secret",
      legacyWorkerTokenEnabled: true,
      leaseSeconds: 60
    });
    servers.push(server);

    for (let index = 0; index < 10; index += 1) {
      const response = await server.inject({ method: "POST", url: "/api/requests", payload: { prompt: `request ${index}` } });
      expect(response.statusCode).toBe(201);
    }
    const limited = await server.inject({ method: "POST", url: "/api/requests", payload: { prompt: "request 11" } });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: "rate_limit_exceeded" });
  });

  it("publishes only explicitly public jobs through the unauthenticated explorer", async () => {
    const server = await buildServer({
      store: new MemoryJobStore(),
      userToken: "user-secret",
      adminToken: "admin-secret", openWorkerSigningKey: "s".repeat(43),
      workerToken: "worker-secret",
      legacyWorkerTokenEnabled: true,
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
        payload: { prompt, isPublic }
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
      store: new MemoryJobStore(), userToken: "user-secret", adminToken: "admin-secret", openWorkerSigningKey: "s".repeat(43), workerToken: "worker-secret", legacyWorkerTokenEnabled: true, leaseSeconds: 60
    });
    servers.push(server);
    const created = await server.inject({ method: "POST", url: "/api/jobs", headers: { authorization: "Bearer user-secret", "idempotency-key": "public-image" }, payload: { prompt: "Generate a map image", isPublic: true } });
    const claim = await server.inject({ method: "POST", url: "/api/worker/claim", headers: { authorization: "Bearer worker-secret", "x-worker-id": "image-worker" }, payload: { capabilities: ["image.openai.gpt-image-2"] } });
    const artifact = `data:image/webp;base64,${"a".repeat(150_000)}`;
    const completed = await server.inject({ method: "POST", url: `/api/worker/attempts/${claim.json().attempt.id}/complete`, headers: { authorization: "Bearer worker-secret", "x-worker-id": "image-worker" }, payload: { leaseToken: claim.json().leaseToken, output: artifact } });
    expect(completed.statusCode).toBe(200);
    const explorer = await server.inject({ method: "GET", url: "/api/explorer/jobs" });
    expect(explorer.json().jobs[0]).toMatchObject({ id: created.json().id, output: null });
    const detail = await server.inject({ method: "GET", url: `/api/explorer/jobs/${created.json().id}` });
    expect(detail.json().job.output).toBe(artifact);
  });

  it("infers requirements and returns coordinator-selected services to matching workers", async () => {
    const server = await buildServer({
      store: new MemoryJobStore(),
      userToken: "user-secret",
      adminToken: "admin-secret", openWorkerSigningKey: "s".repeat(43),
      workerToken: "worker-secret",
      legacyWorkerTokenEnabled: true,
      leaseSeconds: 60
    });
    servers.push(server);

    const catalog = await server.inject({ method: "GET", url: "/api/services", headers: { authorization: "Bearer user-secret" } });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().services.map((service: { id: string }) => service.id)).toContain("text.openai.sol");

    const created = await server.inject({
      method: "POST",
      url: "/api/jobs",
      headers: { authorization: "Bearer user-secret", "idempotency-key": "combined-job" },
      payload: { prompt: "Write a caption and generate an image" }
    });
    expect(created.json()).toMatchObject({ requirements: ["text", "image"], serviceId: "text.ollama" });

    const wrongWorker = await server.inject({
      method: "POST",
      url: "/api/worker/claim",
      headers: { authorization: "Bearer worker-secret", "x-worker-id": "ollama-worker" },
      payload: { capabilities: ["text.ollama"] }
    });
    expect(wrongWorker.statusCode).toBe(204);

    const combinedWorker = await server.inject({
      method: "POST",
      url: "/api/worker/claim",
      headers: { authorization: "Bearer worker-secret", "x-worker-id": "combined-worker" },
      payload: { capabilities: ["image.higgsfield.nano-banana-2", "text.openai.sol", "image.openai.gpt-image-2"] }
    });
    expect(combinedWorker.statusCode).toBe(200);
    expect(combinedWorker.json()).toMatchObject({
      serviceIds: ["text.openai.sol", "image.openai.gpt-image-2"],
      job: { serviceId: "text.openai.sol", requirements: ["text", "image"] }
    });
  });

  it("rejects requester-selected services on public and private request APIs", async () => {
    const server = await buildServer({
      store: new MemoryJobStore(), userToken: "user-secret", adminToken: "admin-secret", openWorkerSigningKey: "s".repeat(43), workerToken: "worker-secret", legacyWorkerTokenEnabled: true, leaseSeconds: 60
    });
    servers.push(server);

    const publicResponse = await server.inject({ method: "POST", url: "/api/requests", payload: { prompt: "Write a greeting", serviceId: "text.ollama" } });
    expect(publicResponse.statusCode).toBe(400);
    const privateResponse = await server.inject({
      method: "POST", url: "/api/jobs", headers: { authorization: "Bearer user-secret", "idempotency-key": "no-selection" },
      payload: { prompt: "Write a greeting", serviceId: "text.ollama" }
    });
    expect(privateResponse.statusCode).toBe(400);
  });
});
