import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { registerWeb } from "../src/web.js";
import { MemoryJobStore } from "../src/memory-job-store.js";

const servers: Awaited<ReturnType<typeof buildServer>>[] = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => server.close())));

describe("static web registration", () => {
  it("serves the application root without duplicate routes", async () => {
    const server = await buildServer({
      store: new MemoryJobStore(),
      userToken: "user-secret",
      adminToken: "admin-secret",
      workerToken: "worker-secret",
      leaseSeconds: 60
    });
    servers.push(server);
    await registerWeb(server, join(import.meta.dirname, "..", "public"));
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("BNB AI NETWORK");
  });
});
