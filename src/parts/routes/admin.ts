// The staff portal's door into the customer parts site. One way only: the portal calls in;
// the parts site has no way to call the portal or read the business store.
//
// Used for: publishing a machine's catalog, setting up customer companies, their machines and
// logins, and reading quote requests. Every call needs the publish key (Authorization: Bearer ...),
// whose SHA-256 is the ADMIN_KEY_HASH secret. With no secret set, all of /admin is switched off.
import { Hono } from "hono";
import { randomId, sameText, sha256Hex } from "../../shared/crypto";
import { cleanPartCode, SECTIONS } from "../../shared/catalog/model";
import type { PartsApp } from "../env";
import { audit, body, fail, mustStr, now, str } from "../lib/http";
import { createCustomerInvite } from "./auth";

export const admin = new Hono<PartsApp>();

admin.use("*", async (c, next) => {
  const want = c.env.ADMIN_KEY_HASH;
  const got = /^Bearer (.{32,200})$/.exec(c.req.header("authorization") ?? "")?.[1];
  if (!want || !got || !sameText(await sha256Hex(got), want.toLowerCase())) {
    await audit(c.env.PARTS_DB, { action: "admin.refused", ip: c.get("ip") });
    fail(404, "Not found.");
  }
  await next();
});

const SERIAL = /^\d{4}[A-Z]{1,3}$/;
const ID = /^[A-Za-z0-9_-]{8,40}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null);

// ---------- Companies, machines, logins ----------

admin.get("/companies", async (c) => {
  const { results: companies } = await c.env.PARTS_DB.prepare("SELECT id, name, status, created_at FROM companies ORDER BY name").all<{ id: string }>();
  const { results: users } = await c.env.PARTS_DB.prepare(
    "SELECT u.id, u.company_id, u.name, u.email, u.role, u.status, (SELECT MAX(last_used_at) FROM passkeys p WHERE p.user_id = u.id) AS last_sign_in FROM users u ORDER BY u.name",
  ).all<{ company_id: string }>();
  const { results: machines } = await c.env.PARTS_DB.prepare(
    "SELECT cm.company_id, cm.serial, cm.label, m.published_at FROM company_machines cm LEFT JOIN machines m ON m.serial = cm.serial ORDER BY cm.serial",
  ).all<{ company_id: string }>();
  const { results: invites } = await c.env.PARTS_DB.prepare(
    "SELECT id, company_id, name, email, role, expires_at FROM invites WHERE used_at IS NULL AND user_id IS NULL AND expires_at > ? ORDER BY created_at DESC",
  ).bind(now()).all<{ company_id: string }>();
  return c.json({
    companies: companies.map((co) => ({
      ...co,
      users: users.filter((u) => u.company_id === co.id),
      machines: machines.filter((m) => m.company_id === co.id),
      invites: invites.filter((i) => i.company_id === co.id),
    })),
  });
});

admin.post("/companies", async (c) => {
  const b = await body(c);
  const id = randomId();
  const t = now();
  await c.env.PARTS_DB.prepare("INSERT INTO companies (id, name, status, created_at, updated_at) VALUES (?,?, 'active', ?,?)").bind(id, mustStr(b.name, 200, "Company name"), t, t).run();
  await audit(c.env.PARTS_DB, { companyId: id, action: "company.create", detail: { by: str(b.by, 100) } });
  return c.json({ id });
});

admin.patch("/companies/:id", async (c) => {
  const id = c.req.param("id");
  const b = await body(c);
  const co = await c.env.PARTS_DB.prepare("SELECT id, name, status FROM companies WHERE id = ?").bind(id).first<{ id: string; name: string; status: string }>();
  if (!co) fail(404, "Not found.");
  const status = b.status === "disabled" || b.status === "active" ? b.status : co.status;
  const stmts = [c.env.PARTS_DB.prepare("UPDATE companies SET name = ?, status = ?, updated_at = ? WHERE id = ?").bind(str(b.name, 200) ?? co.name, status, now(), id)];
  if (status === "disabled") stmts.push(c.env.PARTS_DB.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)").bind(id));
  await c.env.PARTS_DB.batch(stmts);
  await audit(c.env.PARTS_DB, { companyId: id, action: "company.update", detail: { status, by: str(b.by, 100) } });
  return c.json({ ok: true });
});

