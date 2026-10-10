import { describe, expect, it, vi } from "vitest";
import { registerWorkerCredentials, validateCoordinatorUrl, type PreparedCredential } from "../src/issue-worker-credentials.js";

const batch: PreparedCredential[] = [
  { issuanceId: "10000000-0000-4000-8000-000000000001", label: "Friend Worker 1", workerId: "friend-worker-1", token: `bncw_${"a".repeat(43)}`, status: "pending", credentialId: null },
  { issuanceId: "10000000-0000-4000-8000-000000000002", label: "Friend Worker 2", workerId: "friend-worker-2", token: `bncw_${"b".repeat(43)}`, status: "pending", credentialId: null }
];

describe("worker credential issuer", () => {
  it("rejects unencrypted remote coordinator URLs while allowing HTTPS and loopback HTTP", () => {
    expect(() => validateCoordinatorUrl("http://coordinator.example")).toThrow("HTTPS");
    expect(validateCoordinatorUrl("https://coordinator.example")).toBe("https://coordinator.example");
    expect(validateCoordinatorUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(() => validateCoordinatorUrl("https://user:pass@coordinator.example/path?secret=x#fragment")).toThrow("credentials, query strings, or fragments");
  });

  it("registers a pre-generated batch idempotently without receiving plaintext tokens", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const issuanceId = url.split("/").at(-1)!;
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ credential: { id: issuanceId, issuanceId, label: body.label, workerId: body.workerId, enabled: true } }), { status: 201 });
    });
    const updates: PreparedCredential[][] = [];
    const registered = await registerWorkerCredentials({
      baseUrl: "https://coordinator.example",
      adminToken: "admin-secret",
      credentials: batch.map((item) => ({ ...item })),
      fetcher: fetcher as never,
      onProgress: async (credentials) => { updates.push(credentials.map((item) => ({ ...item }))); }
    });
    expect(registered.every((item) => item.status === "active" && item.credentialId === item.issuanceId)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]![0]).toContain(batch[0]!.issuanceId);
    expect(fetcher.mock.calls[0]![1]?.method).toBe("PUT");
    expect(fetcher.mock.calls[0]![1]?.headers).toMatchObject({ authorization: "Bearer admin-secret" });
    expect(String(await (fetcher.mock.calls[0]![1]?.body as string))).toContain(batch[0]!.token);
    expect(updates).toHaveLength(2);
  });

  it("preserves completed progress when a later registration fails", async () => {
    let call = 0;
    const fetcher = vi.fn(async (url: string) => {
      call += 1;
      if (call === 2) return new Response(JSON.stringify({ error: "temporary" }), { status: 503 });
      const issuanceId = url.split("/").at(-1);
      return new Response(JSON.stringify({ credential: { id: issuanceId, issuanceId, label: "Friend Worker 1", workerId: "friend-worker-1", enabled: true } }), { status: 201 });
    });
    const updates: PreparedCredential[][] = [];
    await expect(registerWorkerCredentials({
      baseUrl: "https://coordinator.example", adminToken: "admin-secret",
      credentials: batch.map((item) => ({ ...item })), fetcher: fetcher as never,
      onProgress: async (credentials) => { updates.push(credentials.map((item) => ({ ...item }))); }
    })).rejects.toThrow("credential registration failed (503)");
    expect(updates.at(-1)?.[0]).toMatchObject({ status: "active", credentialId: batch[0]!.issuanceId });
    expect(updates.at(-1)?.[1]).toMatchObject({ status: "pending", credentialId: null });
  });

  it("rejects a successful response whose credential metadata does not match the request", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ credential: {
      id: "30000000-0000-4000-8000-000000000003",
      issuanceId: batch[0]!.issuanceId,
      label: batch[0]!.label,
      workerId: "different-worker",
      enabled: true
    } }), { status: 200 }));
    await expect(registerWorkerCredentials({
      baseUrl: "https://coordinator.example", adminToken: "admin-secret",
      credentials: [{ ...batch[0]! }], fetcher: fetcher as never
    })).rejects.toThrow("mismatched metadata");
  });
});
