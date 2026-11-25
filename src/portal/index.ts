// Ronchi Portal Worker (staff side). Start here when reading the code.
//
// Every request passes through this file:
//   1. security headers are added to every response (pages and API alike)
//   2. API calls that change something must come from the portal's own pages (Origin check + X-Ronchi header)
//   3. the session cookie is read, so routes know who is signed in
//   4. each /api/... path goes to its file in routes/; anything else is the staff app from web/dist
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { PORTAL_CSP, securityHeaders, withHeaders } from "../shared/security-headers";
import type { AppEnv } from "./env";
import { fail } from "./lib/http";
import { loadSession } from "./lib/session";
import { auth } from "./routes/auth";
import { boards } from "./routes/boards";
import { catalog } from "./routes/catalog";
import { customers, quotes } from "./routes/customers";
import { changeParts } from "./routes/change-parts";
import { files } from "./routes/files";
import { jobs } from "./routes/jobs";
import { switches } from "./routes/switches";
import { kb } from "./routes/kb";
import { links } from "./routes/links";
import { machines } from "./routes/machines";
import { prefs } from "./routes/prefs";
import { users } from "./routes/users";

const HEADERS = securityHeaders({ csp: PORTAL_CSP });
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  c.set("ip", c.req.header("cf-connecting-ip") ?? "unknown");
  c.set("user", null);
  await next();
  // A file from a chat or a catalog drawing keeps its own, stricter Content-Security-Policy.
  const fileRoute = c.req.path.startsWith("/api/files/") || c.req.path.startsWith("/api/jobs/files/") || /^\/api\/catalog\/sheets\/[^/]+\/(drawing|model)$/.test(c.req.path);
  const own = fileRoute ? c.res.headers.get("Content-Security-Policy") : null;
  c.res = withHeaders(c.res, HEADERS);
  if (own) c.res.headers.set("Content-Security-Policy", own);
});

app.use("/api/*", async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    // Cross-site request protection, on top of the SameSite=Strict cookie.
    if (c.req.header("origin") !== c.env.ORIGIN || c.req.header("x-ronchi") !== "1") fail(403, "Request blocked.");
  }
  c.set("user", await loadSession(c));
  const user = c.get("user");
  if (c.env.API_LIMIT) {
    const { success } = await c.env.API_LIMIT.limit({ key: user ? `u:${user.id}` : `ip:${c.get("ip")}` });
    if (!success) fail(429, "Too many requests. Wait a minute and try again.");
  }
  await next();
  // API answers are never cached, except files (routes/files.ts), which set their own private rule.
  if (!c.res.headers.get("Cache-Control")) c.header("Cache-Control", "no-store");
});

app.route("/api/auth", auth);
app.route("/api/users", users);
app.route("/api/machines", machines);
app.route("/api/boards", boards);
app.route("/api/prefs", prefs);
app.route("/api/files", files);
app.route("/api/catalog", catalog);
app.route("/api/customers", customers);
app.route("/api/quotes", quotes);
app.route("/api/change-parts", changeParts);
app.route("/api/kb", kb);
app.route("/api/jobs", jobs);
app.route("/api/switches", switches);
app.route("/api/links", links);

app.all("/api/*", () => fail(404, "Not found."));

// Everything else is the staff app (the single-page app in web/dist).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => {
  const res = err instanceof HTTPException ? err.getResponse() : null;
  if (!res) console.error("Unexpected error", err); // shows in Cloudflare's Workers logs
  return withHeaders(res ?? Response.json({ error: "Something went wrong. It has been logged." }, { status: 500 }), { ...HEADERS, "Cache-Control": "no-store" });
});

export default app;
