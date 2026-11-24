// Loads and saves the admin controls (one JSON record in portal-db, table settings).
//
// Every API request waits for loadSettings() before its route runs (see index.ts). The record is
// kept in memory for 10 seconds so most requests don't read it again; an admin's save applies at
// once on the server that saved it, and on every other server within 10 seconds.
import { audit, now } from "./db";
import { ALL, builtInRoleTable, effectiveTable, setActiveTable, type Permission } from "./roles";
import { clean, defaults, SECTIONS, SECTION_IDS, type PortalSettings } from "./settings";

const TTL_MS = 10_000;
let cached: { at: number; settings: PortalSettings } | null = null;

export const DEFAULTS = (): PortalSettings => defaults(builtInRoleTable());

function apply(s: PortalSettings) {
  const off = new Set<Permission>(SECTION_IDS.filter((k) => !s.sections[k]).flatMap((k) => [...SECTIONS[k].perms]));
  setActiveTable(effectiveTable(s.roles, off));
  cached = { at: Date.now(), settings: s };
}

/** The current settings. Only call after loadSettings() (the API middleware does that). */
export function getSettings(): PortalSettings {
  return cached?.settings ?? DEFAULTS();
}

export async function loadSettings(db: D1Database, force = false): Promise<PortalSettings> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.settings;
  let data: unknown = null;
  try {
    const row = await db.prepare("SELECT data FROM settings WHERE id = 1").first<{ data: string }>();
    data = row ? JSON.parse(row.data) : null;
  } catch {
    // No settings table yet (migration 0007 not applied) or a damaged record: run on defaults.
    data = null;
  }
  const { settings } = clean(data, DEFAULTS(), ALL);
  apply(settings);
  return settings;
}

/** Save an admin's changes. Returns an error message instead when something is out of range. */
export async function saveSettings(
  db: D1Database,
  input: unknown,
  who: { id: string; ip?: string },
): Promise<{ settings: PortalSettings; error: string | null }> {
  const before = await loadSettings(db, true);
  // Changes are merged onto what's saved, so a page that sends one group doesn't reset the others.
  const merged: Record<string, unknown> = { ...before };
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [k, v] of Object.entries(input)) {
      const cur = (before as unknown as Record<string, unknown>)[k];
      merged[k] = v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" ? { ...cur, ...v } : v;
    }
  }
  const { settings, error } = clean(merged, DEFAULTS(), ALL, true);
  if (error) return { settings: before, error };
  await db.prepare(
    "INSERT INTO settings (id, data, updated_at, updated_by) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
  ).bind(JSON.stringify(settings), now(), who.id).run();
  await audit(db, { userId: who.id, action: "settings.update", detail: changes(before, settings), ip: who.ip });
  apply(settings);
  return { settings, error: null };
}

/** For the audit log: only the values that changed, as [before, after]. */
function changes(a: PortalSettings, b: PortalSettings): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const group of Object.keys(b) as (keyof PortalSettings)[]) {
    const ga = a[group] as unknown as Record<string, unknown>;
    const gb = b[group] as unknown as Record<string, unknown>;
    for (const k of Object.keys(gb)) {
      if (JSON.stringify(ga?.[k]) !== JSON.stringify(gb[k])) out[`${group}.${k}`] = [ga?.[k], gb[k]];
    }
  }
  return out;
}

/** Tests only: forget the in-memory copy. */
export function forgetSettings() {
  cached = null;
  setActiveTable(effectiveTable(builtInRoleTable()));
}
