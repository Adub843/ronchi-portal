// Carts, lists, quote requests and favorites, like the Mario portal's Shopping menu:
//   - a cart is personal; Add to cart puts parts in your active cart
//   - a list is shared with everyone in your company (a technician makes it, the buyer uses it)
//   - a quote request is sent by the company's buyer from a cart; Ronchi America answers by email
// Parts can only be added from the company's own machines. Parts that aren't in the catalog
// (for example a chain from a vendor manual) can be typed in by hand.
import { Hono, type Context } from "hono";
import { randomId } from "../../shared/crypto";
import { toCsv } from "../../shared/csv";
import { cleanPartCode } from "../../shared/catalog/model";
import type { Customer, PartsApp } from "../env";
import { companySerials } from "../lib/access";
import { audit, body, fail, mustStr, now, qty, requireBuyer, requireCustomer, str } from "../lib/http";

export const shop = new Hono<PartsApp>();

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const ID = /^[A-Za-z0-9_-]{8,40}$/;

async function myCart(c: Context<PartsApp>, u: Customer, id: string) {
  if (!ID.test(id)) fail(404, "Not found.");
  const cart = await c.env.PARTS_DB.prepare("SELECT * FROM carts WHERE id = ? AND user_id = ?").bind(id, u.id).first<{ id: string; name: string; notes: string; active: number }>();
  if (!cart) fail(404, "Not found.");
  return cart;
}

async function companyList(c: Context<PartsApp>, u: Customer, id: string) {
  if (!ID.test(id)) fail(404, "Not found.");
  const list = await c.env.PARTS_DB.prepare("SELECT * FROM lists WHERE id = ? AND company_id = ?").bind(id, u.companyId).first<{ id: string; name: string; notes: string; user_id: string }>();
  if (!list) fail(404, "Not found.");
  return list;
}

async function lines(db: D1Database, col: "cart_id" | "list_id" | "quote_id", id: string) {
  const { results } = await db.prepare(
    `SELECT l.id, l.code, l.description, l.qty, l.serial, l.note, p.name_en, p.name_it, p.maker, p.maker_pn
       FROM lines l LEFT JOIN parts p ON p.code = l.code WHERE l.${col} = ? ORDER BY l.created_at`,
  ).bind(id).all();
  return results;
}

/** Check a line typed by a customer: a part on one of their machines, or a described part. */
async function cleanLine(c: Context<PartsApp>, u: Customer, b: Record<string, unknown>) {
  const serials = await companySerials(c.env.PARTS_DB, u);
  const serial = str(b.serial, 12)?.toUpperCase() ?? null;
  if (serial && !serials.some((s) => s.toUpperCase() === serial)) fail(400, "That machine isn't on your account.");
  const code = b.code === undefined || b.code === null || b.code === "" ? null : cleanPartCode(b.code);
  if (b.code && !code) fail(400, "That isn't a Ronchi part number.");
  if (code) {
    // Only parts that appear on one of the company's own machines.
    const onMine = await c.env.PARTS_DB.prepare(
      `SELECT 1 FROM sheet_rows r JOIN sheets s ON s.id = r.sheet_id JOIN company_machines cm ON cm.serial = s.serial AND cm.company_id = ? WHERE r.code = ? LIMIT 1`,
    ).bind(u.companyId, code).first();
    if (!onMine) fail(400, "That part isn't in your machines' catalog. Add it as a part typed by hand instead.");
  }
  const description = str(b.description, 300) ?? "";
  if (!code && !description) fail(400, "Describe the part (maker, model, size).");
  return { code, description, qty: qty(b.qty ?? 1), serial, note: str(b.note, 500) ?? "" };
}

// ---------- Carts ----------

shop.get("/carts", async (c) => {
  const u = requireCustomer(c);
  const { results } = await c.env.PARTS_DB.prepare(
    `SELECT c.id, c.name, c.active, c.updated_at, (SELECT COUNT(*) FROM lines l WHERE l.cart_id = c.id) AS items
       FROM carts c WHERE c.user_id = ? ORDER BY c.active DESC, c.updated_at DESC`,
  ).bind(u.id).all();
  return c.json({ carts: results });
});

shop.post("/carts", async (c) => {
  const u = requireCustomer(c);
  const b = await body(c);
  const id = randomId();
  const t = now();
  const name = str(b.name, 100) ?? new Date().toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  await c.env.PARTS_DB.batch([
    c.env.PARTS_DB.prepare("UPDATE carts SET active = 0 WHERE user_id = ?").bind(u.id),
    c.env.PARTS_DB.prepare("INSERT INTO carts (id, company_id, user_id, name, active, created_at, updated_at) VALUES (?,?,?,?,1,?,?)").bind(id, u.companyId, u.id, name, t, t),
  ]);
  return c.json({ id });
});

