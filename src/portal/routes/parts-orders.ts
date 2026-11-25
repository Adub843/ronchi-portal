// Parts orders (spare parts, not change parts): a quote that becomes an order when the customer's PO
// comes in, its lines, files, history, and the sales tracker's numbers.
//
// Who: psales.view sees, psales.edit changes (lib/roles.ts). Deny by default; every change goes in
// the audit log with what it was before and after, and the order page shows that history.
// Two people editing at once can't overwrite each other: a save sends the revision it started from.
//
// Shipping progress (qty shipped, partially shipped, shipped) is never typed here. It is added up
// from the shipments in routes/shipping.ts, so the two can't disagree.
//
// HARD RULE: no money anywhere (LOCKED_RULES in lib/settings.ts). Counts, quantities and dates only.
import { Hono, type Context } from "hono";
import { randomId } from "../../shared/crypto";
import { toCsv } from "../../shared/csv";
import {
  canMove, cleanLines, cleanNotes, cleanPoFields, fullyShipped, isBackordered, isPoStatus, isQuote, PO_CSV_HEADER, PO_FIELDS, PO_MAX, PO_MOVES,
  poKpis, remaining, revLetter, shownStatus, type LineInput, type PoField, type PoStatus, type PoSummary,
} from "../../shared/parts-orders";
import { trackingUrl } from "../../shared/shipping";
import type { AppEnv } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, has, requirePerm } from "../lib/http";
import { partsCall } from "../lib/parts-site";
import { serveFile } from "../lib/serve-file";
import { historyOf, nextNumber, storeUploads } from "../lib/uploads";

export const partsOrders = new Hono<AppEnv>();

type Row = Record<PoField, string | null> & {
  id: string; quote_number: string; quote_rev: number; order_number: string | null; status: PoStatus; reason: string | null;
  notes: string | null; revision: number; request_id: string | null; request_number: string | null;
  sent_at: string | null; booked_at: string | null; lost_at: string | null; closed_at: string | null; cancelled_at: string | null;
  created_at: string; updated_at: string;
};
interface LineRow { id: string; order_id: string; line_no: number; part_code: string | null; description: string | null; qty: number; backorder: number; shipped: number; allocated: number; last_ship: string | null }

const today = () => new Date().toISOString().slice(0, 10);
const stale = "Someone else changed this parts order while you were working on it. Reload to see their changes.";

/** Every line with what has shipped (shipments marked shipped or delivered) and what is on a shipment being packed. */
async function linesOf(db: D1Database, orderId?: string): Promise<LineRow[]> {
  const { results } = await db.prepare(
    `SELECT l.id, l.order_id, l.line_no, l.part_code, l.description, l.qty, l.backorder,
            COALESCE(SUM(CASE WHEN s.status IN ('shipped','delivered') THEN sl.qty END), 0) AS shipped,
            COALESCE(SUM(CASE WHEN s.status IN ('to_pick','packed') THEN sl.qty END), 0) AS allocated,
            MAX(CASE WHEN s.status IN ('shipped','delivered') THEN s.ship_date END) AS last_ship
       FROM po_lines l
       LEFT JOIN sh_out_lines sl ON sl.po_line_id = l.id
       LEFT JOIN sh_outbound s ON s.id = sl.outbound_id
      ${orderId ? "WHERE l.order_id = ?" : ""}
      GROUP BY l.id ORDER BY l.order_id, l.line_no`,
  ).bind(...(orderId ? [orderId] : [])).all<LineRow>();
  return results;
}

