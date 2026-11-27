// Who can do what. Deny by default: anything not listed here is refused.
// To change what a role can do, edit this one table (and its test in test/roles.test.ts).
export type Role = "admin" | "manager" | "billing" | "scheduling" | "service" | "sales" | "engineering" | "tech";

export const ROLES: Record<Role, string> = {
  admin: "Admin: everything (Aaron)",
  manager: "Manager (Paolo, Steve, Michele, Morad)",
  billing: "Billing (Lola)",
  scheduling: "Scheduling (Meagan)",
  service: "Service",
  sales: "Sales",
  engineering: "Engineering",
  tech: "Field service engineer",
};

export type Permission =
  | "settings.manage"     // the admin controls in Settings (admins only)
  | "users.manage"        // invite people, change roles, disable, sign out everywhere
  | "audit.view"
  | "machines.view"
  | "machines.add"        // add a machine to the list
  | "machines.edit"       // change a machine's model, customer, site, notes and link
  | "boards.use"          // read and post on boards they can see
  | "boards.create"       // start a new board
  | "chats.start"         // start a private chat (they can still answer chats others add them to)
  | "files.send"          // attach photos and files in chats and boards
  | "boards.moderate"     // pin, archive, remove anyone's post
  | "boards.export"       // download a chat or board as a text file
  | "catalog.view"        // the parts catalog: drawings, 3D, parts lists, where-used, staff notes
  | "catalog.edit"        // import manuals, fix tables, upload drawings and 3D
  | "catalog.publish"     // publish a machine's catalog to the customer parts site, or take it down
  | "customers.manage"    // customer companies and which machines each one sees
  | "customers.invite"    // customer sign-up links, and turning a customer person on or off
  | "quotes.manage"       // read customer quote requests and set their status
  | "cpsales.view"        // see change-part sales (before they're orders)
  | "cpsales.edit"        // start, work and close change-part sales, and mark them sold
  | "orders.view"         // see change-part orders (sales side)
  | "orders.add"          // add a change-part order
  | "orders.edit"         // change an order's details and status
  | "orders.remove"       // remove an order
  | "orders.import"       // bring in orders from a CSV spreadsheet
  | "orders.export"       // download the order list as a spreadsheet
  | "machinesales.view"   // see new-machine deals (never their dollar value)
  | "machinesales.add"    // start a deal
  | "machinesales.edit"   // change a deal, move its stage, log calls and visits
  | "machinesales.remove" // take a deal off the list
  | "machinesales.prices" // see and set deal values and the pipeline totals
  | "partsorders.view"    // see spare parts orders (sales side)
  | "partsorders.add"     // start a parts order, by hand, as a repeat, or from a quote request
  | "partsorders.edit"    // change an order, its lines, status, arrivals and shipments
  | "partsorders.remove"  // take a parts order off the list
  | "partsorders.prices"  // see and set prices, costs, discounts and totals
  | "partsorders.reports" // sales by month, customer and part; how long orders take
  | "partsorders.export"  // download the parts order list as a spreadsheet
  | "kb.view"             // search and read the knowledge base
  | "kb.write"            // add quick notes and articles, change your own
  | "kb.edit_all"         // change or archive anyone's article
  | "kb.import"           // bring in documents from the import file
  | "kb.publish"          // publish to and take down from the customer help center
  | "software.view"       // open software packages (installers, program folders) and download them
  | "software.manage"     // make software packages, upload and remove installers and folders
  | "jobs.view"           // see field service jobs and their machine history, and add files to them
  | "jobs.schedule"       // schedule jobs, choose the field service engineers, send the job emails
  | "shipping.view"       // see shipments going out and coming in, track them, add photos and papers
  | "shipping.edit"      // make and change shipments, mark them shipped, check deliveries in
  | "inventory.view"      // see what is in stock, where, and what is reserved
  | "inventory.edit"      // put stock in, take it out, move it between shelves
  | "inventory.adjust"    // correct a count, change a part's stock details, import a stock list
  | "inventory.prices"    // see and set part costs and stock value
  | "workbook.billing";   // see every engineer's billable hours and expenses across jobs, and export them