/** The active cart (made on first use), with its lines. */
shop.get("/carts/active", async (c) => {
  const u = requireCustomer(c);
  const cart = await c.env.PARTS_DB.prepare("SELECT id, name, notes FROM carts WHERE user_id = ? AND active = 1").bind(u.id).first<{ id: string; name: string; notes: string }>();
  if (!cart) return c.json({ cart: null, lines: [] });
  return c.json({ cart, lines: await lines(c.env.PARTS_DB, "cart_id", cart.id) });
});

shop.get("/carts/:id", async (c) => {
  const u = requireCustomer(c);
  const cart = await myCart(c, u, c.req.param("id"));
  return c.json({ cart, lines: await lines(c.env.PARTS_DB, "cart_id", cart.id) });
});

shop.patch("/carts/:id", async (c) => {
  const u = requireCustomer(c);
  const cart = await myCart(c, u, c.req.param("id"));
  const b = await body(c);
  const stmts = [];
  if (b.active === true) stmts.push(c.env.PARTS_DB.prepare("UPDATE carts SET active = (id = ?) WHERE user_id = ?").bind(cart.id, u.id));
  stmts.push(c.env.PARTS_DB.prepare("UPDATE carts SET name = ?, notes = ?, updated_at = ? WHERE id = ?")
    .bind(str(b.name, 100) ?? cart.name, typeof b.notes === "string" ? (str(b.notes, 2000) ?? "") : cart.notes, now(), cart.id));
  await c.env.PARTS_DB.batch(stmts);
  return c.json({ ok: true });
});

shop.delete("/carts/:id", async (c) => {
  const u = requireCustomer(c);
  const cart = await myCart(c, u, c.req.param("id"));
  await c.env.PARTS_DB.batch([
    c.env.PARTS_DB.prepare("DELETE FROM lines WHERE cart_id = ?").bind(cart.id),
    c.env.PARTS_DB.prepare("DELETE FROM carts WHERE id = ?").bind(cart.id),
  ]);
  return c.json({ ok: true });
});

/** Add a part. With no cart id, it goes in the active cart (made if there isn't one). */
shop.post("/carts/:id/lines", async (c) => {
  const u = requireCustomer(c);
  let cartId = c.req.param("id");
  if (cartId === "active") {
    const active = await c.env.PARTS_DB.prepare("SELECT id FROM carts WHERE user_id = ? AND active = 1").bind(u.id).first<{ id: string }>();
    if (active) cartId = active.id;
    else {
      cartId = randomId();
      const t = now();
      await c.env.PARTS_DB.prepare("INSERT INTO carts (id, company_id, user_id, name, active, created_at, updated_at) VALUES (?,?,?,?,1,?,?)")
        .bind(cartId, u.companyId, u.id, new Date().toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }), t, t).run();
    }
  }
  const cart = await myCart(c, u, cartId);
  const line = await cleanLine(c, u, await body(c));
  const count = await c.env.PARTS_DB.prepare("SELECT COUNT(*) AS n FROM lines WHERE cart_id = ?").bind(cart.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= 500) fail(400, "A cart holds up to 500 lines. Start a new cart.");
  // Same part for the same machine: add to the quantity instead of a second line.
  const same = line.code
    ? await c.env.PARTS_DB.prepare("SELECT id, qty FROM lines WHERE cart_id = ? AND code = ? AND IFNULL(serial,'') = IFNULL(?, '')").bind(cart.id, line.code, line.serial).first<{ id: string; qty: number }>()
    : null;
  const t = now();
  if (same) await c.env.PARTS_DB.prepare("UPDATE lines SET qty = ? WHERE id = ?").bind(Math.round((same.qty + line.qty) * 1000) / 1000, same.id).run();
  else await c.env.PARTS_DB.prepare("INSERT INTO lines (id, cart_id, code, description, qty, serial, note, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(randomId(), cart.id, line.code, line.description, line.qty, line.serial, line.note, t).run();
  await c.env.PARTS_DB.prepare("UPDATE carts SET updated_at = ? WHERE id = ?").bind(t, cart.id).run();
  return c.json({ ok: true, cartId: cart.id });
});

