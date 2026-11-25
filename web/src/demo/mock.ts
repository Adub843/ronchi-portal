// DEMO ONLY. Used by `npm run build:demo` (the preview shown inside Claude), never by the real portal.
// It answers the app's /api calls from example data kept in this browser, so the real screens
// can be clicked through without a server. Signed in as Aaron Lewis, admin.
import logoUrl from "../assets/ronchi-logo.png";
import { cleanName, fileInfo, fileProblem } from "../../../src/shared/files";
import { adjustable, effective, isPermission, PERMISSION_GROUPS, PERMISSIONS, rolePermissions, ROLES, VIEW_PERMS, type AccessChanges } from "../../../src/portal/lib/roles";
import { CP_FIELDS, isOpen, readOrdersCsv } from "../../../src/shared/change-parts";
import { KbFail, kbRoute, resetKb } from "./kb-mock";
type Role = keyof typeof ROLES;

// Ids for example records. Uses the browser's secure random source like the real server does.
const id = () => "d" + [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number, h: number, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, m, 0, 0);
  return d;
};

interface User { id: string; email: string; name: string; role: string; status: string; created_at: string; access?: AccessChanges; removed_at?: string | null }
interface RoleRow { id: string; name: string; perms: string }
interface DB {
  users: User[];
  roles: RoleRow[]; // roles made in People > Roles, and changed built-ins
  links: { id: string; label: string; url: string; audience: { roles: string[]; people: string[] } | null }[];
  invites: any[];
  machines: any[];
  boards: any[];
  posts: any[];
  audit: any[];
  prefs: any;
  reads: Record<string, string>; // board id -> when Aaron last read it
  muted: Record<string, boolean>;
  members: Record<string, string[]>; // chat id -> user ids
  files: any[];
  orders: any[];
}

/** A small real PDF (one page of text), so example files open like the real thing. */
function examplePdf(title: string): Blob {
  const text = title.replace(/[()\\]/g, "");
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const at: number[] = [];
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([out], { type: "application/pdf" });
}

