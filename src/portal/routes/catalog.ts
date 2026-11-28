// The parts catalog, staff side. Every machine's drawings and parts lists (read from chapter 11
// of its manual), its 3D models (from CAD), where each part is used, and staff-only notes.
//
// Staff build and check a machine's catalog here, then Publish copies it to the customer parts
// site (Worker ronchi-parts) through lib/parts-site.ts. Publish sends only catalog data: the
// machine number and model, drawing titles, part codes, names and quantities. Never customer
// names, sites, staff notes, or anything else from portal-db.
import { Hono } from "hono";
import { randomId } from "../../shared/crypto";
import { cleanPartCode, SECTIONS } from "../../shared/catalog/model";
import { scanForCustomerData } from "../../shared/privacy";
import type { AppEnv } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, mustStr, requirePerm, str, has } from "../lib/http";
import { partsCall, partsSiteReady } from "../lib/parts-site";

export const catalog = new Hono<AppEnv>();

const ID = /^[A-Za-z0-9_-]{8,40}$/;
const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null);
const MAX_SHEETS = 2000;
const MAX_ROWS = 2000;

type Db = D1Database;

export interface SheetRec {
  id: string; machine_id: string; parent_id: string | null; section: string; grp: string | null; code: string | null; rev: string | null;
  title: string; title_it: string; source: string; page: number | null; sort: number;
  image_w: number | null; image_h: number | null; model_size: number | null; mesh_map: string | null;
  /** Set when the model is a shared file (see sharedKey); NULL for a file of the sheet's own. */
  model_ref?: string | null;
}

async function machineById(db: Db, id: string) {
  const m = await db.prepare("SELECT id, serial, model, customer, site, notes, catalog_published_at FROM machines WHERE id = ?").bind(id).first<{
    id: string; serial: string; model: string | null; customer: string | null; site: string | null; notes: string | null; catalog_published_at: string | null;
  }>();
  if (!m) fail(404, "Not found.");
  return m;
}

export async function sheetById(db: Db, id: string) {
  if (!ID.test(id)) fail(404, "Not found.");
  const s = await db.prepare("SELECT * FROM catalog_sheets WHERE id = ?").bind(id).first<SheetRec>();
  if (!s) fail(404, "Not found.");
  return s;
}

/**
 * For a parts list with no drawing of its own: the same assembly's drawing from another machine's
 * manual. Ronchi reuses assemblies across machines, so the drawing and its balloon numbers are the
 * same. The same revision is preferred, then the newest.
 */
async function drawingDonor(db: Db, s: Pick<SheetRec, "id" | "code" | "rev" | "image_w">) {
  if (s.image_w || !s.code) return null;
  return db.prepare(
    `SELECT c.id, c.image_w, c.image_h, m.serial FROM catalog_sheets c JOIN machines m ON m.id = c.machine_id
      WHERE c.code = ? AND c.image_w IS NOT NULL AND c.id <> ?
      ORDER BY (c.rev IS ?) DESC, c.updated_at DESC LIMIT 1`,
  ).bind(s.code, s.id, s.rev ?? null).first<{ id: string; image_w: number; image_h: number; serial: string }>();
}

/**
 * The oldest manuals print a parts table with no quantity and no position. Borrow them from the same
 * assembly on another machine: only for a part number that sits on exactly one row of that list.
 */
async function quantityDonor(db: Db, s: Pick<SheetRec, "id" | "code" | "rev">) {
  if (!s.code) return null;
  const donor = await db.prepare(
    `SELECT c.id, m.serial FROM catalog_sheets c JOIN machines m ON m.id = c.machine_id
      WHERE c.code = ? AND c.id <> ? AND EXISTS (SELECT 1 FROM catalog_rows r WHERE r.sheet_id = c.id AND r.qty IS NOT NULL)
      ORDER BY (c.rev IS ?) DESC, c.updated_at DESC LIMIT 1`,
  ).bind(s.code, s.id, s.rev ?? null).first<{ id: string; serial: string }>();
  if (!donor) return null;
  const { results } = await db.prepare("SELECT pos, code, qty, unit FROM catalog_rows WHERE sheet_id = ?").bind(donor.id).all<{ pos: string; code: string; qty: number | null; unit: string | null }>();
  const byCode = new Map<string, { pos: string; qty: number | null; unit: string | null } | null>();
  for (const r of results) byCode.set(r.code, byCode.has(r.code) ? null : r);
  return { serial: donor.serial, byCode };
}

/** Run statements in batches. D1 runs each batch as one transaction. */
async function runAll(db: Db, stmts: D1PreparedStatement[]) {
  for (let i = 0; i < stmts.length; i += 500) await db.batch(stmts.slice(i, i + 500));
}

function cleanHotspots(v: unknown): string {
  const list = Array.isArray(v) ? (v as Record<string, unknown>[]).slice(0, 50) : [];
  return JSON.stringify(list.map((h) => ({ x: num(h?.x, 1) ?? 0, y: num(h?.y, 1) ?? 0, w: num(h?.w, 1) ?? 0, h: num(h?.h, 1) ?? 0 })));
}

function cleanRows(v: unknown, where: string) {
  if (!Array.isArray(v)) return [];
  if (v.length > MAX_ROWS) fail(400, `Too many rows on ${where}.`);
  return (v as Record<string, unknown>[]).map((r, i) => {
    const code = cleanPartCode(r?.code);
    if (!code) fail(400, `"${String(r?.code ?? "").slice(0, 30)}" on ${where} isn't a Ronchi part code.`);
    return {
      id: typeof r.id === "string" && ID.test(r.id) ? r.id : randomId(),
      pos: str(r.pos, 10) ?? "",
      code,
      qty: num(r.qty, 100000),
      unit: r.unit === "m" ? "m" : null,
      hotspots: cleanHotspots(r.hotspots),
      sort: i,
      rev: str(r.rev, 4),
      nameIt: str(r.nameIt, 300),
      nameEn: str(r.nameEn, 300),
    };
  });
}

