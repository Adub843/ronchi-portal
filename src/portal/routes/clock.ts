// Time clock and hours.
// - The time of a punch is ALWAYS the server's clock. A phone's clock is never trusted.
// - Location is taken only at the moment of clocking in or out (people are told this on screen).
// - People with the "type an address" option (Aaron, or anyone Paolo allows) can type an address
//   instead; it is labeled "entered by hand" everywhere it shows.
// - Changing a punch time is a request. Lola (billing) or an admin approves it, never the person
//   who asked. The original time is kept in punch_edits.
import { Hono } from "hono";
import { randomId } from "../../shared/crypto";
import { toCsv } from "../../shared/csv";
import type { AppEnv } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, mustStr, requirePerm, str } from "../lib/http";
import { dailyTotals, parseRange, toShifts, type Punch } from "../lib/hours";

export const clock = new Hono<AppEnv>();

async function lastPunch(db: D1Database, userId: string) {
  return db.prepare("SELECT id, kind, at FROM punches WHERE user_id = ? ORDER BY at DESC LIMIT 1").bind(userId).first<{ id: string; kind: "in" | "out"; at: string }>();
}

clock.get("/status", async (c) => {
  const u = requirePerm(c, "clock.use");
  return c.json({ last: await lastPunch(c.env.DB, u.id), canTypeAddress: !!u.can_type_address, serverTime: now() });
});