function seed(): DB {
  const t0 = iso(daysAgo(20, 9));
  const u = (name: string, role: string, email: string): User => ({ id: id(), name, role, email, status: "active", created_at: t0 });
  const users = [
    u("Aaron Lewis", "admin", "a_lewis@ronchiamerica.com"),
    u("Paolo Ferla", "manager", "paolo@ronchiamerica.com"),
    u("Lola Parker", "billing", "lola@ronchiamerica.com"),
    u("Meagan Hooper", "scheduling", "meagan@ronchiamerica.com"),
    u("Patrick Morgan", "tech", "PatrickM"),
    u("Steve Williams", "manager", "steve@ronchiamerica.com"),
    u("Andrew Yang", "sales", "andrew@ronchiamerica.com"),
    u("Michele Falsini", "manager", "michele@ronchiamerica.com"),
    u("Morad Rabah", "manager", "morad@ronchiamerica.com"),
    // The rest of the field team (Aaron, 2026-11-24), and the visiting techs from Erre Enne in Italy.
    u("Elim Ramirez", "tech", "ElimR"),
    u("Andrew Jackson", "tech", "AndrewJ"),
    u("Andres", "tech", "Andres"),
    u("Elias", "tech", "Elias"),
    u("Carlos", "tech", "Carlos"),
    u("Josue", "tech", "Josue"),
    u("William (Erre Enne)", "tech", "William"),
    u("Gabriele (Erre Enne)", "tech", "Gabriele"),
    // Office and shop staff (Aaron, 2026-11-25). April's and Joe's jobs aren't confirmed yet.
    u("April Pack", "service", "april@ronchiamerica.com"),
    u("Joe", "service", "Joe"),
    u("Nick Mason", "engineering", "nick@ronchiamerica.com"),
    u("Olivia", "r-shipping", "Olivia"),
  ];
  // A role made in People > Roles: Olivia helps with shipping, receiving and the shop.
  const roles: RoleRow[] = [{ id: "r-shipping", name: "Shipping, receiving and shop", perms: JSON.stringify(["boards.use", "catalog.view", "chats.start", "files.send", "kb.view", "machines.view", "orders.view"]) }];
  const [aaron, paolo, lola, meagan, steve, andrew, michele] = users as [User, User, User, User, User, User, User];
  const m = (serial: string, model: string, customer: string, site: string, notes = "") => ({ id: id(), serial, model, customer, site, notes, sharepoint_url: null, created_at: t0, updated_at: t0 });
  const machines = [
    m("3069MB", "Monoblock filler and capper", "Example Pharma Co.", "Columbus, OH", "Example record. Capper clutch serviced Oct 2026."),
    m("4222TP", "Rotary piston filler", "Example Foods Inc.", "Atlanta, GA"),
    m("4212MB", "Monoblock", "Example Home Care", "Chicago, IL"),
    m("3811CP", "Capper", "Example Pharma Co.", "Columbus, OH"),
    m("3535MB", "Monoblock", "Example Personal Care", "New Albany, OH"),
  ];
  const b = (name: string, description: string | null, by: User, audience: string[] | null = null, machine_id: string | null = null, n = 5) =>
    ({ id: id(), kind: "board", name, description, audience: audience ? JSON.stringify(audience) : null, machine_id, created_by: by.id, created_at: iso(daysAgo(n, 8)), archived_at: null, locked: 0 });
  const service = b("Service team", "Daily updates from the field", paolo, null, null, 9);
  const torque = b("3069MB capper torque", "Torque drift after long runs", aaron, null, machines[0]!.id, 4);
  const sales = b("Sales and quotes", "Machine quotes and change-part pricing", andrew, ["sales", "admin"], null, 6);
  const eng = b("Engineering questions", "Drawings, parts and changeover questions for engineering", steve, null, null, 3);
  const p = (board: any, user: User, body: string, at: Date, parent_id: string | null = null, pinned = 0) =>
    ({ id: id(), board_id: board.id, parent_id, user_id: user.id, body, pinned, created_at: iso(at), edited_at: null, deleted_at: null });
  const t1 = p(torque, aaron, "Torque drops about 10% after two hours on line 3. Clutch looks dry.", daysAgo(4, 10, 12));
  const s1 = p(service, paolo, "Reminder: service reports go in by Friday so I can review them before the weekly call.", daysAgo(9, 8, 30), null, 1);
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
  // A live-looking conversation from the last hour on the service board.
  const ago = (min: number) => new Date(Date.now() - min * 60000);
  const q1 = p(service, steve, "On site at Example Foods. Line 2 filler is short-filling on heads 7 and 8.", ago(52));
  posts.push(
    q1,
    p(service, aaron, "Check the nozzle O-rings on 7 and 8 first. We saw the same thing on the 3958MB.", ago(47), q1.id),
    p(service, steve, "O-rings were flat. Swapped both, running a test batch now.", ago(31)),
    p(service, steve, "Fill weights are back in spec. Leaving it running for an hour before I sign off.", ago(9)),
    p(service, paolo, "Good work. Put the O-ring part number in the service report please.", ago(4)),
  );
  const audit = [
    { at: iso(daysAgo(0, 7, 30)), action: "login", who: "Aaron Lewis", ip: "your phone" },
    { at: iso(daysAgo(1, 9, 0)), action: "invite.create", who: "Paolo Ferla", ip: "office" },
  ];
  // Private chats.
  const chat = (name: string, by: User, people: User[], n: number) => ({ id: id(), kind: "chat", name, description: null, audience: null, machine_id: null, created_by: by.id, created_at: iso(daysAgo(n, 8)), archived_at: null, locked: 0, people });
  const withSteve = chat("", steve, [aaron, steve], 6);
  const withLola = chat("", lola, [aaron, lola], 3);
  const crew = chat("Atlanta install crew", aaron, [aaron, steve, meagan], 5);
  const chats = [withSteve, withLola, crew];
  const files: any[] = [];
  const attach = (post: any, name: string, blob: Blob, url?: string) => {
    const info = fileInfo(name)!;
    files.push({ id: id(), post_id: post.id, board_id: post.board_id, user_id: post.user_id, name, ext: info.ext, kind: info.kind, size: blob.size, created_at: post.created_at, deleted_at: null, url: url ?? URL.createObjectURL(blob) });
  };
  const c1 = p(withSteve, steve, "Service report for the 4222TP changeover. Signed by the plant manager.", ago(185));
  const c2 = p(withSteve, aaron, "Thanks. I'll get it to Lola for the invoice.", ago(170));
  const c3 = p(withSteve, steve, "Fill weights from this morning's test batch, all 12 heads.", ago(26));
  const c4 = p(withLola, lola, "Is the 4222TP changeover ready to bill? I need the signed service report.", ago(160));
  const c5 = p(withLola, aaron, "Yes. Patrick sent it this morning, forwarding it now.", ago(150));
  const g1 = p(crew, meagan, "Flights are booked for Thursday 6:10 AM out of Columbus. Hotel is the Hampton by the plant.", daysAgo(1, 16, 20));
  const g2 = p(crew, steve, "I'll bring the torque wrench and the spare O-ring kit.", daysAgo(1, 16, 45));
  const g3 = p(crew, aaron, "Sounds good. Plant contact wants us on site by 8.", daysAgo(1, 17, 2), g1.id);
  const s9 = p(service, paolo, "Logo file for the service report header, please use this one from now on.", daysAgo(2, 11, 10));
  const g0 = { ...p(crew, aaron, JSON.stringify({ type: "added", names: ["Meagan Hooper"] }), daysAgo(1, 16, 5)), kind: "event" };
  posts.push(c1, c2, c3, c4, c5, g0, g1, g2, g3, s9);
  attach(c1, "Service report 4222TP changeover.pdf", examplePdf("Service report 4222TP changeover (example)"));
  attach(c5, "Service report 4222TP changeover.pdf", examplePdf("Service report 4222TP changeover (example)"));
  attach(c3, "Fill weights line 2 heads 1-12.csv", new Blob(["Head,Target g,Actual g\n" + Array.from({ length: 12 }, (_, i) => `${i + 1},500.0,${(499.6 + ((i * 7) % 9) / 10).toFixed(1)}`).join("\n")], { type: "text/csv" }));
  attach(s9, "ronchi-logo.png", new Blob(["png"], { type: "image/png" }), logoUrl);
  const members = Object.fromEntries(chats.map((c) => [c.id, c.people.map((x) => x.id)]));
  // Example change-part orders. Customers, POs and parts are made up.
  const dayIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const o = (customer: string, machine: string, part: string, status: string, more: Record<string, string | null> = {}, by: User = andrew, n = 3) => {
    const at = iso(daysAgo(n, 10));
    const row: any = { id: id(), customer, machine, part, status, customer_po: null, ra_po: null, aa: null, samples_received: null, samples_shipped: null, fill_test: null, ship_date: null, folder_url: null, notes: null, ...more, revision: 1, created_by: by.id, updated_by: by.id, created_at: at, updated_at: at };
    row._h = [{ at, action: "cp_order.create", who: by.name, changes: null }];
    return row;
  };
  // A preview built for one person can carry their real jobs (window.__CP_SEED, added to the built
  // file only, never to this repository). Otherwise the example orders below are used.
  const real = (globalThis as { __CP_SEED?: Record<string, string>[] }).__CP_SEED;
  const orders = real ? real.map((x, i) => {
    const at = iso(daysAgo(0, 8, 0));
    const row: any = { id: id(), ...Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v || null])), revision: 1, created_by: aaron.id, updated_by: aaron.id, created_at: at, updated_at: new Date(Date.parse(at) - i * 1000).toISOString() };
    row._h = [{ at, action: "cp_order.create", who: "Imported from SharePoint", changes: null }];
    return row;
  }) : [
    o("Example Pharma Co.", "3069MB", "250 ml oval bottle set (star wheels, guides, scroll)", "In production", { customer_po: "EPC-44817", ra_po: "RA-2611", aa: "AA-1093", samples_received: dayIso(-41), samples_shipped: dayIso(-38), fill_test: "Passed in Italy", ship_date: dayIso(12), notes: "Example order. Customer wants it before their January shutdown." }, andrew, 2),
    o("Example Foods Inc.", "4222TP", "Piston resize kit 1 L", "Waiting on samples", { customer_po: "EF-2210", ra_po: "RA-2614", notes: "Example. 24 bottles and caps promised by Friday." }, michele, 5),
    o("Example Home Care", "4212MB", "Trigger sprayer cap chuck set", "Ready to ship", { customer_po: "EHC-90021", ra_po: "RA-2598", aa: "AA-1081", samples_received: dayIso(-70), samples_shipped: dayIso(-66), fill_test: "Passed", ship_date: dayIso(-4) }, andrew, 1),
    o("Example Personal Care", "3535MB", "60 ml round bottle set", "Quote", { notes: "Example. Quote sent, waiting on PO." }, michele, 8),
    o("Example Pharma Co.", "3811CP", "38 mm cap chucks", "Shipped", { customer_po: "EPC-43002", ra_po: "RA-2560", aa: "AA-1040", samples_received: dayIso(-120), samples_shipped: dayIso(-115), fill_test: "Passed", ship_date: dayIso(-30) }, andrew, 29),
    o("Example Beverage LLC", "", "Neck guides for 2 L PET", "In design", { customer_po: "EB-7781", samples_received: dayIso(-9), samples_shipped: dayIso(-7) }, andrew, 4),
  ];
  if (!real) orders[0]._h.unshift({ at: iso(daysAgo(1, 15, 20)), action: "cp_order.update", who: andrew.name, changes: { status: ["Fill test", "In production"], ship_date: [dayIso(5), dayIso(12)] } });
  return {
    // Quick links on Home (Aaron adds these himself in the live portal).
    links: [
      { id: id(), label: "SharePoint", url: "https://ronchiam.sharepoint.com/", audience: null },
      { id: id(), label: "Ronchi Mario (Italy)", url: "https://www.ronchi.it/", audience: null },
      { id: id(), label: "Ronchi service portal", url: "https://service.ronchi.it/", audience: { roles: ["tech", "manager"], people: [] } },
      { id: id(), label: "busybusy time clock", url: "https://busybusy.com/", audience: { roles: ["tech"], people: [] } },
    ],
    users, roles, invites: [], machines, boards: [service, torque, sales, eng, ...chats.map(({ people: _p, ...c }) => c)], posts, audit, prefs: null,
    reads: { [torque.id]: iso(new Date()), [withLola.id]: iso(new Date()), [crew.id]: iso(new Date()), [withSteve.id]: iso(ago(100)) },
    muted: {}, members, files, orders,
  };
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
const savedPerms = (role: string) => db.roles.find((r) => r.id === role)?.perms ?? null;
/** Same shape as the server's listRoles: built-in roles (with any changes), then roles made here. */
function roleList() {
  const count = (rid: string) => db.users.filter((x) => x.role === rid && !x.removed_at).length;
  const builtIn = Object.entries(ROLES).map(([rid, nm]) => {
    const row = db.roles.find((r) => r.id === rid);
    return { id: rid, name: row?.name ?? nm, builtIn: true, changed: !!row, perms: [...rolePermissions(rid, row?.perms)] as string[], people: count(rid) };
  });
  const made = db.roles.filter((r) => !(r.id in ROLES)).map((r) => ({ id: r.id, name: r.name, builtIn: false, changed: false, perms: [...rolePermissions(r.id, r.perms)] as string[], people: count(r.id) }));
  return [...builtIn, ...made];
}

