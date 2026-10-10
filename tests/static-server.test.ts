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

  it("serves nested local brand assets instead of the SPA fallback", async () => {
    const server = await buildServer({
      store: new MemoryJobStore(),
      userToken: "user-secret",
      adminToken: "admin-secret",
      workerToken: "worker-secret",
      leaseSeconds: 60
    });
    servers.push(server);
    await registerWeb(server, join(import.meta.dirname, "..", "public"));
    const response = await server.inject({ method: "GET", url: "/assets/logos/openai.svg" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/svg+xml");
    expect(response.body).toContain("<svg");
    expect(response.body).not.toContain("<!doctype html>");

    const deepseek = await server.inject({ method: "GET", url: "/assets/logos/deepseek.svg" });
    expect(deepseek.statusCode).toBe(200);
    expect(deepseek.headers["content-type"]).toContain("image/svg+xml");
    expect(deepseek.payload).toContain("<svg");
  });

  it("serves the self-contained 3D intro and its nested modules", async () => {
    const server = await buildServer({
      store: new MemoryJobStore(),
      userToken: "user-secret",
      adminToken: "admin-secret",
      workerToken: "worker-secret",
      leaseSeconds: 60
    });
    servers.push(server);
    await registerWeb(server, join(import.meta.dirname, "..", "public"));

    const intro = await server.inject({ method: "GET", url: "/intro/index.html?loader=1" });
    expect(intro.statusCode).toBe(200);
    expect(intro.headers["content-type"]).toContain("text/html");
    expect(intro.body).toContain("BNB Compute 3D intro");
    expect(intro.body).not.toContain("BNB AI NETWORK");

    const module = await server.inject({ method: "GET", url: "/intro/main.js" });
    expect(module.statusCode).toBe(200);
    expect(module.headers["content-type"]).toContain("javascript");
    expect(module.body).toContain("sxg-loader-complete");

    const three = await server.inject({ method: "GET", url: "/intro/vendor/three/three.module.js" });
    expect(three.statusCode).toBe(200);
    expect(three.body).toContain("REVISION");
  });
});
