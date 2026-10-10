import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Attempt, Job, JobStore } from "./types.js";
import { firstServiceForKind, requireService, selectServicesForRequirements } from "./service-catalog.js";
import { inferJobRequirements } from "./job-requirements.js";

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function equalText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class JobService {
  private readonly now: () => Date;
  constructor(private readonly store: JobStore, private readonly options: { leaseSeconds: number; now?: () => Date }) {
    this.now = options.now ?? (() => new Date());
  }

  async createJob(input: { userId: string; prompt: string; serviceId?: string; idempotencyKey?: string; isPublic?: boolean; requesterTokenHash?: string | null }): Promise<Job> {
    const prompt = input.prompt.trim();
    if (!prompt || prompt.length > 8_000) throw new Error("prompt must contain 1 to 8000 characters");
    const requirements = inferJobRequirements(prompt);
    const serviceId = firstServiceForKind(requirements[0] ?? "text").id;
    const now = this.now();
    return this.store.createJob({
      id: randomUUID(),
      userId: input.userId,
      idempotencyKey: input.idempotencyKey ?? randomUUID(),
      prompt,
      serviceId,
      requirements,
      state: "queued",
      output: null,
      isPublic: input.isPublic ?? false,
      requesterTokenHash: input.requesterTokenHash ?? null,
      currentAttemptId: null,
      createdAt: now,
      updatedAt: now
    });
  }

  async createPublicRequest(input: { prompt: string; serviceId?: string; isPublic?: boolean }): Promise<{ job: Job; requesterToken: string }> {
    const requesterToken = randomBytes(32).toString("base64url");
    const requesterTokenHash = hashToken(requesterToken);
    const job = await this.createJob({
      userId: `anonymous:${requesterTokenHash.slice(0, 24)}`,
      prompt: input.prompt,
      isPublic: input.isPublic ?? false,
      requesterTokenHash
    });
    return { job, requesterToken };
  }

  async getRequesterJob(jobId: string, requesterToken: string): Promise<Job | null> {
    const job = await this.store.getJob(jobId);
    if (!job?.requesterTokenHash || !equalText(job.requesterTokenHash, hashToken(requesterToken))) return null;
    return job;
  }

  listJobs(userId: string): Promise<Job[]> {
    return this.store.listJobs(userId);
  }

  listPublicJobs(limit = 50): Promise<Job[]> {
    return this.store.listPublicJobs(Math.max(1, Math.min(limit, 100)));
  }

  async getPublicJobDetail(jobId: string): Promise<{ job: Job; attempt: Attempt | null } | null> {
    const job = await this.store.getPublicJob(jobId);
    if (!job) return null;
    const attempt = job.currentAttemptId ? await this.store.getAttempt(job.currentAttemptId) : null;
    return { job, attempt };
  }

  async claimNext(workerId: string, capabilities: string[] = ["text.ollama"], acceptPublicRequests = false) {
    const approvedCapabilities = [...new Set(capabilities)].filter((capability) => {
      try {
        requireService(capability);
        return true;
      } catch {
        return false;
      }
    });
    if (approvedCapabilities.length === 0) return null;
    const now = this.now();
    const leaseToken = randomBytes(32).toString("base64url");
    const claimed = await this.store.claimNext({
      workerId,
      capabilities: approvedCapabilities,
      capabilityKinds: [...new Set(approvedCapabilities.map((capability) => requireService(capability).kind))],
      acceptPublicRequests,
      attemptId: randomUUID(),
      leaseTokenHash: hashToken(leaseToken),
      leaseExpiresAt: new Date(now.getTime() + this.options.leaseSeconds * 1000),
      now
    });
    if (!claimed) return null;
    const serviceIds = selectServicesForRequirements(claimed.job.requirements, approvedCapabilities);
    if (!serviceIds) throw new Error("store leased a job without full modality coverage");
    return { ...claimed, job: { ...claimed.job, serviceId: serviceIds[0] }, serviceIds, leaseToken };
  }

  async completeAttempt(input: { attemptId: string; workerId: string; leaseToken: string; output: string }): Promise<Job> {
    const output = input.output.trim();
    if (!output || output.length > 15_000_000) throw new Error("output must contain 1 to 15000000 characters");
    const attempt = await this.store.getAttempt(input.attemptId);
    if (!attempt) throw new Error("attempt not found");
    if (attempt.workerId !== input.workerId) throw new Error("wrong worker");
    if (!equalText(attempt.leaseTokenHash, hashToken(input.leaseToken))) throw new Error("invalid lease token");
    const now = this.now();
    if (attempt.leaseExpiresAt.getTime() <= now.getTime()) throw new Error("lease expired");
    return this.store.completeAttempt({ attemptId: input.attemptId, output, completedAt: now });
  }
}
