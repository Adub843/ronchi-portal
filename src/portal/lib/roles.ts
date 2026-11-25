// Who can do what. Deny by default: anything not listed here is refused.
// To change what a role can do, edit this one table (and its test in test/roles.test.ts).
export type Role = "admin" | "billing" | "scheduling" | "service" | "sales" | "engineering" | "tech";

export const ROLES: Record<Role, string> = {
  admin: "Admin: everything (Paolo, Aaron)",
  billing: "Billing (Lola)",
  scheduling: "Scheduling (Meagan)",
  service: "Service workbook side (Steve)",
  sales: "Sales",
  engineering: "Engineering",
  tech: "Field technician",
};

export type Permission =
  | "users.manage"        // invite people, change roles, disable, sign out everywhere
  | "audit.view"
  | "machines.view"
  | "machines.edit"
  | "boards.use"          // read and post on boards they can see
  | "boards.create"       // start a new board
  | "chats.start"         // start a private chat (they can still answer chats others add them to)
  | "files.send"          // attach photos and files in chats and boards
  | "boards.moderate"     // pin, archive, remove anyone's post
  | "catalog.view"        // the parts catalog: drawings, 3D, parts lists, where-used, staff notes
  | "catalog.edit"        // import manuals, fix tables, upload drawings and 3D, publish to customers
  | "customers.manage"    // customer parts logins: companies, their machines, sign-up links
  | "quotes.manage"       // read customer quote requests and set their status
  | "orders.view"         // see change-part orders (sales side)
  | "orders.edit"         // add, change and remove change-part orders
  | "orders.import"       // bring in orders from a CSV spreadsheet
  | "kb.view"             // search and read the knowledge base
  | "kb.write"            // add quick notes and articles, change your own
  | "kb.publish";         // change anyone's article, import documents, publish to the customer help center

const ALL: Permission[] = [
  "users.manage", "audit.view", "machines.view", "machines.edit",
  "boards.use", "boards.create", "chats.start", "files.send", "boards.moderate",
  "catalog.view", "catalog.edit", "customers.manage", "quotes.manage",
  "orders.view", "orders.edit", "orders.import",
  "kb.view", "kb.write", "kb.publish",
];

const STAFF_BASE: Permission[] = ["boards.use", "boards.create", "chats.start", "files.send", "machines.view", "catalog.view", "kb.view", "kb.write"];

export const PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set(ALL),
  billing: new Set([...STAFF_BASE, "quotes.manage"]),
  scheduling: new Set([...STAFF_BASE]),
  service: new Set([...STAFF_BASE, "machines.edit", "boards.moderate", "catalog.edit", "customers.manage", "quotes.manage", "kb.publish"]),
  sales: new Set([...STAFF_BASE, "customers.manage", "quotes.manage", "orders.view", "orders.edit", "orders.import"]),
  engineering: new Set([...STAFF_BASE, "machines.edit", "catalog.edit", "kb.publish"]),
  tech: new Set([...STAFF_BASE]),
};

/** What a role allows on its own, before any per-person changes. */
export function can(role: Role | undefined | null, perm: Permission): boolean {
  if (!role) return false;
  return PERMISSIONS[role]?.has(perm) ?? false;
}

// ---- Per-person access (Aaron, 2026-11-24: "i need to be able to control more in detail") ----
// A person starts with their role's permissions. An admin can then switch any single permission
// on or off for that one person. These stay with the role's rules, never instead of them:
//  - admins always have everything (no one can switch an admin's access off),
//  - managing people and reading the audit log stay admin-only and can't be handed out.

export const ADMIN_ONLY: ReadonlySet<Permission> = new Set(["users.manage", "audit.view"]);

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (ALL as string[]).includes(value);
}

/** Can this permission be switched on or off for one person? */
export function adjustable(perm: Permission): boolean {
  return !ADMIN_ONLY.has(perm);
}

/** A person's own changes: true = switched on, false = switched off. Anything missing follows the role. */
export type AccessChanges = Partial<Record<Permission, boolean>>;

/** Everything one person may do: their role, plus their own changes. */
export function effective(role: Role, changes: AccessChanges | null | undefined): Set<Permission> {
  const out = new Set(PERMISSIONS[role] ?? []);
  if (role === "admin" || !changes) return out;
  for (const [perm, on] of Object.entries(changes)) {
    if (!isPermission(perm) || !adjustable(perm)) continue;
    if (on) out.add(perm);
    else out.delete(perm);
  }
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

/** Plain-English names for the access screen, grouped the way the menu is. */
export const PERMISSION_GROUPS: { group: string; perms: { id: Permission; label: string; hint: string }[] }[] = [
  { group: "Chats and boards", perms: [
    { id: "boards.use", label: "Use chats and boards", hint: "Read and post on the boards they can see, and answer chats." },
    { id: "boards.create", label: "Start new boards", hint: "Make a new message board." },
    { id: "chats.start", label: "Start private chats", hint: "Open a new chat with other staff." },
    { id: "files.send", label: "Send photos and files", hint: "Attach photos and files to messages." },
    { id: "boards.moderate", label: "Moderate boards", hint: "Pin, lock, archive and remove anyone's post." },
  ] },
  { group: "Machines", perms: [
    { id: "machines.view", label: "See machines", hint: "The machine list and each machine's page." },
    { id: "machines.edit", label: "Add and change machines", hint: "Add machines, change models, customers and sites." },
  ] },
  { group: "Parts catalog", perms: [
    { id: "catalog.view", label: "See the parts catalog", hint: "Drawings, 3D, parts lists and staff notes." },
    { id: "catalog.edit", label: "Build the parts catalog", hint: "Import manuals, fix tables, upload drawings and 3D, publish to customers." },
  ] },
  { group: "Customers", perms: [
    { id: "customers.manage", label: "Customer logins", hint: "Customer companies, their machines and sign-up links." },
    { id: "quotes.manage", label: "Quote requests", hint: "Read customer quote requests and set their status." },
  ] },
  { group: "Change-part orders", perms: [
    { id: "orders.view", label: "See orders", hint: "The change-part order tracker." },
    { id: "orders.edit", label: "Add and change orders", hint: "Add, change and remove orders." },
    { id: "orders.import", label: "Import orders", hint: "Bring in orders from a CSV spreadsheet." },
  ] },
  { group: "Knowledge base", perms: [
    { id: "kb.view", label: "Search the knowledge base", hint: "Read articles and quick notes." },
    { id: "kb.write", label: "Write notes and articles", hint: "Add quick notes and articles, and change their own." },
    { id: "kb.publish", label: "Publish to customers", hint: "Change anyone's article, import documents, publish to the help center." },
  ] },
  { group: "Admin only", perms: [
    { id: "users.manage", label: "Manage people", hint: "Invites, roles, access and sign-outs. Admins only." },
    { id: "audit.view", label: "Read the audit log", hint: "Who did what, and when. Admins only." },
  ] },
];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ROLES, value);
}