/** One order with its line counts and the status people see. */
function summarize(o: Row, lines: LineRow[], day: string) {
  const shown = shownStatus(o.status, lines);
  const done = fullyShipped(lines);
  const s: PoSummary = {
    status: o.status, created_at: o.created_at, booked_at: o.booked_at, lost_at: o.lost_at, promised_date: o.promised_date,
    follow_up: o.follow_up, valid_until: o.valid_until, shown,
    shipped_on: o.status !== "cancelled" && done ? lines.reduce<string | null>((m, l) => (l.last_ship && (!m || l.last_ship > m) ? l.last_ship : m), null) : null,
    lines: lines.length,
    backordered: lines.filter(isBackordered).length,
  };
  return {
    ...s,
    qty: lines.reduce((n, l) => n + l.qty, 0),
    qty_shipped: lines.reduce((n, l) => n + Math.min(l.shipped, l.qty), 0),
    late: o.status === "booked" && shown !== "Shipped" && !!o.promised_date && o.promised_date < day,
    expired: isQuote(o.status) && !!o.valid_until && o.valid_until < day,
    due: isQuote(o.status) && !!o.follow_up && o.follow_up <= day,
  };
}

const LIST_COLS = "o.id, o.quote_number, o.quote_rev, o.order_number, o.status, o.customer, o.contact, o.machine, o.customer_po, o.salesperson, o.follow_up, o.valid_until, o.promised_date, o.hold_reason, o.created_at, o.booked_at, o.lost_at, o.updated_at, m.id AS machine_id";

partsOrders.get("/", async (c) => {
  requirePerm(c, "psales.view");
  const db = c.env.DB;
  const { results } = await db.prepare(`SELECT ${LIST_COLS} FROM po_orders o LEFT JOIN machines m ON m.serial = o.machine ORDER BY o.updated_at DESC LIMIT 5000`).all<Row & { machine_id: string | null }>();
  const byOrder = new Map<string, LineRow[]>();
  for (const l of await linesOf(db)) byOrder.set(l.order_id, [...(byOrder.get(l.order_id) ?? []), l]);
  const day = today();
  const orders = results.map((o) => ({ ...o, rev: revLetter(o.quote_rev), ...summarize(o, byOrder.get(o.id) ?? [], day) }));
  return c.json({ orders, kpis: poKpis(orders, day) });
});

