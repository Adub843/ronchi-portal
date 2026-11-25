// Quick links: named buttons on the Home page that open a website (Aaron, 2026-11-25: "the ability to
// ad links with buttons to peoples home page ... the ability to name the button as well").
// Admins (users.manage) add, rename, reorder and remove them, and choose who sees each one:
// everyone, some roles, or some people. Everyone else only reads the links meant for them.
import { Hono } from "hono";
import { randomId } from "../../shared/crypto";
import type { AppEnv } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, has, mustStr, requirePerm, requireUser } from "../lib/http";
import { roleExists } from "../lib/role-store";

export const links = new Hono<AppEnv>();

interface Row { id: string; label: string; url: string; audience: string | null; position: number }

/** Only plain web addresses; a typed "example.com" becomes https://example.com. */
export function cleanUrl(value: unknown): string {
  let raw = mustStr(value, 2000, "Web address").trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    fail(400, "That web address doesn't look right.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") fail(400, "Links must start with https:// or http://");
  if (u.username || u.password) fail(400, "Leave passwords out of the link.");
  if (!u.hostname.includes(".") && u.hostname !== "localhost") fail(400, "That web address doesn't look right.");
  return u.toString();
}

async function cleanAudience(db: D1Database, value: unknown): Promise<string | null> {
  if (value === null || value === undefined) return null;
  const v = value as { roles?: unknown; people?: unknown };
  const roles = Array.isArray(v.roles) ? v.roles : [];
  const people = Array.isArray(v.people) ? v.people : [];
  if (!roles.length && !people.length) return null;
  for (const r of roles) if (!(await roleExists(db, r))) fail(400, "Unknown role in who sees it.");
  for (const p of people) {
    if (typeof p !== "string" || !(await db.prepare("SELECT 1 FROM users WHERE id = ?").bind(p).first())) fail(400, "Unknown person in who sees it.");
  }
  return JSON.stringify([...new Set(roles as string[])].concat([...new Set(people as string[])].map((p) => `u:${p}`)));
}

function shape(r: Row) {
  const list: string[] = r.audience ? JSON.parse(r.audience) : [];
  return {
    id: r.id, label: r.label, url: r.url,
    audience: r.audience ? { roles: list.filter((x) => !x.startsWith("u:")), people: list.filter((x) => x.startsWith("u:")).map((x) => x.slice(2)) } : null,
  };
}

/** The links this person sees. Admins can ask for all of them with ?all=1 to edit. */
links.get("/", async (c) => {
  const u = requireUser(c);
  const { results } = await c.env.DB.prepare("SELECT id, label, url, audience, position FROM quick_links ORDER BY position, created_at").all<Row>();
  const all = c.req.query("all") === "1" && has(u, "users.manage");
  const mine = results.filter((r) => {
    if (all || !r.audience) return true;
    const list: string[] = JSON.parse(r.audience);
    return list.includes(u.role) || list.includes(`u:${u.id}`);
  });
  return c.json({ links: mine.map(shape) });
});

links.post("/", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const b = await body(c);
  const label = mustStr(b.label, 40, "Button name");
  const url = cleanUrl(b.url);
  const audience = await cleanAudience(c.env.DB, b.audience);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS last FROM quick_links").first<{ n: number; last: number }>();
  if ((count?.n ?? 0) >= 40) fail(400, "That's the limit of 40 quick links. Remove one first.");
  const id = randomId();
  const t = now();
  await c.env.DB.prepare("INSERT INTO quick_links (id, label, url, audience, position, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id, label, url, audience, (count?.last ?? -1) + 1, admin.id, t, t).run();
  await audit(c.env.DB, { userId: admin.id, action: "link.create", targetType: "quick_link", targetId: id, detail: { label, url, audience }, ip: c.get("ip") });
  return c.json({ id });
});

/** Put the links in this order (a list of ids). */
links.post("/order", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const b = await body(c);
  if (!Array.isArray(b.ids) || b.ids.some((x) => typeof x !== "string")) fail(400, "Send the list of links in order.");
  const ids = b.ids as string[];
  if (ids.length) await c.env.DB.batch(ids.map((id, i) => c.env.DB.prepare("UPDATE quick_links SET position = ? WHERE id = ?").bind(i, id)));
  await audit(c.env.DB, { userId: admin.id, action: "link.reorder", targetType: "quick_link", ip: c.get("ip") });
  return c.json({ ok: true });
});

links.patch("/:id", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const id = c.req.param("id");
  const before = await c.env.DB.prepare("SELECT id, label, url, audience, position FROM quick_links WHERE id = ?").bind(id).first<Row>();
  if (!before) fail(404, "Not found.");
  const b = await body(c);
  const label = b.label === undefined ? before.label : mustStr(b.label, 40, "Button name");
  const url = b.url === undefined ? before.url : cleanUrl(b.url);
  const audience = b.audience === undefined ? before.audience : await cleanAudience(c.env.DB, b.audience);
  await c.env.DB.prepare("UPDATE quick_links SET label = ?, url = ?, audience = ?, updated_at = ? WHERE id = ?").bind(label, url, audience, now(), id).run();
  await audit(c.env.DB, { userId: admin.id, action: "link.update", targetType: "quick_link", targetId: id, detail: { before: shape(before), after: { label, url, audience } }, ip: c.get("ip") });
  return c.json({ ok: true });
});

links.delete("/:id", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const id = c.req.param("id");
  const before = await c.env.DB.prepare("SELECT label, url FROM quick_links WHERE id = ?").bind(id).first<{ label: string; url: string }>();
  if (!before) fail(404, "Not found.");
  await c.env.DB.prepare("DELETE FROM quick_links WHERE id = ?").bind(id).run();
  await audit(c.env.DB, { userId: admin.id, action: "link.delete", targetType: "quick_link", targetId: id, detail: before, ip: c.get("ip") });
  return c.json({ ok: true });
});
