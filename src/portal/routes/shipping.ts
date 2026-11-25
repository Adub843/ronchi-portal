// Shipping and receiving.
//  - Incoming: shipments expected from Ronchi Italy and other suppliers, their lines, customs, and
//    receiving in as many goes as it takes (partial receipts), with problems (short, damaged...) and photos.
//  - Outgoing: a shipment made from a parts order, a change-part order or anything else. It takes some
//    or all of what is left to ship; the rest stays on the order as backordered. Marking it shipped is
//    what moves the parts order's shipped quantities and status (routes/parts-orders.ts adds them up).
//  - Carriers: tracking links built from a template staff can fix here, never a paid carrier service.
//
// Who: ship.view sees, ship.edit receives, packs and ships (lib/roles.ts). Every change goes in the audit log.
// HARD RULE: no money (no freight charges, duty or values). Counts, quantities, weights and dates only.
import { Hono, type Context } from "hono";
import { randomId } from "../../shared/crypto";
import { toCsv } from "../../shared/csv";
import { isDay, MAX_QTY, toAllocate } from "../../shared/parts-orders";
import {
  CUSTOMS, IN_CSV_HEADER, IN_MODES, IN_STAGES, inShown, ISSUE_KINDS, isOutStatus, MAX_SH_LINES, OUT_CSV_HEADER, OUT_LABELS, OUT_MOVES, SH_MAX,
  shipKpis, templateProblem, TRACKING, trackingHint, trackingUrl, type Customs, type InStage, type OutStatus,
} from "../../shared/shipping";
import type { AppEnv } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, has, requirePerm } from "../lib/http";
import { serveFile } from "../lib/serve-file";
import { historyOf, nextNumber, storeUploads } from "../lib/uploads";

export const shipping = new Hono<AppEnv>();

const today = () => new Date().toISOString().slice(0, 10);
const staleIn = "Someone else changed this shipment while you were working on it. Reload to see their changes.";

// ---------- small checks ----------

/** A trimmed one-line text field, or null. Throws a 400 when too long. */
function text(v: unknown, max: number, what: string, multiline = false): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") fail(400, `${what} must be text.`);
  // eslint-disable-next-line no-control-regex
  let s = multiline ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") : v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ");
  s = s.trim();
  if (s.length > max) fail(400, `${what} is too long (limit ${max} characters).`);
  return s || null;
}
function day(v: unknown, what: string): string | null {
  const s = text(v, 10, what);
  if (s && !isDay(s)) fail(400, `${what} must be a date.`);
  return s;
}
function whole(v: unknown, what: string, min: number, max: number): number {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) fail(400, `${what} must be a whole number from ${min} to ${max}.`);
  return n;
}
function tracking(v: unknown, what = "The tracking number"): string | null {
  const s = text(v, SH_MAX.tracking, what);
  if (s && !TRACKING.test(s)) fail(400, `${what} can have letters, digits, spaces, dots, slashes and dashes only.`);
  return s;
}
async function carrier(db: D1Database, id: unknown) {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id !== "string") fail(400, "Pick a carrier from the list.");
  const c = await db.prepare("SELECT id, name, mode, url_template FROM carriers WHERE id = ?").bind(id).first<{ id: string; name: string; mode: string; url_template: string | null }>();
  if (!c) fail(400, "Pick a carrier from the list.");
  return c;
}
const pick = <T extends readonly string[]>(list: T, v: unknown, what: string): T[number] => ((list as readonly unknown[]).includes(v) ? (v as T[number]) : fail(400, `Unknown ${what}.`));
function diffOf(before: Record<string, unknown>, after: Record<string, unknown>) {
  const diff: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(after)) if ((before[k] ?? null) !== (after[k] ?? null)) diff[k] = [before[k] ?? null, after[k] ?? null];
  return diff;
}

// ---------- reading ----------

interface InLine { id: string; inbound_id: string; line_no: number; part_code: string | null; description: string | null; qty_expected: number; bin: string | null; qty_good: number; qty_damaged: number; qty_received: number }

async function inLines(db: D1Database, inboundId?: string): Promise<InLine[]> {
  const { results } = await db.prepare(
    `SELECT l.*, COALESCE(SUM(r.qty), 0) AS qty_good, COALESCE(SUM(r.damaged), 0) AS qty_damaged, COALESCE(SUM(r.qty + r.damaged), 0) AS qty_received
       FROM sh_in_lines l LEFT JOIN sh_receipts r ON r.line_id = l.id ${inboundId ? "WHERE l.inbound_id = ?" : ""}
      GROUP BY l.id ORDER BY l.inbound_id, l.line_no`,
  ).bind(...(inboundId ? [inboundId] : [])).all<InLine>();
  return results;
}

const IN_COLS = `i.id, i.number, i.supplier, i.reference, i.mode, i.carrier_id, c.name AS carrier, c.url_template, i.tracking, i.expected_date, i.stage, i.customs_status, i.broker, i.received_at, i.updated_at,
  (SELECT COUNT(*) FROM sh_issues s WHERE s.inbound_id = i.id AND s.status = 'open') AS open_issues`;
type InRow = { id: string; number: string; supplier: string; reference: string | null; mode: string; carrier_id: string | null; carrier: string | null; url_template: string | null; tracking: string | null; expected_date: string | null; stage: InStage; customs_status: Customs; broker: string | null; received_at: string | null; updated_at: string; open_issues: number };

function inSummary(i: InRow, lines: InLine[]) {
  const { url_template, ...rest } = i;
  return {
    ...rest,
    shown: inShown(i.stage, lines),
    tracking_url: trackingUrl(url_template, i.tracking),
    lines: lines.length,
    qty_expected: lines.reduce((n, l) => n + l.qty_expected, 0),
    qty_received: lines.reduce((n, l) => n + l.qty_received, 0),
  };
}

