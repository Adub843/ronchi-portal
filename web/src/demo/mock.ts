// DEMO ONLY. Used by `npm run build:demo` (the preview shown inside Claude), never by the real portal.
// It answers the app's /api calls from example data kept in this browser, so the real screens
// can be clicked through without a server. Signed in as Aaron Lewis, admin.
import { dailyTotals, toShifts, type Punch } from "../../../src/portal/lib/hours";
import { PERMISSIONS, ROLES } from "../../../src/portal/lib/roles";
type Role = keyof typeof ROLES;

// Ids for example records. Uses the browser's secure random source like the real server does.
const id = () => "d" + [...crypto.getRandomValues(new Uint8Array(8))].map((b) => (b % 36).toString(36)).join("");
const jitter = () => crypto.getRandomValues(new Uint16Array(1))[0]! / 65535 / 50;
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number, h: number, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, m, 0, 0);
  return d;
};

interface User { id: string; email: string; name: string; role: Role; status: string; can_type_address: number; created_at: string }
interface DB {
  users: User[];
  invites: any[];
  machines: any[];
  boards: any[];
  posts: any[];
  punches: (Punch & { location_source: string; lat: number | null; lng: number | null; accuracy_m: number | null; address: string | null; note: string | null })[];
  edits: any[];
  audit: any[];
  prefs: any;
  addressMode?: string | null;
}