/** Set exactly which machines a company owns. */
admin.put("/companies/:id/machines", async (c) => {
  const id = c.req.param("id");
  if (!(await c.env.PARTS_DB.prepare("SELECT 1 FROM companies WHERE id = ?").bind(id).first())) fail(404, "Not found.");
  const b = await body(c);
  if (!Array.isArray(b.machines) || b.machines.length > 500) fail(400, "Send the list of machines.");
  const list = (b.machines as unknown[]).map((m) => {
    const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
    const serial = String(o.serial ?? "").trim().toUpperCase();
    if (!SERIAL.test(serial)) fail(400, `"${serial}" isn't a machine number like 3651MB.`);
    return { serial, label: str(o.label, 100) };
  });
  const t = now();
  await c.env.PARTS_DB.batch([
    c.env.PARTS_DB.prepare("DELETE FROM company_machines WHERE company_id = ?").bind(id),
    ...list.map((m) => c.env.PARTS_DB.prepare("INSERT OR IGNORE INTO company_machines (company_id, serial, label, added_at) VALUES (?,?,?,?)").bind(id, m.serial, m.label, t)),
  ]);
  await audit(c.env.PARTS_DB, { companyId: id, action: "company.machines", detail: { serials: list.map((m) => m.serial), by: str(b.by, 100) } });
  return c.json({ ok: true });
});

admin.post("/companies/:id/invites", async (c) => {
  const id = c.req.param("id");
  const co = await c.env.PARTS_DB.prepare("SELECT id FROM companies WHERE id = ? AND status = 'active'").bind(id).first();
  if (!co) fail(404, "Not found.");
  const b = await body(c);
  const email = mustStr(b.email, 254, "Email").toLowerCase();
  if (!EMAIL.test(email)) fail(400, "That email address doesn't look right.");
  const role = b.role === "buyer" ? "buyer" : "standard";
  const existing = await c.env.PARTS_DB.prepare("SELECT id, company_id FROM users WHERE email = ?").bind(email).first<{ id: string; company_id: string }>();
  if (existing && existing.company_id !== id) fail(409, "That email already has a login with another company.");
  const link = await createCustomerInvite(c.env, { companyId: id, email, name: mustStr(b.name, 100, "Name"), role, userId: existing?.id });
  await audit(c.env.PARTS_DB, { companyId: id, action: "invite.create", detail: { email, role, by: str(b.by, 100) } });
  return c.json({ link });
});

admin.patch("/users/:id", async (c) => {
  const id = c.req.param("id");
  const b = await body(c);
  const u = await c.env.PARTS_DB.prepare("SELECT id, company_id, role, status FROM users WHERE id = ?").bind(id).first<{ id: string; company_id: string; role: string; status: string }>();
  if (!u) fail(404, "Not found.");
  const role = b.role === "buyer" || b.role === "standard" ? b.role : u.role;
  const status = b.status === "disabled" || b.status === "active" ? b.status : u.status;
  const stmts = [c.env.PARTS_DB.prepare("UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?").bind(role, status, now(), id)];
  if (status === "disabled") stmts.push(c.env.PARTS_DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id));
  await c.env.PARTS_DB.batch(stmts);
  await audit(c.env.PARTS_DB, { userId: id, companyId: u.company_id, action: "user.update", detail: { role, status, by: str(b.by, 100) } });
  return c.json({ ok: true });
});

