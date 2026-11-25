// Shipping and receiving (Aaron, 2026-11-25): everything going out of Ronchi America and everything
// coming in, in one list. The fields, steps and carrier list are in src/shared/shipping.ts.
//
// Out: make a shipment (often from a parts order, change-part order or job, which fills in the customer,
// address and packing list), pack it, mark it shipped with the tracking numbers, then delivered.
// In: make an expected receipt (parts from Italy, a supplier PO, a customer return, sample bottles),
// then check items in as they arrive, a bit at a time if needed, noting the shelf or bin and any damage.
//
// The rest of the portal hears about it: shipping a change-part order fills the order's ship date
// (and status), receiving a customer's samples fills "samples received", and the parts order, change-part
// order, job and machine pages list their shipments. Parts orders read these tables themselves.
//
// Who: shipping.view to look (all staff by default), shipping.edit to change. The whole section can be
// switched off in the admin controls (section "shipping").
import { Hono, type Context } from "hono";
import { isOpen } from "../../shared/change-parts";
import { randomId } from "../../shared/crypto";
import { cleanName, fileInfo, fileProblem, MAX_FILES_PER_MESSAGE, MAX_MESSAGE_BYTES } from "../../shared/files";
import {
  cleanPackages, DONE_STATUSES, firstStatus, FREIGHT_OPTIONS, isCarrier, isDirection, isKindFor, isMode, isProblem, isSource, isStatusFor,
  MAX_LINES, nextNumber, packageTotals, receiveStatus, SHIP_MAX, SHIP_TEXT_FIELDS, trackingLinks, type Direction, type Package, type Source,
} from "../../shared/shipping";
import type { AppEnv, SessionUser } from "../env";
import { syncPartsOrdersForShipment } from "./parts-orders";
import { audit, now } from "../lib/db";
import { body, fail, has, requirePerm } from "../lib/http";
import { isEmail } from "../lib/mail";
import { serveFile } from "../lib/serve-file";

export const shipping = new Hono<AppEnv>();

interface ShipmentRow {
  id: string; number: string; direction: Direction; kind: string; status: string; party: string; machine: string | null;
  carrier: string | null; tracking: string | null; packages: string; freight_options: string; source_type: string | null; source_id: string | null;
  shipped_date: string | null; done_date: string | null; revision: number; [k: string]: unknown;
}
interface LineRow { id: string; line_no: number; part_code: string | null; description: string; qty: number; qty_received: number; bin: string | null; hold: number; hold_note: string | null; source_type: string | null; source_id: string | null }

const LABELS: Record<string, string> = {
  party: "Customer or supplier", machine: "Machine", reference: "Reference", address: "Address", origin: "Ship from",
  contact_name: "Contact name", contact_phone: "Contact phone", contact_email: "Contact email", carrier_other: "Carrier name",
  service: "Service", tracking: "Tracking numbers", vessel: "Vessel or flight", container: "Container", broker: "Customs broker", bol_number: "Bill of lading number", freight_class: "Freight class",
  problem_note: "Problem note", notes: "Notes",
};
const MULTI_LINE = new Set(["address", "origin", "tracking", "problem_note", "notes"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = () => now().slice(0, 10);
const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");
const isDuplicate = (e: unknown) => /UNIQUE/i.test(String((e as Error)?.message ?? e));
/** Added to a line's change so it only applies if the shipment's own save went through (bind: id, revision + 1). */
const guard = "AND (SELECT revision FROM shipments WHERE id = ?) = ?";
const STALE = "Someone else changed this shipment while you were editing. Reload to see their changes.";

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}
const toShipment = (r: ShipmentRow) => ({ ...r, packages: parseJson<Package[]>(r.packages, []), freight_options: parseJson<string[]>(r.freight_options, []) });

/** Check and tidy the typed fields for a shipment going `direction`. Only fields present in `b` come back. */
function clean(b: Record<string, unknown>, direction: Direction) {
  const f: Record<string, string | number | null> = {};
  for (const k of SHIP_TEXT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) continue;
    const raw = b[k];
    if (raw !== null && raw !== undefined && typeof raw !== "string") fail(400, `${LABELS[k]} must be text.`);
    let v = (raw ?? "").replace(/\r\n/g, "\n").trim();
    if (!MULTI_LINE.has(k)) v = v.replace(/\s+/g, " ");
    if (v.length > SHIP_MAX[k]) fail(400, `${LABELS[k]} is too long (limit ${SHIP_MAX[k]} characters).`);
    if (k === "machine") v = v.toUpperCase();
    if (k === "contact_email" && v && !isEmail(v)) fail(400, "The contact email doesn't look right.");
    f[k] = v || null;
  }
  if ("party" in f && !f.party) fail(400, direction === "out" ? "Who is it going to? Customer is required." : "Who is it coming from? Supplier or sender is required.");
  if (b.kind !== undefined) {
    if (!isKindFor(direction, b.kind)) fail(400, "Pick what kind of shipment it is from the list.");
    f.kind = b.kind as string;
  }
  if (b.status !== undefined) {
    if (!isStatusFor(direction, b.status)) fail(400, "That step doesn't fit this shipment.");
    f.status = b.status;
  }
  if (b.carrier !== undefined) {
    if (b.carrier !== null && b.carrier !== "" && !isCarrier(b.carrier)) fail(400, "Pick the carrier from the list.");
    f.carrier = (b.carrier as string) || null;
  }
  for (const k of ["planned_date", "shipped_date", "done_date"] as const) {
    if (b[k] === undefined) continue;
    if (b[k] !== null && b[k] !== "" && (typeof b[k] !== "string" || !DAY.test(b[k] as string))) fail(400, "Use the date picker for dates.");
    f[k] = (b[k] as string) || null;
  }
  if (b.mode !== undefined) {
    if (b.mode !== null && b.mode !== "" && !isMode(b.mode)) fail(400, "Pick how it travels from the list.");
    f.mode = (b.mode as string) || null;
  }
  if (b.problem !== undefined) {
    if (b.problem !== null && b.problem !== "" && !isProblem(b.problem)) fail(400, "Pick the problem from the list.");
    f.problem = (b.problem as string) || null;
  }
  if (b.packages !== undefined) {
    try {
      f.packages = JSON.stringify(cleanPackages(b.packages));
    } catch (e) {
      fail(400, (e as Error).message);
    }
  }
  if (b.freight_options !== undefined) {
    if (!Array.isArray(b.freight_options) || b.freight_options.some((o) => !(FREIGHT_OPTIONS as readonly string[]).includes(o as string))) fail(400, "Pick freight extras from the list.");
    f.freight_options = JSON.stringify([...new Set(b.freight_options as string[])]);
  }
  return f;
}

