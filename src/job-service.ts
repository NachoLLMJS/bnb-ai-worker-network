import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Attempt, Job, JobStore } from "./types.js";
import { requireService } from "./service-catalog.js";

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

  async createJob(input: { userId: string; prompt: string; serviceId?: string; idempotencyKey?: string; isPublic?: boolean }): Promise<Job> {
    const prompt = input.prompt.trim();
    if (!prompt || prompt.length > 8_000) throw new Error("prompt must contain 1 to 8000 characters");
    const serviceId = input.serviceId ?? "text.ollama";
    requireService(serviceId);
    const now = this.now();
    return this.store.createJob({
      id: randomUUID(),
      userId: input.userId,
      idempotencyKey: input.idempotencyKey ?? randomUUID(),
      prompt,
      serviceId,
      state: "queued",
      output: null,
      isPublic: input.isPublic ?? false,
      currentAttemptId: null,
      createdAt: now,
      updatedAt: now
    });
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

  async claimNext(workerId: string, capabilities: string[] = ["text.ollama"]) {
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
      attemptId: randomUUID(),
      leaseTokenHash: hashToken(leaseToken),
      leaseExpiresAt: new Date(now.getTime() + this.options.leaseSeconds * 1000),
      now
    });
    return claimed ? { ...claimed, leaseToken } : null;
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
