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

  it("infers requirements and leases only to a worker covering every required modality", async () => {
    const store = new MemoryJobStore();
    const service = new JobService(store, { leaseSeconds: 60 });
    const job = await service.createJob({
      userId: "user-1",
      prompt: "Write a caption and create a cinematic image of a moonlit forest"
    });

    expect(job.requirements).toEqual(["text", "image"]);
    expect(await service.claimNext("text-worker", ["text.ollama"])).toBeNull();
    expect(await service.claimNext("image-worker", ["image.openai.gpt-image-2"])).toBeNull();

    const lease = await service.claimNext("combined-worker", [
      "image.higgsfield.nano-banana-2",
      "text.openai.sol",
      "image.openai.gpt-image-2",
      "text.ollama"
    ]);
    expect(lease?.job.id).toBe(job.id);
    expect(lease?.serviceIds).toEqual(["text.ollama", "image.openai.gpt-image-2"]);
    expect(lease?.job.serviceId).toBe("text.ollama");
  });

  it("requires one worker to cover text, image, and video together", async () => {
    const store = new MemoryJobStore();
    const service = new JobService(store, { leaseSeconds: 60 });
    const job = await service.createJob({
      userId: "user-1",
      prompt: "Write launch copy, create an image, and generate a short video"
    });

    expect(job.requirements).toEqual(["text", "image", "video"]);
    expect(await service.claimNext("partial-worker", ["text.ollama", "image.openai.gpt-image-2"])).toBeNull();
    const lease = await service.claimNext("complete-worker", [
      "text.ollama",
      "image.openai.gpt-image-2",
      "video.higgsfield.kling-3-turbo"
    ]);
    expect(lease?.job.id).toBe(job.id);
    expect(lease?.serviceIds).toEqual([
      "text.ollama",
      "image.openai.gpt-image-2",
      "video.higgsfield.kling-3-turbo"
    ]);
  });

  it("ignores legacy requester service selection and routes from the prompt", async () => {
    const store = new MemoryJobStore();
    const service = new JobService(store, { leaseSeconds: 60 });
    const job = await service.createJob({
      userId: "user-1",
      prompt: "Generate a product image",
      serviceId: "text.anthropic.fable"
    });

    expect(job).toMatchObject({ requirements: ["image"], serviceId: "image.openai.gpt-image-2" });
  });
});
