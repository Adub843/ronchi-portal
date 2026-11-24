// The catalog a customer sees: their machines, each machine's drawings and parts, search and
// where-used. Every route goes through lib/access.ts, so a company only ever reaches its own machines.
import { Hono } from "hono";
import type { PartsApp } from "../env";
import { companySerials, requireMachine, requireSheet } from "../lib/access";
import { fail, requireCustomer } from "../lib/http";

export const catalog = new Hono<PartsApp>();

catalog.get("/machines", async (c) => {
  const u = requireCustomer(c);
  const { results } = await c.env.PARTS_DB.prepare(
    `SELECT m.serial, m.model, cm.label, m.published_at,
            (SELECT COUNT(*) FROM sheets s WHERE s.serial = m.serial) AS sheets,
            (SELECT COUNT(*) FROM sheets s WHERE s.serial = m.serial AND s.model_size IS NOT NULL) AS models
       FROM company_machines cm JOIN machines m ON m.serial = cm.serial
      WHERE cm.company_id = ? ORDER BY m.serial`,
  ).bind(u.companyId).all();
  return c.json({ machines: results });
});

catalog.get("/machines/:serial", async (c) => {
  const u = requireCustomer(c);
  const m = await requireMachine(c.env.PARTS_DB, u, c.req.param("serial"));
  const { results } = await c.env.PARTS_DB.prepare(
    `SELECT id, parent_id, section, grp, code, rev, title, sort, image_w IS NOT NULL AS has_drawing, model_size IS NOT NULL AS has_model,
            (SELECT COUNT(*) FROM sheet_rows r WHERE r.sheet_id = s.id) AS rows
       FROM sheets s WHERE serial = ? ORDER BY sort`,
  ).bind(m.serial).all();
  return c.json({ machine: m, sheets: results });
});

catalog.get("/sheets/:id", async (c) => {
  const u = requireCustomer(c);
  const s = await requireSheet(c.env.PARTS_DB, u, c.req.param("id"));
  const { results: rows } = await c.env.PARTS_DB.prepare(
    `SELECT r.id, r.pos, r.code, r.qty, r.unit, r.hotspots, p.rev, p.name_en, p.name_it, p.maker, p.maker_pn, p.wear,
            (SELECT id FROM sheets c WHERE c.serial = ? AND c.code = r.code AND c.id <> r.sheet_id LIMIT 1) AS sub_sheet
       FROM sheet_rows r LEFT JOIN parts p ON p.code = r.code WHERE r.sheet_id = ? ORDER BY r.sort`,
  ).bind(s.serial, s.id).all();
  const siblings = await c.env.PARTS_DB.prepare("SELECT id FROM sheets WHERE serial = ? ORDER BY sort").bind(s.serial).all<{ id: string }>();
  const ids = siblings.results.map((r) => r.id);
  const at = ids.indexOf(s.id);
  const path: { id: string; title: string; code: string | null }[] = [];
  let parent = s.parent_id;
  for (let i = 0; parent && i < 10; i++) {
    const p = await c.env.PARTS_DB.prepare("SELECT id, title, code, parent_id FROM sheets WHERE id = ? AND serial = ?").bind(parent, s.serial).first<{ id: string; title: string; code: string | null; parent_id: string | null }>();
    if (!p) break;
    path.unshift({ id: p.id, title: p.title, code: p.code });
    parent = p.parent_id;
  }
  return c.json({
    sheet: {
      id: s.id, serial: s.serial, section: s.section, group: s.grp, code: s.code, rev: s.rev, title: s.title,
      drawing: s.image_w ? { w: s.image_w, h: s.image_h } : null,
      model: s.model_size ? { size: s.model_size, meshMap: s.mesh_map ? JSON.parse(s.mesh_map) : {} } : null,
      prev: at > 0 ? ids[at - 1] : null,
      next: at >= 0 && at < ids.length - 1 ? ids[at + 1] : null,
      path,
    },
    rows: rows.map((r: any) => ({ ...r, hotspots: r.hotspots ? JSON.parse(r.hotspots) : [], wear: !!r.wear })),
  });
});