/** Save part names read from a manual. A name typed by staff is kept unless the manual has one. */
function upsertPart(db: Db, p: { code: string; rev: string | null; nameEn: string | null; nameIt: string | null }, t: string) {
  return db.prepare(
    `INSERT INTO catalog_parts (code, rev, name_en, name_it, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT (code) DO UPDATE SET
       rev = COALESCE(excluded.rev, catalog_parts.rev),
       name_en = CASE WHEN excluded.name_en <> '' THEN excluded.name_en ELSE catalog_parts.name_en END,
       name_it = CASE WHEN excluded.name_it <> '' THEN excluded.name_it ELSE catalog_parts.name_it END,
       updated_at = excluded.updated_at`,
  ).bind(p.code, p.rev, p.nameEn ?? "", p.nameIt ?? "", t);
}

const fileKey = (sheetId: string, file: string) => `catalog/${sheetId}/${file === "model" ? "model.glb" : "drawing"}`;
// A 3D model is stored once by what's in it (SHA-256), so the same assembly on 50 machines is one file.
const sharedKey = (ref: string) => `catalog/shared/${ref}.glb`;
const modelKey = (s: { id: string; model_ref?: string | null }) => (s.model_ref ? sharedKey(s.model_ref) : fileKey(s.id, "model"));
const SHA = /^[0-9a-f]{64}$/;

/** Delete the model files these sheets held, once the sheets no longer point at them. A shared file goes only when no parts list uses it. */
async function dropModelFiles(env: AppEnv["Bindings"], sheets: { id: string; model_ref?: string | null }[]) {
  const own = sheets.filter((s) => !s.model_ref).map((s) => fileKey(s.id, "model"));
  if (own.length) await env.FILES.delete(own);
  for (const ref of new Set(sheets.map((s) => s.model_ref).filter((r): r is string => !!r))) {
    const used = await env.DB.prepare("SELECT 1 AS x FROM catalog_sheets WHERE model_ref = ? LIMIT 1").bind(ref).first();
    if (!used) await env.FILES.delete(sharedKey(ref));
  }
}