function seed(): DB {
  const t0 = iso(daysAgo(20, 9));
  const u = (name: string, role: Role, email: string, typed = 0): User => ({ id: id(), name, role, email, status: "active", can_type_address: typed, created_at: t0 });
  const users = [
    u("Aaron Lewis", "admin", "a_lewis@ronchiamerica.com", 1),
    u("Paolo Ferla", "admin", "paolo@ronchiamerica.com", 1),
    u("Lola Parker", "billing", "lola@ronchiamerica.com"),
    u("Meagan Hooper", "scheduling", "meagan@ronchiamerica.com"),
    u("Steve Williams", "service", "steve@ronchiamerica.com"),
    u("Andrew Yang", "sales", "andrew@ronchiamerica.com"),
    u("Michele Falsini", "sales", "michele@ronchiamerica.com"),
  ];
  const [aaron, paolo, lola, meagan, steve, andrew] = users as [User, User, User, User, User, User, User];
  const m = (serial: string, model: string, customer: string, site: string, notes = "") => ({ id: id(), serial, model, customer, site, notes, sharepoint_url: null, created_at: t0, updated_at: t0 });
  const machines = [
    m("3069MB", "Monoblock filler and capper", "Example Pharma Co.", "Columbus, OH", "Example record. Capper clutch serviced Oct 2026."),
    m("4222TP", "Rotary piston filler", "Example Foods Inc.", "Atlanta, GA"),
    m("4212MB", "Monoblock", "Example Home Care", "Chicago, IL"),
    m("3811CP", "Capper", "Example Pharma Co.", "Columbus, OH"),
    m("3535MB", "Monoblock", "Example Personal Care", "New Albany, OH"),
  ];
  const b = (name: string, description: string | null, by: User, audience: string[] | null = null, machine_id: string | null = null, n = 5) =>
    ({ id: id(), name, description, audience: audience ? JSON.stringify(audience) : null, machine_id, created_by: by.id, created_at: iso(daysAgo(n, 8)), archived_at: null });
  const service = b("Service team", "Daily updates from the field", paolo, null, null, 9);
  const torque = b("3069MB capper torque", "Torque drift after long runs", aaron, null, machines[0]!.id, 4);
  const sales = b("Sales and quotes", "Machine quotes and change-part pricing", andrew, ["sales", "admin"], null, 6);
  const eng = b("Engineering questions", "Drawings, parts and changeover questions for engineering", steve, null, null, 3);
  const p = (board: any, user: User, body: string, at: Date, parent_id: string | null = null, pinned = 0) =>
    ({ id: id(), board_id: board.id, parent_id, user_id: user.id, body, pinned, created_at: iso(at), edited_at: null, deleted_at: null });
  const t1 = p(torque, aaron, "Torque drops about 10% after two hours on line 3. Clutch looks dry.", daysAgo(4, 10, 12));
  const s1 = p(service, paolo, "Reminder: service reports go in by Friday so Lola can close the week.", daysAgo(9, 8, 30), null, 1);
  const posts = [
    s1,
    p(service, aaron, "Heading to Atlanta Thursday for the 4222TP changeover.", daysAgo(2, 7, 45)),
    p(service, meagan, "Thursday is on the calendar. Hotel is booked.", daysAgo(2, 9, 5), null),
    t1,
    p(torque, steve, "Re-grease the magnetic clutch and check the spring preload. Same fix as the 3811CP last spring.", daysAgo(4, 11, 40), t1.id),
    p(torque, aaron, "That fixed it. Holding torque across a full shift now.", daysAgo(3, 15, 20), t1.id),
    p(sales, andrew, "Quote for two change-part sets on 4212MB sent today.", daysAgo(1, 14, 0)),
    p(eng, steve, "Does anyone have the latest star wheel drawing for the 50 ml bottle?", daysAgo(1, 9, 30)),
  ];
  const punches: DB["punches"] = [];
  const shift = (user: User, dAgo: number, inH: number, outH: number, typed?: string) => {
    for (const [kind, h] of [["in", inH], ["out", outH]] as const) {
      const at = daysAgo(dAgo, Math.floor(h), Math.round((h % 1) * 60));
      punches.push({ id: id(), user_id: user.id, kind, at: iso(at), location_source: typed ? "typed" : "gps", lat: typed ? null : 32.85 + jitter(), lng: typed ? null : -79.97 + jitter(), accuracy_m: typed ? null : 12, address: typed ?? null, note: null });
    }
  };
  for (let d = 13; d >= 1; d--) {
    const day = daysAgo(d, 12).getDay();
    if (day === 0 || day === 6) continue;
    shift(aaron, d, 7.5, d % 3 === 0 ? 18 : 16.5, d === 2 ? "Example Foods Inc., Atlanta GA" : undefined);
    shift(steve, d, 8, 16.75);
    shift(meagan, d, 8.5, 17);
  }
  // Aaron is clocked in today.
  punches.push({ id: id(), user_id: aaron.id, kind: "in", at: iso(new Date(Date.now() - 2 * 3600000)), location_source: "gps", lat: 32.85, lng: -79.97, accuracy_m: 10, address: null, note: null });
  const steveLast = punches.filter((x) => x.user_id === steve.id).at(-1)!;
  const edits = [{ id: id(), punch_id: steveLast.id, requested_by: steve.id, old_at: steveLast.at, new_at: iso(new Date(Date.parse(steveLast.at) + 45 * 60000)), reason: "Stayed late to finish the 3811CP test run", status: "pending", decided_by: null, decided_at: null, created_at: iso(daysAgo(1, 18)) }];
  const audit = [
    { at: iso(daysAgo(0, 7, 30)), action: "login", who: "Aaron Lewis", ip: "your phone" },
    { at: iso(daysAgo(1, 9, 0)), action: "invite.create", who: "Paolo Ferla", ip: "office" },
    { at: iso(daysAgo(1, 18, 2)), action: "punch.edit_request", who: "Steve Williams", ip: "field" },
    { at: iso(daysAgo(3, 16, 0)), action: "hours.export", who: "Lola Parker", ip: "office" },
  ];
  void lola;
  return { users, invites: [], machines, boards: [service, torque, sales, eng], posts, punches, edits, audit, prefs: null };
}

// Example data lives in memory only. Nothing is written to the browser's storage,
// and a reload starts again from the examples.
let db: DB;
function load(): DB {
  return seed();
}
function save() {
  /* in memory only */
}

class Fail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const me = () => db.users[0]!;
const name = (uid: string) => db.users.find((u) => u.id === uid)?.name ?? "";
const log = (action: string) => db.audit.unshift({ at: iso(new Date()), action, who: me().name, ip: "this browser" });