const OUT_COLS = `s.id, s.number, s.source, s.po_order_id, s.cp_order_id, s.customer, s.carrier_id, c.name AS carrier, c.mode AS carrier_mode, c.url_template, s.service, s.tracking,
  s.boxes, s.weight_lb, s.ship_date, s.status, s.delivered_at, s.updated_at, o.order_number, o.quote_number, o.customer_po AS order_po,
  (SELECT COUNT(*) FROM sh_out_lines l WHERE l.outbound_id = s.id) AS lines, (SELECT COALESCE(SUM(qty), 0) FROM sh_out_lines l WHERE l.outbound_id = s.id) AS qty`;
const OUT_FROM = "FROM sh_outbound s LEFT JOIN carriers c ON c.id = s.carrier_id LEFT JOIN po_orders o ON o.id = s.po_order_id";
type OutRow = { id: string; number: string; source: string; po_order_id: string | null; cp_order_id: string | null; customer: string; carrier_id: string | null; carrier: string | null; carrier_mode: string | null; url_template: string | null; service: string | null; tracking: string | null; boxes: number | null; weight_lb: number | null; ship_date: string | null; status: OutStatus; delivered_at: string | null; updated_at: string; order_number: string | null; quote_number: string | null; order_po: string | null; lines: number; qty: number };
const outSummary = ({ url_template, ...s }: OutRow) => ({ ...s, tracking_url: trackingUrl(url_template, s.tracking) });

/** The dashboard: every incoming and outgoing shipment, with the tiles' numbers. */
shipping.get("/", async (c) => {
  requirePerm(c, "ship.view");
  const db = c.env.DB;
  const [{ results: ins }, lines, { results: outs }] = await Promise.all([
    db.prepare(`SELECT ${IN_COLS} FROM sh_inbound i LEFT JOIN carriers c ON c.id = i.carrier_id ORDER BY i.expected_date IS NULL, i.expected_date DESC LIMIT 3000`).all<InRow>(),
    inLines(db),
    db.prepare(`SELECT ${OUT_COLS} ${OUT_FROM} ORDER BY s.updated_at DESC LIMIT 3000`).all<OutRow>(),
  ]);
  const by = new Map<string, InLine[]>();
  for (const l of lines) by.set(l.inbound_id, [...(by.get(l.inbound_id) ?? []), l]);
  const inbound = ins.map((i) => inSummary(i, by.get(i.id) ?? []));
  const outbound = outs.map(outSummary);
  return c.json({ inbound, outbound, kpis: shipKpis(inbound, outbound, today()) });
});

shipping.get("/carriers", async (c) => {
  requirePerm(c, "ship.view");
  const { results } = await c.env.DB.prepare("SELECT c.id, c.name, c.mode, c.url_template, c.checked, c.active, c.sort, c.updated_at, u.name AS updated_by FROM carriers c LEFT JOIN users u ON u.id = c.updated_by ORDER BY c.sort, c.name").all();
  return c.json({ carriers: results });
});

/** Fix or check a carrier's tracking link, rename it, or hide it from the lists. */
shipping.patch("/carriers/:id", async (c) => {
  const u = requirePerm(c, "ship.edit");
  const db = c.env.DB;
  const before = await db.prepare("SELECT * FROM carriers WHERE id = ?").bind(c.req.param("id")).first<Record<string, unknown>>();
  if (!before) fail(404, "Not found.");
  const b = await body(c);
  const set: Record<string, unknown> = {};
  if (b.name !== undefined) set.name = text(b.name, 60, "The carrier name") ?? fail(400, "The carrier name is required.");
  if (b.url_template !== undefined) {
    const tpl = text(b.url_template, 500, "The tracking link");
    if (tpl) { const p = templateProblem(tpl); if (p) fail(400, p); }
    set.url_template = tpl;
    if (tpl !== before.url_template && b.checked === undefined) set.checked = 0; // a new link needs checking again
  }
  if (b.checked !== undefined) set.checked = b.checked === true ? 1 : 0;
  if (b.active !== undefined) set.active = b.active === true ? 1 : 0;
  const diff = diffOf(before, set);
  if (!Object.keys(diff).length) return c.json({ ok: true });
  const keys = Object.keys(diff);
  await db.prepare(`UPDATE carriers SET ${keys.map((k) => `${k} = ?, `).join("")}updated_by = ?, updated_at = ? WHERE id = ?`).bind(...keys.map((k) => set[k]), u.id, now(), before.id).run();
  await audit(db, { userId: u.id, action: "carrier.update", targetType: "carrier", targetId: String(before.id), detail: { changes: diff }, ip: c.get("ip") });
  return c.json({ ok: true });
});

shipping.post("/carriers", async (c) => {
  const u = requirePerm(c, "ship.edit");
  const b = await body(c);
  const name = text(b.name, 60, "The carrier name") ?? fail(400, "The carrier name is required.");
  const mode = pick(["parcel", "ltl", "ocean", "air", "courier", "pickup", "other"] as const, b.mode ?? "other", "kind of carrier");
  const tpl = text(b.url_template, 500, "The tracking link");
  if (tpl) { const p = templateProblem(tpl); if (p) fail(400, p); }
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || randomId().slice(0, 8);
  if (await c.env.DB.prepare("SELECT 1 FROM carriers WHERE id = ? OR lower(name) = lower(?)").bind(id, name).first()) fail(409, "That carrier is already on the list.");
  await c.env.DB.prepare("INSERT INTO carriers (id, name, mode, url_template, checked, active, sort, updated_by, updated_at) VALUES (?,?,?,?,0,1,500,?,?)").bind(id, name, mode, tpl, u.id, now()).run();
  await audit(c.env.DB, { userId: u.id, action: "carrier.create", targetType: "carrier", targetId: id, detail: { name, url_template: tpl }, ip: c.get("ip") });
  return c.json({ id });
});