/** Everything as a spreadsheet, one row per line. Exports go in the audit log. */
partsOrders.get("/export", async (c) => {
  const u = requirePerm(c, "psales.view");
  const db = c.env.DB;
  const { results } = await db.prepare("SELECT * FROM po_orders ORDER BY created_at").all<Row>();
  const byOrder = new Map<string, LineRow[]>();
  for (const l of await linesOf(db)) byOrder.set(l.order_id, [...(byOrder.get(l.order_id) ?? []), l]);
  const rows: unknown[][] = [];
  for (const o of results) {
    const lines = byOrder.get(o.id) ?? [];
    const head = [o.quote_number, revLetter(o.quote_rev), o.order_number, shownStatus(o.status, lines), o.customer, o.contact, o.machine, o.customer_po, o.salesperson, o.follow_up, o.valid_until, o.promised_date, o.booked_at?.slice(0, 10), summarize(o, lines, today()).shipped_on];
    if (!lines.length) rows.push([...head, "", "", "", "", "", ""]);
    for (const l of lines) rows.push([...head, l.line_no, l.part_code, l.description, l.qty, Math.min(l.shipped, l.qty), isBackordered(l) ? "Yes" : ""]);
  }
  await audit(db, { userId: u.id, action: "po.export", targetType: "parts_order", detail: { orders: results.length }, ip: c.get("ip") });
  return new Response(toCsv(PO_CSV_HEADER, rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="parts-orders-${today()}.csv"` },
  });
});

// ---- files ----

partsOrders.get("/files/:fileId", async (c) => {
  requirePerm(c, "psales.view");
  const f = await c.env.DB.prepare("SELECT id, name FROM po_files WHERE id = ? AND deleted_at IS NULL").bind(c.req.param("fileId")).first<{ id: string; name: string }>();
  if (!f) fail(404, "Not found.");
  return serveFile(c.env.FILES, `parts-orders/${f.id}`, f.name, { download: c.req.query("download") !== undefined });
});

partsOrders.delete("/files/:fileId", async (c) => {
  const u = requirePerm(c, "psales.edit");
  const f = await c.env.DB.prepare("SELECT id, order_id, name FROM po_files WHERE id = ? AND deleted_at IS NULL").bind(c.req.param("fileId")).first<{ id: string; order_id: string; name: string }>();
  if (!f) fail(404, "Not found.");
  await c.env.DB.prepare("UPDATE po_files SET deleted_at = ? WHERE id = ?").bind(now(), f.id).run();
  await c.env.FILES.delete(`parts-orders/${f.id}`).catch(() => undefined);
  await audit(c.env.DB, { userId: u.id, action: "po.file.remove", targetType: "parts_order", targetId: f.order_id, detail: { name: f.name }, ip: c.get("ip") });
  return c.json({ ok: true });
});

partsOrders.post("/:id/files", async (c) => {
  const u = requirePerm(c, "psales.edit");
  const o = await load(c.env.DB, c.req.param("id"));
  const { stored } = await storeUploads(c, u, "parts-orders", { order: o.id });
  const add = c.env.DB.prepare("INSERT INTO po_files (id, order_id, user_id, name, ext, size, created_at) VALUES (?,?,?,?,?,?,?)");
  const at = now();
  await c.env.DB.batch(stored.map((s) => add.bind(s.id, o.id, u.id, s.name, s.ext, s.size, at)));
  await audit(c.env.DB, { userId: u.id, action: "po.file.add", targetType: "parts_order", targetId: o.id, detail: { names: stored.map((s) => s.name) }, ip: c.get("ip") });
  return c.json({ ids: stored.map((s) => s.id) });
});

// ---- one order ----

async function load(db: D1Database, id: string): Promise<Row> {
  const o = await db.prepare("SELECT * FROM po_orders WHERE id = ?").bind(id).first<Row>();
  if (!o) fail(404, "Not found.");
  return o;
}

function bad(e: unknown): never {
  fail(400, (e as Error).message);
}

partsOrders.get("/:id", async (c) => {
  requirePerm(c, "psales.view");
  const db = c.env.DB;
  const o = await load(db, c.req.param("id"));
  const lines = await linesOf(db, o.id);
  const [machine, revisions, files, shipments, history] = await Promise.all([
    o.machine ? db.prepare("SELECT id FROM machines WHERE serial = ?").bind(o.machine).first<{ id: string }>() : null,
    db.prepare("SELECT rev, lines, detail, saved_at, u.name AS saved_by FROM po_revisions r LEFT JOIN users u ON u.id = r.saved_by WHERE order_id = ? ORDER BY rev DESC").bind(o.id).all<{ rev: number; lines: string; detail: string | null; saved_at: string; saved_by: string | null }>(),
    db.prepare("SELECT f.id, f.name, f.ext, f.size, f.created_at, u.name AS by_name FROM po_files f LEFT JOIN users u ON u.id = f.user_id WHERE f.order_id = ? AND f.deleted_at IS NULL ORDER BY f.created_at DESC").bind(o.id).all(),
    shipmentsOf(db, o.id),
    historyOf(db, "parts_order", o.id),
  ]);
  const day = today();
  const pc = (l: LineRow) => ({ ...l, backorder: !!l.backorder, remaining: remaining(l), backordered: isBackordered(l) });
  return c.json({
    order: { ...o, rev: revLetter(o.quote_rev), machine_id: machine?.id ?? null, ...summarize(o, lines, day), moves: PO_MOVES[o.status] },
    lines: lines.map(pc),
    revisions: revisions.results.map((r) => ({ rev: revLetter(r.rev), saved_at: r.saved_at, saved_by: r.saved_by, lines: JSON.parse(r.lines) })),
    files: files.results,
    shipments,
    history,
  });
});

/** The shipments made from an order, each with its tracking link and lines. */
async function shipmentsOf(db: D1Database, orderId: string) {
  const { results } = await db.prepare(
    `SELECT s.id, s.number, s.status, s.ship_date, s.tracking, s.service, s.boxes, s.carrier_id, c.name AS carrier, c.url_template
       FROM sh_outbound s LEFT JOIN carriers c ON c.id = s.carrier_id WHERE s.po_order_id = ? ORDER BY s.created_at`,
  ).bind(orderId).all<{ id: string; number: string; status: string; ship_date: string | null; tracking: string | null; service: string | null; boxes: number | null; carrier_id: string | null; carrier: string | null; url_template: string | null }>();
  if (!results.length) return [];
  const { results: lines } = await db.prepare(
    `SELECT sl.outbound_id, sl.po_line_id, sl.part_code, sl.description, sl.qty FROM sh_out_lines sl JOIN sh_outbound s ON s.id = sl.outbound_id WHERE s.po_order_id = ?`,
  ).bind(orderId).all<{ outbound_id: string; po_line_id: string | null; part_code: string | null; description: string | null; qty: number }>();
  return results.map(({ url_template, ...s }) => ({ ...s, tracking_url: trackingUrl(url_template, s.tracking), lines: lines.filter((l) => l.outbound_id === s.id) }));
}

/** Start a quote. Lines can come now or later. */
partsOrders.post("/", async (c) => {
  const u = requirePerm(c, "psales.edit");
  const b = await body(c);
  let f, lines: LineInput[], notes: string | null;
  try {
    f = cleanPoFields(b);
    lines = b.lines === undefined ? [] : cleanLines(b.lines);
    notes = cleanNotes(b.notes);
  } catch (e) {
    bad(e);
  }
  if (!f.customer) fail(400, "Customer is required.");
  f.salesperson ||= u.name;
  const id = await createQuote(c, u.id, f, lines, notes, null);
  await audit(c.env.DB, { userId: u.id, action: "po.create", targetType: "parts_order", targetId: id, detail: { changes: diffOf({}, f), lines: lines.length }, ip: c.get("ip") });
  return c.json({ id });
});

async function createQuote(c: Context<AppEnv>, userId: string, f: Partial<Record<PoField, string | null>>, lines: LineInput[], notes: string | null, request: { id: string; number: string } | null) {
  const db = c.env.DB;
  const id = randomId();
  const t = now();
  const number = await nextNumber(db, "Q");
  const cols = PO_FIELDS.filter((k) => f[k] !== undefined);
  const addLine = db.prepare("INSERT INTO po_lines (id, order_id, line_no, part_code, description, qty, backorder, created_at) VALUES (?,?,?,?,?,?,?,?)");
  await db.batch([
    db.prepare(`INSERT INTO po_orders (id, quote_number, ${cols.map((k) => k + ", ").join("")}notes, request_id, request_number, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ${cols.map(() => "?, ").join("")}?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, number, ...cols.map((k) => f[k] ?? null), notes, request?.id ?? null, request?.number ?? null, userId, userId, t, t),
    ...lines.map((l, i) => addLine.bind(randomId(), id, i + 1, l.part_code, l.description, l.qty, l.backorder ? 1 : 0, t)),
  ]);
  return id;
}

function diffOf(before: Record<string, unknown>, after: Record<string, unknown>) {
  const diff: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(after)) if ((before[k] ?? null) !== (after[k] ?? null)) diff[k] = [before[k] ?? null, after[k] ?? null];
  return diff;
}

