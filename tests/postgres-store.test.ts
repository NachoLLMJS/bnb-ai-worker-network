import { describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { JobService } from "../src/job-service.js";
import { PostgresJobStore } from "../src/postgres-job-store.js";

describe("PostgresJobStore", () => {
  it("persists a completed job across store instances", async () => {
    const db = newDb();
    const pg = db.adapters.createPg();
    const pool = new pg.Pool();
    const firstStore = new PostgresJobStore(pool as never);
    await firstStore.initialize();
    const firstService = new JobService(firstStore, { leaseSeconds: 60 });
    const created = await firstService.createJob({ userId: "user-1", prompt: "persistent", idempotencyKey: "persist-1" });
    const lease = await firstService.claimNext("worker-1");
    await firstService.completeAttempt({ attemptId: lease!.attempt.id, workerId: "worker-1", leaseToken: lease!.leaseToken, output: "saved" });

    const secondStore = new PostgresJobStore(pool as never);
    const jobs = await secondStore.listJobs("user-1");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: created.id, state: "succeeded", output: "saved" });
    await pool.end();
  });

  it("lists only jobs explicitly published to the Explorer", async () => {
    const db = newDb();
    const pg = db.adapters.createPg();
    const pool = new pg.Pool();
    const store = new PostgresJobStore(pool as never);
    await store.initialize();
    const service = new JobService(store, { leaseSeconds: 60 });
    await service.createJob({ userId: "user-1", prompt: "private", idempotencyKey: "private-1" });
    const published = await service.createJob({ userId: "user-1", prompt: "public", idempotencyKey: "public-1", isPublic: true });

    const publicJobs = await store.listPublicJobs(20);
    expect(publicJobs).toHaveLength(1);
    expect(publicJobs[0]).toMatchObject({ id: published.id, prompt: "public", isPublic: true });
    await pool.end();
  });

  it("migrates legacy rows by deriving durable requirements from the service prefix", async () => {
    const db = newDb({ noAstCoverageCheck: true });
    const pg = db.adapters.createPg();
    const pool = new pg.Pool();
    await pool.query(`CREATE TABLE jobs (
      id text PRIMARY KEY, user_id text NOT NULL, idempotency_key text NOT NULL, prompt text NOT NULL,
      service_id text NOT NULL, state text NOT NULL, output text, is_public boolean NOT NULL DEFAULT false,
      requester_token_hash text, current_attempt_id text, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
      UNIQUE (user_id, idempotency_key)
    )`);
    await pool.query(`INSERT INTO jobs VALUES
      ('legacy-image','user-1','legacy-1','legacy image','image.openai.gpt-image-2','queued',NULL,false,NULL,NULL,NOW(),NOW())`);

    const store = new PostgresJobStore(pool as never);
    await store.initialize();
    const migrated = await store.getJob("legacy-image");
    expect(migrated?.requirements).toEqual(["image"]);
    await pool.end();
  });

  it("claims a combined-modality job only when the worker covers every requirement", async () => {
    const db = newDb();
    const pg = db.adapters.createPg();
    const pool = new pg.Pool();
    const store = new PostgresJobStore(pool as never);
    await store.initialize();
    const service = new JobService(store, { leaseSeconds: 60 });
    await service.createJob({ userId: "user-1", prompt: "Write a caption and generate an image", idempotencyKey: "combined-1" });

    expect(await service.claimNext("text-only", ["text.ollama"])).toBeNull();
    const claimed = await service.claimNext("combined", ["image.openai.gpt-image-2", "text.openai.sol"]);
    expect(claimed?.serviceIds).toEqual(["text.openai.sol", "image.openai.gpt-image-2"]);
    await pool.end();
  });

  it("requeues a job when its old lease has expired", async () => {
    const db = newDb();
    const pg = db.adapters.createPg();
    const pool = new pg.Pool();
    const store = new PostgresJobStore(pool as never);
    await store.initialize();
    let now = new Date("2026-10-08T12:00:00.000Z");
    const service = new JobService(store, { leaseSeconds: 5, now: () => now });
    await service.createJob({ userId: "user-1", prompt: "retry", idempotencyKey: "retry-1" });
    const first = await service.claimNext("worker-1");
    now = new Date("2026-10-08T12:00:06.000Z");
    const second = await service.claimNext("worker-2");
    expect(second?.job.id).toBe(first?.job.id);
    expect(second?.attempt.workerId).toBe("worker-2");
    await pool.end();
  });
});
