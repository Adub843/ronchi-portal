import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app, { toFtsQuery } from "../../src/help/index";

async function addArticle(n: number, title: string, issue: string, fix: string) {
  await env.HELP_DB.prepare("INSERT INTO articles (id, number, kind, title, machine_type, category, issue, fix, body, published_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(`a${n}`, `KB-${n}`, "issue_fix", title, "Capper", "Mechanical", issue, fix, "", "2026-11-24T00:00:00Z", "2026-11-24T00:00:00Z").run();
}

const get = (path: string) => app.request(`https://help.example${path}`, {}, env);

describe("customer help center", () => {
  it("finds an article by describing the problem or the fix", async () => {
    await addArticle(1001, "Capper torque drifts during a run", "Cap torque slowly drops after a couple of hours", "Clean and re-grease the magnetic clutch");
    expect(await (await get("/?q=torque%20drops")).text()).toContain("KB-1001");
    expect(await (await get("/?q=clutch")).text()).toContain("KB-1001");
    const api = await (await get("/api/search?q=grease")).json<{ results: { number: string }[] }>();
    expect(api.results[0]?.number).toBe("KB-1001");
  });

  it("shows whatever is stored as text, never as code", async () => {
    await addArticle(1002, `<script>alert(1)</script>`, "x", "y");
    const html = await (await get("/a/KB-1002")).text();
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;");
  });

  it("is read-only: no posting, no cookies, strict headers", async () => {
    const post = await app.request("https://help.example/", { method: "POST" }, env);
    expect(post.status).toBe(405);
    const res = await get("/");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("search input can't break the query", () => {
    expect(toFtsQuery(`torque" OR 1=1 --`)).toBe(`"torque"* "or"* "1"*`.replace(` "1"*`, ""));
    expect(toFtsQuery("NEAR(a b)")).toBe(`"near"*`);
  });
});
