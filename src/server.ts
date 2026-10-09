import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { JobService } from "./job-service.js";
import type { JobStore } from "./types.js";
import { getService, listServices } from "./service-catalog.js";

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

export async function buildServer(options: {
  store: JobStore;
  userToken: string;
  adminToken: string;
  workerToken: string;
  leaseSeconds: number;
}) {
  const app = Fastify({ logger: false, bodyLimit: 16_000_000 });
  const service = new JobService(options.store, { leaseSeconds: options.leaseSeconds });
  const userAuth = requireToken(options.userToken);
  const workerAuth = requireToken(options.workerToken);

  app.get("/health/live", async () => ({ ok: true }));

  app.get("/api/services", async () => ({ services: listServices() }));

  app.get("/api/explorer/jobs", async (request, reply) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_request" });
    const jobs = await service.listPublicJobs(query.data.limit);
    return {
      jobs: jobs.map(({ id, prompt, serviceId, state, createdAt, updatedAt }) => ({
        id, prompt, serviceId, state, output: null, createdAt, updatedAt
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

  app.post("/api/jobs", { preHandler: userAuth }, async (request, reply) => {
    const parsed = z.object({
      prompt: z.string().min(1).max(8_000),
      serviceId: z.string().min(3).max(100).default("text.ollama"),
      isPublic: z.boolean().default(false)
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.issues });
    if (!getService(parsed.data.serviceId)) return reply.code(400).send({ error: "unsupported_service" });
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 3 || idempotencyKey.length > 128) {
      return reply.code(400).send({ error: "invalid_idempotency_key" });
    }
    const job = await service.createJob({ userId: "bootstrap-user", prompt: parsed.data.prompt, serviceId: parsed.data.serviceId, isPublic: parsed.data.isPublic, idempotencyKey });
    return reply.code(201).send(job);
  });

  app.get("/api/jobs", { preHandler: userAuth }, async () => ({ jobs: await service.listJobs("bootstrap-user") }));

  app.post("/api/worker/claim", { preHandler: workerAuth }, async (request, reply) => {
    const workerId = request.headers["x-worker-id"];
    if (typeof workerId !== "string" || !/^[a-zA-Z0-9_-]{3,64}$/.test(workerId)) return reply.code(400).send({ error: "invalid_worker_id" });
    const body = z.object({ capabilities: z.array(z.string().min(3).max(100)).min(1).max(32).default(["text.ollama"]) }).safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "invalid_capabilities" });
    const claimed = await service.claimNext(workerId, body.data.capabilities);
    return claimed ? reply.send(claimed) : reply.code(204).send();
  });

  app.post("/api/worker/attempts/:attemptId/complete", { preHandler: workerAuth }, async (request, reply) => {
    const workerId = request.headers["x-worker-id"];
    if (typeof workerId !== "string") return reply.code(400).send({ error: "invalid_worker_id" });
    const params = z.object({ attemptId: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ leaseToken: z.string().min(20), output: z.string().min(1).max(15_000_000) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      return await service.completeAttempt({ attemptId: params.data.attemptId, workerId, ...body.data });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "completion_failed" });
    }
  });

  return app;
}
