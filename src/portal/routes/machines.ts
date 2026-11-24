// Machine registry. Every machine has one page; later steps hang manuals,
// service reports, boards, orders and remote sessions off it.
import { Hono } from "hono";
import { randomId } from "../../shared/crypto";
import { MACHINE_SERIAL } from "../../shared/service-report";
import type { AppEnv } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, mustStr, requirePerm, str } from "../lib/http";
import { can } from "../lib/roles";

export const machines = new Hono<AppEnv>();

const SERIAL_ONLY = new RegExp(`^${MACHINE_SERIAL.source.replace(/\\b/g, "")}$`, "i");

machines.get("/", async (c) => {
  requirePerm(c, "machines.view");
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT id, serial, model, customer, site, updated_at FROM machines
      WHERE ? = '' OR serial LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\' OR customer LIKE ? ESCAPE '\\' OR site LIKE ? ESCAPE '\\'
      ORDER BY serial LIMIT 500`,
  ).bind(q, like, like, like, like).all();
  return c.json({ machines: results });
});

machines.get("/:id", async (c) => {
  requirePerm(c, "machines.view");
  const m = await c.env.DB.prepare("SELECT * FROM machines WHERE id = ?").bind(c.req.param("id")).first();
  if (!m) fail(404, "Not found.");
  const boards = await c.env.DB.prepare("SELECT id, name FROM boards WHERE machine_id = ? AND archived_at IS NULL").bind(c.req.param("id")).all();
  // Change-part orders for this machine, only for people who may see orders.
  const orders = can(c.get("user")?.role, "orders.view")
    ? (await c.env.DB.prepare("SELECT id, part, status, ship_date, updated_at FROM cp_orders WHERE machine = ? AND removed_at IS NULL ORDER BY updated_at DESC").bind(m.serial).all()).results
    : null;
  return c.json({ machine: m, boards: boards.results, orders });
});

function fields(b: Record<string, unknown>) {
  return {
    model: str(b.model, 100),
    customer: str(b.customer, 200),
    site: str(b.site, 200),
    notes: str(b.notes, 5000),
    sharepoint_url: (() => {
      const u = str(b.sharepointUrl, 1000);
      if (u && !/^https:\/\/[a-z0-9-]+\.sharepoint\.com\//i.test(u)) fail(400, "The SharePoint link must start with https://<company>.sharepoint.com/");
      return u;
    })(),
  };
}

machines.post("/", async (c) => {
  const u = requirePerm(c, "machines.edit");
  const b = await body(c);
  const serial = mustStr(b.serial, 20, "Machine number").toUpperCase();
  if (!SERIAL_ONLY.test(serial)) fail(400, "Machine numbers look like 3069MB (four digits, then letters).");
  const f = fields(b);
  const id = randomId();
  const t = now();
  try {
    await c.env.DB.prepare("INSERT INTO machines (id, serial, model, customer, site, notes, sharepoint_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, serial, f.model, f.customer, f.site, f.notes, f.sharepoint_url, t, t)
      .run();
  } catch {
    fail(409, `Machine ${serial} is already in the registry.`);
  }
  await audit(c.env.DB, { userId: u.id, action: "machine.create", targetType: "machine", targetId: id, detail: { serial }, ip: c.get("ip") });
  return c.json({ id });
});

machines.patch("/:id", async (c) => {
  const u = requirePerm(c, "machines.edit");
  const id = c.req.param("id");
  const before = await c.env.DB.prepare("SELECT * FROM machines WHERE id = ?").bind(id).first();
  if (!before) fail(404, "Not found.");
  const f = fields(await body(c));
  await c.env.DB.prepare("UPDATE machines SET model = ?, customer = ?, site = ?, notes = ?, sharepoint_url = ?, updated_at = ? WHERE id = ?")
    .bind(f.model, f.customer, f.site, f.notes, f.sharepoint_url, now(), id)
    .run();
  await audit(c.env.DB, { userId: u.id, action: "machine.update", targetType: "machine", targetId: id, detail: { before, after: f }, ip: c.get("ip") });
  return c.json({ ok: true });
});
