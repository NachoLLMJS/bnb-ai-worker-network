import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Job, JobStore } from "./types.js";

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

  async createJob(input: { userId: string; prompt: string; idempotencyKey?: string }): Promise<Job> {
    const prompt = input.prompt.trim();
    if (!prompt || prompt.length > 8_000) throw new Error("prompt must contain 1 to 8000 characters");
    const now = this.now();
    return this.store.createJob({
      id: randomUUID(),
      userId: input.userId,
      idempotencyKey: input.idempotencyKey ?? randomUUID(),
      prompt,
      state: "queued",
      output: null,
      currentAttemptId: null,
      createdAt: now,
      updatedAt: now
    });
  }

  listJobs(userId: string): Promise<Job[]> {
    return this.store.listJobs(userId);
  }

  async claimNext(workerId: string) {
    const now = this.now();
    const leaseToken = randomBytes(32).toString("base64url");
    const claimed = await this.store.claimNext({
      workerId,
      attemptId: randomUUID(),
      leaseTokenHash: hashToken(leaseToken),
      leaseExpiresAt: new Date(now.getTime() + this.options.leaseSeconds * 1000),
      now
    });
    return claimed ? { ...claimed, leaseToken } : null;
  }

  async completeAttempt(input: { attemptId: string; workerId: string; leaseToken: string; output: string }): Promise<Job> {
    const output = input.output.trim();
    if (!output || output.length > 100_000) throw new Error("output must contain 1 to 100000 characters");
    const attempt = await this.store.getAttempt(input.attemptId);
    if (!attempt) throw new Error("attempt not found");
    if (attempt.workerId !== input.workerId) throw new Error("wrong worker");
    if (!equalText(attempt.leaseTokenHash, hashToken(input.leaseToken))) throw new Error("invalid lease token");
    const now = this.now();
    if (attempt.leaseExpiresAt.getTime() <= now.getTime()) throw new Error("lease expired");
    return this.store.completeAttempt({ attemptId: input.attemptId, output, completedAt: now });
  }
}