const ALL: Permission[] = [
  "settings.manage", "users.manage", "audit.view", "machines.view", "machines.add", "machines.edit",
  "boards.use", "boards.create", "chats.start", "files.send", "boards.moderate", "boards.export",
  "catalog.view", "catalog.edit", "catalog.publish", "customers.manage", "customers.invite", "quotes.manage",
  "cpsales.view", "cpsales.edit", "orders.view", "orders.add", "orders.edit", "orders.remove", "orders.import", "orders.export",
  "partsorders.view", "partsorders.add", "partsorders.edit", "partsorders.remove", "partsorders.prices", "partsorders.reports", "partsorders.export",
  "machinesales.view", "machinesales.add", "machinesales.edit", "machinesales.remove", "machinesales.prices",
  "kb.view", "kb.write", "kb.edit_all", "kb.import", "kb.publish",
  "software.view", "software.manage",
  "jobs.view", "jobs.schedule", "workbook.billing",
  "shipping.view", "shipping.edit",
  "inventory.view", "inventory.edit", "inventory.adjust", "inventory.prices",
];

const STAFF_BASE: Permission[] = ["boards.use", "boards.create", "chats.start", "files.send", "boards.export", "machines.view", "catalog.view", "kb.view", "kb.write", "software.view", "jobs.view", "shipping.view", "machinesales.view", "inventory.view"];

// Managers (Aaron, 2026-11-24: "paolo, steve, michele, and morad should all be manager level log
// ins i am the only admin") get everything except managing people and reading the audit log.
const MANAGER: Permission[] = ALL.filter((p) => p !== "users.manage" && p !== "audit.view" && p !== "settings.manage");

export const PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set(ALL),
  manager: new Set(MANAGER),
  // Billing (Lola) types the QuickBooks invoice number and needs the prices to bill.
  billing: new Set([...STAFF_BASE, "inventory.prices", "quotes.manage", "workbook.billing", "machinesales.prices", "partsorders.view", "partsorders.edit", "partsorders.prices", "partsorders.reports", "partsorders.export"]),
  // Scheduling (Meagan) also handles parts: she can take orders and track arrivals, without prices.
  scheduling: new Set([...STAFF_BASE, "inventory.edit", "inventory.adjust", "jobs.schedule", "shipping.edit", "partsorders.view", "partsorders.add", "partsorders.edit", "partsorders.export"]),
  service: new Set([...STAFF_BASE, "inventory.edit", "machines.add", "machines.edit", "boards.moderate", "catalog.edit", "catalog.publish", "customers.manage", "customers.invite", "quotes.manage", "kb.edit_all", "kb.import", "kb.publish", "jobs.schedule", "shipping.edit"]),
  sales: new Set([...STAFF_BASE, "inventory.edit", "inventory.prices", "customers.manage", "customers.invite", "quotes.manage", "cpsales.view", "cpsales.edit", "orders.view", "orders.add", "orders.edit", "orders.remove", "orders.import", "orders.export", "shipping.edit",
    "partsorders.view", "partsorders.add", "partsorders.edit", "partsorders.remove", "partsorders.prices", "partsorders.reports", "partsorders.export",
    "machinesales.add", "machinesales.edit", "machinesales.remove", "machinesales.prices"]),
  engineering: new Set([...STAFF_BASE, "machines.add", "machines.edit", "catalog.edit", "catalog.publish", "kb.edit_all", "kb.import", "kb.publish", "software.manage"]),
  tech: new Set([...STAFF_BASE]),
};

/** What a role allows on its own, before any per-person changes. */
export function can(role: Role | undefined | null, perm: Permission): boolean {
  if (!role) return false;
  if (role !== "admin" && switchedOff.has(perm)) return false;
  return PERMISSIONS[role]?.has(perm) ?? false;
}

// ---- Sections switched off in Settings > Command center ----
// Their permissions are taken from everyone except admins, whatever their role or own changes say.
let switchedOff: ReadonlySet<Permission> = new Set();

/** Called by lib/settings-store.ts whenever Settings are loaded or saved. */
export function setSwitchedOff(perms: Iterable<Permission>) {
  switchedOff = new Set([...perms].filter((p) => !ADMIN_ONLY.has(p)));
}

// ---- Per-person access (Aaron, 2026-11-24: "i need to be able to control more in detail") ----
// A person starts with their role's permissions. An admin can then switch any single permission
// on or off for that one person. These stay with the role's rules, never instead of them:
//  - admins always have everything (no one can switch an admin's access off),
//  - managing people and reading the audit log stay admin-only and can't be handed out.

export const ADMIN_ONLY: ReadonlySet<Permission> = new Set(["users.manage", "audit.view", "settings.manage"]);

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (ALL as string[]).includes(value);
}

/** Can this permission be switched on or off for one person? */
export function adjustable(perm: Permission): boolean {
  return !ADMIN_ONLY.has(perm);
}

/** A person's own changes: true = switched on, false = switched off. Anything missing follows the role. */
export type AccessChanges = Partial<Record<Permission, boolean>>;

/** Built-in role ids (the rest live in the roles table). */
export function isBuiltInRole(value: unknown): value is Role {
  return isRole(value);
}

