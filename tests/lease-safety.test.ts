import { describe, expect, it } from "vitest";
import { JobService } from "../src/job-service.js";
import { MemoryJobStore } from "../src/memory-job-store.js";

describe("lease safety", () => {
  it("rejects completion from an expired lease", async () => {
    let now = new Date("2026-10-08T12:00:00.000Z");
    const service = new JobService(new MemoryJobStore(), {
      leaseSeconds: 10,
      now: () => now
    });
    await service.createJob({ userId: "user-1", prompt: "hello" });
    const lease = await service.claimNext("worker-1");
    now = new Date("2026-10-08T12:00:11.000Z");

    await expect(service.completeAttempt({
      attemptId: lease!.attempt.id,
      workerId: "worker-1",
      leaseToken: lease!.leaseToken,
      output: "too late"
    })).rejects.toThrow("lease expired");
  });

  it("allows only one worker to claim one queued job", async () => {
    const service = new JobService(new MemoryJobStore(), { leaseSeconds: 60 });
    await service.createJob({ userId: "user-1", prompt: "hello" });

    const claims = await Promise.all([
      service.claimNext("worker-1"),
      service.claimNext("worker-2"),
      service.claimNext("worker-3")
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});