function route(method: string, path: string, q: URLSearchParams, body: any): unknown {
  const seg = path.split("/").filter(Boolean);
  const u = me();
  // --- auth & me ---
  if (path === "/auth/me") return { user: { id: u.id, name: u.name, email: u.email, role: u.role, permissions: [...effective(u.role, u.access, savedPerms(u.role))] } };
  if (path === "/auth/logout") throw new Fail(400, "Sign-out is turned off in this preview.");
  if (path === "/auth/add-device") return { link: "https://portal.ronchiamerica.com/welcome#example-one-time-link" };
  if (path === "/prefs") {
    const cur = db.prefs ?? { theme: "ronchi", mode: "auto", layout: "L2", tiles: null, lang: "en", popups: true };
    if (method === "PUT") db.prefs = body.reset ? { ...cur, theme: "ronchi", mode: "auto", layout: "L2", tiles: null } : { theme: body.theme, mode: body.mode ?? "auto", layout: body.layout ?? "L2", tiles: body.tiles ?? null, lang: body.lang ?? "en", popups: body.popups !== false };
    return db.prefs ?? cur;
  }
  // --- quick links ---
  if (path === "/links" && method === "GET") {
    const all = q.get("all") === "1";
    return { links: db.links.filter((l) => all || !l.audience || l.audience.roles.includes(u.role) || l.audience.people.includes(u.id)) };
  }
  if (path === "/links/order") {
    db.links.sort((a, b) => body.ids.indexOf(a.id) - body.ids.indexOf(b.id));
    return { ok: true };
  }
  if (seg[0] === "links") {
    const fixUrl = (v: string) => {
      const raw = /^[a-z][a-z0-9+.-]*:/i.test(v.trim()) ? v.trim() : `https://${v.trim()}`;
      try { const x = new URL(raw); if (!/^https?:$/.test(x.protocol) || !x.hostname.includes(".")) throw 0; return x.toString(); } catch { throw new Fail(400, "That web address doesn't look right."); }
    };
    const aud = (a: any) => (a && (a.roles?.length || a.people?.length) ? { roles: a.roles ?? [], people: a.people ?? [] } : null);
    if (method === "POST") {
      if (!String(body.label ?? "").trim()) throw new Fail(400, "Button name is required.");
      const l = { id: id(), label: String(body.label).trim().slice(0, 40), url: fixUrl(String(body.url ?? "")), audience: aud(body.audience) };
      db.links.push(l);
      log("link.create");
      return { id: l.id };
    }
    const l = db.links.find((x) => x.id === seg[1]);
    if (!l) throw new Fail(404, "Not found.");
    if (method === "DELETE") { db.links = db.links.filter((x) => x !== l); log("link.delete"); return { ok: true }; }
    if (body.label !== undefined) l.label = String(body.label).trim().slice(0, 40) || l.label;
    if (body.url !== undefined) l.url = fixUrl(String(body.url));
    if (body.audience !== undefined) l.audience = aud(body.audience);
    log("link.update");
    return { ok: true };
  }
  // --- people ---
  if (path === "/users/roles" && method === "GET") {
    const list = roleList();
    return { roles: Object.fromEntries(list.map((r) => [r.id, r.name])), named: Object.fromEntries(list.filter((r) => !r.builtIn || r.changed).map((r) => [r.id, r.name])), list };
  }
  if (path === "/users/roles" && method === "POST") {
    const nm = String(body.name ?? "").trim();
    if (!nm) throw new Fail(400, "Role name is required.");
    if (roleList().some((r) => r.name.toLowerCase() === nm.toLowerCase())) throw new Fail(409, "There's already a role with that name.");
    const from = body.copyFrom ? roleList().find((r) => r.id === body.copyFrom) : null;
    const rid = `r-${id().slice(0, 8)}`;
    db.roles.push({ id: rid, name: nm, perms: JSON.stringify((from?.perms ?? []).filter((p) => adjustable(p as never))) });
    log("role.create");
    return { id: rid };
  }
  if (seg[0] === "users" && seg[1] === "roles" && seg[2]) {
    const rid = seg[2];
    const cur = roleList().find((r) => r.id === rid);
    if (!cur) throw new Fail(404, "Not found.");
    if (seg[3] === "reset") { db.roles = db.roles.filter((r) => r.id !== rid); log("role.reset"); return { ok: true }; }
    if (method === "DELETE") {
      if (cur.builtIn) throw new Fail(400, "Built-in roles can't be deleted. You can change their switches instead.");
      if (cur.people) throw new Fail(409, "People have this role. Give them another role first.");
      db.roles = db.roles.filter((r) => r.id !== rid);
      log("role.delete");
      return { ok: true };
    }
    if (rid === "admin") throw new Fail(400, "The admin role always has everything.");
    const nm = body.name === undefined ? cur.name : String(body.name).trim();
    if (!nm) throw new Fail(400, "Role name is required.");
    if (roleList().some((r) => r.id !== rid && r.name.toLowerCase() === nm.toLowerCase())) throw new Fail(409, "There's already a role with that name.");
    const perms = body.perms === undefined ? cur.perms : (body.perms as string[]).filter((p) => isPermission(p) && adjustable(p));
    db.roles = [...db.roles.filter((r) => r.id !== rid), { id: rid, name: nm, perms: JSON.stringify(perms) }];
    log("role.update");
    return { ok: true };
  }
  if (path === "/users/permissions")
    return { groups: PERMISSION_GROUPS.map((g) => ({ ...g, perms: g.perms.map((p) => ({ ...p, adjustable: adjustable(p.id), view: VIEW_PERMS.has(p.id) })) })), byRole: Object.fromEntries(roleList().map((r) => [r.id, r.perms])) };
  if (seg[0] === "users" && (seg[2] === "remove" || seg[2] === "restore")) {
    const t = db.users.find((x) => x.id === seg[1]);
    if (!t) throw new Fail(404, "Not found.");
    if (seg[2] === "remove") {
      if (t.id === u.id) throw new Fail(400, "You can't remove yourself.");
      if (t.role === "admin") throw new Fail(400, "Admins can't be removed. Change their role first.");
      t.removed_at = iso(new Date());
      t.status = "disabled";
      log("user.remove");
    } else {
      if (body.role) t.role = body.role;
      else if (!roleList().some((r) => r.id === t.role)) throw new Fail(409, "Their old role was deleted. Pick a role for them, then press Restore.");
      t.removed_at = null;
      t.status = "active";
      log("user.restore");
    }
    return { ok: true };
  }
  if (seg[0] === "users" && seg[2] === "access" && method === "PUT") {
    const t = db.users.find((x) => x.id === seg[1]);
    if (!t) throw new Fail(404, "Not found.");
    if (t.id === u.id) throw new Fail(400, "You can't change your own access. Ask another admin.");
    if (t.role === "admin") throw new Fail(400, "Admins always have everything. Change their role first.");
    const next: AccessChanges = body.reset ? {} : { ...(t.access ?? {}) };
    for (const [perm, on] of Object.entries(body.changes ?? {})) {
      if (!isPermission(perm) || !adjustable(perm)) throw new Fail(400, "Managing people and the audit log stay with admins. Make them an admin instead.");
      if (on === null) delete next[perm];
      else next[perm] = !!on;
    }
    t.access = next;
    log("user.access");
    return { changes: next, permissions: [...effective(t.role, next, savedPerms(t.role))] };
  }
  if (path === "/users" && method === "GET")
    return { users: db.users.map((x) => ({ ...x, access: x.role === "admin" ? {} : (x.access ?? {}), permissions: [...effective(x.role, x.access, savedPerms(x.role))], passkeys: 1 + (x.id === u.id ? 1 : 0), sessions: x.status === "active" ? 1 : 0 })), invites: db.invites };
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
    log("user.update");
    return { ok: true };
  }
  // --- parts catalog (the preview has no manuals or customer parts site, so it starts empty) ---
  if (seg[0] === "kb") {
    try {
      return kbRoute(method, seg, q, body, { me: u, perms: effective(u.role, u.access, savedPerms(u.role)) as Set<string>, machines: db.machines, nameOf: (x) => (x ? name(x) || null : null), newId: id }, db.users);
    } catch (e) {
      if (e instanceof KbFail) throw new Fail(e.status, e.message);
      throw e;
    }
  }
  if (path === "/catalog/machines") return { machines: db.machines.map((m) => ({ id: m.id, serial: m.serial, model: m.model, sheets: 0, models: 0, catalog_published_at: null })), partsSite: false };
  if (path === "/catalog/search") return { results: [] };
  if (seg[0] === "catalog" && seg[1] === "machines" && seg[2] && method === "GET") {
    const m = db.machines.find((x) => x.id === seg[2]);
    if (!m) throw new Fail(404, "Not found.");
    return { machine: { id: m.id, serial: m.serial, model: m.model, catalog_published_at: null }, sheets: [], imports: [] };
  }
  if (seg[0] === "catalog" || seg[0] === "customers" || seg[0] === "quotes") throw new Fail(400, "The parts catalog needs the real portal; it isn't part of this preview.");
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
    return { machine: m, boards: db.boards.filter((b) => b.machine_id === m.id && !b.archived_at), orders: db.orders.filter((x) => x.machine === m.serial && !x.removed_at).map(({ _h, ...x }) => x) };
  }
  // --- change-part orders ---
  if (seg[0] === "change-parts") {
    const view = (x: any) => {
      const { _h, ...rest } = x;
      return { ...rest, open: isOpen(x.status), machine_id: db.machines.find((m) => m.serial === x.machine)?.id ?? null };
    };
    const tidy = (b: any) => {
      const out: any = {};
      for (const f of CP_FIELDS) {
        if (!(f in b)) continue;
        const v = String(b[f] ?? "").trim();
        if (v && f === "folder_url" && !/^https:\/\/[a-z0-9-]+(?:-my)?\.sharepoint\.com\//i.test(v)) throw new Fail(400, "The folder link must start with https://<company>.sharepoint.com/");
        out[f] = (f === "machine" ? v.toUpperCase() : v) || null;
      }
      return out;
    };
    const live = db.orders.filter((x) => !x.removed_at);
    if (seg.length === 1 && method === "GET") return { orders: live.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(view) };
    if (seg.length === 1 && method === "POST") {
      const f = tidy(body);
      if (!f.customer) throw new Fail(400, "Customer is required.");
      const at = iso(new Date());
      const row = { id: id(), ...Object.fromEntries(CP_FIELDS.map((k) => [k, null])), ...f, revision: 1, created_at: at, updated_at: at, _h: [{ at, action: "cp_order.create", who: u.name, changes: null }] };
      db.orders.push(row);
      return { id: row.id };
    }
    if (seg[1] === "import") {
      const read = readOrdersCsv(String(body.csv ?? ""));
      const k = (x: any) => [x.customer, x.machine, x.part, x.customer_po].map((v) => String(v ?? "").trim().toLowerCase()).join("|");
      const have = new Set(live.map(k));
      const fresh = read.orders.filter((x) => (have.has(k(x)) ? false : (have.add(k(x)), true)));
      const summary = { found: read.orders.length, adding: fresh.length, duplicates: read.orders.length - fresh.length, skipped: read.skipped, matched: read.matched, extra: read.extra, problems: read.problems, sample: fresh.slice(0, 5) };
      if (body.confirm !== true) return summary;
      const at = iso(new Date());
      for (const x of fresh) db.orders.push({ id: id(), ...Object.fromEntries(CP_FIELDS.map((f) => [f, null])), ...x, revision: 1, created_at: at, updated_at: at, _h: [{ at, action: "cp_order.create", who: u.name, changes: null }] });
      return { ...summary, imported: fresh.length };
    }
    const row = live.find((x) => x.id === seg[1]);
    if (!row) throw new Fail(404, "Not found.");
    if (method === "DELETE") {
      row.removed_at = iso(new Date());
      return { ok: true };
    }
    if (method === "PATCH") {
      if (body.revision !== row.revision) throw new Fail(409, "Someone else changed this order while you were editing. Reload to see their changes.");
      const f = tidy(body);
      const changes: any = {};
      for (const [key, v] of Object.entries(f)) if ((row[key] ?? null) !== v) changes[key] = [row[key] ?? null, v];
      if (!Object.keys(changes).length) return { ok: true, revision: row.revision };
      Object.assign(row, f, { revision: row.revision + 1, updated_at: iso(new Date()) });
      row._h.unshift({ at: row.updated_at, action: "cp_order.update", who: u.name, changes });
      return { ok: true, revision: row.revision };
    }
    const creator = db.users.find((x) => x.id === row.created_by);
    return { order: { ...view(row), created_by_name: creator?.name ?? null }, history: row._h };
  }
  // --- boards and chats ---
  const visible = (b: any) => !b.archived_at && (b.kind === "chat" ? (db.members[b.id] ?? []).includes(u.id) : true);
  const live = (bid: string) => db.posts.filter((p) => p.board_id === bid && !p.deleted_at).sort((x, y) => x.created_at.localeCompare(y.created_at));
  const liveFiles = (postId: string) => db.files.filter((f) => f.post_id === postId && !f.deleted_at);
  const membersOf = (bid: string) => (db.members[bid] ?? []).map((uid) => db.users.find((x) => x.id === uid)!).map((x) => ({ id: x.id, name: x.name, role: x.role }));
  const event = (b: any, type: string, names: string[]) =>
    db.posts.push({ id: id(), board_id: b.id, parent_id: null, user_id: u.id, body: JSON.stringify({ type, names }), kind: "event", pinned: 0, created_at: iso(new Date()), edited_at: null, deleted_at: null });
  const listRow = (b: any) => {
    const posts = live(b.id).filter((p) => p.kind !== "event");
    const last = posts.at(-1);
    const unread = posts.filter((p) => p.user_id !== u.id && p.created_at > (db.reads[b.id] ?? "")).length;
    return {
      ...b, last_post_at: last?.created_at ?? null, unread, muted: db.muted[b.id] ? 1 : 0,
      last_user_id: last?.user_id ?? null, last_author: last ? name(last.user_id) : null, last_body: last ? last.body.slice(0, 120) : null,
      last_files: last ? liveFiles(last.id).length : 0, members: b.kind === "chat" ? membersOf(b.id) : undefined,
    };
  };
  const list = (kind: string, archived = false) =>
    db.boards.filter((b) => b.kind === kind && (archived ? !!b.archived_at : visible(b))).map(listRow)
      .sort((a, b) => (b.last_post_at ?? b.created_at).localeCompare(a.last_post_at ?? a.created_at));
  if (path === "/boards" && method === "GET") return { boards: list(q.get("kind") === "chat" ? "chat" : "board") };
  if (path === "/boards/archived") return { boards: list("board", true) };
  if (path === "/boards/people") return { people: db.users.filter((x) => x.id !== u.id && x.status === "active").map((x) => ({ id: x.id, name: x.name, role: x.role })).sort((a, b) => a.name.localeCompare(b.name)) };
  if (path === "/boards/updates") {
    const at = iso(new Date());
    const unread = { boards: list("board").reduce((n, b) => n + b.unread, 0), chats: list("chat").reduce((n, b) => n + b.unread, 0) };
    const since = q.get("since");
    if (!since) return { now: at, posts: [], unread };
    const posts = db.posts
      .filter((p) => p.created_at > since && p.user_id !== u.id && !p.deleted_at && p.kind !== "event")
      .map((p) => ({ p, b: db.boards.find((b) => b.id === p.board_id)! }))
      .filter(({ b }) => visible(b) && !db.muted[b.id])
      .map(({ p, b }) => ({ id: p.id, board_id: b.id, body: p.body.slice(0, 160), created_at: p.created_at, author: name(p.user_id), board_name: b.name, kind: b.kind, files: liveFiles(p.id).length }));
    return { now: at, posts, unread };
  }
  if (path === "/boards/read-all") {
    for (const b of db.boards) db.reads[b.id] = iso(new Date());
    return { ok: true };
  }
  if (path === "/boards/chats") {
    const others = (body.userIds ?? []).filter((x: string) => x !== u.id);
    if (!others.length) throw new Fail(400, "Pick who to chat with.");
    if (others.length === 1 && !body.name) {
      const found = db.boards.find((b) => b.kind === "chat" && !b.name && (db.members[b.id] ?? []).length === 2 && db.members[b.id]!.includes(others[0]) && db.members[b.id]!.includes(u.id));
      if (found) return { id: found.id };
    }
    const c = { id: id(), kind: "chat", name: body.name ?? "", description: null, audience: null, machine_id: null, created_by: u.id, created_at: iso(new Date()), archived_at: null, locked: 0 };
    db.boards.push(c);
    db.members[c.id] = [u.id, ...others];
    return { id: c.id };
  }
  if (path === "/boards" && method === "POST") {
    if (!body.name?.trim()) throw new Fail(400, "Board name is required.");
    const b = { id: id(), kind: "board", name: body.name.trim(), description: body.description || null, audience: body.audience?.length ? JSON.stringify([...new Set([...body.audience, u.role])]) : null, machine_id: null, created_by: u.id, created_at: iso(new Date()), archived_at: null, locked: 0 };
    db.boards.push(b);
    log("board.create");
    return { id: b.id };
  }
  if (seg[0] === "boards") {
    const b = db.boards.find((x) => x.id === seg[1]);
    if (!b || (b.kind === "chat" && !(db.members[b.id] ?? []).includes(u.id))) throw new Fail(404, "Not found.");
    const moderate = b.kind === "chat" ? b.created_by === u.id : true;
    if (seg[2] === "read") {
      db.reads[b.id] = iso(new Date());
      return { ok: true };
    }
    if (seg[2] === "mute") {
      db.muted[b.id] = !!body.muted;
      return { muted: !!body.muted };
    }
    if (seg[2] === "archive") {
      b.archived_at = iso(new Date());
      log("board.archive");
      return { ok: true };
    }
    if (seg[2] === "unarchive") {
      b.archived_at = null;
      log("board.unarchive");
      return { ok: true };
    }
    if (seg[2] === "leave") {
      db.members[b.id] = (db.members[b.id] ?? []).filter((x) => x !== u.id);
      event(b, "left", []);
      if (b.created_by === u.id && db.members[b.id]!.length) b.created_by = db.members[b.id]![0];
      return { ok: true };
    }
    if (seg[2] === "people" && method === "POST") {
      const have = db.members[b.id] ?? [];
      const add = (body.userIds ?? []).filter((x: string) => !have.includes(x));
      if (!add.length) throw new Fail(400, "Pick someone who isn't in this chat yet.");
      const names = add.map(name).sort();
      if (!b.name && have.length <= 2) {
        const c = { id: id(), kind: "chat", name: "", description: null, audience: null, machine_id: null, created_by: u.id, created_at: iso(new Date()), archived_at: null, locked: 0 };
        db.boards.push(c);
        db.members[c.id] = [...have, ...add];
        return { id: c.id, newChat: true };
      }
      db.members[b.id] = [...have, ...add];
      event(b, "added", names);
      return { id: b.id, newChat: false };
    }
    if (seg[2] === "people" && seg[3] && method === "DELETE") {
      if (!moderate) throw new Fail(403, "Only the person who started this chat can remove people.");
      if (seg[3] === u.id) throw new Fail(400, "To take yourself out, leave the chat.");
      if (!(db.members[b.id] ?? []).includes(seg[3])) throw new Fail(404, "That person isn't in this chat.");
      db.members[b.id] = db.members[b.id]!.filter((x) => x !== seg[3]);
      event(b, "removed", [name(seg[3])]);
      return { ok: true };
    }
    if (seg[2] === "files") {
      return { files: db.files.filter((f) => f.board_id === b.id && !f.deleted_at).map((f) => ({ ...f, author: name(f.user_id) })).sort((x, y) => y.created_at.localeCompare(x.created_at)) };
    }
    if (seg[2] === "export") {
      const lines = [b.name || "Chat", `Exported ${iso(new Date())} by ${u.name}. Times are UTC.`, ""];
      for (const p of live(b.id)) {
        const f = liveFiles(p.id).map((x) => x.name).join(", ");
        if (p.kind === "event") {
          const e = JSON.parse(p.body);
          lines.push(`[${p.created_at.slice(0, 16).replace("T", " ")}] ${name(p.user_id)} ${e.type === "left" ? "left the chat" : `${e.type} ${e.names.join(", ")}`}`);
          continue;
        }
        lines.push(`[${p.created_at.slice(0, 16).replace("T", " ")}] ${name(p.user_id)}: ${p.body}${f ? ` (files: ${f})` : ""}`);
      }
      return { __text: lines.join("\r\n") };
    }
    if (!seg[2] && method === "PATCH") {
      if (b.kind === "board") {
        if (body.name !== undefined) b.name = String(body.name).trim() || b.name;
        if (body.description !== undefined) b.description = body.description || null;
        if (body.audience !== undefined) b.audience = body.audience.length ? JSON.stringify([...new Set([...body.audience, u.role])]) : null;
        if (body.locked !== undefined) b.locked = body.locked ? 1 : 0;
      } else {
        if (!moderate) throw new Fail(403, "Only the person who started this chat can change it.");
        if (body.name !== undefined) b.name = String(body.name).trim();
      }
      log(`${b.kind}.update`);
      return { ok: true };
    }
    if (seg[2] === "posts" && !seg[3]) {
      const files: File[] = body.files ?? [];
      if (!body.body?.trim() && !files.length) throw new Fail(400, "Message is required.");
      for (const f of files) {
        const problem = fileProblem(f.name, f.size);
        if (problem) throw new Fail(400, `${f.name}: ${problem}`);
      }
      const p = { id: id(), board_id: b.id, parent_id: body.parentId || null, user_id: u.id, body: (body.body ?? "").trim(), pinned: 0, created_at: iso(new Date()), edited_at: null, deleted_at: null };
      db.posts.push(p);
      for (const f of files) {
        const info = fileInfo(f.name)!;
        db.files.push({ id: id(), post_id: p.id, board_id: b.id, user_id: u.id, name: cleanName(f.name), ext: info.ext, kind: info.kind, size: f.size, created_at: p.created_at, deleted_at: null, url: URL.createObjectURL(f) });
      }
      return { id: p.id };
    }
    if (seg[2] === "posts" && seg[3]) {
      const p = db.posts.find((x) => x.id === seg[3] && x.kind !== "event");
      if (!p) throw new Fail(404, "Not found.");
      if (method === "DELETE") {
        p.deleted_at = iso(new Date());
        for (const f of liveFiles(p.id)) f.deleted_at = p.deleted_at;
      }
      if (method === "PATCH" && body.pinned !== undefined) p.pinned = body.pinned ? 1 : 0;
      if (method === "PATCH" && body.body !== undefined) {
        if (!String(body.body).trim()) throw new Fail(400, "Message is required.");
        p.body = String(body.body).trim();
        p.edited_at = iso(new Date());
      }
      return { ok: true };
    }
    return {
      board: b,
      members: b.kind === "chat" ? membersOf(b.id) : undefined,
      canModerate: moderate,
      canPost: !b.archived_at && (!b.locked || moderate),
      muted: !!db.muted[b.id],
      posts: live(b.id).reverse().map((p) => ({ ...p, author: name(p.user_id), files: liveFiles(p.id) })),
    };
  }
  throw new Fail(404, "Not found.");
}

