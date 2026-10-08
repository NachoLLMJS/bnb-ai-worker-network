import { describe, expect, it } from "vitest";
import { JobService } from "../src/job-service.js";
import { MemoryJobStore } from "../src/memory-job-store.js";

describe("JobService", () => {
  it("creates, claims and completes a text job", async () => {
    const store = new MemoryJobStore();
    const service = new JobService(store, { leaseSeconds: 60 });

    const job = await service.createJob({ userId: "user-1", prompt: "Explain BNB in one sentence" });
    const lease = await service.claimNext("worker-1");

    expect(lease?.job.id).toBe(job.id);
    expect(lease?.job.state).toBe("active");

    const completed = await service.completeAttempt({
      attemptId: lease!.attempt.id,
      workerId: "worker-1",
      leaseToken: lease!.leaseToken,
      output: "BNB is the gas and ecosystem asset used across BNB Chain."
    });

    expect(completed.state).toBe("succeeded");
    expect(completed.output).toContain("BNB Chain");
  });

  it("only leases a job to a worker that advertises the requested service", async () => {
    const store = new MemoryJobStore();
    const service = new JobService(store, { leaseSeconds: 60 });
    const job = await service.createJob({
      userId: "user-1",
      prompt: "Create a cinematic moonlit forest",
      serviceId: "image.higgsfield.gpt-image-2.5"
    });

    expect(await service.claimNext("text-worker", ["text.ollama"])).toBeNull();
    const lease = await service.claimNext("image-worker", ["image.higgsfield.gpt-image-2.5"]);
    expect(lease?.job).toMatchObject({ id: job.id, serviceId: "image.higgsfield.gpt-image-2.5" });
  });
});