/**
 * Start a quote from a customer's quote request on the parts site: the company, who sent it, the
 * machine (when every line is for the same one) and every line. Asking twice opens the same quote.
 */
partsOrders.post("/from-request", async (c) => {
  const u = requirePerm(c, "psales.edit");
  if (!has(u, "quotes.manage")) fail(403, "Your role doesn't allow this.");
  const b = await body(c);
  const rid = typeof b.requestId === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(b.requestId) ? b.requestId : fail(400, "Pick a quote request.");
  const have = await c.env.DB.prepare("SELECT id FROM po_orders WHERE request_id = ?").bind(rid).first<{ id: string }>();
  if (have) return c.json({ id: have.id, existing: true });
  const r = await partsCall<{ quote: Record<string, any>; lines: Record<string, any>[] }>(c.env, `/quotes/${rid}`);
  const q = r.quote;
  const serials = [...new Set(r.lines.map((l) => (typeof l.serial === "string" ? l.serial.toUpperCase() : "")))];
  const cut = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  let f, lines: LineInput[];
  try {
    f = cleanPoFields({
      customer: cut(q.company, PO_MAX.customer) ?? "(no company)",
      contact: cut([q.sent_by, q.email ? `(${q.email})` : ""].filter(Boolean).join(" "), PO_MAX.contact),
      machine: serials.length === 1 && /^[A-Z0-9-]{2,20}$/.test(serials[0]!) ? serials[0] : null,
    });
    lines = cleanLines(r.lines.slice(0, 200).map((l) => ({
      part_code: cut(l.code, PO_MAX.part_code),
      description: cut([l.name_en || l.name_it || l.description, serials.length > 1 && l.serial ? `for ${l.serial}` : "", l.note].filter(Boolean).join(" · "), PO_MAX.description) ?? "(no description)",
      qty: Math.min(100000, Math.max(1, Math.ceil(Number(l.qty) || 1))),
    })));
  } catch (e) {
    bad(e);
  }
  f.salesperson = u.name;
  const id = await createQuote(c, u.id, f, lines, cut(q.notes, PO_MAX.notes), { id: rid, number: cut(q.number, 40) ?? rid });
  await audit(c.env.DB, { userId: u.id, action: "po.from_request", targetType: "parts_order", targetId: id, detail: { request: q.number, lines: lines.length }, ip: c.get("ip") });
  return c.json({ id });
});