/** Answer /api/... calls from the example data instead of a server. */
export function installDemo() {
  db = load();
  // A couple of messages "arrive" while the preview is open, so the pop-up alerts can be seen.
  const arrive = (afterMs: number, who: string, where: (b: any) => boolean, text: string) =>
    setTimeout(() => {
      const b = db.boards.find(where);
      const u = db.users.find((x) => x.name === who);
      if (b && u) db.posts.push({ id: id(), board_id: b.id, parent_id: null, user_id: u.id, body: text, pinned: 0, created_at: iso(new Date()), edited_at: null, deleted_at: null });
    }, afterMs);
  arrive(12000, "Patrick Morgan", (b) => b.kind === "chat" && !b.name && (db.members[b.id] ?? []).includes(db.users[4]!.id), "Line 2 is signed off. Heading back to the hotel, I'll call you in the morning.");
  arrive(45000, "Meagan Hooper", (b) => b.name === "Atlanta install crew", "Rental car is confirmed at the airport, under Patrick's name.");
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    const at = url.pathname.indexOf("/api/");
    if (at < 0) return realFetch(input, init);
    const path = url.pathname.slice(at + 4);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: any = {};
    if (init?.body instanceof FormData) {
      const f = init.body;
      body = { body: f.get("body") ?? "", parentId: f.get("parentId") ?? null, files: f.getAll("files") };
    } else {
      try {
        body = init?.body ? JSON.parse(String(init.body)) : {};
      } catch {
        body = {};
      }
    }
    await new Promise((r) => setTimeout(r, 60));
    try {
      const data = route(method, path, url.searchParams, body) as any;
      save();
      if (data && typeof data.__text === "string") return new Response(data.__text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
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
  resetKb();
  save();
}