async function sha256Bytes(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Machines ----------

catalog.get("/machines", async (c) => {
  requirePerm(c, "catalog.view");
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.serial, m.model, m.customer, m.site, m.catalog_published_at,
            (SELECT COUNT(*) FROM catalog_sheets s WHERE s.machine_id = m.id) AS sheets,
            (SELECT COUNT(*) FROM catalog_sheets s WHERE s.machine_id = m.id AND s.model_size IS NOT NULL) AS models,
            (SELECT MAX(updated_at) FROM catalog_sheets s WHERE s.machine_id = m.id) AS updated_at
       FROM machines m ORDER BY m.serial`,
  ).all();
  return c.json({ machines: results, partsSite: partsSiteReady(c.env) });
});

catalog.get("/machines/:id", async (c) => {
  requirePerm(c, "catalog.view");
  const m = await machineById(c.env.DB, c.req.param("id"));
  const { results: sheets } = await c.env.DB.prepare(
    `SELECT id, parent_id, section, grp, code, rev, title, title_it, source, page, sort, updated_at,
            image_w IS NOT NULL AS has_drawing, model_size IS NOT NULL AS has_model,
            (SELECT COUNT(*) FROM catalog_rows r WHERE r.sheet_id = s.id) AS rows
       FROM catalog_sheets s WHERE machine_id = ? ORDER BY sort`,
  ).bind(m.id).all();
  const { results: imports } = await c.env.DB.prepare(
    `SELECT i.id, i.file_name, i.pages, i.sheets, i.rows, i.warnings, i.created_at, u.name AS by_name
       FROM catalog_imports i LEFT JOIN users u ON u.id = i.user_id WHERE i.machine_id = ? ORDER BY i.created_at DESC LIMIT 20`,
  ).bind(m.id).all();
  return c.json({
    machine: { id: m.id, serial: m.serial, model: m.model, customer: m.customer, site: m.site, notes: m.notes, catalog_published_at: m.catalog_published_at },
    sheets,
    imports: imports.map((i: any) => ({ ...i, warnings: i.warnings ? JSON.parse(i.warnings) : [] })),
  });
});

/**
 * Save what the browser read from a manual's chapter 11 (pdf.js runs in the browser; see
 * web/src/catalog/import.ts). Replaces the machine's sheets that came from a manual. Sheets made
 * by hand or from CAD are kept. Answers with the new sheet ids so the drawings can be uploaded.
 */
catalog.post("/machines/:id/import", async (c) => {
  const u = requirePerm(c, "catalog.edit");
  const m = await machineById(c.env.DB, c.req.param("id"));
  return c.json(await importManual(c.env, m, await body(c), { userId: u.id, ip: c.get("ip") }));
});

/** The import itself, shared by the staff page above and the PC catalog loader (routes/catalog-loader.ts). */
export async function importManual(env: AppEnv["Bindings"], m: { id: string }, b: Record<string, unknown>, who: { userId: string | null; ip?: string }) {
  const db = env.DB;
  const fileName = mustStr(b.fileName, 200, "File name");
  if (!Array.isArray(b.sheets) || !b.sheets.length) fail(400, "Nothing was read from the file.");
  if (b.sheets.length > MAX_SHEETS) fail(400, "Too many drawings in one import.");
  const t = now();

  const incoming = (b.sheets as Record<string, unknown>[]).map((s, i) => {
    const key = String(s?.key ?? i);
    return {
      key,
      parentKey: s.parentKey === undefined || s.parentKey === null ? null : String(s.parentKey),
      id: randomId(),
      section: SECTIONS.includes(s.section as never) ? (s.section as string) : "machine",
      grp: str(s.grp, 200),
      code: cleanPartCode(s.code),
      rev: str(s.rev, 4),
      title: str(s.title, 300) ?? "",
      titleIt: str(s.titleIt, 300) ?? "",
      page: num(s.page, 100000),
      rows: cleanRows(s.rows, `page ${num(s.page, 100000) ?? i + 1}`),
    };
  });
  const byKey = new Map(incoming.map((s) => [s.key, s.id]));

  const old = await db.prepare("SELECT id, model_ref FROM catalog_sheets WHERE machine_id = ? AND source = 'manual'").bind(m.id).all<{ id: string; model_ref: string | null }>();
  const base = await db.prepare("SELECT COALESCE(MAX(sort), -1) AS n FROM catalog_sheets WHERE machine_id = ? AND source <> 'manual'").bind(m.id).first<{ n: number }>();

  const stmts: D1PreparedStatement[] = [
    // Hand-made and CAD sheets that sat under an old manual sheet move to the top level.
    db.prepare("UPDATE catalog_sheets SET parent_id = NULL WHERE machine_id = ? AND source <> 'manual' AND parent_id IN (SELECT id FROM catalog_sheets WHERE machine_id = ? AND source = 'manual')").bind(m.id, m.id),
    db.prepare("DELETE FROM catalog_rows WHERE sheet_id IN (SELECT id FROM catalog_sheets WHERE machine_id = ? AND source = 'manual')").bind(m.id),
    db.prepare("UPDATE catalog_sheets SET parent_id = NULL WHERE machine_id = ? AND source = 'manual'").bind(m.id),
    db.prepare("DELETE FROM catalog_sheets WHERE machine_id = ? AND source = 'manual'").bind(m.id),
  ];
  const parts = new Map<string, { code: string; rev: string | null; nameEn: string | null; nameIt: string | null }>();
  // Parents go in before children at every depth, so the parent_id reference always exists. A sheet
  // whose parent is missing, or that sits in a loop, goes to the top level.
  const kids = new Map<string, typeof incoming>();
  for (const s of incoming) if (s.parentKey && s.parentKey !== s.key && byKey.has(s.parentKey)) kids.set(s.parentKey, [...(kids.get(s.parentKey) ?? []), s]);
  const order: typeof incoming = incoming.filter((s) => !s.parentKey || s.parentKey === s.key || !byKey.has(s.parentKey));
  const placed = new Set(order.map((s) => s.key));
  for (let i = 0; i < order.length; i++) for (const k of kids.get(order[i]!.key) ?? []) if (!placed.has(k.key)) { placed.add(k.key); order.push(k); }
  for (const s of incoming) if (!placed.has(s.key)) { s.parentKey = null; order.push(s); }
  for (const s of order) {
    const sort = (base?.n ?? -1) + 1 + incoming.indexOf(s);
    const parentId = s.parentKey ? (byKey.get(s.parentKey) ?? null) : null;
    stmts.push(db.prepare(
      `INSERT INTO catalog_sheets (id, machine_id, parent_id, section, grp, code, rev, title, title_it, source, page, sort, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?, 'manual', ?,?,?,?)`,
    ).bind(s.id, m.id, parentId === s.id ? null : parentId, s.section, s.grp, s.code, s.rev, s.title, s.titleIt, s.page, sort, t, t));
    for (const r of s.rows) {
      stmts.push(db.prepare("INSERT INTO catalog_rows (id, sheet_id, pos, code, qty, unit, hotspots, sort) VALUES (?,?,?,?,?,?,?,?)")
        .bind(r.id, s.id, r.pos, r.code, r.qty, r.unit, r.hotspots, r.sort));
      const known = parts.get(r.code);
      if (!known || (!known.nameEn && r.nameEn)) parts.set(r.code, { code: r.code, rev: r.rev, nameEn: r.nameEn, nameIt: r.nameIt });
    }
    if (s.code && !parts.has(s.code)) parts.set(s.code, { code: s.code, rev: s.rev, nameEn: s.title, nameIt: s.titleIt });
  }
  for (const p of parts.values()) stmts.push(upsertPart(db, p, t));
  const warnings = Array.isArray(b.warnings) ? (b.warnings as unknown[]).slice(0, 500).map((w) => String(w).slice(0, 300)) : [];
  const rowCount = incoming.reduce((n, s) => n + s.rows.length, 0);
  stmts.push(db.prepare("INSERT INTO catalog_imports (id, machine_id, file_name, pages, sheets, rows, warnings, user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(randomId(), m.id, fileName, num(b.pages, 100000) ?? 0, incoming.length, rowCount, JSON.stringify(warnings), who.userId, t));
  await runAll(db, stmts);
  if (old.results.length) {
    await env.FILES.delete(old.results.map((r) => fileKey(r.id, "drawing")));
    await dropModelFiles(env, old.results);
  }
  await audit(db, { userId: who.userId, action: who.userId ? "catalog.import" : "catalog.import.load", targetType: "machine", targetId: m.id, detail: { fileName, sheets: incoming.length, rows: rowCount }, ip: who.ip });
  return { sheets: incoming.map((s) => ({ key: s.key, id: s.id })) };
}

/** Add a sheet by hand, or for a 3D assembly from CAD. */
catalog.post("/machines/:id/sheets", async (c) => {
  const u = requirePerm(c, "catalog.edit");
  const m = await machineById(c.env.DB, c.req.param("id"));
  const b = await body(c);
  const parentId = typeof b.parentId === "string" ? (await sheetById(c.env.DB, b.parentId)) : null;
  if (parentId && parentId.machine_id !== m.id) fail(400, "That assembly is on another machine.");
  const id = randomId();
  const t = now();
  const sort = await c.env.DB.prepare("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM catalog_sheets WHERE machine_id = ?").bind(m.id).first<{ n: number }>();
  await c.env.DB.prepare(
    `INSERT INTO catalog_sheets (id, machine_id, parent_id, section, grp, code, title, title_it, source, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(id, m.id, parentId?.id ?? null, SECTIONS.includes(b.section as never) ? b.section : "machine", str(b.grp, 200), cleanPartCode(b.code),
    mustStr(b.title, 300, "Title"), str(b.titleIt, 300) ?? "", b.source === "cad" ? "cad" : "hand", sort?.n ?? 0, t, t).run();
  await audit(c.env.DB, { userId: u.id, action: "catalog.sheet.create", targetType: "catalog_sheet", targetId: id, ip: c.get("ip") });
  return c.json({ id });
});

// ---------- Sheets ----------

catalog.get("/sheets/:id", async (c) => {
  const u = requirePerm(c, "catalog.view");
  const db = c.env.DB;
  const s = await sheetById(db, c.req.param("id"));
  const m = await machineById(db, s.machine_id);
  const { results: rows } = await db.prepare(
    `SELECT r.id, r.pos, r.code, r.qty, r.unit, r.hotspots, p.rev, p.name_en, p.name_it, p.maker, p.maker_pn, p.wear,
            (SELECT id FROM catalog_sheets c WHERE c.machine_id = ? AND c.code = r.code AND c.id <> r.sheet_id LIMIT 1) AS sub_sheet,
            (SELECT COUNT(*) FROM catalog_notes n WHERE n.code = r.code AND n.deleted_at IS NULL) AS notes
       FROM catalog_rows r LEFT JOIN catalog_parts p ON p.code = r.code WHERE r.sheet_id = ? ORDER BY r.sort`,
  ).bind(s.machine_id, s.id).all();
  // No drawing here: borrow the same assembly's drawing, and its balloon spots for the rows that match.
  const donor = await drawingDonor(db, s);
  const spots = new Map<string, string>();
  if (donor) {
    const { results } = await db.prepare("SELECT pos, code, hotspots FROM catalog_rows WHERE sheet_id = ? AND hotspots IS NOT NULL").bind(donor.id).all<{ pos: string; code: string; hotspots: string }>();
    for (const r of results) spots.set(`${r.pos}\n${r.code}`, r.hotspots);
  }
  const amounts = rows.length && rows.every((r: any) => r.qty === null) ? await quantityDonor(db, s) : null;
  const ids = (await db.prepare("SELECT id FROM catalog_sheets WHERE machine_id = ? ORDER BY sort").bind(s.machine_id).all<{ id: string }>()).results.map((r) => r.id);
  const at = ids.indexOf(s.id);
  const path: { id: string; title: string; code: string | null }[] = [];
  let parent = s.parent_id;
  for (let i = 0; parent && i < 10; i++) {
    const p = await db.prepare("SELECT id, title, code, parent_id FROM catalog_sheets WHERE id = ?").bind(parent).first<{ id: string; title: string; code: string | null; parent_id: string | null }>();
    if (!p) break;
    path.unshift({ id: p.id, title: p.title, code: p.code });
    parent = p.parent_id;
  }
  return c.json({
    machine: { id: m.id, serial: m.serial, model: m.model, customer: m.customer },
    sheet: {
      id: s.id, serial: m.serial, section: s.section, group: s.grp, code: s.code, rev: s.rev, title: s.title, titleIt: s.title_it,
      source: s.source, page: s.page,
      quantitiesFrom: amounts?.serial ?? null,
      drawing: s.image_w ? { w: s.image_w, h: s.image_h } : donor ? { w: donor.image_w, h: donor.image_h, from: donor.serial } : null,
      model: s.model_size ? { size: s.model_size, meshMap: s.mesh_map ? JSON.parse(s.mesh_map) : {} } : null,
      prev: at > 0 ? ids[at - 1] : null,
      next: at >= 0 && at < ids.length - 1 ? ids[at + 1] : null,
      path,
    },
    rows: rows.map((r: any) => {
      const own = r.hotspots ? JSON.parse(r.hotspots) : [];
      const amount = r.qty === null ? amounts?.byCode.get(r.code) : null;
      const filled = amount && amount.qty !== null ? { qty: amount.qty, unit: amount.unit, pos: r.pos || amount.pos } : {};
      const lent = !own.length ? spots.get(`${filled.pos ?? r.pos}\n${r.code}`) : undefined;
      return { ...r, ...filled, hotspots: lent ? JSON.parse(lent) : own, wear: !!r.wear };
    }),
    canEdit: has(u, "catalog.edit"),
  });
});

catalog.patch("/sheets/:id", async (c) => {
  const u = requirePerm(c, "catalog.edit");
  const db = c.env.DB;
  const s = await sheetById(db, c.req.param("id"));
  const b = await body(c);
  let parentId = s.parent_id;
  if (b.parentId === null) parentId = null;
  else if (typeof b.parentId === "string") {
    const p = await sheetById(db, b.parentId);
    if (p.machine_id !== s.machine_id) fail(400, "That assembly is on another machine.");
    // No loops: the new parent can't sit inside this sheet.
    for (let cur: string | null = p.id, i = 0; cur && i < 20; i++) {
      if (cur === s.id) fail(400, "A sheet can't sit inside itself.");
      cur = (await db.prepare("SELECT parent_id FROM catalog_sheets WHERE id = ?").bind(cur).first<{ parent_id: string | null }>())?.parent_id ?? null;
    }
    parentId = p.id;
  }
  let meshMap = s.mesh_map;
  if (b.meshMap && typeof b.meshMap === "object" && !Array.isArray(b.meshMap)) {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(b.meshMap as Record<string, unknown>).slice(0, 20000)) {
      const code = cleanPartCode(v);
      if (code && k.length <= 200) clean[k] = code;
    }
    meshMap = JSON.stringify(clean);
  }
  await db.prepare(
    `UPDATE catalog_sheets SET title = ?, title_it = ?, section = ?, grp = ?, code = ?, rev = ?, parent_id = ?, mesh_map = ?, sort = ?, updated_at = ? WHERE id = ?`,
  ).bind(
    b.title === undefined ? s.title : mustStr(b.title, 300, "Title"),
    b.titleIt === undefined ? s.title_it : (str(b.titleIt, 300) ?? ""),
    SECTIONS.includes(b.section as never) ? b.section : s.section,
    b.grp === undefined ? s.grp : str(b.grp, 200),
    b.code === undefined ? s.code : cleanPartCode(b.code),
    b.rev === undefined ? s.rev : str(b.rev, 4),
    parentId, meshMap,
    num(b.sort, 1_000_000) ?? s.sort,
    now(), s.id,
  ).run();
  await audit(db, { userId: u.id, action: "catalog.sheet.update", targetType: "catalog_sheet", targetId: s.id, ip: c.get("ip") });
  return c.json({ ok: true });
});

/** Replace a sheet's parts table (after fixing what the import read wrong). */
catalog.put("/sheets/:id/rows", async (c) => {
  const u = requirePerm(c, "catalog.edit");
  const db = c.env.DB;
  const s = await sheetById(db, c.req.param("id"));
  const b = await body(c);
  const rows = cleanRows(b.rows, "this sheet");
  const t = now();
  const stmts = [db.prepare("DELETE FROM catalog_rows WHERE sheet_id = ?").bind(s.id)];
  for (const r of rows) {
    stmts.push(db.prepare("INSERT INTO catalog_rows (id, sheet_id, pos, code, qty, unit, hotspots, sort) VALUES (?,?,?,?,?,?,?,?)").bind(r.id, s.id, r.pos, r.code, r.qty, r.unit, r.hotspots, r.sort));
    if (r.nameEn || r.nameIt) stmts.push(upsertPart(db, r, t));
    else stmts.push(db.prepare("INSERT OR IGNORE INTO catalog_parts (code, updated_at) VALUES (?,?)").bind(r.code, t));
  }
  stmts.push(db.prepare("UPDATE catalog_sheets SET updated_at = ? WHERE id = ?").bind(t, s.id));
  await runAll(db, stmts);
  await audit(db, { userId: u.id, action: "catalog.rows.update", targetType: "catalog_sheet", targetId: s.id, detail: { rows: rows.length }, ip: c.get("ip") });
  return c.json({ ok: true });
});

catalog.delete("/sheets/:id", async (c) => {
  const u = requirePerm(c, "catalog.edit");
  const db = c.env.DB;
  const s = await sheetById(db, c.req.param("id"));
  await db.batch([
    db.prepare("UPDATE catalog_sheets SET parent_id = ? WHERE parent_id = ?").bind(s.parent_id, s.id),
    db.prepare("DELETE FROM catalog_rows WHERE sheet_id = ?").bind(s.id),
    db.prepare("DELETE FROM catalog_sheets WHERE id = ?").bind(s.id),
  ]);
  await c.env.FILES.delete(fileKey(s.id, "drawing"));
  await dropModelFiles(c.env, [s]);
  await audit(db, { userId: u.id, action: "catalog.sheet.delete", targetType: "catalog_sheet", targetId: s.id, detail: { title: s.title }, ip: c.get("ip") });
  return c.json({ ok: true });
});

/**
 * Check and store a sheet's drawing or 3D model. Shared by the staff upload below and the PC
 * catalog loader (routes/catalog-loader.ts), so both follow the same type, size and content rules.
 */
export async function saveSheetFile(
  env: AppEnv["Bindings"], s: SheetRec, file: "drawing" | "model", type: string, bytes: ArrayBuffer,
  size: { w?: number; h?: number }, who: { userId: string | null; ip?: string; action?: string },
) {
  const allowed = file === "model" ? ["model/gltf-binary"] : ["image/webp", "image/png"];
  if (!allowed.includes(type)) fail(400, file === "model" ? "3D models must be GLB files." : "Drawings must be WebP or PNG images.");
  if (!bytes.byteLength) fail(400, "The file is empty.");
  if (bytes.byteLength > (file === "model" ? 95 : 20) * 1024 * 1024) fail(413, "That file is too big.");
  // Check the file really is what it says (first bytes), not just its label.
  const head = new Uint8Array(bytes.slice(0, 12));
  const ascii = String.fromCharCode(...head);
  const ok = type === "model/gltf-binary" ? ascii.startsWith("glTF")
    : type === "image/png" ? head[0] === 0x89 && ascii.slice(1, 4) === "PNG"
    : ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
  if (!ok) fail(400, "That file isn't what its type says.");
  if (file === "drawing" && !(size.w! > 0 && size.w! <= 20000 && size.h! > 0 && size.h! <= 20000)) fail(400, "Send the drawing's width and height.");
  if (file === "model") {
    const ref = await sha256Bytes(bytes);
    if (!(await env.FILES.head(sharedKey(ref)))) await env.FILES.put(sharedKey(ref), bytes, { httpMetadata: { contentType: type } });
    await env.DB.prepare("UPDATE catalog_sheets SET model_size = ?, model_ref = ?, updated_at = ? WHERE id = ?").bind(bytes.byteLength, ref, now(), s.id).run();
    if (s.model_size && s.model_ref !== ref) await dropModelFiles(env, [s]);
  } else {
    await env.FILES.put(fileKey(s.id, file), bytes, { httpMetadata: { contentType: type } });
    await env.DB.prepare("UPDATE catalog_sheets SET image_w = ?, image_h = ?, updated_at = ? WHERE id = ?").bind(Math.round(size.w!), Math.round(size.h!), now(), s.id).run();
  }
  await audit(env.DB, { userId: who.userId, action: who.action ?? `catalog.${file}.upload`, targetType: "catalog_sheet", targetId: s.id, detail: { bytes: bytes.byteLength }, ip: who.ip });
}

/**
 * Point a parts list at a 3D model the portal already holds (same file, by its SHA-256), so the
 * PC loader sends each assembly once however many machines use it. 404 when the file isn't here yet.
 */
export async function linkSheetModel(env: AppEnv["Bindings"], s: SheetRec, ref: string, who: { userId: string | null; ip?: string; action?: string }) {
  if (!SHA.test(ref)) fail(400, "Send the model's SHA-256.");
  const obj = await env.FILES.head(sharedKey(ref));
  if (!obj) fail(404, "The portal doesn't have that 3D model yet.");
  await env.DB.prepare("UPDATE catalog_sheets SET model_size = ?, model_ref = ?, updated_at = ? WHERE id = ?").bind(obj.size, ref, now(), s.id).run();
  if (s.model_size && s.model_ref !== ref) await dropModelFiles(env, [s]);
  await audit(env.DB, { userId: who.userId, action: who.action ?? "catalog.model.link", targetType: "catalog_sheet", targetId: s.id, detail: { bytes: obj.size, shared: true }, ip: who.ip });
}

/** Take a sheet's 3D model off (a wrong or empty model). Shared by staff and the PC catalog loader. */
export async function removeSheetModel(env: AppEnv["Bindings"], s: SheetRec, who: { userId: string | null; ip?: string; action?: string }) {
  if (!s.model_size) fail(404, "That parts list has no 3D model.");
  await env.DB.prepare("UPDATE catalog_sheets SET model_size = NULL, model_ref = NULL, updated_at = ? WHERE id = ?").bind(now(), s.id).run();
  await dropModelFiles(env, [s]);
  await audit(env.DB, { userId: who.userId, action: who.action ?? "catalog.model.remove", targetType: "catalog_sheet", targetId: s.id, detail: { bytes: s.model_size }, ip: who.ip });
}

catalog.delete("/sheets/:id/model", async (c) => {
  const u = requirePerm(c, "catalog.edit");
  await removeSheetModel(c.env, await sheetById(c.env.DB, c.req.param("id")), { userId: u.id, ip: c.get("ip") });
  return c.json({ ok: true });
});

/** Upload a sheet's drawing (WebP or PNG, made in the browser from the manual page) or its 3D model (GLB). */
catalog.put("/sheets/:id/:file{drawing|model}", async (c) => {
  const u = requirePerm(c, "catalog.edit");
  const s = await sheetById(c.env.DB, c.req.param("id"));
  const file = c.req.param("file") as "drawing" | "model";
  const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
  await saveSheetFile(c.env, s, file, type, await c.req.arrayBuffer(), { w: Number(c.req.query("w")), h: Number(c.req.query("h")) }, { userId: u.id, ip: c.get("ip") });
  return c.json({ ok: true });
});

catalog.get("/sheets/:id/:file{drawing|model}", async (c) => {
  requirePerm(c, "catalog.view");
  const s = await sheetById(c.env.DB, c.req.param("id"));
  const file = c.req.param("file");
  const donor = file === "drawing" ? await drawingDonor(c.env.DB, s) : null;
  const obj = await c.env.FILES.get(file === "model" ? modelKey(s) : fileKey(donor?.id ?? s.id, file));
  if (!obj) fail(404, "Not found.");
  return new Response(obj.body, {
    headers: {
      "Content-Type": file === "model" ? "model/gltf-binary" : (obj.httpMetadata?.contentType === "image/png" ? "image/png" : "image/webp"),
      "Content-Length": String(obj.size),
      "Cache-Control": "private, max-age=300",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});

// ---------- Parts, search, notes ----------

catalog.get("/search", async (c) => {
  requirePerm(c, "catalog.view");
  const q = (c.req.query("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return c.json({ results: [] });
  const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT r.code, p.name_en, p.name_it, s.id AS sheet_id, s.title AS sheet_title, m.serial, m.id AS machine_id, r.pos, r.qty
       FROM catalog_rows r
       JOIN catalog_sheets s ON s.id = r.sheet_id
       JOIN machines m ON m.id = s.machine_id
       LEFT JOIN catalog_parts p ON p.code = r.code
      WHERE r.code LIKE ? ESCAPE '\\' OR p.name_en LIKE ? ESCAPE '\\' OR p.name_it LIKE ? ESCAPE '\\' OR p.maker_pn LIKE ? ESCAPE '\\'
      ORDER BY (r.code = ?) DESC, r.code, m.serial LIMIT 300`,
  ).bind(like, like, like, like, q.toUpperCase()).all();
  // Machines too: a machine number, model or customer finds the machine even before it has a catalog.
  const { results: machines } = await c.env.DB.prepare(
    `SELECT m.id, m.serial, m.model, m.customer, m.site, (SELECT COUNT(*) FROM catalog_sheets s WHERE s.machine_id = m.id) AS sheets
       FROM machines m
      WHERE m.serial LIKE ? ESCAPE '\\' OR m.model LIKE ? ESCAPE '\\' OR m.customer LIKE ? ESCAPE '\\' OR m.site LIKE ? ESCAPE '\\'
      ORDER BY (m.serial = ?) DESC, m.serial LIMIT 50`,
  ).bind(like, like, like, like, q.toUpperCase()).all();
  return c.json({ results, machines });
});

catalog.get("/parts/:code", async (c) => {
  requirePerm(c, "catalog.view");
  const code = cleanPartCode(c.req.param("code"));
  if (!code) fail(404, "Not found.");
  const part = await c.env.DB.prepare("SELECT code, rev, name_en, name_it, maker, maker_pn, wear, updated_at FROM catalog_parts WHERE code = ?").bind(code).first();
  const { results: usedOn } = await c.env.DB.prepare(
    `SELECT m.id AS machine_id, m.serial, m.model, s.id AS sheet_id, s.title AS sheet_title, r.pos, r.qty, r.unit
       FROM catalog_rows r JOIN catalog_sheets s ON s.id = r.sheet_id JOIN machines m ON m.id = s.machine_id
      WHERE r.code = ? ORDER BY m.serial, s.sort LIMIT 1000`,
  ).bind(code).all();
  if (!part && !usedOn.length) fail(404, "Not found.");
  const { results: notes } = await c.env.DB.prepare(
    `SELECT n.id, n.body, n.created_at, n.user_id, u.name AS by_name FROM catalog_notes n JOIN users u ON u.id = n.user_id
      WHERE n.code = ? AND n.deleted_at IS NULL ORDER BY n.created_at DESC`,
  ).bind(code).all();
  return c.json({ part: part ?? { code }, usedOn, notes });
});

catalog.patch("/parts/:code", async (c) => {
  const u = requirePerm(c, "catalog.edit");
  const code = cleanPartCode(c.req.param("code"));
  if (!code) fail(404, "Not found.");
  const b = await body(c);
  const cur = await c.env.DB.prepare("SELECT * FROM catalog_parts WHERE code = ?").bind(code).first<{ rev: string | null; name_en: string; name_it: string; maker: string | null; maker_pn: string | null; wear: number }>();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO catalog_parts (code, rev, name_en, name_it, maker, maker_pn, wear, updated_at) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (code) DO UPDATE SET rev = excluded.rev, name_en = excluded.name_en, name_it = excluded.name_it,
       maker = excluded.maker, maker_pn = excluded.maker_pn, wear = excluded.wear, updated_at = excluded.updated_at`,
  ).bind(
    code,
    b.rev === undefined ? (cur?.rev ?? null) : str(b.rev, 4),
    b.nameEn === undefined ? (cur?.name_en ?? "") : (str(b.nameEn, 300) ?? ""),
    b.nameIt === undefined ? (cur?.name_it ?? "") : (str(b.nameIt, 300) ?? ""),
    b.maker === undefined ? (cur?.maker ?? null) : str(b.maker, 100),
    b.makerPn === undefined ? (cur?.maker_pn ?? null) : str(b.makerPn, 100),
    b.wear === undefined ? (cur?.wear ?? 0) : (b.wear ? 1 : 0),
    t,
  ).run();
  await audit(c.env.DB, { userId: u.id, action: "catalog.part.update", targetType: "catalog_part", targetId: code, ip: c.get("ip") });
  return c.json({ ok: true });
});

catalog.post("/parts/:code/notes", async (c) => {
  const u = requirePerm(c, "catalog.view");
  const code = cleanPartCode(c.req.param("code"));
  if (!code) fail(404, "Not found.");
  const b = await body(c);
  const id = randomId();
  await c.env.DB.prepare("INSERT INTO catalog_notes (id, code, user_id, body, created_at) VALUES (?,?,?,?,?)").bind(id, code, u.id, mustStr(b.body, 4000, "Note"), now()).run();
  return c.json({ id });
});

catalog.delete("/notes/:id", async (c) => {
  const u = requirePerm(c, "catalog.view");
  const n = await c.env.DB.prepare("SELECT id, user_id FROM catalog_notes WHERE id = ? AND deleted_at IS NULL").bind(c.req.param("id")).first<{ id: string; user_id: string }>();
  if (!n) fail(404, "Not found.");
  if (n.user_id !== u.id && !has(u, "catalog.edit")) fail(403, "Only the writer or a catalog editor can remove a note.");
  await c.env.DB.prepare("UPDATE catalog_notes SET deleted_at = ? WHERE id = ?").bind(now(), n.id).run();
  await audit(c.env.DB, { userId: u.id, action: "catalog.note.delete", targetType: "catalog_note", targetId: n.id, ip: c.get("ip") });
  return c.json({ ok: true });
});

// ---------- Publish to the customer parts site ----------

/** Every customer name and site in the registry, so none of them can ride along in a title or part name. */
async function privateTerms(db: Db) {
  const { results } = await db.prepare("SELECT customer, site FROM machines").all<{ customer: string | null; site: string | null }>();
  return {
    customers: [...new Set(results.map((r) => r.customer).filter((v): v is string => !!v))],
    sites: [...new Set(results.map((r) => r.site).filter((v): v is string => !!v))],
    serials: [],
  };
}

catalog.post("/machines/:id/publish", async (c) => {
  const u = requirePerm(c, "catalog.publish");
  const db = c.env.DB;
  const m = await machineById(db, c.req.param("id"));
  const { results: sheets } = await db.prepare("SELECT * FROM catalog_sheets WHERE machine_id = ? ORDER BY sort").bind(m.id).all<SheetRec>();
  if (!sheets.length) fail(400, "This machine has no catalog yet. Import its manual first.");
  const { results: rows } = await db.prepare(
    `SELECT r.sheet_id, r.id, r.pos, r.code, r.qty, r.unit, r.hotspots FROM catalog_rows r JOIN catalog_sheets s ON s.id = r.sheet_id WHERE s.machine_id = ? ORDER BY r.sort`,
  ).bind(m.id).all<{ sheet_id: string; id: string; pos: string; code: string; qty: number | null; unit: string | null; hotspots: string | null }>();
  const codes = [...new Set([...rows.map((r) => r.code), ...sheets.map((s) => s.code).filter((v): v is string => !!v)])];
  const parts: { code: string; rev: string | null; name_en: string; name_it: string; maker: string | null; maker_pn: string | null; wear: number }[] = [];
  for (let i = 0; i < codes.length; i += 90) {
    const chunk = codes.slice(i, i + 90);
    const r = await db.prepare(`SELECT code, rev, name_en, name_it, maker, maker_pn, wear FROM catalog_parts WHERE code IN (${chunk.map(() => "?").join(",")})`).bind(...chunk).all<typeof parts[number]>();
    parts.push(...r.results);
  }

  // The wall: refuse if any customer name or site appears in text that would be published.
  const text = [
    m.model ?? "",
    ...sheets.flatMap((s) => [s.title, s.title_it, s.grp ?? ""]),
    ...parts.flatMap((p) => [p.name_en, p.name_it, p.maker ?? "", p.maker_pn ?? ""]),
  ].join("\n");
  const found = scanForCustomerData(text, await privateTerms(db))
    // The machine's own number is meant to be there. Part codes never match the machine-number pattern.
    .filter((f) => !(f.kind === "machine_number" && f.match.toUpperCase() === m.serial.toUpperCase()));
  if (found.length) {
    fail(400, `Not published: the catalog text contains ${found.slice(0, 5).map((f) => `"${f.match}"`).join(", ")}. Remove customer names, sites and other machine numbers first.`);
  }

  const bySheet = new Map<string, typeof rows>();
  for (const r of rows) (bySheet.get(r.sheet_id) ?? bySheet.set(r.sheet_id, []).get(r.sheet_id)!).push(r);
  const res = await partsCall<{ sheets: number; parts: number }>(c.env, "/publish", {
    body: {
      by: u.id,
      machine: { serial: m.serial, model: m.model },
      sheets: sheets.map((s) => ({
        id: s.id, parentId: s.parent_id, section: s.section, grp: s.grp, code: s.code, rev: s.rev, title: s.title, titleIt: s.title_it,
        imageW: s.image_w, imageH: s.image_h, modelSize: s.model_size, meshMap: s.mesh_map ? JSON.parse(s.mesh_map) : null,
        rows: (bySheet.get(s.id) ?? []).map((r) => ({ id: r.id, pos: r.pos, code: r.code, qty: r.qty, unit: r.unit, hotspots: r.hotspots ? JSON.parse(r.hotspots) : [] })),
      })),
      parts: parts.map((p) => ({ code: p.code, rev: p.rev, nameEn: p.name_en, nameIt: p.name_it, maker: p.maker, makerPn: p.maker_pn, wear: !!p.wear })),
    },
  });
  await db.prepare("UPDATE machines SET catalog_published_at = ? WHERE id = ?").bind(now(), m.id).run();
  await audit(db, { userId: u.id, action: "catalog.publish", targetType: "machine", targetId: m.id, detail: res, ip: c.get("ip") });
  const files = sheets.filter((s) => s.image_w || s.model_size).map((s) => s.id);
  return c.json({ ok: true, sheets: res.sheets, parts: res.parts, files });
});

/**
 * Copy drawings and 3D models to the parts site, a few sheets per call so no single request runs
 * long. The app calls this with the list publish returned until it's done.
 */
catalog.post("/machines/:id/publish/files", async (c) => {
  requirePerm(c, "catalog.publish");
  const m = await machineById(c.env.DB, c.req.param("id"));
  const b = await body(c);
  const ids = Array.isArray(b.sheets) ? (b.sheets as unknown[]).filter((v): v is string => typeof v === "string" && ID.test(v)).slice(0, 10) : [];
  let copied = 0;
  for (const id of ids) {
    const s = await c.env.DB.prepare("SELECT id, image_w, model_size, model_ref FROM catalog_sheets WHERE id = ? AND machine_id = ?").bind(id, m.id).first<{ id: string; image_w: number | null; model_size: number | null; model_ref: string | null }>();
    if (!s) continue;
    for (const file of ["drawing", "model"] as const) {
      if (file === "drawing" ? !s.image_w : !s.model_size) continue;
      const obj = await c.env.FILES.get(file === "model" ? modelKey(s) : fileKey(s.id, file));
      if (!obj) continue;
      await partsCall(c.env, `/files/sheets/${s.id}/${file}`, { method: "PUT", raw: obj.body, type: obj.httpMetadata?.contentType ?? (file === "model" ? "model/gltf-binary" : "image/webp") });
      copied++;
    }
  }
  return c.json({ ok: true, copied });
});

catalog.delete("/machines/:id/publish", async (c) => {
  const u = requirePerm(c, "catalog.publish");
  const m = await machineById(c.env.DB, c.req.param("id"));
  await partsCall(c.env, `/machines/${encodeURIComponent(m.serial)}`, { method: "DELETE" });
  await c.env.DB.prepare("UPDATE machines SET catalog_published_at = NULL WHERE id = ?").bind(m.id).run();
  await audit(c.env.DB, { userId: u.id, action: "catalog.unpublish", targetType: "machine", targetId: m.id, ip: c.get("ip") });
  return c.json({ ok: true });
});

