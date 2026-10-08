import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

describe("web inbox", () => {
  it("contains an access gate, job composer and private results inbox", async () => {
    const html = await readFile(join(root, "public", "index.html"), "utf8");
    expect(html).toContain("Worker Relay");
    expect(html).toContain('id="access-form"');
    expect(html).toContain('id="job-form"');
    expect(html).toContain('id="service-id"');
    expect(html).toContain('id="jobs-list"');
    expect(html).not.toContain("user-secret");
    const css = await readFile(join(root, "public", "styles.css"), "utf8");
    expect(css).toContain("[hidden]{display:none!important}");
  });

  it("uses authenticated API calls and never persists the access token in localStorage", async () => {
    const source = await readFile(join(root, "public", "app.js"), "utf8");
    expect(source).toContain("/api/jobs");
    expect(source).toContain("/api/services");
    expect(source).toContain("serviceId");
    expect(source).toContain("document.createElement(\"img\")");
    expect(source).toContain("document.createElement(\"video\")");
    expect(source).toContain("Authorization");
    expect(source).toContain("sessionStorage");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("innerHTML =");
  });
});