/** Spreadsheet of incoming (?kind=in) or outgoing (?kind=out) shipments, one row per line. */
shipping.get("/export", async (c) => {
  const u = requirePerm(c, "ship.view");
  const db = c.env.DB;
  const kind = c.req.query("kind") === "out" ? "out" : "in";
  const rows: unknown[][] = [];
  if (kind === "in") {
    const { results } = await db.prepare(`SELECT ${IN_COLS} FROM sh_inbound i LEFT JOIN carriers c ON c.id = i.carrier_id ORDER BY i.created_at`).all<InRow>();
    const lines = await inLines(db);
    for (const i of results) {
      const mine = lines.filter((l) => l.inbound_id === i.id);
      const head = [i.number, i.supplier, i.reference, i.mode, i.carrier, i.tracking, i.expected_date, inShown(i.stage, mine), i.customs_status];
      if (!mine.length) rows.push([...head, "", "", "", "", "", ""]);
      for (const l of mine) rows.push([...head, l.line_no, l.part_code, l.description, l.qty_expected, l.qty_received, l.bin]);
    }
  } else {
    const { results } = await db.prepare(`SELECT ${OUT_COLS} ${OUT_FROM} ORDER BY s.created_at`).all<OutRow>();
    const { results: lines } = await db.prepare("SELECT outbound_id, part_code, description, qty FROM sh_out_lines ORDER BY rowid").all<{ outbound_id: string; part_code: string | null; description: string | null; qty: number }>();
    for (const s of results) {
      const mine = lines.filter((l) => l.outbound_id === s.id);
      const head = [s.number, s.source === "parts_order" ? "Parts order" : s.source === "change_part" ? "Change parts" : "Other", s.order_number, s.customer, s.carrier, s.service, s.tracking, s.boxes, s.weight_lb, s.ship_date, OUT_LABELS[s.status]];
      if (!mine.length) rows.push([...head, "", "", "", ""]);
      mine.forEach((l, i) => rows.push([...head, i + 1, l.part_code, l.description, l.qty]));
    }
  }
  await audit(db, { userId: u.id, action: "shipping.export", targetType: kind === "in" ? "inbound" : "outbound", detail: { rows: rows.length }, ip: c.get("ip") });
  return new Response(toCsv(kind === "in" ? IN_CSV_HEADER : OUT_CSV_HEADER, rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${kind === "in" ? "incoming" : "outgoing"}-shipments-${today()}.csv"` },
  });
});

// ---------- files ----------

shipping.get("/files/:fileId", async (c) => {
  requirePerm(c, "ship.view");
  const f = await c.env.DB.prepare("SELECT id, name FROM sh_files WHERE id = ? AND deleted_at IS NULL").bind(c.req.param("fileId")).first<{ id: string; name: string }>();
  if (!f) fail(404, "Not found.");
  return serveFile(c.env.FILES, `shipping/${f.id}`, f.name, { download: c.req.query("download") !== undefined });
});

shipping.delete("/files/:fileId", async (c) => {
  const u = requirePerm(c, "ship.edit");
  const f = await c.env.DB.prepare("SELECT id, owner_type, owner_id, name FROM sh_files WHERE id = ? AND deleted_at IS NULL").bind(c.req.param("fileId")).first<{ id: string; owner_type: string; owner_id: string; name: string }>();
  if (!f) fail(404, "Not found.");
  await c.env.DB.prepare("UPDATE sh_files SET deleted_at = ? WHERE id = ?").bind(now(), f.id).run();
  await c.env.FILES.delete(`shipping/${f.id}`).catch(() => undefined);
  await audit(c.env.DB, { userId: u.id, action: `${f.owner_type}.file.remove`, targetType: f.owner_type, targetId: f.owner_id, detail: { name: f.name }, ip: c.get("ip") });
  return c.json({ ok: true });
});

async function addFiles(c: Context<AppEnv>, owner: "inbound" | "outbound", ownerId: string) {
  const u = requirePerm(c, "ship.edit");
  const table = owner === "inbound" ? "sh_inbound" : "sh_outbound";
  if (!(await c.env.DB.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).bind(ownerId).first())) fail(404, "Not found.");
  const { stored, form } = await storeUploads(c, u, "shipping", { [owner]: ownerId });
  const issue = form.get("issueId");
  let issueId: string | null = null;
  if (typeof issue === "string" && issue) {
    if (!(await c.env.DB.prepare("SELECT 1 FROM sh_issues WHERE id = ? AND inbound_id = ?").bind(issue, ownerId).first())) fail(400, "That problem isn't on this shipment.");
    issueId = issue;
  }
  const add = c.env.DB.prepare("INSERT INTO sh_files (id, owner_type, owner_id, issue_id, user_id, name, ext, size, created_at) VALUES (?,?,?,?,?,?,?,?,?)");
  const at = now();
  await c.env.DB.batch(stored.map((s) => add.bind(s.id, owner, ownerId, issueId, u.id, s.name, s.ext, s.size, at)));
  await audit(c.env.DB, { userId: u.id, action: `${owner}.file.add`, targetType: owner, targetId: ownerId, detail: { names: stored.map((s) => s.name), issue: issueId }, ip: c.get("ip") });
  return c.json({ ids: stored.map((s) => s.id) });
}
shipping.post("/inbound/:id/files", (c) => addFiles(c, "inbound", c.req.param("id")));
shipping.post("/outbound/:id/files", (c) => addFiles(c, "outbound", c.req.param("id")));

async function filesOf(db: D1Database, owner: string, id: string) {
  const { results } = await db.prepare("SELECT f.id, f.name, f.ext, f.size, f.issue_id, f.created_at, u.name AS by_name FROM sh_files f LEFT JOIN users u ON u.id = f.user_id WHERE f.owner_type = ? AND f.owner_id = ? AND f.deleted_at IS NULL ORDER BY f.created_at DESC").bind(owner, id).all();
  return results;
}

// ---------- incoming ----------

