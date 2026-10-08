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
