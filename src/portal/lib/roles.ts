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
  | "orders.view"         // see change-part orders (sales side)
  | "orders.edit";        // add, change, import and remove change-part orders

const ALL: Permission[] = [
  "users.manage", "audit.view", "machines.view", "machines.edit", "boards.use", "boards.moderate",
  "orders.view", "orders.edit",
];

const STAFF_BASE: Permission[] = ["boards.use", "machines.view"];

export const PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set(ALL),
  billing: new Set([...STAFF_BASE]),
  scheduling: new Set([...STAFF_BASE]),
  service: new Set([...STAFF_BASE, "machines.edit", "boards.moderate"]),
  sales: new Set([...STAFF_BASE, "orders.view", "orders.edit"]),
  engineering: new Set([...STAFF_BASE, "machines.edit"]),
  tech: new Set([...STAFF_BASE]),
};

export function can(role: Role | undefined | null, perm: Permission): boolean {
  if (!role) return false;
  return PERMISSIONS[role]?.has(perm) ?? false;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ROLES, value);
}
