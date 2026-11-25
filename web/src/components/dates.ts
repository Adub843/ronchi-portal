import { loc } from "../i18n";

/** 2026-12-03 → Dec 3, 2026 in the chosen language; "–" when empty. */
export function shortDay(day: string | null | undefined): string {
  if (!day) return "–";
  const d = new Date(`${day.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(loc(), { month: "short", day: "numeric", year: "numeric" });
}

/** Today as YYYY-MM-DD in the person's own time zone. */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 2026-11 → Nov in the chosen language. */
export function monthShort(ym: string): string {
  return new Date(`${ym}-15T12:00:00`).toLocaleDateString(loc(), { month: "short" });
}