/** The packing list (out) or what is expected (in). Existing lines keep what was already received. */
function cleanLines(value: unknown): { id: string | null; part_code: string | null; description: string; qty: number; source_type: string | null; source_id: string | null }[] {
  if (!Array.isArray(value)) fail(400, "The list of items must be a list.");
  if (value.length > MAX_LINES) fail(400, `Up to ${MAX_LINES} items in one shipment.`);
  return value.map((raw) => {
    const l = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
    const description = text(l.description, 300) || text(l.part_code, 80);
    if (!description) fail(400, "Each item needs a description or part number.");
    const qty = Number(l.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100_000) fail(400, "Each item's quantity must be a whole number from 1 up.");
    const st = l.source_type === "parts_order_line" && typeof l.source_id === "string" && l.source_id.length <= 64 ? l.source_id : null;
    return { id: typeof l.id === "string" ? l.id : null, part_code: text(l.part_code, 80) || null, description, qty, source_type: st ? "parts_order_line" : null, source_id: st };
  });
}

async function tableExists(db: D1Database, name: string) {
  return !!(await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").bind(name).first());
}

/** What a shipment can be for, read from that part of the portal, or null when it doesn't exist. */
async function loadSource(db: D1Database, type: Source, id: string): Promise<Record<string, any> | null> {
  if (type === "cp_order") return db.prepare("SELECT * FROM cp_orders WHERE id = ? AND removed_at IS NULL").bind(id).first();
  if (type === "job") return db.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first();
  if (!(await tableExists(db, "parts_orders"))) return null;
  const order = await db.prepare("SELECT * FROM parts_orders WHERE id = ?").bind(id).first<Record<string, any>>();
  if (!order || order.removed_at) return null;
  const lines = (await tableExists(db, "parts_order_lines"))
    ? (await db.prepare(
        `SELECT p.*, (SELECT COALESCE(SUM(l.qty), 0) FROM shipment_lines l JOIN shipments s ON s.id = l.shipment_id
                       WHERE l.source_type = 'parts_order_line' AND l.source_id = p.id AND s.direction = 'out' AND s.removed_at IS NULL AND s.status != 'cancelled') AS already
           FROM parts_order_lines p WHERE p.order_id = ? ORDER BY p.line_no`,
      ).bind(id).all<Record<string, any>>()).results
    : [];
  return { ...order, lines };
}

/**
 * Who may see the thing a shipment is for (each part of the portal keeps its own rules, and a section
 * switched off takes these away). Without it, a person sees that a shipment is for an order, not which one.
 */
const SOURCE_PERM: Record<Source, string> = { cp_order: "orders.view", job: "jobs.view", parts_order: "partsorders.view" };
const mayRead = (u: SessionUser, type: Source) => has(u, SOURCE_PERM[type] as never);

/** A short name for what a shipment is for: "Job J-1042", "Acme · 38 mm star wheels", "PO-2026-0001". */
function sourceLabel(type: Source, src: Record<string, any>): string {
  if (type === "job") return `Job ${src.job_number}`;
  if (type === "cp_order") return [src.customer, src.part].filter(Boolean).join(" · ");
  return String(src.number ?? "Parts order");
}

async function loadShipment(db: D1Database, id: string): Promise<ShipmentRow> {
  const s = await db.prepare("SELECT * FROM shipments WHERE id = ? AND removed_at IS NULL").bind(id).first<ShipmentRow>();
  if (!s) fail(404, "Not found.");
  return s;
}

/**
 * Tell the change-part order this shipment is for: shipping change parts fills its ship date and moves an
 * open order to Shipped; shipping or receiving samples fills the samples dates. Only empty fields are filled,
 * so nothing anyone typed is overwritten. Written to the order's history like any other change.
 */
async function tellChangePartOrder(c: Context<AppEnv>, s: ShipmentRow, u: SessionUser, event: "shipped" | "received") {
  if (s.source_type !== "cp_order" || !s.source_id) return;
  const db = c.env.DB;
  const o = await db.prepare("SELECT * FROM cp_orders WHERE id = ? AND removed_at IS NULL").bind(s.source_id).first<Record<string, any>>();
  if (!o || o.phase === "sale") return; // a sale not yet sold isn't an order to ship
  const set: Record<string, string> = {};
  if (s.kind === "samples") {
    const k = event === "shipped" ? "samples_shipped" : "samples_received";
    if (!o[k]) set[k] = today();
  } else if (event === "shipped" && s.direction === "out") {
    if (!o.ship_date) set.ship_date = today();
    if (isOpen(o.status)) set.status = "Shipped";
  }
  const keys = Object.keys(set);
  if (!keys.length) return;
  const r = await db.prepare(`UPDATE cp_orders SET ${keys.map((k) => `${k} = ?`).join(", ")}, revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?`)
    .bind(...keys.map((k) => set[k]), u.id, now(), o.id, o.revision).run();
  if (!r.meta.changes) return;
  await audit(db, { userId: u.id, action: "cp_order.update", targetType: "cp_order", targetId: o.id, detail: { changes: Object.fromEntries(keys.map((k) => [k, [o[k] ?? null, set[k]]])), by: `shipment ${s.number}` }, ip: c.get("ip") });
}

// ---- Lists ----

shipping.get("/", async (c) => {
  requirePerm(c, "shipping.view");
  const where = ["s.removed_at IS NULL"];
  const args: unknown[] = [];
  const direction = c.req.query("direction");
  if (isDirection(direction)) where.push("s.direction = ?"), args.push(direction);
  const view = c.req.query("view") ?? "all";
  const done = [...DONE_STATUSES];
  if (view === "open") where.push(`s.status NOT IN (${marks(done.length)})`), args.push(...done);
  if (view === "done") where.push(`s.status IN (${marks(done.length)})`), args.push(...done);
  if (view === "problems") where.push("s.problem IS NOT NULL");
  if (view === "hold") where.push("s.id IN (SELECT shipment_id FROM shipment_lines WHERE hold = 1)");
  const status = c.req.query("status");
  if (status) where.push("s.status = ?"), args.push(status);
  const machine = c.req.query("machine");
  if (machine) where.push("s.machine = ?"), args.push(machine.trim().toUpperCase());
  // What it's for: ?link=cp_order:<id> or ?source=cp_order&id=<id>
  const link = c.req.query("link")?.split(":") ?? [c.req.query("source"), c.req.query("id")];
  if (link[0] && link[1]) {
    if (!isSource(link[0])) fail(400, "Unknown link.");
    where.push("s.source_type = ? AND s.source_id = ?"), args.push(link[0], link[1]);
  }
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    const cols = ["s.number", "s.party", "s.machine", "s.reference", "s.tracking", "s.bol_number", "s.address"];
    where.push(`(${cols.map((col) => `${col} LIKE ? ESCAPE '\\'`).join(" OR ")} OR s.id IN (SELECT shipment_id FROM shipment_lines WHERE part_code LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'))`);
    args.push(...cols.map(() => like), like, like);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.number, s.direction, s.kind, s.status, s.party, s.machine, s.reference, s.carrier, s.carrier_other, s.tracking,
            s.packages, s.planned_date, s.shipped_date, s.done_date, s.problem, s.source_type, s.source_id, s.updated_at,
            (SELECT COUNT(*) FROM shipment_lines l WHERE l.shipment_id = s.id) AS lines,
            (SELECT COUNT(*) FROM shipment_files f WHERE f.shipment_id = s.id AND f.deleted_at IS NULL) AS files,
            m.id AS machine_id
       FROM shipments s LEFT JOIN machines m ON m.serial = s.machine
      WHERE ${where.join(" AND ")}
      ORDER BY CASE WHEN s.status IN (${marks(done.length)}) THEN 1 ELSE 0 END, COALESCE(s.planned_date, '9999') ASC, s.updated_at DESC LIMIT 2000`,
  ).bind(...args, ...done).all<ShipmentRow & { lines: number; files: number }>();
  // How much is waiting at each step (open work only, both directions), for the counters at the top.
  // One small query over open shipments only (finished ones are never counted), using the status index.
  const { results: counted } = await c.env.DB.prepare(
    `SELECT status, COUNT(*) AS n, SUM(problem IS NOT NULL) AS problems,
            SUM(EXISTS (SELECT 1 FROM shipment_lines l WHERE l.shipment_id = shipments.id AND l.hold = 1)) AS held
       FROM shipments WHERE status NOT IN ('delivered','cancelled') AND removed_at IS NULL GROUP BY status`,
  ).all<{ status: string; n: number; problems: number; held: number }>();
  const problems = { n: counted.reduce((a, r) => a + (r.problems ?? 0), 0) };
  const held = { n: counted.reduce((a, r) => a + (r.held ?? 0), 0) };
  const counts: Record<string, number> = { to_pack: 0, packed: 0, shipped: 0, expected: 0, arrived: 0, partly_received: 0, on_hold: 0, problems: problems?.n ?? 0, hold: held?.n ?? 0 };
  for (const r of counted) if (r.status in counts) counts[r.status] = r.n;
  return c.json({
    shipments: results.map((s) => {
      const { packages, ...rest } = s;
      return { ...rest, pieces: packageTotals(parseJson<Package[]>(packages, [])).pieces, trackingLinks: trackingLinks(s.carrier, s.tracking) };
    }),
    counts,
  });
});

/**
 * What a new shipment starts with: the ship-from address of the last outgoing one, and, when it's for a
 * parts order, change-part order or job (?source=job&id=...), that customer, machine, address and items.
 */
shipping.get("/prefill", async (c) => {
  const u = requirePerm(c, "shipping.edit");
  const db = c.env.DB;
  const last = await db.prepare("SELECT origin FROM shipments WHERE direction = 'out' AND origin IS NOT NULL AND removed_at IS NULL ORDER BY created_at DESC LIMIT 1").first<{ origin: string }>();
  const out: Record<string, unknown> = { origin: last?.origin ?? null };
  const type = c.req.query("source");
  const id = c.req.query("id");
  if (!type || !id) return c.json(out);
  if (!isSource(type)) fail(400, "Unknown link.");
  if (!mayRead(u, type)) fail(403, "Your role doesn't allow this.");
  const src = await loadSource(db, type, id);
  if (!src) fail(404, "Not found.");
  out.source_type = type;
  out.source_id = id;
  out.direction = "out";
  if (type === "cp_order") {
    Object.assign(out, { kind: "change_parts", party: src.customer, machine: src.machine, reference: src.customer_po ?? src.ra_po ?? null, label: sourceLabel(type, src) });
    if (src.part) out.lines = [{ part_code: null, description: String(src.part).slice(0, 300), qty: 1 }];
  } else if (type === "job") {
    Object.assign(out, { kind: "spare_parts", party: src.customer, machine: src.machine, address: src.location, contact_name: src.contact_name, contact_phone: src.contact_phone, contact_email: src.contact_email, reference: src.job_number, label: sourceLabel(type, src) });
  } else {
    Object.assign(out, {
      kind: "spare_parts", party: src.customer, machine: src.machine ?? null, address: src.ship_to ?? null, reference: src.customer_po ?? src.number ?? null, label: sourceLabel(type, src),
      // Only what is still to ship: each line's quantity less what is already on other shipments.
      lines: (src.lines as Record<string, any>[])
        .map((l) => ({ part_code: l.part_code ?? null, description: String(l.description ?? l.part_code ?? "Part").slice(0, 300), qty: Number(l.qty) - Number(l.already ?? 0), source_type: "parts_order_line", source_id: l.id }))
        .filter((l) => l.qty > 0),
    });
  }
  return c.json(out);
});

// ---- Files ----

shipping.get("/files/:fileId", async (c) => {
  requirePerm(c, "shipping.view");
  const f = await c.env.DB.prepare(
    "SELECT f.id, f.name FROM shipment_files f JOIN shipments s ON s.id = f.shipment_id WHERE f.id = ? AND f.deleted_at IS NULL AND s.removed_at IS NULL",
  ).bind(c.req.param("fileId")).first<{ id: string; name: string }>();
  if (!f) fail(404, "Not found.");
  return serveFile(c.env.FILES, `shipping/${f.id}`, f.name, { download: c.req.query("download") !== undefined });
});

shipping.delete("/files/:fileId", async (c) => {
  const u = requirePerm(c, "shipping.view");
  const f = await c.env.DB.prepare("SELECT id, shipment_id, user_id, name FROM shipment_files WHERE id = ? AND deleted_at IS NULL").bind(c.req.param("fileId")).first<{ id: string; shipment_id: string; user_id: string; name: string }>();
  if (!f) fail(404, "Not found.");
  if (f.user_id !== u.id && !has(u, "shipping.edit")) fail(403, "Only the person who added a file, or shipping, can remove it.");
  await c.env.DB.prepare("UPDATE shipment_files SET deleted_at = ? WHERE id = ?").bind(now(), f.id).run();
  await c.env.FILES.delete(`shipping/${f.id}`).catch(() => undefined);
  await audit(c.env.DB, { userId: u.id, action: "shipment.file.remove", targetType: "shipment", targetId: f.shipment_id, detail: { name: f.name }, ip: c.get("ip") });
  return c.json({ ok: true });
});

/** Anyone who can see shipments can add photos and papers (proof of delivery, damage photos). */
shipping.post("/:id/files", async (c) => {
  const u = requirePerm(c, "shipping.view");
  if (!has(u, "files.send")) fail(403, "You can't add photos or files. Ask an admin.");
  const s = await loadShipment(c.env.DB, c.req.param("id"));
  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    fail(400, "The upload didn't come through. Try again.");
  }
  const files = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  if (!files.length) fail(400, "Choose a file to add.");
  if (files.length > MAX_FILES_PER_MESSAGE) fail(400, `Add up to ${MAX_FILES_PER_MESSAGE} files at a time.`);
  if (files.reduce((n, f) => n + f.size, 0) > MAX_MESSAGE_BYTES) fail(400, "Those files are too big to add together. Add them in two goes.");
  for (const f of files) {
    const problem = fileProblem(f.name, f.size);
    if (problem) fail(400, `${cleanName(f.name)}: ${problem}`);
  }
  const stored = files.map((f) => ({ id: randomId(), file: f, name: cleanName(f.name), info: fileInfo(f.name)! }));
  try {
    for (const x of stored) await c.env.FILES.put(`shipping/${x.id}`, x.file.stream(), { httpMetadata: { contentType: x.info.type }, customMetadata: { shipment: s.id, by: u.id } });
  } catch (e) {
    await Promise.all(stored.map((x) => c.env.FILES.delete(`shipping/${x.id}`).catch(() => undefined)));
    throw e;
  }
  const at = now();
  const add = c.env.DB.prepare("INSERT INTO shipment_files (id, shipment_id, user_id, name, ext, size, created_at) VALUES (?,?,?,?,?,?,?)");
  await c.env.DB.batch(stored.map((x) => add.bind(x.id, s.id, u.id, x.name, x.info.ext, x.file.size, at)));
  await audit(c.env.DB, { userId: u.id, action: "shipment.file.add", targetType: "shipment", targetId: s.id, detail: { names: stored.map((x) => x.name) }, ip: c.get("ip") });
  return c.json({ ids: stored.map((x) => x.id) });
});

// ---- One shipment ----

shipping.get("/:id", async (c) => {
  const u = requirePerm(c, "shipping.view");
  const db = c.env.DB;
  const s = await loadShipment(db, c.req.param("id"));
  const [lines, files, hist, machine] = await Promise.all([
    db.prepare("SELECT * FROM shipment_lines WHERE shipment_id = ? ORDER BY line_no").bind(s.id).all<LineRow>(),
    db.prepare("SELECT f.id, f.name, f.ext, f.size, f.created_at, f.user_id, u.name AS by_name FROM shipment_files f LEFT JOIN users u ON u.id = f.user_id WHERE f.shipment_id = ? AND f.deleted_at IS NULL ORDER BY f.created_at DESC").bind(s.id).all(),
    db.prepare("SELECT a.at, a.action, a.detail, u.name AS who FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.target_type = 'shipment' AND a.target_id = ? ORDER BY a.at DESC LIMIT 200").bind(s.id).all<{ at: string; action: string; detail: string | null; who: string | null }>(),
    s.machine && has(u, "machines.view") ? db.prepare("SELECT id, serial, model FROM machines WHERE serial = ?").bind(s.machine).first() : Promise.resolve(null),
  ]);
  // What it's for, with a link only for people allowed to open that page.
  let source: Record<string, unknown> | null = null;
  if (s.source_type && s.source_id && isSource(s.source_type)) {
    const allowed = mayRead(u, s.source_type);
    const src = allowed ? await loadSource(db, s.source_type, s.source_id) : null;
    source = { type: s.source_type, id: s.source_id, label: src ? sourceLabel(s.source_type, src) : null, open: !!src };
  }
  const shipment = toShipment(s);
  return c.json({
    shipment,
    lines: lines.results,
    files: files.results,
    totals: packageTotals(shipment.packages),
    tracking: trackingLinks(s.carrier, s.tracking),
    machine,
    source,
    history: hist.results.map((h) => ({ at: h.at, action: h.action, who: h.who, detail: parseJson<Record<string, unknown> | null>(h.detail, null) })),
  });
});

shipping.post("/", async (c) => {
  const u = requirePerm(c, "shipping.edit");
  const db = c.env.DB;
  const b = await body(c);
  if (!isDirection(b.direction)) fail(400, "Say whether it's going out or coming in.");
  const direction = b.direction;
  const f = clean({ kind: direction === "out" ? "spare_parts" : "supplier", ...b }, direction);
  if (!f.party) clean({ party: "" }, direction); // says which one is missing
  f.status ??= firstStatus(direction);
  if ((f.status === "shipped" || f.status === "delivered") && direction === "out" && !f.shipped_date) f.shipped_date = today();
  if (f.status === "delivered" && !f.done_date) f.done_date = today();
  const lines = b.lines === undefined ? [] : cleanLines(b.lines);
  if (b.source_type !== undefined && b.source_type !== null && b.source_type !== "") {
    if (!isSource(b.source_type) || typeof b.source_id !== "string" || !(await loadSource(db, b.source_type, b.source_id))) fail(400, "The order or job this is for wasn't found.");
    f.source_type = b.source_type;
    f.source_id = b.source_id;
  }
  const id = randomId();
  const t = now();
  const year = Number(t.slice(0, 4));
  const addLine = db.prepare("INSERT INTO shipment_lines (id, shipment_id, line_no, part_code, description, qty, source_type, source_id) VALUES (?,?,?,?,?,?,?,?)");
  let number = "";
  // Two people saving at the same moment could pick the same number; the second simply takes the next one.
  for (let attempt = 0; attempt < 5; attempt++) {
    const prefix = `${direction === "out" ? "SH" : "RC"}-${year}-`;
    // A range on the number (not LIKE) so the unique index is used instead of reading every row.
    const top = await db.prepare("SELECT number FROM shipments WHERE number >= ? AND number < ? ORDER BY length(number) DESC, number DESC LIMIT 1").bind(prefix, prefix + "~").first<{ number: string }>();
    number = nextNumber(direction, year, top?.number ?? null);
    const cols = ["direction", ...Object.keys(f)];
    try {
      await db.batch([
        db.prepare(`INSERT INTO shipments (id, number, ${cols.join(", ")}, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ${marks(cols.length)}, ?, ?, ?, ?)`)
          .bind(id, number, direction, ...Object.values(f), u.id, u.id, t, t),
        ...lines.map((l, i) => addLine.bind(randomId(), id, i + 1, l.part_code, l.description, l.qty, l.source_type, l.source_id)),
      ]);
      break;
    } catch (e) {
      if (!isDuplicate(e) || attempt === 4) throw e;
    }
  }
  await audit(db, { userId: u.id, action: "shipment.create", targetType: "shipment", targetId: id, detail: { number, direction, ...f, lines: lines.length }, ip: c.get("ip") });
  if (direction === "out" && (f.status === "shipped" || f.status === "delivered")) await tellChangePartOrder(c, await loadShipment(db, id), u, "shipped");
  await syncPartsOrdersForShipment(db, id, u.id, c.get("ip"));
  return c.json({ id, number });
});

shipping.patch("/:id", async (c) => {
  const u = requirePerm(c, "shipping.edit");
  const db = c.env.DB;
  const id = c.req.param("id");
  const b = await body(c);
  const before = await loadShipment(db, id);
  if (typeof b.revision !== "number" || b.revision !== before.revision) fail(409, STALE);
  const f = clean(b, before.direction);
  if (b.source_type !== undefined) {
    if (b.source_type === null || b.source_type === "") f.source_type = f.source_id = null;
    else if (!isSource(b.source_type) || typeof b.source_id !== "string" || !(await loadSource(db, b.source_type, b.source_id))) fail(400, "The order or job this is for wasn't found.");
    else (f.source_type = b.source_type), (f.source_id = b.source_id);
  }
  if (f.status === "received" && f.status !== before.status) {
    const left = await db.prepare("SELECT COUNT(*) AS n FROM shipment_lines WHERE shipment_id = ? AND qty_received < qty").bind(id).first<{ n: number }>();
    if (left?.n) fail(400, "Some items haven't been checked in yet. Check them in, or note what's missing as a problem.");
  }
  // Stamp the dates when a step is reached, unless someone typed them.
  if (f.status && f.status !== before.status) {
    if (before.direction === "out" && (f.status === "shipped" || f.status === "delivered") && !before.shipped_date && !f.shipped_date) f.shipped_date = today();
    if (before.direction === "out" && f.status === "delivered" && !before.done_date && !f.done_date) f.done_date = today();
    if (before.direction === "in" && f.status === "arrived" && !before.shipped_date && !f.shipped_date) f.shipped_date = today();
    if (before.direction === "in" && f.status === "received" && !before.done_date && !f.done_date) f.done_date = today();
  }
  const diff: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(f)) if ((before[k] ?? null) !== f[k]) diff[k] = [before[k] ?? null, f[k]];

  // The items, when sent: lines kept by id keep what was received; the rest are new. Nothing received can be dropped.
  const stmts: D1PreparedStatement[] = [];
  if (b.lines !== undefined) {
    const lines = cleanLines(b.lines);
    const { results: had } = await db.prepare("SELECT * FROM shipment_lines WHERE shipment_id = ?").bind(id).all<LineRow>();
    const keep = new Set(lines.map((l) => l.id).filter(Boolean));
    const dropped = had.filter((h) => !keep.has(h.id));
    if (dropped.some((h) => h.qty_received > 0)) fail(400, "An item that has already been checked in can't be taken off the list.");
    for (const h of dropped) stmts.push(db.prepare(`DELETE FROM shipment_lines WHERE id = ? ${guard}`).bind(h.id, id, before.revision + 1));
    lines.forEach((l, i) => {
      const old = l.id ? had.find((h) => h.id === l.id) : undefined;
      if (old) stmts.push(db.prepare(`UPDATE shipment_lines SET line_no = ?, part_code = ?, description = ?, qty = ? WHERE id = ? ${guard}`).bind(i + 1, l.part_code, l.description, l.qty, old.id, id, before.revision + 1));
      else stmts.push(db.prepare(`INSERT INTO shipment_lines (id, shipment_id, line_no, part_code, description, qty, source_type, source_id) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT revision FROM shipments WHERE id = ?) = ?`).bind(randomId(), id, i + 1, l.part_code, l.description, l.qty, l.source_type, l.source_id, id, before.revision + 1));
    });
    const itemText = (x: { id?: string | null; part_code: string | null; description: string; qty: number }) => `${x.id ?? "new"} ${x.part_code ?? ""} ${x.description} x${x.qty}`;
    const listBefore = [...had].sort((a, b) => a.line_no - b.line_no).map(itemText).join("; ");
    if (listBefore !== lines.map(itemText).join("; ")) diff.items = [had.length, lines.length];
  }
  if (!Object.keys(diff).length) return c.json({ ok: true, revision: before.revision });
  const keys = Object.keys(f).filter((k) => k in diff);
  const [r] = await db.batch([
    db.prepare(`UPDATE shipments SET ${keys.map((k) => `${k} = ?, `).join("")}revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?`)
      .bind(...keys.map((k) => f[k]), u.id, now(), id, before.revision),
    ...stmts,
  ]);
  if (!r?.meta.changes) fail(409, STALE);
  await audit(db, { userId: u.id, action: "shipment.update", targetType: "shipment", targetId: id, detail: { changes: diff }, ip: c.get("ip") });
  const after = await loadShipment(db, id);
  if (diff.status && after.direction === "out" && (after.status === "shipped" || after.status === "delivered")) await tellChangePartOrder(c, after, u, "shipped");
  if (diff.status && after.direction === "in" && after.status === "received") await tellChangePartOrder(c, after, u, "received");
  await syncPartsOrdersForShipment(db, id, u.id, c.get("ip"));
  return c.json({ ok: true, revision: after.revision });
});

/**
 * Check items in (incoming only): how many of each line came in this time, where they were put, and any
 * problem. Partial receipts add up; the status follows (arrived, partly received, received).
 * More than expected is refused unless the problem is noted as "over".
 */
shipping.post("/:id/receive", async (c) => {
  const u = requirePerm(c, "shipping.edit");
  const db = c.env.DB;
  const id = c.req.param("id");
  const b = await body(c);
  const s = await loadShipment(db, id);
  if (s.direction !== "in") fail(400, "Only incoming shipments are checked in.");
  if (s.status === "cancelled") fail(400, "This delivery was cancelled. Change its status first if it came after all.");
  if (typeof b.revision !== "number" || b.revision !== s.revision) fail(409, STALE);
  if (!Array.isArray(b.lines)) fail(400, "Say how many of each item came in.");
  if (b.problem !== undefined && b.problem !== null && b.problem !== "" && !isProblem(b.problem)) fail(400, "Pick the problem from the list.");
  const problem = (b.problem as string) || null;
  const note = typeof b.problem_note === "string" ? b.problem_note.trim().slice(0, SHIP_MAX.problem_note) || null : null;
  const { results: lines } = await db.prepare("SELECT * FROM shipment_lines WHERE shipment_id = ? ORDER BY line_no").bind(id).all<LineRow>();
  const byId = new Map(lines.map((l) => [l.id, l]));
  const got: { id: string; qty: number; bin: string | null; hold: number | null; hold_note: string | null }[] = [];
  for (const raw of b.lines as unknown[]) {
    const x = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const line = typeof x.id === "string" ? byId.get(x.id) : undefined;
    if (!line) fail(400, "One of the items isn't on this shipment. Reload and try again.");
    const qty = Number(x.qty ?? 0);
    if (!Number.isInteger(qty) || qty < 0 || qty > 100_000) fail(400, "Quantities must be whole numbers.");
    if (line.qty_received + qty > line.qty && problem !== "over") fail(400, `More ${line.part_code ?? line.description} than expected (${line.qty}). Note it as "Extra" if that's right.`);
    const bin = typeof x.bin === "string" ? x.bin.replace(/\s+/g, " ").trim().slice(0, 80) || null : null;
    const hold = x.hold === true ? 1 : x.hold === false ? 0 : null;
    const hold_note = typeof x.hold_note === "string" ? x.hold_note.trim().slice(0, 500) || null : null;
    got.push({ id: line.id, qty, bin, hold, hold_note });
    line.qty_received += qty;
    if (bin) line.bin = bin;
  }
  const status = receiveStatus(lines);
  const set: Record<string, string | null> = { status };
  if (!s.shipped_date) set.shipped_date = today();
  if (status === "received" && !s.done_date) set.done_date = today();
  if (problem) set.problem = problem;
  if (note) set.problem_note = note;
  const keys = Object.keys(set);
  const [r] = await db.batch([
    db.prepare(`UPDATE shipments SET ${keys.map((k) => `${k} = ?, `).join("")}revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?`)
      .bind(...keys.map((k) => set[k]), u.id, now(), id, s.revision),
    ...got.map((g) => db.prepare(`UPDATE shipment_lines SET qty_received = qty_received + ?, bin = COALESCE(?, bin), hold = COALESCE(?, hold), hold_note = CASE WHEN ? IS NULL THEN hold_note WHEN ? = 1 THEN COALESCE(?, hold_note) ELSE NULL END WHERE id = ? ${guard}`)
      .bind(g.qty, g.bin, g.hold, g.hold, g.hold, g.hold_note, g.id, id, s.revision + 1)),
  ]);
  if (!r?.meta.changes) fail(409, STALE);
  await audit(db, { userId: u.id, action: "shipment.receive", targetType: "shipment", targetId: id, detail: { received: got.filter((g) => g.qty || g.bin || g.hold !== null).map((g) => ({ item: byId.get(g.id)!.part_code ?? byId.get(g.id)!.description, qty: g.qty, bin: g.bin, hold: g.hold, hold_note: g.hold_note })), status, problem, note }, ip: c.get("ip") });
  const after = await loadShipment(db, id);
  if (status === "received" || s.kind === "samples") await tellChangePartOrder(c, after, u, "received");
  await syncPartsOrdersForShipment(db, id, u.id, c.get("ip"));
  return c.json({ ok: true, revision: after.revision, status });
});