async function myLine(c: Context<PartsApp>, u: Customer, id: string) {
  if (!ID.test(id)) fail(404, "Not found.");
  const l = await c.env.PARTS_DB.prepare(
    `SELECT l.id, l.cart_id, l.list_id FROM lines l
       LEFT JOIN carts c ON c.id = l.cart_id LEFT JOIN lists li ON li.id = l.list_id
      WHERE l.id = ? AND l.quote_id IS NULL AND (c.user_id = ? OR li.company_id = ?)`,
  ).bind(id, u.id, u.companyId).first<{ id: string; cart_id: string | null; list_id: string | null }>();
  if (!l) fail(404, "Not found.");
  return l;
}

shop.patch("/lines/:id", async (c) => {
  const u = requireCustomer(c);
  const l = await myLine(c, u, c.req.param("id"));
  const b = await body(c);
  const serials = await companySerials(c.env.PARTS_DB, u);
  const serial = b.serial === undefined ? undefined : (str(b.serial, 12)?.toUpperCase() ?? null);
  if (serial && !serials.some((s) => s.toUpperCase() === serial)) fail(400, "That machine isn't on your account.");
  await c.env.PARTS_DB.prepare("UPDATE lines SET qty = COALESCE(?, qty), note = COALESCE(?, note), serial = CASE WHEN ? THEN ? ELSE serial END WHERE id = ?")
    .bind(b.qty === undefined ? null : qty(b.qty), typeof b.note === "string" ? (str(b.note, 500) ?? "") : null, serial !== undefined ? 1 : 0, serial ?? null, l.id).run();
  return c.json({ ok: true });
});

shop.delete("/lines/:id", async (c) => {
  const u = requireCustomer(c);
  const l = await myLine(c, u, c.req.param("id"));
  await c.env.PARTS_DB.prepare("DELETE FROM lines WHERE id = ?").bind(l.id).run();
  return c.json({ ok: true });
});

/** Download a cart or list as a spreadsheet (CSV opens in Excel). */
shop.get("/:kind{carts|lists}/:id/csv", async (c) => {
  const u = requireCustomer(c);
  const kind = c.req.param("kind");
  const owner = kind === "carts" ? await myCart(c, u, c.req.param("id")) : await companyList(c, u, c.req.param("id"));
  const rows = (await lines(c.env.PARTS_DB, kind === "carts" ? "cart_id" : "list_id", owner.id)) as any[];
  const csv = toCsv(["Part number", "Description", "Maker", "Maker part number", "Quantity", "Machine", "Note"],
    rows.map((r) => [r.code ?? "", r.name_en || r.description || "", r.maker ?? "", r.maker_pn ?? "", r.qty, r.serial ?? "", r.note ?? ""]));
  const safe = owner.name.replace(/[^\w .-]+/g, "_").slice(0, 60) || "parts";
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${safe}.csv"` } });
});

// ---------- Lists (shared in the company) ----------

shop.get("/lists", async (c) => {
  const u = requireCustomer(c);
  const { results } = await c.env.PARTS_DB.prepare(
    `SELECT li.id, li.name, li.updated_at, us.name AS made_by, (SELECT COUNT(*) FROM lines l WHERE l.list_id = li.id) AS items
       FROM lists li JOIN users us ON us.id = li.user_id WHERE li.company_id = ? ORDER BY li.updated_at DESC`,
  ).bind(u.companyId).all();
  return c.json({ lists: results });
});

/** New list, empty or copied from one of your carts or one of your company's quote requests. */
shop.post("/lists", async (c) => {
  const u = requireCustomer(c);
  const b = await body(c);
  const id = randomId();
  const t = now();
  const name = mustStr(b.name, 100, "A name");
  const stmts = [c.env.PARTS_DB.prepare("INSERT INTO lists (id, company_id, user_id, name, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").bind(id, u.companyId, u.id, name, str(b.notes, 2000) ?? "", t, t)];
  let from: { col: "cart_id" | "quote_id"; id: string } | null = null;
  if (typeof b.fromCart === "string") from = { col: "cart_id", id: (await myCart(c, u, b.fromCart)).id };
  if (typeof b.fromQuote === "string") {
    const q = await c.env.PARTS_DB.prepare("SELECT id FROM quotes WHERE id = ? AND company_id = ?").bind(b.fromQuote, u.companyId).first<{ id: string }>();
    if (!q) fail(404, "Not found.");
    from = { col: "quote_id", id: q.id };
  }
  if (from) {
    stmts.push(c.env.PARTS_DB.prepare(
      `INSERT INTO lines (id, list_id, code, description, qty, serial, note, created_at)
       SELECT lower(hex(randomblob(16))), ?, code, description, qty, serial, note, ? FROM lines WHERE ${from.col} = ?`,
    ).bind(id, t, from.id));
  }
  await c.env.PARTS_DB.batch(stmts);
  return c.json({ id });
});

