// Ronchi Help Center Worker (CUSTOMER side). Open link, no login, no cookies.
//
// THE WALL: this file may only import from src/shared and src/help. It has one database,
// help-db, which holds nothing but published customer-safe articles. test/wall.test.ts
// checks both rules on every build.
import { Hono } from "hono";
import { sha256Hex } from "../shared/crypto";
import { KB_CODE, toFtsQuery } from "../shared/kb";
import { HELP_CSP, securityHeaders, withHeaders } from "../shared/security-headers";
import { page, articlePage, resultsHtml, type ArticleRow } from "./html";
import { LOGO_PNG_BASE64 } from "./logo";

interface HelpEnv {
  HELP_DB: D1Database;
  SEARCH_LIMIT?: RateLimit;
  // SHA-256 of the staff portal's publish key (a secret, set by scripts/set-publish-keys.mjs).
  // With no secret set, the /admin publish door is switched off.
  ADMIN_KEY_HASH?: string;
}

const HEADERS = { ...securityHeaders({ csp: HELP_CSP }), "Cache-Control": "public, max-age=60" };

export const app = new Hono<{ Bindings: HelpEnv }>();

app.use("*", async (c, next) => {
  const door = c.req.path.startsWith("/admin/");
  if (!door && c.req.method !== "GET" && c.req.method !== "HEAD") return c.text("Not allowed", 405, HEADERS);
  await next();
  c.res = withHeaders(c.res, HEADERS);
});

export { toFtsQuery };

// ---------- The publish door: the staff portal's one way in ----------
// The portal reaches it only through its HELP service binding, with the publish key. It can put an
// article in or take one out, nothing else: there is no way to read anything back or reach the portal.

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const HELP_KINDS = new Set(["opl", "howto", "issue_fix", "training"]);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

app.use("/admin/*", async (c, next) => {
  const want = c.env.ADMIN_KEY_HASH;
  const got = /^Bearer (.{32,200})$/.exec(c.req.header("authorization") ?? "")?.[1];
  if (!want || !got || !sameText(await sha256Hex(got), want.toLowerCase())) return c.json({ error: "Not found." }, 404);
  await next();
});

app.put("/admin/articles/:number", async (c) => {
  const number = c.req.param("number");
  const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!KB_CODE.test(number) || !b || !HELP_KINDS.has(String(b.kind)) || !text(b.title, 200).trim()) return c.json({ error: "That isn't an article." }, 400);
  const at = new Date().toISOString();
  await c.env.HELP_DB.prepare(
    `INSERT INTO articles (id, number, kind, title, machine_type, category, issue, fix, body, published_at, updated_at)
     VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
     ON CONFLICT(number) DO UPDATE SET kind = ?2, title = ?3, machine_type = ?4, category = ?5, issue = ?6, fix = ?7, body = ?8, updated_at = ?9`,
  ).bind(number, b.kind, text(b.title, 200).trim(), text(b.machine_type, 80) || null, text(b.category, 40) || null, text(b.issue, 8000), text(b.fix, 8000), text(b.body, 100000), at).run();
  return c.json({ ok: true, number });
});

app.delete("/admin/articles/:number", async (c) => {
  await c.env.HELP_DB.prepare("DELETE FROM articles WHERE number = ?").bind(c.req.param("number")).run();
  return c.json({ ok: true });
});

app.all("/admin/*", (c) => c.json({ error: "Not found." }, 404));

async function search(c: { env: HelpEnv; req: { header(n: string): string | undefined } }, q: string): Promise<ArticleRow[] | "limited"> {
  if (c.env.SEARCH_LIMIT) {
    const { success } = await c.env.SEARCH_LIMIT.limit({ key: c.req.header("cf-connecting-ip") ?? "unknown" });
    if (!success) return "limited";
  }
  const fts = toFtsQuery(q);
  if (!fts) {
    const { results } = await c.env.HELP_DB.prepare("SELECT number, kind, title, machine_type, category, issue, fix FROM articles ORDER BY updated_at DESC LIMIT 20").all<ArticleRow>();
    return results;
  }
  const { results } = await c.env.HELP_DB.prepare(
    `SELECT a.number, a.kind, a.title, a.machine_type, a.category, a.issue, a.fix
       FROM articles_fts f JOIN articles a ON a.rowid = f.rowid
      WHERE articles_fts MATCH ? ORDER BY bm25(articles_fts, 4.0, 2.0, 2.0, 1.0) LIMIT 50`,
  ).bind(fts).all<ArticleRow>();
  return results;
}

app.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").slice(0, 200);
  const results = await search(c, q);
  return c.html(page(q, results === "limited" ? null : resultsHtml(q, results)));
});

app.get("/api/search", async (c) => {
  const results = await search(c, (c.req.query("q") ?? "").slice(0, 200));
  if (results === "limited") return c.json({ error: "Too many searches. Wait a minute." }, 429);
  return c.json({ results });
});

app.get("/a/:number", async (c) => {
  const number = c.req.param("number");
  if (!/^[A-Z]{2,4}-\d{1,6}$/.test(number) && !KB_CODE.test(number)) return c.html(page("", "<p>Article not found.</p>"), 404);
  const a = await c.env.HELP_DB.prepare("SELECT number, kind, title, machine_type, category, issue, fix, body, updated_at FROM articles WHERE number = ?").bind(number).first<ArticleRow & { body: string; updated_at: string }>();
  if (!a) return c.html(page("", "<p>Article not found.</p>"), 404);
  return c.html(articlePage(a));
});

app.get("/logo.png", () => {
  const bin = atob(LOGO_PNG_BASE64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
});

app.get("/robots.txt", (c) => c.text("User-agent: *\nAllow: /\n"));

app.notFound((c) => c.html(page("", "<p>Page not found.</p>"), 404));

app.onError((err, c) => {
  console.error("Unexpected error", err);
  return withHeaders(c.html(page("", "<p>Something went wrong. Please try again.</p>"), 500), HEADERS);
});

export default app;