/** Lines typed for an incoming shipment: part code or description, and a whole expected quantity. */
function cleanInLines(v: unknown) {
  if (!Array.isArray(v)) fail(400, "Send the list of lines.");
  if (v.length > MAX_SH_LINES) fail(400, `A shipment can have up to ${MAX_SH_LINES} lines.`);
  return v.map((raw, i) => {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const part_code = text(r.part_code, SH_MAX.part_code, `Line ${i + 1}: the part code`)?.toUpperCase() ?? null;
    const description = text(r.description, SH_MAX.description, `Line ${i + 1}: the description`);
    if (!part_code && !description) fail(400, `Line ${i + 1}: add a part code or a description.`);
    return { id: typeof r.id === "string" ? r.id : undefined, part_code, description, qty_expected: whole(r.qty_expected ?? r.qty, `Line ${i + 1}: the quantity`, 1, MAX_QTY) };
  });
}

function inFields(b: Record<string, unknown>) {
  const f: Record<string, unknown> = {};
  if (b.supplier !== undefined) f.supplier = text(b.supplier, SH_MAX.supplier, "The supplier") ?? fail(400, "The supplier is required.");
  if (b.reference !== undefined) f.reference = text(b.reference, SH_MAX.reference, "The reference");
  if (b.mode !== undefined) f.mode = pick(IN_MODES, b.mode, "way of shipping");
  if (b.tracking !== undefined) f.tracking = tracking(b.tracking, "The tracking, container or bill of lading number");
  if (b.expected_date !== undefined) f.expected_date = day(b.expected_date, "The expected date");
  if (b.stage !== undefined) f.stage = pick(IN_STAGES, b.stage, "stage");
  if (b.customs_status !== undefined) f.customs_status = pick(CUSTOMS, b.customs_status, "customs status");
  if (b.broker !== undefined) f.broker = text(b.broker, SH_MAX.broker, "The customs broker");
  if (b.customs_notes !== undefined) f.customs_notes = text(b.customs_notes, SH_MAX.customs_notes, "The customs notes", true);
  if (b.notes !== undefined) f.notes = text(b.notes, SH_MAX.notes, "The notes", true);
  return f;
}

shipping.post("/inbound", async (c) => {
  const u = requirePerm(c, "ship.edit");
  const db = c.env.DB;
  const b = await body(c);
  const f = inFields({ supplier: b.supplier ?? null, ...b });
  const car = await carrier(db, b.carrier_id);
  const lines = b.lines === undefined ? [] : cleanInLines(b.lines);
  const id = randomId();
  const t = now();
  const number = await nextNumber(db, "IN");
  const cols = Object.keys(f);
  const add = db.prepare("INSERT INTO sh_in_lines (id, inbound_id, line_no, part_code, description, qty_expected) VALUES (?,?,?,?,?,?)");
  await db.batch([
    db.prepare(`INSERT INTO sh_inbound (id, number, carrier_id, ${cols.map((k) => k + ", ").join("")}created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ${cols.map(() => "?, ").join("")}?, ?, ?, ?)`)
      .bind(id, number, car?.id ?? null, ...cols.map((k) => f[k] ?? null), u.id, u.id, t, t),
    ...lines.map((l, i) => add.bind(randomId(), id, i + 1, l.part_code, l.description, l.qty_expected)),
  ]);
  await audit(db, { userId: u.id, action: "inbound.create", targetType: "inbound", targetId: id, detail: { number, ...f, lines: lines.length }, ip: c.get("ip") });
  return c.json({ id, number, hint: trackingHint(car?.id, f.tracking as string | null) });
});

async function loadIn(db: D1Database, id: string) {
  const i = await db.prepare("SELECT * FROM sh_inbound WHERE id = ?").bind(id).first<Record<string, any>>();
  if (!i) fail(404, "Not found.");
  return i;
}

shipping.get("/inbound/:id", async (c) => {
  requirePerm(c, "ship.view");
  const db = c.env.DB;
  const id = c.req.param("id");
  const i = await db.prepare(`SELECT i.*, c.name AS carrier, c.url_template, (SELECT COUNT(*) FROM sh_issues s WHERE s.inbound_id = i.id AND s.status = 'open') AS open_issues FROM sh_inbound i LEFT JOIN carriers c ON c.id = i.carrier_id WHERE i.id = ?`).bind(id).first<InRow & Record<string, unknown>>();
  if (!i) fail(404, "Not found.");
  const [lines, issues, receipts, files, history] = await Promise.all([
    inLines(db, id),
    db.prepare("SELECT s.*, l.line_no, l.part_code, cu.name AS by_name, ru.name AS resolved_by_name FROM sh_issues s LEFT JOIN sh_in_lines l ON l.id = s.line_id LEFT JOIN users cu ON cu.id = s.created_by LEFT JOIN users ru ON ru.id = s.resolved_by WHERE s.inbound_id = ? ORDER BY s.created_at DESC").bind(id).all(),
    db.prepare("SELECT r.at, r.qty, r.damaged, r.bin, l.line_no, l.part_code, u.name AS by_name FROM sh_receipts r JOIN sh_in_lines l ON l.id = r.line_id LEFT JOIN users u ON u.id = r.user_id WHERE r.inbound_id = ? ORDER BY r.at DESC").bind(id).all(),
    filesOf(db, "inbound", id),
    historyOf(db, "inbound", id),
  ]);
  return c.json({ inbound: { ...i, ...inSummary(i, lines) }, lines: lines.map((l) => ({ ...l, open: Math.max(0, l.qty_expected - l.qty_received) })), issues: issues.results, receipts: receipts.results, files, history });
});