/**
 * What a role allows. `saved` is the role's switches from the roles table (a JSON list), when it
 * has a row there: a role an admin created, or a built-in role whose switches were changed.
 * Admin always has everything; no other role can hold the admin-only permissions.
 */
export function rolePermissions(role: string, saved?: string | null): Set<Permission> {
  if (role === "admin") return new Set(ALL);
  if (saved != null) {
    let list: unknown = [];
    try { list = JSON.parse(saved); } catch { list = []; }
    return new Set((Array.isArray(list) ? list : []).filter((p): p is Permission => isPermission(p) && adjustable(p)));
  }
  return new Set(isRole(role) ? PERMISSIONS[role] : []);
}

/** Everything one person may do: their role, plus their own changes. */
export function effective(role: string, changes: AccessChanges | null | undefined, saved?: string | null): Set<Permission> {
  const out = rolePermissions(role, saved);
  if (role === "admin") return out;
  for (const [perm, on] of Object.entries(changes ?? {})) {
    if (!isPermission(perm) || !adjustable(perm)) continue;
    if (on) out.add(perm);
    else out.delete(perm);
  }
  for (const p of switchedOff) out.delete(p); // a section turned off in Settings wins
  return out;
}

/** Read the "perm=1,perm=0" list stored with a session. Unknown names are ignored. */
export function readChanges(list: string | null | undefined): AccessChanges {
  const out: AccessChanges = {};
  for (const item of (list ?? "").split(",")) {
    const [perm, on] = item.split("=");
    if (isPermission(perm) && (on === "1" || on === "0")) out[perm] = on === "1";
  }
  return out;
}

/** SQL that keeps only access changes that haven't run out (alias a = user_access). Same text format as toISOString(). */
export const ACCESS_LIVE = "(a.expires_at IS NULL OR a.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

/** Seeing, without changing anything: what "View only" on the access screen keeps on. */
export const VIEW_PERMS: ReadonlySet<Permission> = new Set(["boards.use", "machines.view", "catalog.view", "kb.view", "software.view", "cpsales.view", "orders.view", "partsorders.view", "machinesales.view", "jobs.view", "shipping.view", "inventory.view"]);

