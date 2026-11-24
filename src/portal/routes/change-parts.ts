// Change-part orders: the sales side's job tracker (replaces the old Change Parts Console).
// Only roles with orders.view can see these; only orders.edit can change them (see lib/roles.ts).
// Every change is written to the audit log with what it was before and after, and the order
// page shows that history. Two people editing at once can't overwrite each other: each save
// sends the revision it started from, and a stale one is refused.
import { Hono } from "hono";
import { CP_FIELDS, CP_LABELS, CP_MAX, FOLDER_LINK, isOpen, readOrdersCsv, type CpField, type CpOrderInput } from "../../shared/change-parts";
import { randomId } from "../../shared/crypto";
import type { AppEnv } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, requirePerm } from "../lib/http";

export const changeParts = new Hono<AppEnv>();

const COLS = CP_FIELDS.join(", ");

/** Check and tidy the typed fields. Only fields present in `b` are returned. */
function clean(b: Record<string, unknown>): CpOrderInput {
  const out: CpOrderInput = {};
  for (const f of CP_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(b, f)) continue;
    const raw = b[f];
    if (raw !== null && raw !== undefined && typeof raw !== "string") fail(400, `${CP_LABELS[f]} must be text.`);
    let v = (raw ?? "").trim();
    if (v.length > CP_MAX[f]) fail(400, `${CP_LABELS[f]} is too long (limit ${CP_MAX[f]} characters).`);
    if (v && f === "folder_url" && !FOLDER_LINK.test(v)) fail(400, "The folder link must start with https://<company>.sharepoint.com/");
    if (f === "machine") v = v.toUpperCase();
    out[f] = v || null;
  }
  return out;
}

function changes(before: Record<string, unknown>, after: CpOrderInput) {
  const diff: Record<string, [unknown, unknown]> = {};
  for (const f of Object.keys(after) as CpField[]) if ((before[f] ?? null) !== (after[f] ?? null)) diff[f] = [before[f] ?? null, after[f] ?? null];
  return diff;
}

