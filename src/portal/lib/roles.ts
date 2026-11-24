// Who can do what. Deny by default: anything not listed here is refused.
// To change what a role can do, edit this one table (and its test in test/roles.test.ts).
export type Role = "admin" | "billing" | "scheduling" | "service" | "sales" | "engineering" | "tech";

export const ROLES: Record<Role, string> = {
  admin: "Admin: everything (Paolo, Aaron)",
  billing: "Billing and hours (Lola)",
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
  | "clock.use"           // clock themselves in and out
  | "hours.view_all"      // everyone's hours
  | "hours.approve"       // approve punch edits
  | "hours.export";

const ALL: Permission[] = [
  "users.manage", "audit.view", "machines.view", "machines.edit", "boards.use", "boards.moderate",
  "clock.use", "hours.view_all", "hours.approve", "hours.export",
];

const STAFF_BASE: Permission[] = ["boards.use", "clock.use", "machines.view"];

export const PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set(ALL),
  billing: new Set([...STAFF_BASE, "hours.view_all", "hours.approve", "hours.export"]),
  scheduling: new Set([...STAFF_BASE, "hours.view_all"]),
  service: new Set([...STAFF_BASE, "machines.edit", "boards.moderate"]),
  sales: new Set([...STAFF_BASE]),
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