function hours(from?: string | null, to?: string | null, userId?: string | null) {
  const start = from ? Date.parse(`${from}T00:00:00`) : Date.now() - 14 * 86400000;
  const end = to ? Date.parse(`${to}T23:59:59`) : Date.now();
  const punches = db.punches.filter((p) => Date.parse(p.at) >= start && Date.parse(p.at) <= end && (!userId || p.user_id === userId)).map((p) => ({ ...p, name: name(p.user_id) }));
  const shifts = toShifts(punches);
  return { punches, shifts, days: dailyTotals(shifts).map((d) => ({ ...d, name: name(d.userId) })) };
}

function route(method: string, path: string, q: URLSearchParams, body: any): unknown {
  const seg = path.split("/").filter(Boolean);
  const u = me();
  // --- auth & me ---
  if (path === "/auth/me") return { user: { id: u.id, name: u.name, email: u.email, role: u.role, canTypeAddress: true, permissions: [...PERMISSIONS[u.role]] } };
  if (path === "/auth/logout") throw new Fail(400, "Sign-out is turned off in this preview.");
  if (path === "/auth/add-device") return { link: "https://portal.ronchiamerica.com/welcome#example-one-time-link" };
  if (path === "/prefs") {
    if (method === "PUT") db.prefs = body.reset ? null : { theme: body.theme, mode: body.mode ?? "auto", layout: body.layout ?? "L2", tiles: body.tiles ?? null };
    return db.prefs ?? { theme: "ronchi", mode: "auto", layout: "L2", tiles: null };
  }
  // --- people ---
  if (path === "/users/roles") return { roles: ROLES };
  if (path === "/users" && method === "GET")
    return { users: db.users.map((x) => ({ ...x, passkeys: 1 + (x.id === u.id ? 1 : 0), sessions: x.status === "active" ? 1 : 0 })), invites: db.invites };
  if (path === "/users/invite") {
    if (!body.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email ?? "")) throw new Fail(400, "Enter a name and a valid email.");
    db.invites.unshift({ id: id(), email: body.email, name: body.name, role: body.role, expires_at: iso(new Date(Date.now() + 72 * 3600000)) });
    log("invite.create");
    return { link: `https://portal.ronchiamerica.com/welcome#example-link-for-${body.name.split(" ")[0].toLowerCase()}` };
  }
  if (path === "/users/audit/recent") return { entries: db.audit };
  if (path === "/users/me/devices")
    return { sessions: [{ id: "a1", current: true, created_at: iso(daysAgo(6, 7)), last_seen_at: iso(new Date()), user_agent: "Windows Chrome/131" }, { id: "a2", current: false, created_at: iso(daysAgo(12, 7)), last_seen_at: iso(daysAgo(0, 7, 30)), user_agent: "iPhone Safari/605" }], passkeys: [] };
  if (seg[0] === "users" && seg[1] === "me") return { ok: true };
  if (seg[0] === "users" && seg[1] === "invites") {
    db.invites = db.invites.filter((i) => i.id !== seg[2]);
    return { ok: true };
  }
  if (seg[0] === "users" && seg[2] === "sign-out-everywhere") {
    log("user.sign_out_all");
    return { ok: true, sessions: 1 };
  }
  if (seg[0] === "users" && method === "PATCH") {
    const t = db.users.find((x) => x.id === seg[1]);
    if (!t) throw new Fail(404, "Not found.");
    if (t.id === u.id && (body.status === "disabled" || (body.role && body.role !== "admin"))) throw new Fail(400, "You can't remove your own admin access. Ask another admin.");
    if (body.role) t.role = body.role;
    if (body.status) t.status = body.status;
    if (body.canTypeAddress !== undefined) t.can_type_address = body.canTypeAddress ? 1 : 0;
    log("user.update");
    return { ok: true };
  }
  // --- machines ---
  if (path === "/machines" && method === "GET") {
    const s = (q.get("q") ?? "").toLowerCase();
    return { machines: db.machines.filter((m) => !s || [m.serial, m.model, m.customer, m.site].some((v) => (v ?? "").toLowerCase().includes(s))).sort((a, b) => a.serial.localeCompare(b.serial)) };
  }
  if (path === "/machines") {
    const serial = String(body.serial ?? "").trim().toUpperCase();
    if (!/^\d{4}[A-Z]{1,3}$/.test(serial)) throw new Fail(400, "Machine numbers look like 3069MB (four digits, then letters).");
    if (db.machines.some((m) => m.serial === serial)) throw new Fail(409, `Machine ${serial} is already in the registry.`);
    const m = { id: id(), serial, model: body.model || null, customer: body.customer || null, site: body.site || null, notes: null, sharepoint_url: null, created_at: iso(new Date()), updated_at: iso(new Date()) };
    db.machines.push(m);
    log("machine.create");
    return { id: m.id };
  }
  if (seg[0] === "machines") {
    const m = db.machines.find((x) => x.id === seg[1]);
    if (!m) throw new Fail(404, "Not found.");
    if (method === "PATCH") {
      Object.assign(m, { model: body.model || null, customer: body.customer || null, site: body.site || null, notes: body.notes || null, sharepoint_url: body.sharepointUrl || null, updated_at: iso(new Date()) });
      log("machine.update");
      return { ok: true };
    }
    return { machine: m, boards: db.boards.filter((b) => b.machine_id === m.id && !b.archived_at) };
  }
  // --- boards ---
  if (path === "/boards" && method === "GET") {
    const live = (bid: string) => db.posts.filter((p) => p.board_id === bid && !p.deleted_at);
    return {
      boards: db.boards
        .filter((b) => !b.archived_at)
        .map((b) => ({ ...b, post_count: live(b.id).length, last_post_at: live(b.id).map((p) => p.created_at).sort().at(-1) ?? null }))
        .sort((a, b) => (b.last_post_at ?? b.created_at).localeCompare(a.last_post_at ?? a.created_at)),
    };
  }
  if (path === "/boards") {
    if (!body.name?.trim()) throw new Fail(400, "Board name is required.");
    const b = { id: id(), name: body.name.trim(), description: body.description || null, audience: body.audience?.length ? JSON.stringify([...new Set([...body.audience, u.role])]) : null, machine_id: null, created_by: u.id, created_at: iso(new Date()), archived_at: null };
    db.boards.push(b);
    log("board.create");
    return { id: b.id };
  }
  if (seg[0] === "boards") {
    const b = db.boards.find((x) => x.id === seg[1]);
    if (!b) throw new Fail(404, "Not found.");
    if (seg[2] === "archive") {
      b.archived_at = iso(new Date());
      return { ok: true };
    }
    if (seg[2] === "posts" && !seg[3]) {
      if (!body.body?.trim()) throw new Fail(400, "Message is required.");
      const p = { id: id(), board_id: b.id, parent_id: body.parentId ?? null, user_id: u.id, body: body.body, pinned: 0, created_at: iso(new Date()), edited_at: null, deleted_at: null };
      db.posts.push(p);
      return { id: p.id };
    }
    if (seg[2] === "posts" && seg[3]) {
      const p = db.posts.find((x) => x.id === seg[3]);
      if (!p) throw new Fail(404, "Not found.");
      if (method === "DELETE") p.deleted_at = iso(new Date());
      if (method === "PATCH" && body.pinned !== undefined) p.pinned = body.pinned ? 1 : 0;
      return { ok: true };
    }
    return {
      board: b,
      canModerate: true,
      posts: db.posts.filter((p) => p.board_id === b.id && !p.deleted_at).map((p) => ({ ...p, author: name(p.user_id) })).sort((x, y) => y.created_at.localeCompare(x.created_at)),
    };
  }
  // --- clock & hours ---
  const mine = () => db.punches.filter((p) => p.user_id === u.id).sort((a, b) => a.at.localeCompare(b.at));
  if (path === "/clock/status") return { last: mine().at(-1) ?? null, canTypeAddress: true, addressMode: !!db.addressMode, typedAddress: db.addressMode ?? null, serverTime: iso(new Date()) };
  if (path === "/clock/address-mode") {
    if (body.on && !String(body.address ?? "").trim()) throw new Fail(400, "The address is required.");
    db.addressMode = body.on ? String(body.address).trim() : null;
    log(body.on ? "clock.address_mode_on" : "clock.address_mode_off");
    return { addressMode: !!db.addressMode, typedAddress: db.addressMode };
  }
  if (path === "/clock/punch") {
    const last = mine().at(-1);
    if (body.kind === "in" && last?.kind === "in") throw new Fail(409, "You're already clocked in.");
    if (body.kind === "out" && last?.kind !== "in") throw new Fail(409, "You're not clocked in.");
    const typed = db.addressMode ?? null;
    const source = typed ? "typed" : typeof body.lat === "number" ? "gps" : "none";
    const p = { id: id(), user_id: u.id, kind: body.kind, at: iso(new Date()), location_source: source, lat: typed ? null : body.lat ?? null, lng: typed ? null : body.lng ?? null, accuracy_m: typed ? null : body.accuracy ?? null, address: typed, note: null };
    db.punches.push(p);
    return { id: p.id, at: p.at, kind: p.kind, location: source };
  }
  if (path === "/clock/mine") {
    const h = hours(null, null, u.id);
    return { punches: h.punches, days: h.days, edits: db.edits.filter((e) => e.requested_by === u.id) };
  }
  if (seg[0] === "clock" && seg[1] === "punches") {
    const p = db.punches.find((x) => x.id === seg[2]);
    if (!p) throw new Fail(404, "Not found.");
    if (!body.reason?.trim()) throw new Fail(400, "A reason is required.");
    db.edits.push({ id: id(), punch_id: p.id, requested_by: u.id, old_at: p.at, new_at: body.newAt, reason: body.reason, status: "pending", created_at: iso(new Date()) });
    log("punch.edit_request");
    return { ok: true };
  }
  if (path === "/clock/hours") return hours(q.get("from"), q.get("to"), q.get("user"));
  if (path === "/clock/edits")
    return { edits: db.edits.filter((e) => e.status === "pending").map((e) => ({ ...e, requested_by_name: name(e.requested_by), kind: db.punches.find((p) => p.id === e.punch_id)?.kind })) };
  if (seg[0] === "clock" && seg[1] === "edits") {
    const e = db.edits.find((x) => x.id === seg[2]);
    if (!e) throw new Fail(404, "Not found, or already decided.");
    if (e.requested_by === u.id) throw new Fail(403, "Someone else has to approve changes to your own hours.");
    e.status = body.approve ? "approved" : "rejected";
    if (body.approve) {
      const p = db.punches.find((x) => x.id === e.punch_id);
      if (p) p.at = e.new_at;
    }
    log(body.approve ? "punch.edit_approve" : "punch.edit_reject");
    return { ok: true };
  }
  throw new Fail(404, "Not found.");
}

/** Answer /api/... calls from the example data instead of a server. */
export function installDemo() {
  db = load();
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    const at = url.pathname.indexOf("/api/");
    if (at < 0) return realFetch(input, init);
    const path = url.pathname.slice(at + 4);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: any = {};
    try {
      body = init?.body ? JSON.parse(String(init.body)) : {};
    } catch {
      body = {};
    }
    await new Promise((r) => setTimeout(r, 60));
    try {
      const data = route(method, path, url.searchParams, body);
      save();
      return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (e) {
      const status = e instanceof Fail ? e.status : 500;
      return new Response(JSON.stringify({ error: (e as Error).message }), { status, headers: { "Content-Type": "application/json" } });
    }
  };
}

/** Put the example data back the way it started. */
export function resetDemo() {
  db = seed();
  save();
}
