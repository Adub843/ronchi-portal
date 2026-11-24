import { randomId } from "../../shared/crypto";

/** The server's clock, as ISO 8601 UTC. Every stored time comes from here. */
export function now(): string {
  return new Date().toISOString();
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

/** Write one line to the append-only audit log. */
export async function audit(
  db: D1Database,
  entry: { userId: string | null; action: string; targetType?: string; targetId?: string; detail?: unknown; ip?: string },
): Promise<void> {
  await db
    .prepare("INSERT INTO audit_log (id, at, user_id, action, target_type, target_id, detail, ip) VALUES (?,?,?,?,?,?,?,?)")
    .bind(
      randomId(), now(), entry.userId, entry.action, entry.targetType ?? null, entry.targetId ?? null,
      entry.detail === undefined ? null : JSON.stringify(entry.detail), entry.ip ?? null,
    )
    .run();
}
