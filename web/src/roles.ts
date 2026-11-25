// Role names for labels around the app. Built-in roles have short translated labels; roles an admin
// made (or renamed) in People > Roles come from the server.
import { useEffect, useState } from "react";
import { api } from "./api";
import { t } from "./i18n";

const ONE: Record<string, string> = { admin: "Admin", manager: "Manager", billing: "Billing", scheduling: "Scheduling", service: "Service", sales: "Sales", engineering: "Engineering", tech: "Field service engineer" };
const MANY: Record<string, string> = { admin: "Admin", manager: "Managers", billing: "Billing", scheduling: "Scheduling", service: "Service", sales: "Sales", engineering: "Engineering", tech: "Field service engineers" };

let named: Record<string, string> = {};
let loading: Promise<void> | null = null;

function load(): Promise<void> {
  loading ??= api("/users/roles").then(
    (r: { named?: Record<string, string> }) => { named = r.named ?? {}; },
    () => { loading = null; },
  );
  return loading;
}

/** A role's name for people to read. `many` gives the plural ("Managers"). */
export function roleLabel(id: string | null | undefined, many = false): string {
  if (!id) return "";
  if (named[id]) return named[id]!;
  const own = (many ? MANY : ONE)[id];
  return own ? t(own) : id;
}

/** Every role id: built-in ones first, then the ones an admin made. */
export function roleIds(): string[] {
  return [...Object.keys(ONE), ...Object.keys(named).filter((k) => !(k in ONE))];
}

/** Load the names once and redraw when they arrive. */
export function useRoleNames(when: unknown = true): void {
  const [, redraw] = useState(0);
  useEffect(() => { if (when) void load().then(() => redraw((n) => n + 1)); }, [when]);
}

/** After roles change in People, fetch the names again. */
export function refreshRoleNames(): Promise<void> {
  loading = null;
  return load();
}
