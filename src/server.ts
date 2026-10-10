import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { JobService } from "./job-service.js";
import type { JobStore } from "./types.js";
import { listServices } from "./service-catalog.js";
import type { WorkerCredentialStore } from "./worker-credential-store.js";

function tokenMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ") || !expected) return false;
  const provided = Buffer.from(header.slice(7));
  const wanted = Buffer.from(expected);
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

function requireToken(expected: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!tokenMatches(request.headers.authorization, expected)) return reply.code(401).send({ error: "unauthorized" });
  };
}

function bearerToken(header: string | undefined): string | null {
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

function requesterJob(job: Awaited<ReturnType<JobService["createJob"]>>) {
  return {
    id: job.id,
    prompt: job.prompt,
    serviceId: job.serviceId,
    requirements: job.requirements,
    state: job.state,
    output: job.output,
    isPublic: job.isPublic,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

export async function buildServer(options: {
  store: JobStore;
  userToken: string;
  adminToken: string;
  workerToken: string;
  legacyWorkerTokenEnabled: boolean;
  workerCredentials?: WorkerCredentialStore;
  leaseSeconds: number;
}) {
  const app = Fastify({ logger: false, bodyLimit: 16_000_000, trustProxy: (_address: string, hop: number) => hop === 0 });
  const service = new JobService(options.store, { leaseSeconds: options.leaseSeconds });
  const userAuth = requireToken(options.userToken);
  const adminAuth = requireToken(options.adminToken);
  const workerAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    if (options.legacyWorkerTokenEnabled && tokenMatches(request.headers.authorization, options.workerToken)) return;
    const token = bearerToken(request.headers.authorization);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const workerId = request.headers["x-worker-id"];
    if (typeof workerId !== "string" || !/^[a-zA-Z0-9_-]{3,64}$/.test(workerId)) return reply.code(400).send({ error: "invalid_worker_id" });
    if (!options.workerCredentials || !await options.workerCredentials.authenticate(token, workerId)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  };
  const publicRequests = new Map<string, { count: number; resetAt: number }>();

  const publicRequestRateLimit = async (request: FastifyRequest, reply: FastifyReply) => {
    const now = Date.now();
    const current = publicRequests.get(request.ip);
    if (!current || current.resetAt <= now) {
      publicRequests.set(request.ip, { count: 1, resetAt: now + 10 * 60_000 });
      return;
    }
    if (current.count >= 10) return reply.code(429).send({ error: "rate_limit_exceeded" });
    current.count += 1;
  };

  app.get("/health/live", async () => ({ ok: true }));

  app.get("/api/services", async () => ({ services: listServices() }));

  app.put("/api/admin/worker-credentials/:issuanceId", { preHandler: adminAuth }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (!options.workerCredentials) return reply.code(503).send({ error: "worker_credentials_unavailable" });
    const params = z.object({ issuanceId: z.string().uuid() }).safeParse(request.params);
    const body = z.object({
      label: z.string().trim().min(1).max(80),
      workerId: z.string().regex(/^[a-zA-Z0-9_-]{3,64}$/),
      token: z.string().regex(/^bncw_[A-Za-z0-9_-]{43}$/)
    }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const registered = await options.workerCredentials.register({ issuanceId: params.data.issuanceId, ...body.data });
      return reply.code(registered.created ? 201 : 200).send({ credential: registered.credential });
    } catch (error) {
      if (error instanceof Error && /conflict|revoked/.test(error.message)) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });

  app.get("/api/admin/worker-credentials", { preHandler: adminAuth }, async (_request, reply) => {
    reply.header("cache-control", "no-store");
    if (!options.workerCredentials) return reply.code(503).send({ error: "worker_credentials_unavailable" });
    return { credentials: await options.workerCredentials.list() };
  });

  app.post("/api/admin/worker-credentials/:credentialId/revoke", { preHandler: adminAuth }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (!options.workerCredentials) return reply.code(503).send({ error: "worker_credentials_unavailable" });
    const parsed = z.object({ credentialId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(404).send({ error: "not_found" });
    const credential = await options.workerCredentials.revoke(parsed.data.credentialId);
    return credential ? { credential } : reply.code(404).send({ error: "not_found" });
  });

  app.get("/api/explorer/jobs", async (request, reply) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_request" });
    const jobs = await service.listPublicJobs(query.data.limit);
    return {
      jobs: jobs.map(({ id, prompt, serviceId, requirements, state, createdAt, updatedAt }) => ({
        id, prompt, serviceId, requirements, state, output: null, createdAt, updatedAt
      }))
    };
  });

  app.get("/api/explorer/jobs/:jobId", async (request, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    const detail = await service.getPublicJobDetail(params.data.jobId);
    if (!detail) return reply.code(404).send({ error: "not_found" });
    const { job, attempt } = detail;
    return {
      job: {
        id: job.id,
        prompt: job.prompt,
        serviceId: job.serviceId,
        requirements: job.requirements,
        state: job.state,
        output: job.output,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      },
      work: {
        claimedAt: attempt?.createdAt ?? null,
        completedAt: attempt?.completedAt ?? null
      }
    };
  });

  app.post("/api/requests", { preHandler: publicRequestRateLimit }, async (request, reply) => {
    const parsed = z.object({
      prompt: z.string().min(1).max(8_000),
      isPublic: z.boolean().default(false)
    }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.issues });
    const created = await service.createPublicRequest(parsed.data);
    return reply.code(201).send({ job: requesterJob(created.job), requesterToken: created.requesterToken });
  });

  app.get("/api/requests/:jobId", async (request, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).safeParse(request.params);
    const requesterToken = request.headers["x-request-token"];
    if (!params.success || typeof requesterToken !== "string" || requesterToken.length < 32) {
      return reply.code(404).send({ error: "not_found" });
    }
    const job = await service.getRequesterJob(params.data.jobId, requesterToken);
    return job ? requesterJob(job) : reply.code(404).send({ error: "not_found" });
  });

  app.post("/api/jobs", { preHandler: userAuth }, async (request, reply) => {
    const parsed = z.object({
      prompt: z.string().min(1).max(8_000),
      isPublic: z.boolean().default(false)
    }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.issues });
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 3 || idempotencyKey.length > 128) {
      return reply.code(400).send({ error: "invalid_idempotency_key" });
    }
    const job = await service.createJob({ userId: "bootstrap-user", prompt: parsed.data.prompt, isPublic: parsed.data.isPublic, idempotencyKey });
    return reply.code(201).send(requesterJob(job));
  });

  app.get("/api/jobs", { preHandler: userAuth }, async () => ({ jobs: (await service.listJobs("bootstrap-user")).map(requesterJob) }));

  app.post("/api/worker/claim", { preHandler: workerAuth }, async (request, reply) => {
    const workerId = request.headers["x-worker-id"];
    if (typeof workerId !== "string" || !/^[a-zA-Z0-9_-]{3,64}$/.test(workerId)) return reply.code(400).send({ error: "invalid_worker_id" });
    const body = z.object({
      capabilities: z.array(z.string().min(3).max(100)).min(1).max(32).default(["text.ollama"]),
      acceptPublicRequests: z.boolean().default(false)
    }).safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "invalid_capabilities" });
    const claimed = await service.claimNext(workerId, body.data.capabilities, body.data.acceptPublicRequests);
    return claimed ? reply.send({
      job: {
        id: claimed.job.id,
        prompt: claimed.job.prompt,
        serviceId: claimed.job.serviceId,
        requirements: claimed.job.requirements,
        state: claimed.job.state,
        createdAt: claimed.job.createdAt
      },
      serviceIds: claimed.serviceIds,
      attempt: {
        id: claimed.attempt.id,
        jobId: claimed.attempt.jobId,
        state: claimed.attempt.state,
        leaseExpiresAt: claimed.attempt.leaseExpiresAt
      },
      leaseToken: claimed.leaseToken
    }) : reply.code(204).send();
  });

  app.post("/api/worker/attempts/:attemptId/complete", { preHandler: workerAuth }, async (request, reply) => {
    const workerId = request.headers["x-worker-id"];
    if (typeof workerId !== "string") return reply.code(400).send({ error: "invalid_worker_id" });
    const params = z.object({ attemptId: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ leaseToken: z.string().min(20), output: z.string().min(1).max(15_000_000) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      return requesterJob(await service.completeAttempt({ attemptId: params.data.attemptId, workerId, ...body.data }));
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "completion_failed" });
    }
  });

  return app;
}