/** Change the header fields. Sends the revision it started from. */
partsOrders.patch("/:id", async (c) => {
  const u = requirePerm(c, "psales.edit");
  const before = await load(c.env.DB, c.req.param("id"));
  const b = await body(c);
  if (typeof b.revision !== "number" || b.revision !== before.revision) fail(409, stale);
  if (before.status === "cancelled") fail(409, "This order was cancelled. It can't be changed.");
  let f;
  try {
    f = cleanPoFields(b);
  } catch (e) {
    bad(e);
  }
  if (before.status === "booked" && "customer_po" in f && !f.customer_po) fail(400, "A booked order needs the customer's PO.");
  const diff = diffOf(before, f);
  if (!Object.keys(diff).length) return c.json({ ok: true, revision: before.revision });
  const keys = Object.keys(diff) as PoField[];
  const r = await c.env.DB.prepare(`UPDATE po_orders SET ${keys.map((k) => `${k} = ?, `).join("")}revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?`)
    .bind(...keys.map((k) => f[k] ?? null), u.id, now(), before.id, before.revision).run();
  if (!r.meta.changes) fail(409, stale);
  await audit(c.env.DB, { userId: u.id, action: "po.update", targetType: "parts_order", targetId: before.id, detail: { changes: diff }, ip: c.get("ip") });
  return c.json({ ok: true, revision: before.revision + 1 });
});

/** The notes box saves as people type. Notes don't take part in the revision check, so a save never collides with other edits. */
partsOrders.put("/:id/notes", async (c) => {
  const u = requirePerm(c, "psales.edit");
  const before = await load(c.env.DB, c.req.param("id"));
  let notes: string | null;
  try {
    notes = cleanNotes((await body(c)).notes);
  } catch (e) {
    bad(e);
  }
  if ((before.notes ?? null) === notes) return c.json({ ok: true });
  await c.env.DB.prepare("UPDATE po_orders SET notes = ?, updated_by = ?, updated_at = ? WHERE id = ?").bind(notes, u.id, now(), before.id).run();
  await audit(c.env.DB, { userId: u.id, action: "po.notes", targetType: "parts_order", targetId: before.id, detail: { length: notes?.length ?? 0 }, ip: c.get("ip") });
  return c.json({ ok: true });
});

/**
 * Replace the lines. Lines keep their id when sent back with it. A line can't drop below what has
 * shipped or is on a shipment being packed, and a line on any shipment can't be removed.
 */
