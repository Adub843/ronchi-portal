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
  | "boards.use"          // read and post on boards they can see, create boards
  | "boards.moderate"     // pin, archive, remove anyone's post
  | "catalog.view"        // the parts catalog: drawings, 3D, parts lists, where-used, staff notes
  | "catalog.edit"        // import manuals, fix tables, upload drawings and 3D, publish to customers
  | "customers.manage"    // customer parts logins: companies, their machines, sign-up links
  | "quotes.manage";      // read customer quote requests and set their status

const ALL: Permission[] = [
  "users.manage", "audit.view", "machines.view", "machines.edit", "boards.use", "boards.moderate",
  "catalog.view", "catalog.edit", "customers.manage", "quotes.manage",
];

const STAFF_BASE: Permission[] = ["boards.use", "machines.view", "catalog.view"];

export const PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set(ALL),
  billing: new Set([...STAFF_BASE, "quotes.manage"]),
  scheduling: new Set([...STAFF_BASE]),
  service: new Set([...STAFF_BASE, "machines.edit", "boards.moderate", "catalog.edit", "customers.manage", "quotes.manage"]),
  sales: new Set([...STAFF_BASE, "customers.manage", "quotes.manage"]),
  engineering: new Set([...STAFF_BASE, "machines.edit", "catalog.edit"]),
  tech: new Set([...STAFF_BASE]),
};

export function can(role: Role | undefined | null, perm: Permission): boolean {
  if (!role) return false;
  return PERMISSIONS[role]?.has(perm) ?? false;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ROLES, value);
}
