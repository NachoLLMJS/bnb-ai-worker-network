export type JobState = "queued" | "active" | "succeeded" | "failed" | "cancelled";
export type AttemptState = "leased" | "running" | "succeeded" | "failed" | "abandoned" | "cancelled";

export interface Job {
  id: string;
  userId: string;
  idempotencyKey: string;
  prompt: string;
  serviceId: string;
  state: JobState;
  output: string | null;
  isPublic: boolean;
  requesterTokenHash?: string | null;
  currentAttemptId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Attempt {
  id: string;
  jobId: string;
  workerId: string;
  state: AttemptState;
  leaseTokenHash: string;
  leaseExpiresAt: Date;
  createdAt: Date;
  completedAt: Date | null;
}

export interface ClaimedAttempt {
  job: Job;
  attempt: Attempt;
}

export interface JobStore {
  createJob(job: Job): Promise<Job>;
  listJobs(userId: string): Promise<Job[]>;
  listPublicJobs(limit: number): Promise<Job[]>;
  getPublicJob(jobId: string): Promise<Job | null>;
  getJob(jobId: string): Promise<Job | null>;
  claimNext(input: { workerId: string; capabilities: string[]; acceptPublicRequests: boolean; attemptId: string; leaseTokenHash: string; leaseExpiresAt: Date; now: Date }): Promise<ClaimedAttempt | null>;
  getAttempt(attemptId: string): Promise<Attempt | null>;
  completeAttempt(input: { attemptId: string; output: string; completedAt: Date }): Promise<Job>;
}