/** The drawing image or 3D model, only for a sheet on one of the company's machines. */
catalog.get("/sheets/:id/:file{drawing|model}", async (c) => {
  const u = requireCustomer(c);
  const s = await requireSheet(c.env.PARTS_DB, u, c.req.param("id"));
  const file = c.req.param("file");
  const obj = await c.env.PARTS_FILES.get(`sheets/${s.id}/${file === "model" ? "model.glb" : "drawing"}`);
  if (!obj) fail(404, "Not found.");
  return new Response(obj.body, {
    headers: {
      "Content-Type": file === "model" ? "model/gltf-binary" : (obj.httpMetadata?.contentType === "image/png" ? "image/png" : "image/webp"),
      "Content-Length": String(obj.size),
      "Cache-Control": "private, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});

/** Search the company's own machines by part code or name. */
catalog.get("/search", async (c) => {
  const u = requireCustomer(c);
  const q = (c.req.query("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return c.json({ results: [] });
  const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
  const { results } = await c.env.PARTS_DB.prepare(
    `SELECT r.code, p.name_en, p.name_it, s.id AS sheet_id, s.title AS sheet_title, s.serial, r.pos, r.qty
       FROM sheet_rows r
       JOIN sheets s ON s.id = r.sheet_id
       JOIN company_machines cm ON cm.serial = s.serial AND cm.company_id = ?
       LEFT JOIN parts p ON p.code = r.code
      WHERE r.code LIKE ? ESCAPE '\\' OR p.name_en LIKE ? ESCAPE '\\' OR p.name_it LIKE ? ESCAPE '\\' OR p.maker_pn LIKE ? ESCAPE '\\'
      ORDER BY (r.code = ?) DESC, r.code, s.serial LIMIT 200`,
  ).bind(u.companyId, like, like, like, like, q.toUpperCase()).all();
  return c.json({ results });
});

/** One part: its names and where it's used, on this company's machines only. */
catalog.get("/parts/:code", async (c) => {
  const u = requireCustomer(c);
  const code = c.req.param("code").toUpperCase();
  if (!/^[A-Z0-9_]{4,20}$/.test(code)) fail(404, "Not found.");
  const serials = await companySerials(c.env.PARTS_DB, u);
  if (!serials.length) fail(404, "Not found.");
  const { results: used } = await c.env.PARTS_DB.prepare(
    `SELECT s.serial, s.id AS sheet_id, s.title AS sheet_title, r.pos, r.qty, r.unit
       FROM sheet_rows r JOIN sheets s ON s.id = r.sheet_id
       JOIN company_machines cm ON cm.serial = s.serial AND cm.company_id = ?
      WHERE r.code = ? ORDER BY s.serial, s.sort`,
  ).bind(u.companyId, code).all();
  if (!used.length) fail(404, "Not found.");
  const part = await c.env.PARTS_DB.prepare("SELECT code, rev, name_en, name_it, maker, maker_pn, wear FROM parts WHERE code = ?").bind(code).first();
  return c.json({ part: part ?? { code }, usedOn: used });
});

/** Parts that wear out, for a machine: a suggested spares list to keep on the shelf. */
catalog.get("/machines/:serial/spares", async (c) => {
  const u = requireCustomer(c);
  const m = await requireMachine(c.env.PARTS_DB, u, c.req.param("serial"));
  const { results } = await c.env.PARTS_DB.prepare(
    `SELECT r.code, p.name_en, p.name_it, SUM(r.qty) AS qty, MIN(r.unit) AS unit, MIN(s.id) AS sheet_id
       FROM sheet_rows r JOIN sheets s ON s.id = r.sheet_id JOIN parts p ON p.code = r.code
      WHERE s.serial = ? AND p.wear = 1 GROUP BY r.code ORDER BY r.code`,
  ).bind(m.serial).all();
  return c.json({ spares: results });
});
