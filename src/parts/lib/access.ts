// THE access rule for customers, in one place: a person sees a machine, its drawings and its
// parts ONLY when the machine is listed for their company in company_machines. A listed machine
// shows even before its catalog is published (Aaron: customers see every machine we have, with
// whatever information exists), so the access rule is company_machines alone.
// Every catalog route calls one of these. Anything else gets "Not found", the same answer as a
// machine that doesn't exist, so nobody can learn which other machine numbers are real.
import type { Customer } from "../env";
import { fail } from "./http";

export async function requireMachine(db: D1Database, u: Customer, serial: string): Promise<{ serial: string; model: string | null; label: string | null }> {
  if (!/^[0-9A-Za-z]{4,12}$/.test(serial)) fail(404, "Not found.");
  const m = await db.prepare(
    `SELECT cm.serial, m.model, cm.label FROM company_machines cm LEFT JOIN machines m ON m.serial = cm.serial
      WHERE cm.company_id = ? AND cm.serial = ?`,
  ).bind(u.companyId, serial).first<{ serial: string; model: string | null; label: string | null }>();
  if (!m) fail(404, "Not found.");
  return m;
}

export interface SheetRecord {
  id: string; serial: string; parent_id: string | null; section: string; grp: string | null; code: string | null; rev: string | null;
  title: string; title_it: string; sort: number; image_w: number | null; image_h: number | null; model_size: number | null; mesh_map: string | null;
}

export async function requireSheet(db: D1Database, u: Customer, id: string): Promise<SheetRecord> {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) fail(404, "Not found.");
  const s = await db.prepare(
    `SELECT s.* FROM sheets s JOIN company_machines cm ON cm.serial = s.serial AND cm.company_id = ? WHERE s.id = ?`,
  ).bind(u.companyId, id).first<SheetRecord>();
  if (!s) fail(404, "Not found.");
  return s;
}

/** The company's machine numbers, for filtering searches and checking cart lines. */
export async function companySerials(db: D1Database, u: Customer): Promise<string[]> {
  const { results } = await db.prepare("SELECT serial FROM company_machines WHERE company_id = ?").bind(u.companyId).all<{ serial: string }>();
  return results.map((r) => r.serial);
}
