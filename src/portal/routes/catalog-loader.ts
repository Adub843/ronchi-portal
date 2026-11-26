// The PC catalog loader's door (scripts/cad-load.ts): it reads a machine's parts lists and puts a
// 3D model (GLB) on each one, so every machine with a manual and a CAD file gets its 3D catalog
// without someone uploading each machine by hand (Aaron, 2026-11-26: "every machine if it has a
// manual should have a 3d rendering parts catalog").
//
// No staff session: every call needs the loader key (Authorization: Bearer ...), whose SHA-256 is
// the CATALOG_LOADER_KEY_HASH secret. With no secret set, the loader is switched off (404).
// It can only read machine numbers, parts-list numbers and titles, and save or remove 3D models.
import { Hono } from "hono";
import { sameText, sha256Hex } from "../../shared/crypto";
import type { AppEnv } from "../env";
import { audit } from "../lib/db";
import { fail } from "../lib/http";
import { linkSheetModel, removeSheetModel, saveSheetFile, sheetById } from "./catalog";

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
    "SELECT id, machine_id, code, title, model_size IS NOT NULL AS has_model FROM catalog_sheets ORDER BY machine_id, sort",
  ).all<{ id: string; machine_id: string; code: string | null; title: string; has_model: number }>();
  const by = new Map<string, { id: string; code: string | null; title: string; has_model: boolean }[]>();
  for (const s of sheets) by.set(s.machine_id, [...(by.get(s.machine_id) ?? []), { id: s.id, code: s.code, title: s.title, has_model: !!s.has_model }]);
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
