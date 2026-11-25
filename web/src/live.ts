// Live updates on the staff app (server side: src/portal/lib/live.ts).
// Every change anyone makes through the portal bumps a number for its area. The regular check
// (the alerts check, or GET /api/live) hands the numbers to handleRevs(); when an area's number moves,
// LIVE_EVENT fires with the areas that changed, and every useLoad() on a page that shows that area
// reloads in place. A page never reloads while someone is typing in it: it waits until they leave the field.

export const LIVE_EVENT = "portal:live";

/** Which live areas each page shows. A page also counts as showing an area it links to on screen. */
const PAGE_TOPICS: Record<string, string[]> = {
  "": ["jobs", "change-parts", "kb", "links", "parts-orders", "shipping", "reports"], // Home
  chats: ["boards"], boards: ["boards"],
  jobs: ["jobs", "reports"], "work-orders": ["jobs", "reports", "change-parts", "kb", "machines", "boards"], reports: ["reports", "jobs"],
  kb: ["kb", "software"], machines: ["machines", "jobs", "change-parts", "kb", "parts-orders"], catalog: ["catalog", "machines"],
  customers: ["customers", "machines"], quotes: ["customers"], "change-parts": ["change-parts", "shipping"],
  "parts-orders": ["parts-orders", "shipping", "customers"], shipping: ["shipping", "parts-orders", "change-parts"],
  software: ["software"], people: ["users"], settings: ["settings", "users"],
};

export function pageTopics(path: string): string[] {
  return PAGE_TOPICS[path.split("/")[1] ?? ""] ?? [];
}

let last: Record<string, number> | null = null;

/** Called with the numbers from each check. Returns the areas that changed since the last check. */
export function handleRevs(revs: Record<string, number> | undefined | null): string[] {
  if (!revs) return [];
  const prev = last;
  last = { ...revs };
  if (!prev) return []; // first check after opening: nothing to compare with yet
  const changed = Object.keys(revs).filter((k) => revs[k] !== prev[k]);
  if (changed.length && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail: changed }));
  return changed;
}

/** For tests. */
export function resetLive() {
  last = null;
}

/** True while someone is typing in a field, so a reload doesn't throw away what they're writing. */
export function typing(): boolean {
  const el = typeof document !== "undefined" ? document.activeElement : null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && !/^(button|submit|checkbox|radio|file|range|color|reset)$/i.test((el as HTMLInputElement).type)) || (el as HTMLElement).isContentEditable;
}
