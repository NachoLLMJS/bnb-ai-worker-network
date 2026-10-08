import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

describe("BNB AI Network web application", () => {
  it("provides a gated landing page and every reference-led application route", async () => {
    const html = await readFile(join(root, "public", "index.html"), "utf8");
    expect(html).toContain("BNB AI NETWORK");
    expect(html).toContain('id="access-form"');
    expect(html).toContain('data-route="dashboard"');
    expect(html).toContain('data-route="jobs"');
    expect(html).toContain('data-route="workers"');
    expect(html).toContain('data-route="submit"');
    expect(html).toContain('data-route="inbox"');
    expect(html).toContain('data-route="logs"');
    expect(html).toContain('id="job-detail-view"');
    expect(html).toContain('id="job-form"');
    expect(html).toContain('id="service-id"');
    expect(html).toContain('id="jobs-table-body"');
    expect(html).toContain('id="inbox-list"');
    expect(html).not.toContain("user-secret");
  });

  it("uses a dark BNB-yellow responsive design system from the supplied reference", async () => {
    const css = await readFile(join(root, "public", "styles.css"), "utf8");
    expect(css).toContain("--yellow:#f3ba2f");
    expect(css).toContain("--bg:#070d14");
    expect(css).toContain("[hidden]{display:none!important}");
    expect(css).toContain("@media(max-width:760px)");
    expect(css).toContain(".app-nav");
    expect(css).toContain(".stat-grid");
    expect(css).toContain(".jobs-table");
  });

  it("routes between real data views and never fabricates wallet or worker telemetry", async () => {
    const source = await readFile(join(root, "public", "app.js"), "utf8");
    expect(source).toContain("history.pushState");
    expect(source).toContain("renderDashboard");
    expect(source).toContain("renderJobsTable");
    expect(source).toContain("renderInbox");
    expect(source).toContain("renderLogs");
    expect(source).toContain("openJobDetail");
    expect(source).toContain("function openJobDetail(id, push = true)");
    expect(source).toContain("openJobDetail(selectedJobId, false)");
    expect(source).toContain("/api/jobs");
    expect(source).toContain("/api/services");
    expect(source).toContain("serviceId");
    expect(source).toContain("document.createElement(\"img\")");
    expect(source).toContain("document.createElement(\"video\")");
    expect(source).toContain("Authorization");
    expect(source).toContain("sessionStorage");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("innerHTML =");
    expect(source).not.toContain("Connect Wallet");
    expect(source).not.toContain("Total Workers: 156");
  });
});