admin.delete("/invites/:id", async (c) => {
  await c.env.PARTS_DB.prepare("UPDATE invites SET expires_at = ? WHERE id = ? AND used_at IS NULL").bind(now(), c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---------- Publishing a machine's catalog ----------

/**
 * Replace a machine's published catalog. The portal sends only catalog data: machine number,
 * model, drawings' titles and part tables, part names. Fields that aren't listed here are dropped.
 */
admin.post("/publish", async (c) => {
  const b = await body(c);
  const m = (b.machine ?? {}) as Record<string, unknown>;
  const serial = String(m.serial ?? "").toUpperCase();
  if (!SERIAL.test(serial)) fail(400, "Machine number missing.");
  if (!Array.isArray(b.sheets) || b.sheets.length > 2000) fail(400, "Sheets missing.");
  if (!Array.isArray(b.parts) || b.parts.length > 50000) fail(400, "Parts missing.");
  const t = now();
  const db = c.env.PARTS_DB;

  const sheets = (b.sheets as Record<string, unknown>[]).map((s, i) => {
    const id = String(s.id ?? "");
    if (!ID.test(id)) fail(400, "Bad sheet id.");
    const section = SECTIONS.includes(s.section as never) ? (s.section as string) : "machine";
    const rows = Array.isArray(s.rows) ? (s.rows as Record<string, unknown>[]) : [];
    if (rows.length > 2000) fail(400, "Too many rows on one sheet.");
    return {
      id, section, sort: i,
      parentId: typeof s.parentId === "string" && ID.test(s.parentId) ? s.parentId : null,
      grp: str(s.grp, 200), code: cleanPartCode(s.code), rev: str(s.rev, 4),
      title: str(s.title, 300) ?? "", titleIt: str(s.titleIt, 300) ?? "",
      imageW: num(s.imageW, 20000), imageH: num(s.imageH, 20000), modelSize: num(s.modelSize, 200_000_000),
      meshMap: s.meshMap && typeof s.meshMap === "object" ? JSON.stringify(s.meshMap).slice(0, 500_000) : null,
      rows: rows.map((r, j) => {
        const code = cleanPartCode(r.code);
        if (!code) fail(400, `Bad part code on sheet ${id}.`);
        const hs = Array.isArray(r.hotspots) ? (r.hotspots as Record<string, unknown>[]).slice(0, 50).map((h) => ({ x: num(h.x, 1) ?? 0, y: num(h.y, 1) ?? 0, w: num(h.w, 1) ?? 0, h: num(h.h, 1) ?? 0 })) : [];
        return { id: typeof r.id === "string" && ID.test(r.id) ? r.id : randomId(), pos: str(r.pos, 10) ?? "", code, qty: num(r.qty, 100000), unit: r.unit === "m" ? "m" : null, hotspots: JSON.stringify(hs), sort: j };
      }),
    };
  });
  const parts = (b.parts as Record<string, unknown>[]).map((p) => {
    const code = cleanPartCode(p.code);
    if (!code) fail(400, "Bad part code.");
    return { code, rev: str(p.rev, 4), nameEn: str(p.nameEn, 300) ?? "", nameIt: str(p.nameIt, 300) ?? "", maker: str(p.maker, 100), makerPn: str(p.makerPn, 100), wear: p.wear ? 1 : 0 };
  });

  // Drawings and models of sheets that are gone get deleted from storage too.
  const old = await db.prepare("SELECT id FROM sheets WHERE serial = ?").bind(serial).all<{ id: string }>();
  const keep = new Set(sheets.map((s) => s.id));
  const gone = old.results.map((r) => r.id).filter((id) => !keep.has(id));

  const stmts: D1PreparedStatement[] = [
    db.prepare("INSERT INTO machines (serial, model, published_at) VALUES (?,?,?) ON CONFLICT (serial) DO UPDATE SET model = excluded.model, published_at = excluded.published_at").bind(serial, str(m.model, 100), t),
    db.prepare("DELETE FROM sheet_rows WHERE sheet_id IN (SELECT id FROM sheets WHERE serial = ?)").bind(serial),
    db.prepare("DELETE FROM sheets WHERE serial = ?").bind(serial),
  ];
  for (const p of parts) {
    stmts.push(db.prepare(
      `INSERT INTO parts (code, rev, name_en, name_it, maker, maker_pn, wear) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT (code) DO UPDATE SET rev = excluded.rev, name_en = excluded.name_en, name_it = excluded.name_it, maker = excluded.maker, maker_pn = excluded.maker_pn, wear = excluded.wear`,
    ).bind(p.code, p.rev, p.nameEn, p.nameIt, p.maker, p.makerPn, p.wear));
  }
  for (const s of sheets) {
    stmts.push(db.prepare(
      "INSERT INTO sheets (id, serial, parent_id, section, grp, code, rev, title, title_it, sort, image_w, image_h, model_size, mesh_map) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(s.id, serial, s.parentId, s.section, s.grp, s.code, s.rev, s.title, s.titleIt, s.sort, s.imageW, s.imageH, s.modelSize, s.meshMap));
    for (const r of s.rows) {
      stmts.push(db.prepare("INSERT INTO sheet_rows (id, sheet_id, pos, code, qty, unit, hotspots, sort) VALUES (?,?,?,?,?,?,?,?)").bind(r.id, s.id, r.pos, r.code, r.qty, r.unit, r.hotspots, r.sort));
    }
  }
  // D1 runs a batch as one transaction: customers see the old catalog or the new one, never half.
  for (let i = 0; i < stmts.length; i += 5000) await db.batch(stmts.slice(i, i + 5000));
  if (gone.length) await c.env.PARTS_FILES.delete(gone.flatMap((id) => [`sheets/${id}/drawing`, `sheets/${id}/model.glb`]));
  await audit(db, { action: "catalog.publish", target: serial, detail: { sheets: sheets.length, parts: parts.length, by: str(b.by, 100) } });
  return c.json({ ok: true, sheets: sheets.length, parts: parts.length });
});

/** Upload one published drawing (WebP or PNG) or 3D model (GLB). */
admin.put("/files/sheets/:id/:file{drawing|model}", async (c) => {
  const id = c.req.param("id");
  if (!ID.test(id)) fail(400, "Bad sheet id.");
  const file = c.req.param("file");
  const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
  const allowed = file === "model" ? ["model/gltf-binary"] : ["image/webp", "image/png"];
  if (!allowed.includes(type)) fail(400, "Wrong file type.");
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength > (file === "model" ? 95 : 20) * 1024 * 1024) fail(413, "File too big.");
  await c.env.PARTS_FILES.put(`sheets/${id}/${file === "model" ? "model.glb" : "drawing"}`, bytes, { httpMetadata: { contentType: type } });
  return c.json({ ok: true });
});

/** Take a machine's catalog off the parts site (owners keep the machine on their list, with nothing in it). */
admin.delete("/machines/:serial", async (c) => {
  const serial = c.req.param("serial").toUpperCase();
  if (!SERIAL.test(serial)) fail(400, "Bad machine number.");
  const old = await c.env.PARTS_DB.prepare("SELECT id FROM sheets WHERE serial = ?").bind(serial).all<{ id: string }>();
  await c.env.PARTS_DB.batch([
    c.env.PARTS_DB.prepare("DELETE FROM sheet_rows WHERE sheet_id IN (SELECT id FROM sheets WHERE serial = ?)").bind(serial),
    c.env.PARTS_DB.prepare("DELETE FROM sheets WHERE serial = ?").bind(serial),
    c.env.PARTS_DB.prepare("DELETE FROM machines WHERE serial = ?").bind(serial),
  ]);
  if (old.results.length) await c.env.PARTS_FILES.delete(old.results.flatMap((r) => [`sheets/${r.id}/drawing`, `sheets/${r.id}/model.glb`]));
  await audit(c.env.PARTS_DB, { action: "catalog.unpublish", target: serial });
  return c.json({ ok: true });
});

// ---------- Quote requests ----------

admin.get("/quotes", async (c) => {
  const status = c.req.query("status");
  const { results } = await c.env.PARTS_DB.prepare(
    `SELECT q.id, q.number, q.status, q.email, q.created_at, q.updated_at, co.name AS company, u.name AS sent_by,
            (SELECT COUNT(*) FROM lines l WHERE l.quote_id = q.id) AS items
       FROM quotes q JOIN companies co ON co.id = q.company_id JOIN users u ON u.id = q.user_id
      WHERE (? IS NULL OR q.status = ?) ORDER BY q.created_at DESC LIMIT 500`,
  ).bind(status ?? null, status ?? null).all();
  return c.json({ quotes: results });
});

admin.get("/quotes/:id", async (c) => {
  const q = await c.env.PARTS_DB.prepare(
    `SELECT q.*, co.name AS company, u.name AS sent_by, u.email AS sent_by_email
       FROM quotes q JOIN companies co ON co.id = q.company_id JOIN users u ON u.id = q.user_id WHERE q.id = ?`,
  ).bind(c.req.param("id")).first();
  if (!q) fail(404, "Not found.");
  const { results } = await c.env.PARTS_DB.prepare(
    `SELECT l.code, l.description, l.qty, l.serial, l.note, p.name_en, p.name_it, p.maker, p.maker_pn
       FROM lines l LEFT JOIN parts p ON p.code = l.code WHERE l.quote_id = ? ORDER BY l.created_at`,
  ).bind(c.req.param("id")).all();
  return c.json({ quote: q, lines: results });
});

admin.patch("/quotes/:id", async (c) => {
  const b = await body(c);
  const status = ["sent", "received", "quoted", "closed"].includes(b.status as string) ? (b.status as string) : null;
  if (!status) fail(400, "Pick a status.");
  const r = await c.env.PARTS_DB.prepare("UPDATE quotes SET status = ?, updated_at = ? WHERE id = ?").bind(status, now(), c.req.param("id")).run();
  if (!r.meta.changes) fail(404, "Not found.");
  await audit(c.env.PARTS_DB, { action: "quote.status", target: c.req.param("id"), detail: { status, by: str(b.by, 100) } });
  return c.json({ ok: true });
});
