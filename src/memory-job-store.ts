import type { Attempt, ClaimedAttempt, Job, JobStore } from "./types.js";

export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly attempts = new Map<string, Attempt>();
  private readonly idempotency = new Map<string, string>();

  async createJob(job: Job): Promise<Job> {
    const key = `${job.userId}:${job.idempotencyKey}`;
    const existingId = this.idempotency.get(key);
    if (existingId) return structuredClone(this.jobs.get(existingId)!);
    this.jobs.set(job.id, structuredClone(job));
    this.idempotency.set(key, job.id);
    return structuredClone(job);
  }

  async listJobs(userId: string): Promise<Job[]> {
    return [...this.jobs.values()]
      .filter((job) => job.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((job) => structuredClone(job));
  }

  async listPublicJobs(limit: number): Promise<Job[]> {
    return [...this.jobs.values()]
      .filter((job) => job.isPublic)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((job) => structuredClone(job));
  }

  async getPublicJob(jobId: string): Promise<Job | null> {
    const job = this.jobs.get(jobId);
    return job?.isPublic ? structuredClone(job) : null;
  }

  async getJob(jobId: string): Promise<Job | null> {
    const job = this.jobs.get(jobId);
    return job ? structuredClone(job) : null;
  }

  async claimNext(input: { workerId: string; capabilities: string[]; acceptPublicRequests: boolean; attemptId: string; leaseTokenHash: string; leaseExpiresAt: Date; now: Date }): Promise<ClaimedAttempt | null> {
    const job = [...this.jobs.values()]
      .filter((candidate) => candidate.state === "queued" && input.capabilities.includes(candidate.serviceId) && (!candidate.requesterTokenHash || input.acceptPublicRequests))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!job) return null;

    const attempt: Attempt = {
      id: input.attemptId,
      jobId: job.id,
      workerId: input.workerId,
      state: "leased",
      leaseTokenHash: input.leaseTokenHash,
      leaseExpiresAt: input.leaseExpiresAt,
      createdAt: input.now,
      completedAt: null
    };
    job.state = "active";
    job.currentAttemptId = attempt.id;
    job.updatedAt = input.now;
    this.attempts.set(attempt.id, structuredClone(attempt));
    this.jobs.set(job.id, structuredClone(job));
    return { job: structuredClone(job), attempt: structuredClone(attempt) };
  }

  async getAttempt(attemptId: string): Promise<Attempt | null> {
    const attempt = this.attempts.get(attemptId);
    return attempt ? structuredClone(attempt) : null;
  }

  async completeAttempt(input: { attemptId: string; output: string; completedAt: Date }): Promise<Job> {
    const attempt = this.attempts.get(input.attemptId);
    if (!attempt || attempt.state !== "leased") throw new Error("attempt is not active");
    const job = this.jobs.get(attempt.jobId);
    if (!job || job.currentAttemptId !== attempt.id || job.state !== "active") throw new Error("attempt is stale");
    attempt.state = "succeeded";
    attempt.completedAt = input.completedAt;
    job.state = "succeeded";
    job.output = input.output;
    job.updatedAt = input.completedAt;
    this.attempts.set(attempt.id, structuredClone(attempt));
    this.jobs.set(job.id, structuredClone(job));
    return structuredClone(job);
  }
}