/** Plain-English names for the access screen, grouped the way the menu is. */
export const PERMISSION_GROUPS: { group: string; perms: { id: Permission; label: string; hint: string }[] }[] = [
  { group: "Chats and boards", perms: [
    { id: "boards.use", label: "Use chats and boards", hint: "Read and post on the boards they can see, and answer chats." },
    { id: "boards.create", label: "Start new boards", hint: "Make a new message board." },
    { id: "chats.start", label: "Start private chats", hint: "Open a new chat with other staff." },
    { id: "files.send", label: "Send photos and files", hint: "Attach photos and files to messages." },
    { id: "boards.moderate", label: "Moderate boards", hint: "Pin, lock, archive and remove anyone's post." },
    { id: "boards.export", label: "Export chats and boards", hint: "Download a whole chat, or a board they run, as a text file." },
  ] },
  { group: "Machines", perms: [
    { id: "machines.view", label: "See machines", hint: "The machine list and each machine's page." },
    { id: "machines.add", label: "Add machines", hint: "Put a new machine on the list." },
    { id: "machines.edit", label: "Change machines", hint: "Change a machine's model, customer, site, notes and SharePoint link." },
  ] },
  { group: "Parts catalog", perms: [
    { id: "catalog.view", label: "See the parts catalog", hint: "Drawings, 3D, parts lists and staff notes." },
    { id: "catalog.edit", label: "Build the parts catalog", hint: "Import manuals, fix tables, upload drawings and 3D." },
    { id: "catalog.publish", label: "Publish catalogs to customers", hint: "Put a machine's catalog on the customer parts site, or take it down." },
  ] },
  { group: "Customers", perms: [
    { id: "customers.manage", label: "Customer companies", hint: "Add, rename or turn off companies, and choose which machines each one sees." },
    { id: "customers.invite", label: "Customer logins", hint: "Make sign-up links, and turn a customer's login on or off." },
    { id: "quotes.manage", label: "Quote requests", hint: "Read customer quote requests and set their status." },
  ] },
  { group: "Change parts", perms: [
    { id: "cpsales.view", label: "See change-part sales", hint: "Change-part requests and quotes that aren't sold yet." },
    { id: "cpsales.edit", label: "Work change-part sales", hint: "Start, update and close sales, and mark a sale sold so it becomes an order." },
    { id: "orders.view", label: "See orders", hint: "The change-part order tracker." },
    { id: "orders.add", label: "Add orders", hint: "Start a new change-part order." },
    { id: "orders.edit", label: "Change orders", hint: "Change an order's details and status." },
    { id: "orders.remove", label: "Remove orders", hint: "Take an order off the list." },
    { id: "orders.import", label: "Import orders", hint: "Bring in orders from a CSV spreadsheet." },
    { id: "orders.export", label: "Export orders", hint: "Download the order list as a spreadsheet." },
  ] },
  { group: "Machine sales", perms: [
    { id: "machinesales.view", label: "See machine deals", hint: "New-machine deals and where each one stands. Dollar values stay hidden." },
    { id: "machinesales.add", label: "Add machine deals", hint: "Start a new machine deal." },
    { id: "machinesales.edit", label: "Change machine deals", hint: "Change a deal, move its stage, and log calls, visits and notes." },
    { id: "machinesales.remove", label: "Remove machine deals", hint: "Take a deal off the list." },
    { id: "machinesales.prices", label: "See deal values", hint: "See and set what each deal is worth, and the pipeline totals." },
  ] },
  { group: "Parts orders", perms: [
    { id: "partsorders.view", label: "See parts orders", hint: "Spare parts orders, from the customer's first ask to the invoice." },
    { id: "partsorders.add", label: "Add parts orders", hint: "Start a parts order by hand, repeat an old one, or make one from a quote request." },
    { id: "partsorders.edit", label: "Change parts orders", hint: "Change an order's details, lines and status, and mark parts arrived or shipped." },
    { id: "partsorders.remove", label: "Remove parts orders", hint: "Take a parts order off the list." },
    { id: "partsorders.prices", label: "See parts prices", hint: "See and set prices, costs, discounts, margins and order totals." },
    { id: "partsorders.reports", label: "Parts sales reports", hint: "Sales by month, customer and part, and how long orders take. Also needs See parts prices." },
    { id: "partsorders.export", label: "Export parts orders", hint: "Download the parts order list as a spreadsheet." },
  ] },
  { group: "Knowledge base", perms: [
    { id: "kb.view", label: "Search the knowledge base", hint: "Read articles and quick notes." },
    { id: "kb.write", label: "Write notes and articles", hint: "Add quick notes and articles, and change their own." },
    { id: "kb.edit_all", label: "Change anyone's articles", hint: "Change or archive articles other people wrote." },
    { id: "kb.import", label: "Import documents", hint: "Bring in documents from the import file." },
    { id: "kb.publish", label: "Publish to customers", hint: "Put articles on the customer help center, or take them down." },
  ] },
  { group: "Software downloads", perms: [
    { id: "software.view", label: "Download software", hint: "Open software packages like New laptop setup and download the programs they need." },
    { id: "software.manage", label: "Upload software", hint: "Make software packages, upload installers and program folders, and remove them." },
  ] },
  { group: "Field service jobs", perms: [
    { id: "jobs.view", label: "See jobs", hint: "Field service jobs, each job's machine history, and adding files to a job." },
    { id: "jobs.schedule", label: "Schedule jobs", hint: "Make and change jobs, choose the field service engineers and send the job emails." },
    { id: "workbook.billing", label: "Billing from work orders", hint: "See every field service engineer's billable hours and expenses by week, and download them for invoicing." },
  ] },
  { group: "Shipping and receiving", perms: [
    { id: "shipping.view", label: "See shipments", hint: "What is going out and coming in, tracking links, and adding photos and papers." },
    { id: "shipping.edit", label: "Ship and receive", hint: "Make and change shipments, mark them shipped or delivered, and check deliveries in." },
  ] },
  { group: "Inventory", perms: [
    { id: "inventory.view", label: "See stock", hint: "What is on the shelves, where, what is reserved and what is low." },
    { id: "inventory.edit", label: "Move stock", hint: "Put parts into stock, take them out, and move them between shelves." },
    { id: "inventory.adjust", label: "Correct stock", hint: "Correct a count, change a part's shelf and reorder point, and import a stock list." },
    { id: "inventory.prices", label: "See stock costs", hint: "See and set what each part costs, and the value of the stock." },
  ] },
  { group: "Admin only", perms: [
    { id: "users.manage", label: "Manage people", hint: "Invites, roles, access and sign-outs. Admins only." },
    { id: "audit.view", label: "Read the audit log", hint: "Who did what, and when. Admins only." },
    { id: "settings.manage", label: "Command center", hint: "Every switch and control for the portal. The portal owner only." },
  ] },
];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ROLES, value);
}

/** Roles an admin can't rename or delete, and whose switches can't change (admin). */
export const LOCKED_ROLES: ReadonlySet<string> = new Set(["admin"]);
