// Aaron's original Field Service Workbook, served unchanged inside the portal (src/portal/index.ts).
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Browser, person } from "./helpers";

// The test Worker has no built web app, so stand in for the static files.
const asked: string[] = [];
const ASSETS = { fetch: async (r: Request) => { asked.push(new URL(r.url).pathname); return new Response("<!doctype html><title>Ronchi Field Service Workbook</title>", { headers: { "content-type": "text/html" } }); } };
const withAssets = <T extends Browser>(b: T) => Object.assign(b, { env: { ...env, ASSETS } as typeof env });

describe("the original Field Service Workbook", () => {
  it("is only for signed-in staff", async () => {
    const res = await withAssets(new Browser()).fetch("/field-service-workbook");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  it("opens for a signed-in field service engineer, framed only by the portal, with its own scripts allowed", async () => {
    const tech = withAssets(await person("tech"));
    asked.length = 0;
    const res = await tech.fetch("/field-service-workbook");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Ronchi Field Service Workbook");
    expect(asked).toEqual(["/field-service-workbook"]);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("leaves the rest of the portal's pages unframeable", async () => {
    const tech = withAssets(await person("tech"));
    const res = await tech.fetch("/jobs");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});