shipping.patch("/inbound/:id", async (c) => {
  const u = requirePerm(c, "ship.edit");
  const db = c.env.DB;
  const before = await loadIn(db, c.req.param("id"));
  const b = await body(c);
  if (typeof b.revision !== "number" || b.revision !== before.revision) fail(409, staleIn);
  const f = inFields(b);
  if (b.carrier_id !== undefined) f.carrier_id = (await carrier(db, b.carrier_id))?.id ?? null;
  const diff = diffOf(before, f);
  if (!Object.keys(diff).length) return c.json({ ok: true, revision: before.revision });
  const keys = Object.keys(diff);
  const r = await db.prepare(`UPDATE sh_inbound SET ${keys.map((k) => `${k} = ?, `).join("")}revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?`)
    .bind(...keys.map((k) => f[k] ?? null), u.id, now(), before.id, before.revision).run();
  if (!r.meta.changes) fail(409, staleIn);
  await audit(db, { userId: u.id, action: "inbound.update", targetType: "inbound", targetId: before.id, detail: { changes: diff }, ip: c.get("ip") });
  const car = (f.carrier_id ?? before.carrier_id) as string | null;
  return c.json({ ok: true, revision: before.revision + 1, hint: trackingHint(car, (f.tracking ?? before.tracking) as string | null) });
});

/** Replace the expected lines. A line can't go below what was already received, or be removed once anything on it was. */
shipping.put("/inbound/:id/lines", async (c) => {
  const u = requirePerm(c, "ship.edit");
  const db = c.env.DB;
  const before = await loadIn(db, c.req.param("id"));
  const b = await body(c);
  if (typeof b.revision !== "number" || b.revision !== before.revision) fail(409, staleIn);
  const lines = cleanInLines(b.lines);
  const had = await inLines(db, before.id);
  const keep = new Set(lines.map((l) => l.id).filter(Boolean));
  for (const l of lines) if (l.id && !had.some((h) => h.id === l.id)) fail(400, "One of the lines isn't on this shipment. Reload and try again.");
  for (const h of had) if (h.qty_received > 0 && !keep.has(h.id)) fail(400, `Line ${h.line_no} has been received, so it can't be removed.`);
  const r = await db.prepare("UPDATE sh_inbound SET revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?").bind(u.id, now(), before.id, before.revision).run();
  if (!r.meta.changes) fail(409, staleIn);
  await db.batch([
    ...had.filter((h) => !keep.has(h.id)).map((h) => db.prepare("DELETE FROM sh_in_lines WHERE id = ?").bind(h.id)),
    ...lines.map((l, i) => l.id
      ? db.prepare("UPDATE sh_in_lines SET line_no = ?, part_code = ?, description = ?, qty_expected = ? WHERE id = ?").bind(i + 1, l.part_code, l.description, l.qty_expected, l.id)
      : db.prepare("INSERT INTO sh_in_lines (id, inbound_id, line_no, part_code, description, qty_expected) VALUES (?,?,?,?,?,?)").bind(randomId(), before.id, i + 1, l.part_code, l.description, l.qty_expected)),
  ]);
  const show = (x: { part_code: string | null; description: string | null; qty_expected: number }) => `${x.part_code ?? x.description} × ${x.qty_expected}`;
  await audit(db, { userId: u.id, action: "inbound.lines", targetType: "inbound", targetId: before.id, detail: { before: had.map(show), after: lines.map(show) }, ip: c.get("ip") });
  return c.json({ ok: true, revision: before.revision + 1 });
});

/**
 * Receive what came in: for each line, how many good, how many damaged, and the bin it went to.
 * Partial receipts are fine; the rest stays open. Damaged parts and anything over what was
 * expected are written down as problems on their own, so nothing is missed.
 */
shipping.post("/inbound/:id/receive", async (c) => {
  const u = requirePerm(c, "ship.edit");
  const db = c.env.DB;
  const i = await loadIn(db, c.req.param("id"));
  if (i.stage === "cancelled") fail(409, "This shipment was cancelled.");
  const b = await body(c);
  if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > MAX_SH_LINES) fail(400, "Say how many came in on each line.");
  const note = text(b.note, SH_MAX.issue_note, "The note", true);
  const had = await inLines(db, i.id);
  const got = (b.lines as unknown[]).map((raw) => {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const line = had.find((h) => h.id === r.line_id) ?? fail(400, "One of the lines isn't on this shipment. Reload and try again.");
    const qty = whole(r.qty ?? 0, `Line ${line.line_no}: the quantity received`, 0, MAX_QTY);
    const damaged = whole(r.damaged ?? 0, `Line ${line.line_no}: the quantity damaged`, 0, MAX_QTY);
    return { line, qty, damaged, bin: text(r.bin, SH_MAX.bin, `Line ${line.line_no}: the bin`)?.toUpperCase() ?? null };
  }).filter((g) => g.qty > 0 || g.damaged > 0);
  if (!got.length) fail(400, "Type how many came in on at least one line.");
  const t = now();
  const stmts: D1PreparedStatement[] = [];
  const issues: { kind: string; qty: number; line: number }[] = [];
  for (const g of got) {
    stmts.push(db.prepare("INSERT INTO sh_receipts (id, inbound_id, line_id, qty, damaged, bin, user_id, at) VALUES (?,?,?,?,?,?,?,?)").bind(randomId(), i.id, g.line.id, g.qty, g.damaged, g.bin, u.id, t));
    if (g.bin) stmts.push(db.prepare("UPDATE sh_in_lines SET bin = ? WHERE id = ?").bind(g.bin, g.line.id));
    const addIssue = (kind: string, qty: number) => {
      issues.push({ kind, qty, line: g.line.line_no });
      stmts.push(db.prepare("INSERT INTO sh_issues (id, inbound_id, line_id, kind, qty, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)").bind(randomId(), i.id, g.line.id, kind, qty, note, u.id, t));
    };
    if (g.damaged) addIssue("damaged", g.damaged);
    const wasOver = Math.max(0, g.line.qty_received - g.line.qty_expected);
    const nowOver = Math.max(0, g.line.qty_received + g.qty + g.damaged - g.line.qty_expected);
    if (nowOver > wasOver) addIssue("over", nowOver - wasOver);
  }
  const done = had.every((h) => h.qty_received + got.filter((g) => g.line.id === h.id).reduce((n, g) => n + g.qty + g.damaged, 0) >= h.qty_expected);
  stmts.push(db.prepare(`UPDATE sh_inbound SET stage = CASE WHEN stage IN ('expected','in_transit','at_customs') THEN 'arrived' ELSE stage END, received_at = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ?`)
    .bind(done ? t : null, u.id, t, i.id));
  await db.batch(stmts);
  await audit(db, { userId: u.id, action: "inbound.receive", targetType: "inbound", targetId: i.id, detail: { lines: got.map((g) => ({ line: g.line.line_no, part: g.line.part_code, qty: g.qty, damaged: g.damaged, bin: g.bin })), issues, note }, ip: c.get("ip") });
  return c.json({ ok: true, received: done, issues: issues.length });
});

