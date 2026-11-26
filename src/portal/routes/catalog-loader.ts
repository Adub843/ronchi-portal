// The PC catalog loader's door (scripts/cad-load.ts): it reads a machine's parts lists and puts a
// 3D model (GLB) on each one, so every machine with a manual and a CAD file gets its 3D catalog
// without someone uploading each machine by hand (Aaron, 2026-11-26: "every machine if it has a
// manual should have a 3d rendering parts catalog").
//
// No staff session: every call needs the loader key (Authorization: Bearer ...), whose SHA-256 is
// the CATALOG_LOADER_KEY_HASH secret. With no secret set, the loader is switched off (404).
// It can only read machine numbers, parts-list numbers and titles, save or remove 3D models, and
// save what it read from a machine's own manual (parts lists and one picture per drawing), for the
// machines whose manual nobody has imported by hand (Aaron, 2026-11-26: "you take the manual and
// build a 3d rendering off of that for all the machine that dont have one").
import { Hono } from "hono";
import { sameText, sha256Hex } from "../../shared/crypto";
import type { AppEnv } from "../env";
import { audit } from "../lib/db";
import { fail } from "../lib/http";
import { importManual, linkSheetModel, removeSheetModel, saveSheetFile, sheetById } from "./catalog";

export const catalogLoader = new Hono<AppEnv>();

catalogLoader.use("*", async (c, next) => {
  const want = c.env.CATALOG_LOADER_KEY_HASH;
  const got = /^Bearer (.{32,200})$/.exec(c.req.header("authorization") ?? "")?.[1];
  if (!want || !got || !sameText(await sha256Hex(got), want.toLowerCase())) {
    if (want) await audit(c.env.DB, { userId: null, action: "catalog.loader.refused", ip: c.get("ip") });
    fail(404, "Not found.");
  }
  await next();
});

/** Every machine with its parts lists: what the loader needs to match a CAD file to parts lists. */
catalogLoader.get("/machines", async (c) => {
  const { results: machines } = await c.env.DB.prepare("SELECT id, serial, model FROM machines ORDER BY serial").all<{ id: string; serial: string; model: string | null }>();
  const { results: sheets } = await c.env.DB.prepare(
    "SELECT id, machine_id, code, title, source, model_size IS NOT NULL AS has_model, image_w IS NOT NULL AS has_drawing FROM catalog_sheets ORDER BY machine_id, sort",
  ).all<{ id: string; machine_id: string; code: string | null; title: string; source: string; has_model: number; has_drawing: number }>();
  const by = new Map<string, { id: string; code: string | null; title: string; source: string; has_model: boolean; has_drawing: boolean }[]>();
  for (const s of sheets) {
    if (!by.has(s.machine_id)) by.set(s.machine_id, []);
    by.get(s.machine_id)!.push({ id: s.id, code: s.code, title: s.title, source: s.source, has_model: !!s.has_model, has_drawing: !!s.has_drawing });
  }
  return c.json({ machines: machines.map((m) => ({ serial: m.serial, model: m.model, sheets: by.get(m.id) ?? [] })) });
});

/** Put a 3D model on one parts list. Same checks as a staff upload (GLB only, 95 MB at most). */
catalogLoader.put("/sheets/:id/model", async (c) => {
  const s = await sheetById(c.env.DB, c.req.param("id"));
  const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
  await saveSheetFile(c.env, s, "model", type, await c.req.arrayBuffer(), {}, { userId: null, ip: c.get("ip"), action: "catalog.model.load" });
  return c.json({ ok: true });
});

/** Put a model the portal already holds on another parts list: send its SHA-256, no file. 404 means send the file. */
catalogLoader.put("/sheets/:id/model-ref", async (c) => {
  const s = await sheetById(c.env.DB, c.req.param("id"));
  const b = (await c.req.json().catch(() => ({}))) as { sha256?: unknown };
  await linkSheetModel(c.env, s, typeof b.sha256 === "string" ? b.sha256.toLowerCase() : "", { userId: null, ip: c.get("ip"), action: "catalog.model.load" });
  return c.json({ ok: true, shared: true });
});

/** Take a 3D model off one parts list (a wrong or empty match). */
catalogLoader.delete("/sheets/:id/model", async (c) => {
  await removeSheetModel(c.env, await sheetById(c.env.DB, c.req.param("id")), { userId: null, ip: c.get("ip"), action: "catalog.model.unload" });
  return c.json({ ok: true });
});

/**
 * Save the parts lists read from a machine's manual on the PC. Same rules as the staff import:
 * it replaces only the machine's parts lists that came from a manual. The machine must already
 * be in the portal (404 if not): the loader never makes machines.
 */
catalogLoader.post("/machines/:serial/import", async (c) => {
  const m = await c.env.DB.prepare("SELECT id FROM machines WHERE serial = ? COLLATE NOCASE").bind(c.req.param("serial")).first<{ id: string }>();
  if (!m) fail(404, "No machine with that number.");
  const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") fail(400, "Send the parts lists.");
  return c.json(await importManual(c.env, m, b, { userId: null, ip: c.get("ip") }));
});

/** Save the manual page that goes with one parts list (WebP or PNG, with ?w= and ?h= in pixels). */
catalogLoader.put("/sheets/:id/drawing", async (c) => {
  const s = await sheetById(c.env.DB, c.req.param("id"));
  const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
  await saveSheetFile(c.env, s, "drawing", type, await c.req.arrayBuffer(), { w: Number(c.req.query("w")), h: Number(c.req.query("h")) }, { userId: null, ip: c.get("ip"), action: "catalog.drawing.load" });
  return c.json({ ok: true });
});
