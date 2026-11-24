// Ronchi Parts Worker (CUSTOMER side): the parts catalog customers sign in to.
//
// THE WALL: this file and everything under src/parts may only import from src/parts and
// src/shared. Its only database is parts-db and its only storage is ronchi-parts-files; it has no
// binding, key or address for the business store or the staff Worker. test/unit/wall.test.ts
// checks this on every build.
//
// Every request:
//   1. gets the security headers
//   2. API changes must come from these pages (Origin check + X-Ronchi header)
//   3. the session cookie is read; every catalog route then checks the machine belongs to the
//      person's company (lib/access.ts)
//   4. /admin is the staff portal's publish door, locked by a key (routes/admin.ts)
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { PORTAL_CSP, securityHeaders, withHeaders } from "../shared/security-headers";
import type { PartsApp } from "./env";
import { fail } from "./lib/http";
import { loadSession } from "./lib/session";
import { admin } from "./routes/admin";
import { auth } from "./routes/auth";
import { catalog } from "./routes/catalog";
import { shop } from "./routes/shop";

const HEADERS = securityHeaders({ csp: PORTAL_CSP });
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export const app = new Hono<PartsApp>();

app.use("*", async (c, next) => {
  c.set("ip", c.req.header("cf-connecting-ip") ?? "unknown");
  c.set("user", null);
  await next();
  const own = c.res.headers.get("Content-Security-Policy");
  const fileRoute = /^\/api\/sheets\/[^/]+\/(drawing|model)$/.test(c.req.path);
  c.res = withHeaders(c.res, HEADERS);
  if (fileRoute && own) c.res.headers.set("Content-Security-Policy", own);
});

app.route("/admin", admin);
app.all("/admin/*", () => fail(404, "Not found."));

app.use("/api/*", async (c, next) => {
  if (!SAFE.has(c.req.method) && (c.req.header("origin") !== c.env.ORIGIN || c.req.header("x-ronchi") !== "1")) fail(403, "Request blocked.");
  c.set("user", await loadSession(c));
  const u = c.get("user");
  if (c.env.API_LIMIT) {
    const { success } = await c.env.API_LIMIT.limit({ key: u ? `u:${u.id}` : `ip:${c.get("ip")}` });
    if (!success) fail(429, "Too many requests. Wait a minute and try again.");
  }
  await next();
  if (!c.res.headers.get("Cache-Control")) c.header("Cache-Control", "no-store");
});

app.route("/api/auth", auth);
app.route("/api", catalog);
app.route("/api", shop);
app.all("/api/*", () => fail(404, "Not found."));

app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => {
  const res = err instanceof HTTPException ? err.getResponse() : null;
  if (!res) console.error("Unexpected error", err);
  return withHeaders(res ?? Response.json({ error: "Something went wrong. It has been logged." }, { status: 500 }), { ...HEADERS, "Cache-Control": "no-store" });
});

export default app;
