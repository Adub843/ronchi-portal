// Machine registry. Every machine has one page; later steps hang manuals,
// service reports, boards, orders and remote sessions off it.
import { Hono } from "hono";
import { randomId } from "../../shared/crypto";
import { parseCsv } from "../../shared/change-parts";
import { MACHINE_NUMBER } from "../../shared/machine-number";
import type { AppEnv } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, mustStr, requirePerm, str, has } from "../lib/http";

export const machines = new Hono<AppEnv>();


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
  const orders = has(c.get("user"), "orders.view")
    ? (await c.env.DB.prepare("SELECT id, part, status, ship_date, updated_at FROM cp_orders WHERE instr(upper(machine), ?) > 0 AND phase = 'order' AND removed_at IS NULL ORDER BY updated_at DESC").bind(m.serial).all()).results
    : null;
  // Spare parts orders for this machine, only for people who may see parts orders.
  const partsOrders = has(c.get("user"), "partsorders.view")
    ? (await c.env.DB.prepare("SELECT id, 'P-' || seq AS number, customer, status, customer_po, updated_at FROM parts_orders WHERE machine = ? AND removed_at IS NULL ORDER BY updated_at DESC LIMIT 100").bind(String(m.serial).toUpperCase()).all()).results
    : undefined;
  return c.json({ machine: m, boards: boards.results, orders, partsOrders });
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
  const u = requirePerm(c, "machines.add");
  const b = await body(c);
  const serial = mustStr(b.serial, 20, "Machine number").toUpperCase();
  if (!MACHINE_NUMBER.test(serial)) fail(400, "Machine numbers look like 3069MB or RA1018.");
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

/**
 * Add many machines at once from a CSV file (columns: machine, model, customer, site, sharepoint,
 * notes; the header names can vary). Without confirm it only answers with what it found. A machine
 * already in the registry is never overwritten: only its empty fields are filled in.
 */
machines.post("/import", async (c) => {
  // It adds machines and fills in empty fields on existing ones, so it takes both permissions.
  requirePerm(c, "machines.add");
  const u = requirePerm(c, "machines.edit");
  const b = await body(c);
  if (typeof b.csv !== "string" || !b.csv.trim()) fail(400, "Choose a CSV file to import.");
  if (b.csv.length > 2_000_000) fail(400, "That file is too big (limit 2 MB).");
  const table = parseCsv(b.csv).filter((r) => r.some((x) => x.trim()));
  const head = (table.shift() ?? []).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const at = {
    serial: col("machine", "serial", "number"), model: col("model", "type"), customer: col("customer"),
    site: col("site", "line", "plant"), sharepoint_url: col("sharepoint", "link", "folder"), notes: col("notes", "what"),
  };
  if (at.serial < 0) fail(400, "The file needs a column named Machine.");
  const cell = (r: string[], i: number, max: number) => (i >= 0 ? (r[i] ?? "").trim().slice(0, max) || null : null);
  const bad: string[] = [];
  const rows = new Map<string, { serial: string; model: string | null; customer: string | null; site: string | null; sharepoint_url: string | null; notes: string | null }>();
  for (const r of table) {
    const serial = (cell(r, at.serial, 20) ?? "").toUpperCase();
    if (!MACHINE_NUMBER.test(serial)) { if (serial) bad.push(serial); continue; }
    const link = cell(r, at.sharepoint_url, 1000);
    rows.set(serial, {
      serial, model: cell(r, at.model, 100), customer: cell(r, at.customer, 200), site: cell(r, at.site, 200),
      sharepoint_url: link && /^https:\/\/[a-z0-9-]+\.sharepoint\.com\//i.test(link) ? link : null, notes: cell(r, at.notes, 5000),
    });
  }
  const { results: have } = await c.env.DB.prepare("SELECT serial FROM machines").all<{ serial: string }>();
  const known = new Set(have.map((h) => h.serial.toUpperCase()));
  const list = [...rows.values()];
  const adding = list.filter((r) => !known.has(r.serial));
  const summary = { found: list.length, adding: adding.length, updating: list.length - adding.length, notMachines: bad.slice(0, 30) };
  if (b.confirm !== true) return c.json(summary);
  const t = now();
  const ins = c.env.DB.prepare("INSERT INTO machines (id, serial, model, customer, site, notes, sharepoint_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)");
  const fill = c.env.DB.prepare(
    `UPDATE machines SET model = COALESCE(model, ?), customer = COALESCE(customer, ?), site = COALESCE(site, ?),
            notes = COALESCE(notes, ?), sharepoint_url = COALESCE(sharepoint_url, ?), updated_at = ? WHERE serial = ? COLLATE NOCASE`,
  );
  const stmts = list.map((r) => known.has(r.serial)
    ? fill.bind(r.model, r.customer, r.site, r.notes, r.sharepoint_url, t, r.serial)
    : ins.bind(randomId(), r.serial, r.model, r.customer, r.site, r.notes, r.sharepoint_url, t, t));
  for (let i = 0; i < stmts.length; i += 50) await c.env.DB.batch(stmts.slice(i, i + 50));
  await audit(c.env.DB, { userId: u.id, action: "machine.import", targetType: "machine", detail: { added: adding.length, filled: summary.updating }, ip: c.get("ip") });
  return c.json({ ...summary, imported: adding.length });
});
