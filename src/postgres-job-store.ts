import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { Attempt, ClaimedAttempt, Job, JobStore } from "./types.js";
import { requirementsFromLegacyServiceId } from "./job-requirements.js";

function jobFromRow(row: QueryResultRow): Job {
  let requirements = requirementsFromLegacyServiceId(row.service_id);
  try {
    const parsed = JSON.parse(row.requirements_json ?? "null");
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((kind) => kind === "text" || kind === "image" || kind === "video")) requirements = parsed;
  } catch {}
  return {
    id: row.id,
    userId: row.user_id,
    idempotencyKey: row.idempotency_key,
    prompt: row.prompt,
    serviceId: row.service_id,
    requirements,
    state: row.state,
    output: row.output,
    isPublic: row.is_public,
    requesterTokenHash: row.requester_token_hash ?? null,
    currentAttemptId: row.current_attempt_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function attemptFromRow(row: QueryResultRow): Attempt {
  return {
    id: row.id,
    jobId: row.job_id,
    workerId: row.worker_id,
    state: row.state,
    leaseTokenHash: row.lease_token_hash,
    leaseExpiresAt: new Date(row.lease_expires_at),
    createdAt: new Date(row.created_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null
  };
}

export class PostgresJobStore implements JobStore {
  constructor(private readonly pool: Pool) {}

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        idempotency_key text NOT NULL,
        prompt text NOT NULL,
        service_id text NOT NULL DEFAULT 'text.ollama',
        requirements_json text NOT NULL DEFAULT '["text"]',
        state text NOT NULL CHECK (state IN ('queued','active','succeeded','failed','cancelled')),
        output text,
        is_public boolean NOT NULL DEFAULT false,
        requester_token_hash text,
        current_attempt_id text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        UNIQUE (user_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs (state, created_at);
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS service_id text NOT NULL DEFAULT 'text.ollama';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS requester_token_hash text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS requirements_json text;
      UPDATE jobs SET requirements_json = CASE
        WHEN service_id LIKE 'image.%' THEN '["image"]'
        WHEN service_id LIKE 'video.%' THEN '["video"]'
        ELSE '["text"]'
      END WHERE requirements_json IS NULL;
      ALTER TABLE jobs ALTER COLUMN requirements_json SET DEFAULT '["text"]';
      ALTER TABLE jobs ALTER COLUMN requirements_json SET NOT NULL;
      CREATE INDEX IF NOT EXISTS jobs_service_queue_idx ON jobs (state, service_id, created_at);
      CREATE INDEX IF NOT EXISTS jobs_public_idx ON jobs (is_public, created_at DESC);
      CREATE TABLE IF NOT EXISTS job_attempts (
        id text PRIMARY KEY,
        job_id text NOT NULL REFERENCES jobs(id),
        worker_id text NOT NULL,
        state text NOT NULL CHECK (state IN ('leased','running','succeeded','failed','abandoned','cancelled')),
        lease_token_hash text NOT NULL,
        lease_expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL,
        completed_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS attempts_lease_idx ON job_attempts (state, lease_expires_at);
    `);
  }

  async createJob(job: Job): Promise<Job> {
    const inserted = await this.pool.query(
      `INSERT INTO jobs (id,user_id,idempotency_key,prompt,service_id,requirements_json,state,output,is_public,requester_token_hash,current_attempt_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (user_id,idempotency_key) DO NOTHING
       RETURNING *`,
      [job.id, job.userId, job.idempotencyKey, job.prompt, job.serviceId, JSON.stringify(job.requirements), job.state, job.output, job.isPublic, job.requesterTokenHash, job.currentAttemptId, job.createdAt, job.updatedAt]
    );
    if (inserted.rows[0]) return jobFromRow(inserted.rows[0]);
    const existing = await this.pool.query("SELECT * FROM jobs WHERE user_id=$1 AND idempotency_key=$2", [job.userId, job.idempotencyKey]);
    return jobFromRow(existing.rows[0]);
  }

  async listJobs(userId: string): Promise<Job[]> {
    const result = await this.pool.query("SELECT * FROM jobs WHERE user_id=$1 ORDER BY created_at DESC", [userId]);
    return result.rows.map(jobFromRow);
  }

  async listPublicJobs(limit: number): Promise<Job[]> {
    const result = await this.pool.query("SELECT * FROM jobs WHERE is_public=true ORDER BY created_at DESC LIMIT $1", [limit]);
    return result.rows.map(jobFromRow);
  }

  async getPublicJob(jobId: string): Promise<Job | null> {
    const result = await this.pool.query("SELECT * FROM jobs WHERE id=$1 AND is_public=true", [jobId]);
    return result.rows[0] ? jobFromRow(result.rows[0]) : null;
  }

  async getJob(jobId: string): Promise<Job | null> {
    const result = await this.pool.query("SELECT * FROM jobs WHERE id=$1", [jobId]);
    return result.rows[0] ? jobFromRow(result.rows[0]) : null;
  }

  async claimNext(input: { workerId: string; capabilities: string[]; capabilityKinds: import("./service-catalog.js").ServiceKind[]; acceptPublicRequests: boolean; attemptId: string; leaseTokenHash: string; leaseExpiresAt: Date; now: Date }): Promise<ClaimedAttempt | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.requeueExpired(client, input.now);
      if (input.capabilities.length === 0) {
        await client.query("COMMIT");
        return null;
      }
      const claimed = await client.query(
        `UPDATE jobs SET state='active', current_attempt_id=$1, updated_at=$2
         WHERE id=(SELECT id FROM jobs WHERE state='queued'
           AND (requirements_json NOT LIKE '%"text"%' OR $4=true)
           AND (requirements_json NOT LIKE '%"image"%' OR $5=true)
           AND (requirements_json NOT LIKE '%"video"%' OR $6=true)
           AND (requester_token_hash IS NULL OR $3=true) ORDER BY created_at ASC LIMIT 1)
           AND state='queued'
         RETURNING *`,
        [input.attemptId, input.now, input.acceptPublicRequests, input.capabilityKinds.includes("text"), input.capabilityKinds.includes("image"), input.capabilityKinds.includes("video")]
      );
      if (!claimed.rows[0]) {
        await client.query("COMMIT");
        return null;
      }
      const attempt = await client.query(
        `INSERT INTO job_attempts (id,job_id,worker_id,state,lease_token_hash,lease_expires_at,created_at,completed_at)
         VALUES ($1,$2,$3,'leased',$4,$5,$6,NULL) RETURNING *`,
        [input.attemptId, claimed.rows[0].id, input.workerId, input.leaseTokenHash, input.leaseExpiresAt, input.now]
      );
      await client.query("COMMIT");
      return { job: jobFromRow(claimed.rows[0]), attempt: attemptFromRow(attempt.rows[0]) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async requeueExpired(client: PoolClient, now: Date): Promise<void> {
    await client.query(
      `UPDATE job_attempts SET state='abandoned', completed_at=$1
       WHERE state IN ('leased','running') AND lease_expires_at <= $1`,
      [now]
    );
    await client.query(
      `UPDATE jobs SET state='queued', current_attempt_id=NULL, updated_at=$1
       WHERE state='active' AND current_attempt_id IN
         (SELECT id FROM job_attempts WHERE state='abandoned')`,
      [now]
    );
  }

  async getAttempt(attemptId: string): Promise<Attempt | null> {
    const result = await this.pool.query("SELECT * FROM job_attempts WHERE id=$1", [attemptId]);
    return result.rows[0] ? attemptFromRow(result.rows[0]) : null;
  }

  async completeAttempt(input: { attemptId: string; output: string; completedAt: Date }): Promise<Job> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const attemptResult = await client.query(
        `UPDATE job_attempts SET state='succeeded', completed_at=$2
         WHERE id=$1 AND state='leased' AND lease_expires_at > $2 RETURNING *`,
        [input.attemptId, input.completedAt]
      );
      const attempt = attemptResult.rows[0];
      if (!attempt) throw new Error("attempt is not active");
      const jobResult = await client.query(
        `UPDATE jobs SET state='succeeded', output=$2, updated_at=$3
         WHERE id=$1 AND state='active' AND current_attempt_id=$4 RETURNING *`,
        [attempt.job_id, input.output, input.completedAt, input.attemptId]
      );
      if (!jobResult.rows[0]) throw new Error("attempt is stale");
      await client.query("COMMIT");
      return jobFromRow(jobResult.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
