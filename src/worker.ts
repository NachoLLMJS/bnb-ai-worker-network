import { z } from "zod";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const leaseSchema = z.object({
  leaseToken: z.string().min(20),
  job: z.object({
    id: z.string(),
    prompt: z.string().min(1),
    serviceId: z.string().min(3),
    requirements: z.array(z.enum(["text", "image", "video"])).min(1).optional()
  }),
  serviceIds: z.array(z.string().min(3)).min(1).optional(),
  attempt: z.object({ id: z.string().uuid() })
});

export async function runWorkerOnce(input: {
  apiUrl: string;
  workerId: string;
  workerToken: string;
  capabilities: string[];
  acceptPublicRequests?: boolean;
  fetcher?: Fetcher;
  execute: (job: { id: string; prompt: string; serviceId: string; serviceIds: string[]; requirements?: Array<"text" | "image" | "video"> }) => Promise<string>;
}): Promise<"idle" | "completed"> {
  const fetcher = input.fetcher ?? fetch;
  const headers = {
    authorization: `Bearer ${input.workerToken}`,
    "x-worker-id": input.workerId,
    "content-type": "application/json"
  };
  const base = input.apiUrl.replace(/\/$/, "");
  const claim = await fetcher(`${base}/api/worker/claim`, {
    method: "POST",
    headers,
    body: JSON.stringify({ capabilities: input.capabilities, acceptPublicRequests: input.acceptPublicRequests ?? false })
  });
  if (claim.status === 204) return "idle";
  if (!claim.ok) throw new Error(`claim failed (${claim.status})`);
  const parsed = leaseSchema.safeParse(await claim.json());
  if (!parsed.success) throw new Error("coordinator returned an invalid lease");
  const serviceIds = parsed.data.serviceIds ?? [parsed.data.job.serviceId];
  if (serviceIds.some((serviceId) => !input.capabilities.includes(serviceId))) throw new Error("worker received an unapproved service");
  const output = await input.execute({ ...parsed.data.job, serviceIds });
  const completed = await fetcher(`${base}/api/worker/attempts/${parsed.data.attempt.id}/complete`, {
    method: "POST",
    headers,
    body: JSON.stringify({ leaseToken: parsed.data.leaseToken, output })
  });
  if (!completed.ok) throw new Error(`completion failed (${completed.status})`);
  return "completed";
}