partsOrders.put("/:id/lines", async (c) => {
  const u = requirePerm(c, "psales.edit");
  const db = c.env.DB;
  const before = await load(db, c.req.param("id"));
  const b = await body(c);
  if (typeof b.revision !== "number" || b.revision !== before.revision) fail(409, stale);
  if (["lost", "closed", "cancelled"].includes(before.status)) fail(409, "Reopen it first to change its lines.");
  let lines: LineInput[];
  try {
    lines = cleanLines(b.lines);
  } catch (e) {
    bad(e);
  }
  if (before.status === "booked" && !lines.length) fail(400, "A booked order needs at least one line.");
  const had = await linesOf(db, before.id);
  const { results: onShipments } = await db.prepare("SELECT DISTINCT sl.po_line_id AS id FROM sh_out_lines sl JOIN po_lines l ON l.id = sl.po_line_id WHERE l.order_id = ?").bind(before.id).all<{ id: string }>();
  const used = new Set(onShipments.map((x) => x.id));
  const keep = new Set(lines.map((l) => l.id).filter(Boolean));
  for (const l of lines) {
    if (!l.id) continue;
    const old = had.find((h) => h.id === l.id);
    if (!old) fail(400, "One of the lines isn't on this order. Reload and try again.");
    if (l.qty < old.shipped + old.allocated) fail(400, `Line ${old.line_no}: ${old.shipped + old.allocated} are already shipped or being packed, so the quantity can't be less.`);
  }
  for (const h of had) if (!keep.has(h.id) && used.has(h.id)) fail(400, `Line ${h.line_no} is on a shipment, so it can't be removed.`);
  const t = now();
  const r = await db.prepare("UPDATE po_orders SET revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?").bind(u.id, t, before.id, before.revision).run();
  if (!r.meta.changes) fail(409, stale);
  await db.batch([
    ...had.filter((h) => !keep.has(h.id)).map((h) => db.prepare("DELETE FROM po_lines WHERE id = ?").bind(h.id)),
    ...lines.map((l, i) => l.id
      ? db.prepare("UPDATE po_lines SET line_no = ?, part_code = ?, description = ?, qty = ?, backorder = ? WHERE id = ?").bind(i + 1, l.part_code, l.description, l.qty, l.backorder ? 1 : 0, l.id)
      : db.prepare("INSERT INTO po_lines (id, order_id, line_no, part_code, description, qty, backorder, created_at) VALUES (?,?,?,?,?,?,?,?)").bind(randomId(), before.id, i + 1, l.part_code, l.description, l.qty, l.backorder ? 1 : 0, t)),
  ]);
  const show = (x: { part_code: string | null; description: string | null; qty: number; backorder: boolean | number }) => `${x.part_code ?? x.description} × ${x.qty}${x.backorder ? " (backorder)" : ""}`;
  await audit(db, { userId: u.id, action: "po.lines", targetType: "parts_order", targetId: before.id, detail: { before: had.map(show), after: lines.map(show) }, ip: c.get("ip") });
  return c.json({ ok: true, revision: before.revision + 1 });
});