clock.post("/punch", async (c) => {
  const u = requirePerm(c, "clock.use");
  const b = await body(c);
  if (b.kind !== "in" && b.kind !== "out") fail(400, "Clock in or clock out?");
  const last = await lastPunch(c.env.DB, u.id);
  if (b.kind === "in" && last?.kind === "in") fail(409, "You're already clocked in.");
  if (b.kind === "out" && last?.kind !== "in") fail(409, "You're not clocked in.");

  let source: "gps" | "typed" | "none" = "none";
  let lat: number | null = null, lng: number | null = null, acc: number | null = null, address: string | null = null;
  const typed = str(b.address, 300);
  if (typed) {
    if (!u.can_type_address) fail(403, "Typing an address isn't turned on for your login. Ask Paolo.");
    source = "typed";
    address = typed;
  } else if (typeof b.lat === "number" && typeof b.lng === "number") {
    if (!(Math.abs(b.lat) <= 90 && Math.abs(b.lng) <= 180)) fail(400, "That location isn't valid.");
    source = "gps";
    lat = Math.round(b.lat * 1e5) / 1e5; // about 1 metre; no need to store more
    lng = Math.round(b.lng * 1e5) / 1e5;
    acc = typeof b.accuracy === "number" && b.accuracy >= 0 ? Math.round(Math.min(b.accuracy, 100000)) : null;
  }
  const id = randomId();
  const t = now();
  await c.env.DB.prepare("INSERT INTO punches (id, user_id, kind, at, location_source, lat, lng, accuracy_m, address, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, u.id, b.kind, t, source, lat, lng, acc, address, str(b.note, 300), t)
    .run();
  return c.json({ id, at: t, kind: b.kind, location: source });
});

clock.get("/mine", async (c) => {
  const u = requirePerm(c, "clock.use");
  const range = parseRange(c.req.query("from"), c.req.query("to"));
  if (!range) fail(400, "That date range isn't valid.");
  const { results } = await c.env.DB.prepare(
    "SELECT id, user_id, kind, at, location_source, address, note FROM punches WHERE user_id = ? AND at >= ? AND at < ? ORDER BY at",
  ).bind(u.id, range.fromIso, range.toIso).all<Punch & { location_source: string; address: string | null; note: string | null }>();
  const edits = await c.env.DB.prepare(
    "SELECT e.id, e.punch_id, e.new_at, e.reason, e.status, e.created_at FROM punch_edits e WHERE e.requested_by = ? ORDER BY e.created_at DESC LIMIT 50",
  ).bind(u.id).all();
  const shifts = toShifts(results);
  return c.json({ punches: results, days: dailyTotals(shifts), edits: edits.results });
});

/** Ask to change the time on one of your own punches. */
clock.post("/punches/:id/edit", async (c) => {
  const u = requirePerm(c, "clock.use");
  const p = await c.env.DB.prepare("SELECT id, user_id, at FROM punches WHERE id = ?").bind(c.req.param("id")).first<{ id: string; user_id: string; at: string }>();
  if (!p || p.user_id !== u.id) fail(404, "Not found.");
  const b = await body(c);
  const newAt = typeof b.newAt === "string" ? new Date(b.newAt) : null;
  if (!newAt || isNaN(newAt.getTime())) fail(400, "Pick the correct time.");
  if (newAt.getTime() > Date.now()) fail(400, "The time can't be in the future.");
  const reason = mustStr(b.reason, 300, "A reason");
  const pending = await c.env.DB.prepare("SELECT 1 FROM punch_edits WHERE punch_id = ? AND status = 'pending'").bind(p.id).first();
  if (pending) fail(409, "There's already a change waiting for approval on this punch.");
  const id = randomId();
  await c.env.DB.prepare("INSERT INTO punch_edits (id, punch_id, requested_by, old_at, new_at, reason, status, created_at) VALUES (?,?,?,?,?,?, 'pending', ?)")
    .bind(id, p.id, u.id, p.at, newAt.toISOString(), reason, now())
    .run();
  await audit(c.env.DB, { userId: u.id, action: "punch.edit_request", targetType: "punch", targetId: p.id, detail: { from: p.at, to: newAt.toISOString(), reason }, ip: c.get("ip") });
  return c.json({ id });
});

// ---- Hours (Lola, Meagan, Paolo) ----

async function hoursData(db: D1Database, fromIso: string, toIso: string, userId?: string) {
  const { results } = await db.prepare(
    `SELECT p.id, p.user_id, p.kind, p.at, p.location_source, p.lat, p.lng, p.accuracy_m, p.address, p.note, u.name
       FROM punches p JOIN users u ON u.id = p.user_id
      WHERE p.at >= ? AND p.at < ? AND (? IS NULL OR p.user_id = ?) ORDER BY p.at`,
  ).bind(fromIso, toIso, userId ?? null, userId ?? null).all<Punch & { location_source: string; lat: number | null; lng: number | null; accuracy_m: number | null; address: string | null; note: string | null; name: string }>();
  const names = new Map(results.map((r) => [r.user_id, r.name]));
  const shifts = toShifts(results);
  return { punches: results, shifts, days: dailyTotals(shifts).map((d) => ({ ...d, name: names.get(d.userId) ?? "" })) };
}

clock.get("/hours", async (c) => {
  requirePerm(c, "hours.view_all");
  const range = parseRange(c.req.query("from"), c.req.query("to"));
  if (!range) fail(400, "That date range isn't valid.");
  return c.json(await hoursData(c.env.DB, range.fromIso, range.toIso, c.req.query("user") || undefined));
});

clock.get("/edits", async (c) => {
  requirePerm(c, "hours.approve");
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, u.name AS requested_by_name, p.kind FROM punch_edits e
       JOIN users u ON u.id = e.requested_by JOIN punches p ON p.id = e.punch_id
      WHERE e.status = 'pending' ORDER BY e.created_at`,
  ).all();
  return c.json({ edits: results });
});

clock.post("/edits/:id/decide", async (c) => {
  const u = requirePerm(c, "hours.approve");
  const e = await c.env.DB.prepare("SELECT * FROM punch_edits WHERE id = ? AND status = 'pending'").bind(c.req.param("id")).first<{ id: string; punch_id: string; requested_by: string; old_at: string; new_at: string }>();
  if (!e) fail(404, "Not found, or already decided.");
  if (e.requested_by === u.id) fail(403, "Someone else has to approve changes to your own hours.");
  const b = await body(c);
  const approve = b.approve === true;
  const t = now();
  const stmts = [c.env.DB.prepare("UPDATE punch_edits SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'").bind(approve ? "approved" : "rejected", u.id, t, e.id)];
  if (approve) stmts.push(c.env.DB.prepare("UPDATE punches SET at = ? WHERE id = ?").bind(e.new_at, e.punch_id));
  await c.env.DB.batch(stmts);
  await audit(c.env.DB, { userId: u.id, action: approve ? "punch.edit_approve" : "punch.edit_reject", targetType: "punch", targetId: e.punch_id, detail: { from: e.old_at, to: e.new_at, requestedBy: e.requested_by }, ip: c.get("ip") });
  return c.json({ ok: true });
});

/** Export hours. format=csv (opens in Excel) or json. */
clock.get("/hours/export", async (c) => {
  const u = requirePerm(c, "hours.export");
  const range = parseRange(c.req.query("from"), c.req.query("to"));
  if (!range) fail(400, "That date range isn't valid.");
  const kind = c.req.query("kind") === "punches" ? "punches" : "days";
  const format = c.req.query("format") === "json" ? "json" : "csv";
  const data = await hoursData(c.env.DB, range.fromIso, range.toIso, c.req.query("user") || undefined);
  await audit(c.env.DB, { userId: u.id, action: "hours.export", detail: { kind, format, from: c.req.query("from"), to: c.req.query("to") }, ip: c.get("ip") });
  const stamp = new Date().toISOString().slice(0, 10);
  const headers = { "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="ronchi-hours-${kind}-${stamp}.${format}"` };
  if (format === "json") return c.body(JSON.stringify(kind === "days" ? data.days : data.punches, null, 2), 200, { ...headers, "Content-Type": "application/json" });
  const csv = kind === "days"
    ? toCsv(["Name", "Day", "Hours", "Regular", "Overtime", "Still clocked in"], data.days.map((d) => [d.name, d.day, d.hours, d.regular, d.overtime, d.open ? "yes" : ""]))
    : toCsv(
        ["Name", "In/Out", "Time (UTC)", "Location", "Latitude", "Longitude", "Accuracy (m)", "Address", "Note"],
        data.punches.map((p) => [p.name, p.kind, p.at, p.location_source === "typed" ? "entered by hand" : p.location_source === "gps" ? "phone location" : "none", p.lat, p.lng, p.accuracy_m, p.address, p.note]),
      );
  return c.body(csv, 200, { ...headers, "Content-Type": "text/csv; charset=utf-8" });
});
