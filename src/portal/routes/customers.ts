// Customer parts logins and their quote requests, managed from the staff portal.
// The data lives on the customer parts site (parts-db); every call here goes through the
// one-way door in lib/parts-site.ts. Nothing about customers' logins is kept in portal-db.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { audit } from "../lib/db";
import { body, fail, requirePerm } from "../lib/http";
import { partsCall } from "../lib/parts-site";

export const customers = new Hono<AppEnv>();

const ID = /^[A-Za-z0-9_-]{8,40}$/;
const id = (v: string) => (ID.test(v) ? v : fail(404, "Not found."));

customers.get("/", async (c) => {
  requirePerm(c, "customers.manage");
  return c.json(await partsCall(c.env, "/companies"));
});

customers.post("/", async (c) => {
  const u = requirePerm(c, "customers.manage");
  const b = await body(c);
  const res = await partsCall(c.env, "/companies", { body: { name: b.name, by: u.name } });
  await audit(c.env.DB, { userId: u.id, action: "customer.company.create", targetType: "parts_company", targetId: res.id, ip: c.get("ip") });
  return c.json(res);
});

customers.patch("/:id", async (c) => {
  const u = requirePerm(c, "customers.manage");
  const b = await body(c);
  const res = await partsCall(c.env, `/companies/${id(c.req.param("id"))}`, { method: "PATCH", body: { name: b.name, status: b.status, by: u.name } });
  await audit(c.env.DB, { userId: u.id, action: "customer.company.update", targetType: "parts_company", targetId: c.req.param("id"), detail: { status: b.status }, ip: c.get("ip") });
  return c.json(res);
});

/** Set which machines a company sees. Only machine numbers in the portal's registry can be given. */
customers.put("/:id/machines", async (c) => {
  const u = requirePerm(c, "customers.manage");
  const b = await body(c);
  if (!Array.isArray(b.machines) || b.machines.length > 500) fail(400, "Send the list of machines.");
  const list = (b.machines as Record<string, unknown>[]).map((m) => ({ serial: String(m?.serial ?? "").trim().toUpperCase(), label: typeof m?.label === "string" ? m.label : null }));
  for (const m of list) {
    if (!(await c.env.DB.prepare("SELECT 1 FROM machines WHERE serial = ?").bind(m.serial).first())) fail(400, `${m.serial || "That machine"} isn't in the machine list.`);
  }
  const res = await partsCall(c.env, `/companies/${id(c.req.param("id"))}/machines`, { method: "PUT", body: { machines: list, by: u.name } });
  await audit(c.env.DB, { userId: u.id, action: "customer.machines", targetType: "parts_company", targetId: c.req.param("id"), detail: { serials: list.map((m) => m.serial) }, ip: c.get("ip") });
  return c.json(res);
});

/** A one-time sign-up link for a person at the company. Staff send it themselves. */
customers.post("/:id/invites", async (c) => {
  const u = requirePerm(c, "customers.invite");
  const b = await body(c);
  const res = await partsCall(c.env, `/companies/${id(c.req.param("id"))}/invites`, { body: { email: b.email, name: b.name, role: b.role, by: u.name } });
  await audit(c.env.DB, { userId: u.id, action: "customer.invite", targetType: "parts_company", targetId: c.req.param("id"), detail: { role: b.role }, ip: c.get("ip") });
  return c.json(res);
});

customers.patch("/users/:id", async (c) => {
  const u = requirePerm(c, "customers.invite");
  const b = await body(c);
  const res = await partsCall(c.env, `/users/${id(c.req.param("id"))}`, { method: "PATCH", body: { role: b.role, status: b.status, by: u.name } });
  await audit(c.env.DB, { userId: u.id, action: "customer.user.update", targetType: "parts_user", targetId: c.req.param("id"), detail: { role: b.role, status: b.status }, ip: c.get("ip") });
  return c.json(res);
});

customers.delete("/invites/:id", async (c) => {
  const u = requirePerm(c, "customers.invite");
  const res = await partsCall(c.env, `/invites/${id(c.req.param("id"))}`, { method: "DELETE" });
  await audit(c.env.DB, { userId: u.id, action: "customer.invite.cancel", targetType: "parts_invite", targetId: c.req.param("id"), ip: c.get("ip") });
  return c.json(res);
});

// ---------- Quote requests from customers ----------

export const quotes = new Hono<AppEnv>();

quotes.get("/", async (c) => {
  requirePerm(c, "quotes.manage");
  const status = c.req.query("status");
  const q = status && ["sent", "received", "quoted", "closed"].includes(status) ? `?status=${status}` : "";
  return c.json(await partsCall(c.env, `/quotes${q}`));
});

quotes.get("/:id", async (c) => {
  requirePerm(c, "quotes.manage");
  return c.json(await partsCall(c.env, `/quotes/${id(c.req.param("id"))}`));
});

quotes.patch("/:id", async (c) => {
  const u = requirePerm(c, "quotes.manage");
  const b = await body(c);
  const res = await partsCall(c.env, `/quotes/${id(c.req.param("id"))}`, { method: "PATCH", body: { status: b.status, by: u.name } });
  await audit(c.env.DB, { userId: u.id, action: "quote.status", targetType: "parts_quote", targetId: c.req.param("id"), detail: { status: b.status }, ip: c.get("ip") });
  return c.json(res);
});
