// On/off switches for whole parts of the portal (admins set them on the Settings page).
// When a part is off, its pages leave the menu AND its API answers "Not found", so it is really gone,
// and everything else keeps working without it.
export const SWITCHES = {
  // The Ronchi workbook: the Work orders pages (each job's work order with the log of past work orders
  // and the machine's history). Off = Ronchi keeps using its Excel sheets; scheduling, the job emails
  // and job files still work.
  workbook: { default: true },
} as const;
export type SwitchName = keyof typeof SWITCHES;
export const isSwitch = (v: unknown): v is SwitchName => typeof v === "string" && Object.prototype.hasOwnProperty.call(SWITCHES, v);

export async function readSwitches(db: D1Database): Promise<Record<SwitchName, boolean>> {
  const { results } = await db.prepare("SELECT name, is_on FROM feature_switches").all<{ name: string; is_on: number }>();
  const out = Object.fromEntries(Object.entries(SWITCHES).map(([k, v]) => [k, v.default])) as Record<SwitchName, boolean>;
  for (const r of results) if (isSwitch(r.name)) out[r.name] = r.is_on === 1;
  return out;
}

export async function isOn(db: D1Database, name: SwitchName): Promise<boolean> {
  return (await readSwitches(db))[name];
}
