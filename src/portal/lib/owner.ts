// The portal owner (Aaron, 2026-11-25: switches "by me only in the portal command center which only i can see").
// One admin is the owner (users.is_owner). Only the owner has settings.manage, so only the owner sees
// the command center and flips the switches. Safety nets, so nobody is ever locked out:
//  - while there is no active admin owner (a brand-new portal), every admin counts as the owner;
//  - other admins can't disable, demote or sign out the owner;
//  - the owner can hand the command center to another admin;
//  - lost owner login: run `npm run owner -- <email>` on the PC that deploys the portal.
import { audit } from "./db";

/** Counts the active admin owners, for the session query. */
export const OWNERS_SQL = "SELECT COUNT(*) FROM users o WHERE o.is_owner = 1 AND o.role = 'admin' AND o.status = 'active' AND o.removed_at IS NULL";

export function isOwner(role: string, flagged: boolean, owners: number): boolean {
  return role === "admin" && (flagged || owners === 0);
}

/** Is this person the owner (so other admins may not lock them out)? */
export async function isOwnerId(db: D1Database, userId: string): Promise<boolean> {
  const r = await db.prepare("SELECT is_owner, role FROM users WHERE id = ?").bind(userId).first<{ is_owner: number; role: string }>();
  return !!r && r.is_owner === 1 && r.role === "admin";
}

/** Make `userId` the one owner. The caller has checked that they are the owner and the target is an active admin. */
export async function setOwner(db: D1Database, userId: string, by: { id: string; ip: string }): Promise<void> {
  await db.batch([
    db.prepare("UPDATE users SET is_owner = 0 WHERE is_owner = 1 AND id <> ?").bind(userId),
    db.prepare("UPDATE users SET is_owner = 1 WHERE id = ?").bind(userId),
  ]);
  await audit(db, { userId: by.id, action: "owner.set", targetType: "user", targetId: userId, ip: by.ip });
}
