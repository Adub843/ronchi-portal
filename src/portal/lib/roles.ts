// Who can do what. Deny by default: anything not listed here is refused.
// PERMISSIONS below is the starting table. An admin can change what each role can do in
// Settings > Admin controls (stored in portal-db, see lib/settings-store.ts); can() always uses
// the current table. Hard rules that Settings can't change: admins keep every permission, and
// ADMIN_ONLY permissions are never given to any other role.
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
  | "settings.manage"     // the admin controls in Settings
  | "audit.view"
  | "machines.view"
  | "machines.edit"
  | "boards.use"          // read and post on boards they can see, create boards
  | "boards.moderate"     // pin, archive, remove anyone's post
  | "catalog.view"        // the parts catalog: drawings, 3D, parts lists, where-used, staff notes
  | "catalog.edit"        // import manuals, fix tables, upload drawings and 3D, publish to customers
  | "customers.manage"    // customer parts logins: companies, their machines, sign-up links
  | "quotes.manage"       // read customer quote requests and set their status
  | "orders.view"         // see change-part orders (sales side)
  | "orders.edit";        // add, change, import and remove change-part orders

export const ALL: Permission[] = [
  "users.manage", "settings.manage", "audit.view", "machines.view", "machines.edit", "boards.use", "boards.moderate",
  "catalog.view", "catalog.edit", "customers.manage", "quotes.manage", "orders.view", "orders.edit",
];

const STAFF_BASE: Permission[] = ["boards.use", "machines.view", "catalog.view"];

export const PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set(ALL),
  billing: new Set([...STAFF_BASE, "quotes.manage"]),
  scheduling: new Set([...STAFF_BASE]),
  service: new Set([...STAFF_BASE, "machines.edit", "boards.moderate", "catalog.edit", "customers.manage", "quotes.manage"]),
  sales: new Set([...STAFF_BASE, "customers.manage", "quotes.manage", "orders.view", "orders.edit"]),
  engineering: new Set([...STAFF_BASE, "machines.edit", "catalog.edit"]),
  tech: new Set([...STAFF_BASE]),
};

/** Only admins ever have these, whatever Settings says (hard rule). */
export const ADMIN_ONLY: ReadonlySet<Permission> = new Set(["users.manage", "settings.manage", "audit.view"]);
/** Permissions an admin can hand to other roles in Settings. */
export const ASSIGNABLE: Permission[] = ALL.filter((p) => !ADMIN_ONLY.has(p));

/** The built-in table for every role except admin, in the shape Settings stores. */
export function builtInRoleTable(): Record<Exclude<Role, "admin">, Permission[]> {
  return Object.fromEntries(
    (Object.keys(ROLES) as Role[]).filter((r) => r !== "admin").map((r) => [r, ALL.filter((p) => PERMISSIONS[r].has(p))]),
  ) as Record<Exclude<Role, "admin">, Permission[]>;
}

/**
 * The table can() uses: what each role may do, from Settings, with sections that are turned off
 * removed from everyone but admins. The hard rules are applied here, so no saved setting can break them.
 */
export function effectiveTable(
  roles: Partial<Record<Role, readonly Permission[]>>,
  offPerms: ReadonlySet<Permission> = new Set(),
): Record<Role, ReadonlySet<Permission>> {
  const out = {} as Record<Role, ReadonlySet<Permission>>;
  for (const r of Object.keys(ROLES) as Role[]) {
    out[r] = r === "admin" ? new Set(ALL) : new Set((roles[r] ?? [...PERMISSIONS[r]]).filter((p) => !ADMIN_ONLY.has(p) && !offPerms.has(p)));
  }
  return out;
}

let active: Record<Role, ReadonlySet<Permission>> = PERMISSIONS;

/** Called by lib/settings-store.ts whenever Settings are loaded or saved. */
export function setActiveTable(table: Record<Role, ReadonlySet<Permission>>) {
  active = table;
}

/** Everything this role may do right now. */
export function permissionsOf(role: Role): Permission[] {
  return ALL.filter((p) => active[role]?.has(p));
}

export function can(role: Role | undefined | null, perm: Permission): boolean {
  if (!role) return false;
  return active[role]?.has(perm) ?? false;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ROLES, value);
}