shipping.post("/inbound/:id/issues", async (c) => {
  const u = requirePerm(c, "ship.edit");
  const db = c.env.DB;
  const i = await loadIn(db, c.req.param("id"));
  const b = await body(c);
  const kind = pick(ISSUE_KINDS, b.kind, "kind of problem");
  let lineId: string | null = null;
  if (b.line_id) {
    if (typeof b.line_id !== "string" || !(await db.prepare("SELECT 1 FROM sh_in_lines WHERE id = ? AND inbound_id = ?").bind(b.line_id, i.id).first())) fail(400, "That line isn't on this shipment.");
    lineId = b.line_id;
  }
  const qty = b.qty === undefined || b.qty === null || b.qty === "" ? null : whole(b.qty, "The quantity", 0, MAX_QTY);
  const note = text(b.note, SH_MAX.issue_note, "The note", true);
  if (!note && kind === "other") fail(400, "Say what the problem is.");
  const id = randomId();
  await db.prepare("INSERT INTO sh_issues (id, inbound_id, line_id, kind, qty, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)").bind(id, i.id, lineId, kind, qty, note, u.id, now()).run();
  await audit(db, { userId: u.id, action: "inbound.issue", targetType: "inbound", targetId: i.id, detail: { kind, qty, note }, ip: c.get("ip") });
  return c.json({ id });
});

shipping.patch("/issues/:issueId", async (c) => {
  const u = requirePerm(c, "ship.edit");
  const db = c.env.DB;
  const s = await db.prepare("SELECT * FROM sh_issues WHERE id = ?").bind(c.req.param("issueId")).first<Record<string, any>>();
  if (!s) fail(404, "Not found.");
  const b = await body(c);
  const status = pick(["open", "resolved"] as const, b.status, "status");
  const resolution = text(b.resolution, SH_MAX.resolution, "What was done", true);
  if (status === "resolved" && !resolution) fail(400, "Say how it was sorted out.");
  const t = now();
  await db.prepare("UPDATE sh_issues SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?")
    .bind(status, status === "resolved" ? resolution : null, status === "resolved" ? u.id : null, status === "resolved" ? t : null, s.id).run();
  await audit(db, { userId: u.id, action: status === "resolved" ? "inbound.issue.resolve" : "inbound.issue.reopen", targetType: "inbound", targetId: s.inbound_id, detail: { kind: s.kind, resolution }, ip: c.get("ip") });
  return c.json({ ok: true });
});

// ---------- outgoing ----------

/** What can be shipped: booked parts orders with something left to ship, and open change-part orders. */
shipping.get("/sources", async (c) => {
  const u = requirePerm(c, "ship.edit");
  const db = c.env.DB;
  const { results: orders } = await db.prepare("SELECT id, order_number, quote_number, customer, customer_po, promised_date, machine FROM po_orders WHERE status = 'booked' ORDER BY promised_date IS NULL, promised_date, order_number").all<Record<string, any>>();
  const lines = await openPoLines(db);
  const partsOrders = orders.map((o) => ({ ...o, lines: lines.filter((l) => l.order_id === o.id) })).filter((o) => o.lines.some((l) => l.to_ship > 0));
  const changeParts = (await db.prepare("SELECT id, customer, machine, part, customer_po, status FROM cp_orders WHERE phase = 'order' AND removed_at IS NULL ORDER BY updated_at DESC LIMIT 500").all<Record<string, any>>()).results
    .filter((o) => !/^(shipped|delivered|closed|complete[d]?|cancel+ed|canceled|invoiced|done)\b/i.test(String(o.status ?? "")));
  return c.json({ partsOrders, changeParts, seesOrders: has(u, "psales.view") });
});

async function openPoLines(db: D1Database, orderId?: string) {
  const { results } = await db.prepare(
    `SELECT l.id, l.order_id, l.line_no, l.part_code, l.description, l.qty, l.backorder,
            COALESCE(SUM(CASE WHEN s.status IN ('shipped','delivered') THEN sl.qty END), 0) AS shipped,
            COALESCE(SUM(CASE WHEN s.status IN ('to_pick','packed') THEN sl.qty END), 0) AS allocated
       FROM po_lines l LEFT JOIN sh_out_lines sl ON sl.po_line_id = l.id LEFT JOIN sh_outbound s ON s.id = sl.outbound_id
      ${orderId ? "WHERE l.order_id = ?" : ""} GROUP BY l.id ORDER BY l.line_no`,
  ).bind(...(orderId ? [orderId] : [])).all<{ id: string; order_id: string; line_no: number; part_code: string | null; description: string | null; qty: number; backorder: number; shipped: number; allocated: number }>();
  return results.map((l) => ({ ...l, to_ship: toAllocate(l) }));
}

