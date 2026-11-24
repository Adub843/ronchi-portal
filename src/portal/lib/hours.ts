// Turns clock punches into worked hours. Pure functions, tested in test/hours.test.ts.

export const TIME_ZONE = "America/New_York"; // Ronchi America's office time, used for "which day"

export interface Punch { id: string; user_id: string; kind: "in" | "out"; at: string }

export interface Shift { userId: string; inId: string; outId: string | null; start: string; end: string | null; hours: number; day: string }

export interface DayTotal { userId: string; day: string; hours: number; regular: number; overtime: number; open: boolean }

/** Local calendar day (YYYY-MM-DD) for a UTC time. */
export function localDay(iso: string, timeZone = TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Pair each "in" with the next "out" for the same person. A shift belongs to the day it started. */
export function toShifts(punches: Punch[]): Shift[] {
  const byUser = new Map<string, Punch[]>();
  for (const p of punches) {
    const list = byUser.get(p.user_id) ?? [];
    list.push(p);
    byUser.set(p.user_id, list);
  }
  const shifts: Shift[] = [];
  for (const [userId, list] of byUser) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    let open: Punch | null = null;
    for (const p of list) {
      if (p.kind === "in") {
        if (open) shifts.push({ userId, inId: open.id, outId: null, start: open.at, end: null, hours: 0, day: localDay(open.at) });
        open = p;
      } else if (open) {
        const hours = Math.max(0, (Date.parse(p.at) - Date.parse(open.at)) / 3_600_000);
        shifts.push({ userId, inId: open.id, outId: p.id, start: open.at, end: p.at, hours: round2(hours), day: localDay(open.at) });
        open = null;
      }
    }
    if (open) shifts.push({ userId, inId: open.id, outId: null, start: open.at, end: null, hours: 0, day: localDay(open.at) });
  }
  return shifts.sort((a, b) => a.start.localeCompare(b.start));
}

/** Daily totals with the workbook rule: first 8 hours are regular, the rest overtime. */
export function dailyTotals(shifts: Shift[], regularHours = 8): DayTotal[] {
  const map = new Map<string, DayTotal>();
  for (const s of shifts) {
    const key = `${s.userId}|${s.day}`;
    const t = map.get(key) ?? { userId: s.userId, day: s.day, hours: 0, regular: 0, overtime: 0, open: false };
    t.hours = round2(t.hours + s.hours);
    if (!s.end) t.open = true;
    map.set(key, t);
  }
  for (const t of map.values()) {
    t.regular = round2(Math.min(t.hours, regularHours));
    t.overtime = round2(Math.max(0, t.hours - regularHours));
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day) || a.userId.localeCompare(b.userId));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse a ?from=YYYY-MM-DD&to=YYYY-MM-DD range (to is inclusive). Defaults to the last 14 days. */
export function parseRange(from: string | undefined, to: string | undefined): { fromIso: string; toIso: string } | null {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const end = to && day.test(to) ? new Date(`${to}T00:00:00Z`) : new Date();
  const start = from && day.test(from) ? new Date(`${from}T00:00:00Z`) : new Date(end.getTime() - 14 * 86_400_000);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return null;
  if (end.getTime() - start.getTime() > 400 * 86_400_000) return null;
  // Pad a day each side so local-time days at the edges are complete.
  return {
    fromIso: new Date(start.getTime() - 86_400_000).toISOString(),
    toIso: new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) + 2 * 86_400_000).toISOString(),
  };
}
