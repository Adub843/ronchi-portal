// Roles an admin can create and change (Aaron, 2026-11-24: "i also need to able to add and create rolls").
// The built-in roles come from roles.ts. A row in the roles table either adds a new role (id "r-…")
// or changes a built-in role's name or switches. Admin can't be changed.
import { now } from "./db";
import { isRole, PERMISSIONS, ROLES, rolePermissions, type Permission } from "./roles";

export interface RoleInfo { id: string; name: string; builtIn: boolean; changed: boolean; renamed: boolean; perms: Permission[]; people: number }

interface Row { id: string; name: string; perms: string }

export async function listRoles(db: D1Database): Promise<RoleInfo[]> {
  const [rows, counts] = await Promise.all([
    db.prepare("SELECT id, name, perms FROM roles").all<Row>(),
    db.prepare("SELECT role, COUNT(*) AS n FROM users WHERE removed_at IS NULL GROUP BY role").all<{ role: string; n: number }>(),
  ]);
  const saved = new Map(rows.results.map((r) => [r.id, r]));
  const people = new Map(counts.results.map((c) => [c.role, c.n]));
  const out: RoleInfo[] = Object.entries(ROLES).map(([id, name]) => {
    const row = saved.get(id);
    return { id, name: row?.name ?? name, builtIn: true, changed: !!row, renamed: !!row && row.name !== name, perms: [...rolePermissions(id, row?.perms)], people: people.get(id) ?? 0 };
  });
  for (const r of rows.results) {
    if (isRole(r.id)) continue;
    out.push({ id: r.id, name: r.name, builtIn: false, changed: false, renamed: false, perms: [...rolePermissions(r.id, r.perms)], people: people.get(r.id) ?? 0 });
  }
  return out;
}

/** Is this a role someone can be given? */
export async function roleExists(db: D1Database, id: unknown): Promise<boolean> {
  if (typeof id !== "string" || !id) return false;
  if (isRole(id)) return true;
  return !!(await db.prepare("SELECT 1 FROM roles WHERE id = ?").bind(id).first());
}

/** Save a role's name and switches. */
export async function saveRole(db: D1Database, o: { id: string; name: string; perms: Permission[]; by: string }) {
  const t = now();
  await db.prepare(
    "INSERT INTO roles (id, name, perms, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, perms = excluded.perms, updated_at = excluded.updated_at",
  ).bind(o.id, o.name, JSON.stringify([...new Set(o.perms)].sort()), o.by, t, t).run();
}

/** The default switches of a built-in role, for "back to the original". */
export function builtInDefaults(id: string): Permission[] | null {
  return isRole(id) ? [...PERMISSIONS[id]] : null;
}