/** Put one received item on quality hold (not to be used or shipped), or clear the hold. */
shipping.post("/:id/lines/:lineId/hold", async (c) => {
  const u = requirePerm(c, "shipping.edit");
  const db = c.env.DB;
  const s = await loadShipment(db, c.req.param("id"));
  const b = await body(c);
  if (s.direction !== "in") fail(400, "Only items that came in can go on quality hold.");
  if (typeof b.revision !== "number" || b.revision !== s.revision) fail(409, STALE);
  if (typeof b.hold !== "boolean") fail(400, "Say hold or clear.");
  const note = b.hold && typeof b.note === "string" ? b.note.trim().slice(0, 500) || null : null;
  const line = await db.prepare("SELECT * FROM shipment_lines WHERE id = ? AND shipment_id = ?").bind(c.req.param("lineId"), s.id).first<LineRow>();
  if (!line) fail(404, "Not found.");
  const [r] = await db.batch([
    db.prepare("UPDATE shipments SET revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?").bind(u.id, now(), s.id, s.revision),
    db.prepare("UPDATE shipment_lines SET hold = ?, hold_note = ? WHERE id = ? AND (SELECT revision FROM shipments WHERE id = ?) = ?").bind(b.hold ? 1 : 0, note, line.id, s.id, s.revision + 1),
  ]);
  if (!r?.meta.changes) fail(409, STALE);
  await audit(db, { userId: u.id, action: b.hold ? "shipment.hold" : "shipment.hold_clear", targetType: "shipment", targetId: s.id, detail: { item: line.part_code ?? line.description, note }, ip: c.get("ip") });
  return c.json({ ok: true, revision: s.revision + 1 });
});

shipping.delete("/:id", async (c) => {
  const u = requirePerm(c, "shipping.edit");
  const s = await loadShipment(c.env.DB, c.req.param("id"));
  const r = await c.env.DB.prepare("UPDATE shipments SET removed_at = ?, updated_by = ? WHERE id = ? AND removed_at IS NULL").bind(now(), u.id, s.id).run();
  if (!r.meta.changes) fail(404, "Not found.");
  await audit(c.env.DB, { userId: u.id, action: "shipment.remove", targetType: "shipment", targetId: s.id, detail: { number: s.number }, ip: c.get("ip") });
  return c.json({ ok: true });
});