function outFields(b: Record<string, unknown>) {
  const f: Record<string, unknown> = {};
  if (b.ship_to !== undefined) f.ship_to = text(b.ship_to, SH_MAX.ship_to, "The ship-to address", true);
  if (b.service !== undefined) f.service = text(b.service, SH_MAX.service, "The service");
  if (b.tracking !== undefined) f.tracking = tracking(b.tracking);
  if (b.boxes !== undefined) f.boxes = b.boxes === null || b.boxes === "" ? null : whole(b.boxes, "Boxes", 0, 999);
  if (b.weight_lb !== undefined) {
    const w = b.weight_lb === null || b.weight_lb === "" ? null : typeof b.weight_lb === "string" ? Number(b.weight_lb) : b.weight_lb;
    if (w !== null && (typeof w !== "number" || !Number.isFinite(w) || w < 0 || w > 100000)) fail(400, "The weight must be a number of pounds from 0 to 100000.");
    f.weight_lb = w === null ? null : Math.round((w as number) * 10) / 10;
  }
  if (b.ship_date !== undefined) f.ship_date = day(b.ship_date, "The ship date");
  if (b.notes !== undefined) f.notes = text(b.notes, SH_MAX.notes, "The notes", true);
  return f;
}

/**
 * Make an outgoing shipment. From a parts order, pick lines and how many of each (up to what is
 * left to ship); what isn't picked stays on the order as backordered. From a change-part order or
 * "other", type the lines.
 */
shipping.post("/outbound", async (c) => {
  const u = requirePerm(c, "ship.edit");
  const db = c.env.DB;
  const b = await body(c);
  const source = pick(["parts_order", "change_part", "other"] as const, b.source, "kind of shipment");
  const f = outFields(b);
  const car = await carrier(db, b.carrier_id);
  if (!Array.isArray(b.lines) || !b.lines.length) fail(400, "Pick what goes in this shipment.");
  if (b.lines.length > MAX_SH_LINES) fail(400, `A shipment can have up to ${MAX_SH_LINES} lines.`);
  let customer: string;
  let poId: string | null = null;
  let cpId: string | null = null;
  let lines: { po_line_id: string | null; part_code: string | null; description: string | null; qty: number }[];
  if (source === "parts_order") {
    const o = await db.prepare("SELECT id, status, customer, order_number FROM po_orders WHERE id = ?").bind(b.po_order_id ?? "").first<{ id: string; status: string; customer: string; order_number: string }>();
    if (!o) fail(400, "Pick the parts order to ship.");
    if (o.status !== "booked") fail(409, "Only a booked order can be shipped.");
    poId = o.id;
    customer = o.customer;
    const open = await openPoLines(db, o.id);
    const seen = new Set<string>();
    lines = (b.lines as unknown[]).map((raw) => {
      const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const l = open.find((x) => x.id === r.po_line_id) ?? fail(400, "One of the lines isn't on this order. Reload and try again.");
      if (seen.has(l.id)) fail(400, `Line ${l.line_no} is in the list twice.`);
      seen.add(l.id);
      const qty = whole(r.qty, `Line ${l.line_no}: the quantity`, 0, MAX_QTY);
      if (qty > l.to_ship) fail(400, `Line ${l.line_no}: only ${l.to_ship} left to ship.`);
      return { po_line_id: l.id, part_code: l.part_code, description: l.description, qty };
    }).filter((l) => l.qty > 0);
    if (!lines.length) fail(400, "Pick at least one part to ship.");
  } else {
    if (source === "change_part") {
      const o = await db.prepare("SELECT id, customer FROM cp_orders WHERE id = ? AND phase = 'order' AND removed_at IS NULL").bind(b.cp_order_id ?? "").first<{ id: string; customer: string }>();
      if (!o) fail(400, "Pick the change-part order to ship.");
      cpId = o.id;
      customer = o.customer;
    } else customer = text(b.customer, SH_MAX.customer, "The customer") ?? fail(400, "Say who it's going to.");
    lines = (b.lines as unknown[]).map((raw, i) => {
      const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const part_code = text(r.part_code, SH_MAX.part_code, `Line ${i + 1}: the part code`)?.toUpperCase() ?? null;
      const description = text(r.description, SH_MAX.description, `Line ${i + 1}: the description`);
      if (!part_code && !description) fail(400, `Line ${i + 1}: add a part code or a description.`);
      return { po_line_id: null, part_code, description, qty: whole(r.qty, `Line ${i + 1}: the quantity`, 1, MAX_QTY) };
    });
  }
  const id = randomId();
  const t = now();
  const number = await nextNumber(db, "OUT");
  const cols = Object.keys(f);
  const add = db.prepare("INSERT INTO sh_out_lines (id, outbound_id, po_line_id, part_code, description, qty) VALUES (?,?,?,?,?,?)");
  await db.batch([
    db.prepare(`INSERT INTO sh_outbound (id, number, source, po_order_id, cp_order_id, customer, carrier_id, ${cols.map((k) => k + ", ").join("")}created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ${cols.map(() => "?, ").join("")}?, ?, ?, ?)`)
      .bind(id, number, source, poId, cpId, customer, car?.id ?? null, ...cols.map((k) => f[k] ?? null), u.id, u.id, t, t),
    ...lines.map((l) => add.bind(randomId(), id, l.po_line_id, l.part_code, l.description, l.qty)),
  ]);
  await audit(db, { userId: u.id, action: "outbound.create", targetType: "outbound", targetId: id, detail: { number, source, lines: lines.map((l) => `${l.part_code ?? l.description} × ${l.qty}`) }, ip: c.get("ip") });
  if (poId) await audit(db, { userId: u.id, action: "po.shipment", targetType: "parts_order", targetId: poId, detail: { number, lines: lines.map((l) => `${l.part_code ?? l.description} × ${l.qty}`) }, ip: c.get("ip") });
  return c.json({ id, number });
});

async function loadOut(db: D1Database, id: string) {
  const s = await db.prepare("SELECT * FROM sh_outbound WHERE id = ?").bind(id).first<Record<string, any>>();
  if (!s) fail(404, "Not found.");
  return s;
}

