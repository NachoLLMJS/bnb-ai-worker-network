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
  const app = Fastify({ logger: false, bodyLimit: 128_000 });
  const service = new JobService(options.store, { leaseSeconds: options.leaseSeconds });
  const userAuth = requireToken(options.userToken);
  const workerAuth = requireToken(options.workerToken);

  app.get("/health/live", async () => ({ ok: true }));

  app.get("/api/services", { preHandler: userAuth }, async () => ({ services: listServices() }));

  app.post("/api/jobs", { preHandler: userAuth }, async (request, reply) => {
    const parsed = z.object({
      prompt: z.string().min(1).max(8_000),
      serviceId: z.string().min(3).max(100).default("text.ollama")
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.issues });
    if (!getService(parsed.data.serviceId)) return reply.code(400).send({ error: "unsupported_service" });
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 3 || idempotencyKey.length > 128) {
      return reply.code(400).send({ error: "invalid_idempotency_key" });
    }
    const job = await service.createJob({ userId: "bootstrap-user", prompt: parsed.data.prompt, serviceId: parsed.data.serviceId, idempotencyKey });
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
    const body = z.object({ leaseToken: z.string().min(20), output: z.string().min(1).max(100_000) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      return await service.completeAttempt({ attemptId: params.data.attemptId, workerId, ...body.data });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "completion_failed" });
    }
  });

  return app;
}