changeParts.get("/", async (c) => {
  requirePerm(c, "orders.view");
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, ${CP_FIELDS.map((f) => "o." + f).join(", ")}, o.revision, o.updated_at, m.id AS machine_id
       FROM cp_orders o LEFT JOIN machines m ON m.serial = o.machine
      WHERE o.removed_at IS NULL ORDER BY o.updated_at DESC LIMIT 5000`,
  ).all<Record<string, string | null>>();
  return c.json({ orders: results.map((o) => ({ ...o, open: isOpen(o.status) })) });
});

changeParts.get("/:id", async (c) => {
  requirePerm(c, "orders.view");
  const id = c.req.param("id");
  const order = await c.env.DB.prepare(
    `SELECT o.*, m.id AS machine_id, cu.name AS created_by_name, uu.name AS updated_by_name
       FROM cp_orders o LEFT JOIN machines m ON m.serial = o.machine
       LEFT JOIN users cu ON cu.id = o.created_by LEFT JOIN users uu ON uu.id = o.updated_by
      WHERE o.id = ? AND o.removed_at IS NULL`,
  ).bind(id).first();
  if (!order) fail(404, "Not found.");
  const { results } = await c.env.DB.prepare(
    `SELECT a.at, a.action, a.detail, u.name AS who FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.target_type = 'cp_order' AND a.target_id = ? ORDER BY a.at DESC LIMIT 200`,
  ).bind(id).all<{ at: string; action: string; detail: string | null; who: string | null }>();
  const history = results.map((h) => ({ at: h.at, action: h.action, who: h.who, changes: h.detail ? (JSON.parse(h.detail).changes ?? null) : null }));
  return c.json({ order: { ...order, open: isOpen(order.status as string | null) }, history });
});

changeParts.post("/", async (c) => {
  const u = requirePerm(c, "orders.edit");
  const f = clean(await body(c));
  if (!f.customer) fail(400, "Customer is required.");
  const id = randomId();
  const t = now();
  await c.env.DB.prepare(`INSERT INTO cp_orders (id, ${COLS}, created_by, updated_by, created_at, updated_at) VALUES (?, ${CP_FIELDS.map(() => "?").join(", ")}, ?, ?, ?, ?)`)
    .bind(id, ...CP_FIELDS.map((k) => f[k] ?? null), u.id, u.id, t, t)
    .run();
  await audit(c.env.DB, { userId: u.id, action: "cp_order.create", targetType: "cp_order", targetId: id, detail: { changes: changes({}, f) }, ip: c.get("ip") });
  return c.json({ id });
});

changeParts.patch("/:id", async (c) => {
  const u = requirePerm(c, "orders.edit");
  const id = c.req.param("id");
  const b = await body(c);
  const before = await c.env.DB.prepare("SELECT * FROM cp_orders WHERE id = ? AND removed_at IS NULL").bind(id).first<Record<string, unknown>>();
  if (!before) fail(404, "Not found.");
  if (typeof b.revision !== "number" || b.revision !== before.revision) fail(409, "Someone else changed this order while you were editing. Reload to see their changes.");
  const f = clean(b);
  if ("customer" in f && !f.customer) fail(400, "Customer is required.");
  const diff = changes(before, f);
  if (!Object.keys(diff).length) return c.json({ ok: true, revision: before.revision });
  const keys = Object.keys(diff) as CpField[];
  const r = await c.env.DB.prepare(
    `UPDATE cp_orders SET ${keys.map((k) => `${k} = ?`).join(", ")}, revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?`,
  ).bind(...keys.map((k) => f[k] ?? null), u.id, now(), id, before.revision).run();
  if (!r.meta.changes) fail(409, "Someone else changed this order while you were editing. Reload to see their changes.");
  await audit(c.env.DB, { userId: u.id, action: "cp_order.update", targetType: "cp_order", targetId: id, detail: { changes: diff }, ip: c.get("ip") });
  return c.json({ ok: true, revision: (before.revision as number) + 1 });
});

changeParts.delete("/:id", async (c) => {
  const u = requirePerm(c, "orders.edit");
  const id = c.req.param("id");
  const r = await c.env.DB.prepare("UPDATE cp_orders SET removed_at = ?, updated_by = ? WHERE id = ? AND removed_at IS NULL").bind(now(), u.id, id).run();
  if (!r.meta.changes) fail(404, "Not found.");
  await audit(c.env.DB, { userId: u.id, action: "cp_order.remove", targetType: "cp_order", targetId: id, ip: c.get("ip") });
  return c.json({ ok: true });
});

const dupKey = (o: CpOrderInput | Record<string, unknown>) =>
  [o.customer, o.machine, o.part, o.customer_po].map((v) => String(v ?? "").trim().toLowerCase()).join("|");

/**
 * Bring in a spreadsheet saved as CSV (the old console's export or the SharePoint master sheet).
 * Without `confirm` it only reads the file and says what it found; with `confirm: true` it adds
 * the orders. Orders already here (same customer, machine, part and customer PO) are skipped.
 */
changeParts.post("/import", async (c) => {
  const u = requirePerm(c, "orders.edit");
  const b = await body(c);
  if (typeof b.csv !== "string" || !b.csv.trim()) fail(400, "Choose a CSV file to import.");
  if (b.csv.length > 3_000_000) fail(400, "That file is too big (limit 3 MB).");
  const read = readOrdersCsv(b.csv);
  const { results } = await c.env.DB.prepare("SELECT customer, machine, part, customer_po FROM cp_orders WHERE removed_at IS NULL").all<Record<string, unknown>>();
  const have = new Set(results.map(dupKey));
  const fresh = read.orders.filter((o) => {
    const k = dupKey(o);
    if (have.has(k)) return false;
    have.add(k);
    return true;
  });
  const summary = {
    found: read.orders.length, adding: fresh.length, duplicates: read.orders.length - fresh.length, skipped: read.skipped,
    matched: read.matched, extra: read.extra, problems: read.problems, sample: fresh.slice(0, 5),
  };
  if (b.confirm !== true) return c.json(summary);
  const t = now();
  const stmt = c.env.DB.prepare(`INSERT INTO cp_orders (id, ${COLS}, created_by, updated_by, created_at, updated_at) VALUES (?, ${CP_FIELDS.map(() => "?").join(", ")}, ?, ?, ?, ?)`);
  for (let i = 0; i < fresh.length; i += 50) {
    await c.env.DB.batch(fresh.slice(i, i + 50).map((o) => stmt.bind(randomId(), ...CP_FIELDS.map((k) => o[k] ?? null), u.id, u.id, t, t)));
  }
  await audit(c.env.DB, { userId: u.id, action: "cp_order.import", targetType: "cp_order", detail: { added: fresh.length, duplicates: summary.duplicates, skipped: read.skipped }, ip: c.get("ip") });
  return c.json({ ...summary, imported: fresh.length });
});