shipping.get("/outbound/:id", async (c) => {
  requirePerm(c, "ship.view");
  const db = c.env.DB;
  const id = c.req.param("id");
  const s = await db.prepare(`SELECT ${OUT_COLS}, s.ship_to, s.notes, s.revision, s.created_at ${OUT_FROM} WHERE s.id = ?`).bind(id).first<OutRow & Record<string, unknown>>();
  if (!s) fail(404, "Not found.");
  const { results: lines } = await db.prepare("SELECT id, po_line_id, part_code, description, qty FROM sh_out_lines WHERE outbound_id = ? ORDER BY rowid").bind(id).all<{ id: string; po_line_id: string | null; part_code: string | null; description: string | null; qty: number }>();
  // For a parts order, each line's ordered quantity and what will still be owed after this shipment (for the packing slip).
  const orderLines = s.po_order_id ? await openPoLines(db, s.po_order_id) : [];
  const order = s.po_order_id ? await db.prepare("SELECT id, quote_number, order_number, customer_po, promised_date, machine, contact FROM po_orders WHERE id = ?").bind(s.po_order_id).first() : null;
  const cp = s.cp_order_id ? await db.prepare("SELECT id, customer, machine, part, customer_po, aa FROM cp_orders WHERE id = ?").bind(s.cp_order_id).first() : null;
  const [files, history] = await Promise.all([filesOf(db, "outbound", id), historyOf(db, "outbound", id)]);
  return c.json({
    outbound: { ...outSummary(s), hint: trackingHint(s.carrier_id, s.tracking), moves: OUT_MOVES[s.status] },
    lines: lines.map((l) => {
      const ol = orderLines.find((x) => x.id === l.po_line_id);
      return { ...l, line_no: ol?.line_no ?? null, ordered: ol?.qty ?? null, owed: ol ? Math.max(0, ol.qty - ol.shipped - (s.status === "shipped" || s.status === "delivered" ? 0 : l.qty)) : null };
    }),
    order, changePart: cp, files, history,
  });
});

shipping.patch("/outbound/:id", async (c) => {
  const u = requirePerm(c, "ship.edit");
  const db = c.env.DB;
  const before = await loadOut(db, c.req.param("id"));
  const b = await body(c);
  if (typeof b.revision !== "number" || b.revision !== before.revision) fail(409, staleIn);
  if (before.status === "cancelled") fail(409, "This shipment was cancelled.");
  const f = outFields(b);
  if (b.carrier_id !== undefined) f.carrier_id = (await carrier(db, b.carrier_id))?.id ?? null;
  if (before.status === "shipped" || before.status === "delivered") {
    if ("carrier_id" in f && !f.carrier_id) fail(400, "A shipped shipment needs its carrier.");
    if ("ship_date" in f && !f.ship_date) fail(400, "A shipped shipment needs its ship date.");
  }
  const diff = diffOf(before, f);
  if (!Object.keys(diff).length) return c.json({ ok: true, revision: before.revision });
  const keys = Object.keys(diff);
  const r = await db.prepare(`UPDATE sh_outbound SET ${keys.map((k) => `${k} = ?, `).join("")}revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?`)
    .bind(...keys.map((k) => f[k] ?? null), u.id, now(), before.id, before.revision).run();
  if (!r.meta.changes) fail(409, staleIn);
  await audit(db, { userId: u.id, action: "outbound.update", targetType: "outbound", targetId: before.id, detail: { changes: diff }, ip: c.get("ip") });
  return c.json({ ok: true, revision: before.revision + 1, hint: trackingHint((f.carrier_id ?? before.carrier_id) as string | null, (f.tracking ?? before.tracking) as string | null) });
});

/** To pick → packed → shipped → delivered (or cancelled before it leaves). Shipping needs the carrier and, for parcel and freight, the tracking number. */
shipping.post("/outbound/:id/status", async (c) => {
  const u = requirePerm(c, "ship.edit");
  const db = c.env.DB;
  const s = await loadOut(db, c.req.param("id"));
  const b = await body(c);
  if (typeof b.revision !== "number" || b.revision !== s.revision) fail(409, staleIn);
  const to = isOutStatus(b.to) ? b.to : fail(400, "Pick what to change it to.");
  if (!OUT_MOVES[s.status as OutStatus].includes(to)) fail(409, `A shipment that is ${OUT_LABELS[s.status as OutStatus].toLowerCase()} can't be changed to that.`);
  const set: Record<string, unknown> = { status: to };
  const t = now();
  if (to === "shipped" && s.status !== "delivered") {
    const car = await carrier(db, s.carrier_id);
    if (!car) fail(400, "Pick the carrier before marking it shipped.");
    if (!s.tracking && !["pickup", "other"].includes(car.mode)) fail(400, "Add the tracking number before marking it shipped.");
    if (!s.ship_date || s.ship_date > t.slice(0, 10)) set.ship_date = t.slice(0, 10);
  }
  if (to === "delivered") set.delivered_at = t;
  if (to === "shipped" && s.status === "delivered") set.delivered_at = null;
  const keys = Object.keys(set);
  const r = await db.prepare(`UPDATE sh_outbound SET ${keys.map((k) => `${k} = ?, `).join("")}revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?`)
    .bind(...keys.map((k) => set[k]), u.id, t, s.id, s.revision).run();
  if (!r.meta.changes) fail(409, staleIn);
  await audit(db, { userId: u.id, action: "outbound.status", targetType: "outbound", targetId: s.id, detail: { from: s.status, to }, ip: c.get("ip") });
  if (s.po_order_id && (to === "shipped" || to === "delivered" || to === "cancelled" || s.status === "shipped")) {
    await audit(db, { userId: u.id, action: "po.shipment.status", targetType: "parts_order", targetId: s.po_order_id, detail: { number: s.number, from: s.status, to, tracking: s.tracking }, ip: c.get("ip") });
  }
  return c.json({ ok: true, revision: s.revision + 1 });
});