shop.get("/lists/:id", async (c) => {
  const u = requireCustomer(c);
  const list = await companyList(c, u, c.req.param("id"));
  return c.json({ list, lines: await lines(c.env.PARTS_DB, "list_id", list.id) });
});

shop.patch("/lists/:id", async (c) => {
  const u = requireCustomer(c);
  const list = await companyList(c, u, c.req.param("id"));
  const b = await body(c);
  await c.env.PARTS_DB.prepare("UPDATE lists SET name = ?, notes = ?, updated_at = ? WHERE id = ?")
    .bind(str(b.name, 100) ?? list.name, typeof b.notes === "string" ? (str(b.notes, 2000) ?? "") : list.notes, now(), list.id).run();
  return c.json({ ok: true });
});

shop.delete("/lists/:id", async (c) => {
  const u = requireCustomer(c);
  const list = await companyList(c, u, c.req.param("id"));
  await c.env.PARTS_DB.batch([
    c.env.PARTS_DB.prepare("DELETE FROM lines WHERE list_id = ?").bind(list.id),
    c.env.PARTS_DB.prepare("DELETE FROM lists WHERE id = ?").bind(list.id),
  ]);
  return c.json({ ok: true });
});

shop.post("/lists/:id/lines", async (c) => {
  const u = requireCustomer(c);
  const list = await companyList(c, u, c.req.param("id"));
  const line = await cleanLine(c, u, await body(c));
  const count = await c.env.PARTS_DB.prepare("SELECT COUNT(*) AS n FROM lines WHERE list_id = ?").bind(list.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= 500) fail(400, "A list holds up to 500 lines. Start a new list.");
  await c.env.PARTS_DB.prepare("INSERT INTO lines (id, list_id, code, description, qty, serial, note, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(randomId(), list.id, line.code, line.description, line.qty, line.serial, line.note, now()).run();
  return c.json({ ok: true });
});

/** Put everything on a list into your active cart. */
shop.post("/lists/:id/to-cart", async (c) => {
  const u = requireCustomer(c);
  const list = await companyList(c, u, c.req.param("id"));
  let cart = await c.env.PARTS_DB.prepare("SELECT id FROM carts WHERE user_id = ? AND active = 1").bind(u.id).first<{ id: string }>();
  // The cart's 500-line limit holds here too.
  const n = await c.env.PARTS_DB.prepare("SELECT (SELECT COUNT(*) FROM lines WHERE list_id = ?1) AS adding, (SELECT COUNT(*) FROM lines WHERE cart_id = ?2) AS have").bind(list.id, cart?.id ?? "").first<{ adding: number; have: number }>();
  if ((n?.adding ?? 0) + (n?.have ?? 0) > 500) fail(400, "A cart holds up to 500 lines. Start a new cart.");
  const t = now();
  const stmts: D1PreparedStatement[] = [];
  if (!cart) {
    cart = { id: randomId() };
    stmts.push(c.env.PARTS_DB.prepare("INSERT INTO carts (id, company_id, user_id, name, active, created_at, updated_at) VALUES (?,?,?,?,1,?,?)").bind(cart.id, u.companyId, u.id, list.name, t, t));
  }
  stmts.push(c.env.PARTS_DB.prepare(
    `INSERT INTO lines (id, cart_id, code, description, qty, serial, note, created_at)
     SELECT lower(hex(randomblob(16))), ?, code, description, qty, serial, note, ? FROM lines WHERE list_id = ?`,
  ).bind(cart.id, t, list.id));
  await c.env.PARTS_DB.batch(stmts);
  return c.json({ cartId: cart.id });
});

// ---------- Quote requests ----------

/** The buyer sends a cart to Ronchi America as a quote request. The cart is copied, then emptied. */
shop.post("/carts/:id/quote", async (c) => {
  const u = requireBuyer(c);
  const cart = await myCart(c, u, c.req.param("id"));
  const b = await body(c);
  const email = mustStr(b.email, 254, "Confirmation email");
  if (!EMAIL.test(email)) fail(400, "Enter a valid email address for the quote.");
  const n = await c.env.PARTS_DB.prepare("SELECT COUNT(*) AS n FROM lines WHERE cart_id = ?").bind(cart.id).first<{ n: number }>();
  if (!n?.n) fail(400, "The cart is empty.");
  const id = randomId();
  const t = now();
  // RQ-261124-4F82C: the date, then 5 random hex characters (20 random bits, taken with a mask
  // rather than a remainder so every value is equally likely), so two requests at once never collide.
  const rand = crypto.getRandomValues(new Uint32Array(1))[0]! & 0xfffff;
  const number = `RQ-${t.slice(2, 10).replace(/-/g, "")}-${rand.toString(16).toUpperCase().padStart(5, "0")}`;
  await c.env.PARTS_DB.batch([
    c.env.PARTS_DB.prepare("INSERT INTO quotes (id, number, company_id, user_id, email, notes, status, created_at, updated_at) VALUES (?,?,?,?,?,?, 'sent', ?,?)")
      .bind(id, number, u.companyId, u.id, email, [cart.notes, str(b.notes, 2000)].filter(Boolean).join("\n\n"), t, t),
    c.env.PARTS_DB.prepare("UPDATE lines SET quote_id = ?, cart_id = NULL WHERE cart_id = ?").bind(id, cart.id),
    c.env.PARTS_DB.prepare("UPDATE carts SET notes = '', updated_at = ? WHERE id = ?").bind(t, cart.id),
  ]);
  await audit(c.env.PARTS_DB, { userId: u.id, companyId: u.companyId, action: "quote.send", target: number, ip: c.get("ip") });
  return c.json({ id, number });
});

shop.get("/quotes", async (c) => {
  const u = requireCustomer(c);
  const { results } = await c.env.PARTS_DB.prepare(
    `SELECT q.id, q.number, q.status, q.created_at, q.updated_at, us.name AS sent_by, (SELECT COUNT(*) FROM lines l WHERE l.quote_id = q.id) AS items
       FROM quotes q JOIN users us ON us.id = q.user_id WHERE q.company_id = ? ORDER BY q.created_at DESC LIMIT 200`,
  ).bind(u.companyId).all();
  return c.json({ quotes: results });
});

shop.get("/quotes/:id", async (c) => {
  const u = requireCustomer(c);
  const id = c.req.param("id");
  if (!ID.test(id)) fail(404, "Not found.");
  const q = await c.env.PARTS_DB.prepare("SELECT id, number, status, email, notes, created_at, updated_at FROM quotes WHERE id = ? AND company_id = ?").bind(id, u.companyId).first<{ id: string }>();
  if (!q) fail(404, "Not found.");
  return c.json({ quote: q, lines: await lines(c.env.PARTS_DB, "quote_id", q.id) });
});

// ---------- Favorites ----------

shop.get("/favorites", async (c) => {
  const u = requireCustomer(c);
  // Only favorites that still point at the company's machines (a machine may have been removed).
  const { results } = await c.env.PARTS_DB.prepare(
    `SELECT f.kind, f.ref, f.label, f.created_at,
            CASE f.kind WHEN 'sheet' THEN (SELECT s.title FROM sheets s JOIN company_machines cm ON cm.serial = s.serial AND cm.company_id = ? WHERE s.id = f.ref)
                        ELSE (SELECT cm.serial FROM company_machines cm WHERE cm.company_id = ? AND cm.serial = f.ref) END AS name,
            CASE f.kind WHEN 'sheet' THEN (SELECT s.serial FROM sheets s WHERE s.id = f.ref) ELSE f.ref END AS serial
       FROM favorites f WHERE f.user_id = ? ORDER BY f.created_at DESC`,
  ).bind(u.companyId, u.companyId, u.id).all<{ name: string | null }>();
  return c.json({ favorites: results.filter((r) => r.name) });
});

shop.put("/favorites/:kind{machine|sheet}/:ref", async (c) => {
  const u = requireCustomer(c);
  const kind = c.req.param("kind");
  const ref = c.req.param("ref");
  const ok = kind === "machine"
    ? await c.env.PARTS_DB.prepare("SELECT 1 FROM company_machines WHERE company_id = ? AND serial = ?").bind(u.companyId, ref).first()
    : await c.env.PARTS_DB.prepare("SELECT 1 FROM sheets s JOIN company_machines cm ON cm.serial = s.serial AND cm.company_id = ? WHERE s.id = ?").bind(u.companyId, ref).first();
  if (!ok) fail(404, "Not found.");
  const label = str((await body(c)).label, 100);
  await c.env.PARTS_DB.prepare("INSERT INTO favorites (user_id, kind, ref, label, created_at) VALUES (?,?,?,?,?) ON CONFLICT (user_id, kind, ref) DO UPDATE SET label = excluded.label")
    .bind(u.id, kind, ref, label, now()).run();
  return c.json({ ok: true });
});

shop.delete("/favorites/:kind{machine|sheet}/:ref", async (c) => {
  const u = requireCustomer(c);
  await c.env.PARTS_DB.prepare("DELETE FROM favorites WHERE user_id = ? AND kind = ? AND ref = ?").bind(u.id, c.req.param("kind"), c.req.param("ref")).run();
  return c.json({ ok: true });
});