/** Move it along: sent, booked (needs the customer's PO), lost or cancelled (need a reason), closed, reopened. */
partsOrders.post("/:id/status", async (c) => {
  const u = requirePerm(c, "psales.edit");
  const db = c.env.DB;
  const o = await load(db, c.req.param("id"));
  const b = await body(c);
  if (typeof b.revision !== "number" || b.revision !== o.revision) fail(409, stale);
  const to = isPoStatus(b.to) ? b.to : fail(400, "Pick what to change it to.");
  if (!canMove(o.status, to)) fail(409, `A ${o.status === "sent" ? "sent quote" : o.status === "booked" ? "booked order" : o.status} can't be changed to that.`);
  const reason = typeof b.reason === "string" ? b.reason.replace(/\s+/g, " ").trim().slice(0, PO_MAX.reason) || null : null;
  const lines = await linesOf(db, o.id);
  const t = now();
  const set: Record<string, unknown> = { status: to };
  if (to === "sent") set.sent_at = t;
  if (to === "booked" && o.status !== "closed") {
    let f;
    try {
      f = cleanPoFields({ customer_po: b.customer_po ?? o.customer_po, ...(b.promised_date !== undefined ? { promised_date: b.promised_date } : {}) });
    } catch (e) {
      bad(e);
    }
    if (!f.customer_po) fail(400, "Add the customer's PO to book the order.");
    if (!lines.length) fail(400, "Add at least one line before booking the order.");
    set.customer_po = f.customer_po;
    if ("promised_date" in f) set.promised_date = f.promised_date;
    set.order_number = o.order_number ?? (await nextNumber(db, "SO"));
    set.booked_at = o.booked_at ?? t;
    set.follow_up = null;
    set.reason = null;
  }
  if (to === "booked" && o.status === "closed") set.closed_at = null;
  if (to === "lost") {
    if (!reason) fail(400, "Say why it was lost.");
    Object.assign(set, { reason, lost_at: t });
  }
  if (to === "quote") Object.assign(set, { reason: null, lost_at: null });
  if (to === "closed") {
    if (!fullyShipped(lines)) fail(409, "Ship every line before closing the order, or cancel what's left.");
    set.closed_at = t;
  }
  if (to === "cancelled") {
    if (!reason) fail(400, "Say why it was cancelled.");
    if (lines.some((l) => l.shipped > 0 || l.allocated > 0)) fail(409, "Parts on this order have shipped or are being packed, so it can't be cancelled. Change its lines instead.");
    Object.assign(set, { reason, cancelled_at: t });
  }
  const keys = Object.keys(set);
  const r = await db.prepare(`UPDATE po_orders SET ${keys.map((k) => `${k} = ?, `).join("")}revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?`)
    .bind(...keys.map((k) => set[k] ?? null), u.id, t, o.id, o.revision).run();
  if (!r.meta.changes) fail(409, stale);
  await audit(db, { userId: u.id, action: "po.status", targetType: "parts_order", targetId: o.id, detail: { from: o.status, to, reason, customer_po: set.customer_po ?? undefined, order_number: set.order_number ?? undefined }, ip: c.get("ip") });
  return c.json({ ok: true, revision: o.revision + 1, order_number: set.order_number ?? o.order_number });
});

/** Revise a quote: the current lines are kept read-only as this revision, and the quote moves to the next letter. */
partsOrders.post("/:id/revise", async (c) => {
  const u = requirePerm(c, "psales.edit");
  const db = c.env.DB;
  const o = await load(db, c.req.param("id"));
  const b = await body(c);
  if (typeof b.revision !== "number" || b.revision !== o.revision) fail(409, stale);
  if (!isQuote(o.status)) fail(409, "Only a quote can be revised.");
  const lines = await linesOf(db, o.id);
  const t = now();
  const [r] = await db.batch([
    db.prepare("UPDATE po_orders SET quote_rev = quote_rev + 1, status = 'quote', revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?").bind(u.id, t, o.id, o.revision),
    db.prepare("INSERT INTO po_revisions (order_id, rev, lines, detail, saved_by, saved_at) SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT revision FROM po_orders WHERE id = ?) = ?")
      .bind(o.id, o.quote_rev, JSON.stringify(lines.map((l) => ({ part_code: l.part_code, description: l.description, qty: l.qty }))), JSON.stringify({ customer: o.customer, machine: o.machine, valid_until: o.valid_until, status: o.status }), u.id, t, o.id, o.revision + 1),
  ]);
  if (!r?.meta.changes) fail(409, stale);
  await audit(db, { userId: u.id, action: "po.revise", targetType: "parts_order", targetId: o.id, detail: { from: revLetter(o.quote_rev), to: revLetter(o.quote_rev + 1) }, ip: c.get("ip") });
  return c.json({ ok: true, revision: o.revision + 1, rev: revLetter(o.quote_rev + 1) });
});
