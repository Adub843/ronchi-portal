// Ronchi Help Center Worker (CUSTOMER side). Open link, no login, no cookies.
//
// THE WALL: this file may only import from src/shared and src/help. It has one database,
// help-db, which holds nothing but published customer-safe articles. test/wall.test.ts
// checks both rules on every build.
import { Hono } from "hono";
import { HELP_CSP, securityHeaders, withHeaders } from "../shared/security-headers";
import { page, articlePage, resultsHtml, type ArticleRow } from "./html";
import { LOGO_PNG_BASE64 } from "./logo";

interface HelpEnv {
  HELP_DB: D1Database;
  SEARCH_LIMIT?: RateLimit;
}

const HEADERS = { ...securityHeaders({ csp: HELP_CSP }), "Cache-Control": "public, max-age=60" };

export const app = new Hono<{ Bindings: HelpEnv }>();

app.use("*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.text("Not allowed", 405, HEADERS);
  await next();
  c.res = withHeaders(c.res, HEADERS);
});

/** Turn what a customer typed into a safe full-text query: plain words only, each as a prefix. */
export function toFtsQuery(input: string): string {
  const words = input.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1).slice(0, 8);
  return words.map((w) => `"${w}"*`).join(" ");
}

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
  if (!/^[A-Z]{2,4}-\d{1,6}$/.test(number)) return c.html(page("", "<p>Article not found.</p>"), 404);
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
