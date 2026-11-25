// The main menu: one line per page. A page shows only to people with its permission (perm), and
// not to people who have `unless` (a permission that already reaches the page another way).
// Every page here needs a training area in web/src/learn/guides.ts (test/unit/learn.test.ts checks).

/** Which unread count a menu line shows. Same names as Unread in components/Alerts.tsx. */
type Count = "boards" | "chats";

/** perm may list several permissions split by "|": any one of them shows the page. */
export interface NavItem { to: string; label: string; perm?: string; unless?: string; count?: Count; phone?: boolean; workbook?: boolean }

export const NAV: NavItem[] = [
  { to: "/", label: "Home" },
  { to: "/chats", label: "Chats", perm: "boards.use", count: "chats" },
  { to: "/boards", label: "Boards", perm: "boards.use", count: "boards" },
  { to: "/jobs", label: "Jobs", perm: "jobs.view" },
  // Hidden when an admin switches the Ronchi workbook off in Settings.
  { to: "/work-orders", label: "Work orders", perm: "jobs.view", workbook: true },
  { to: "/kb", label: "Knowledge base", perm: "kb.view" },
  { to: "/machines", label: "Machines", perm: "machines.view" },
  { to: "/catalog", label: "Parts catalog", perm: "catalog.view" },
  { to: "/customers", label: "Customers", perm: "customers.manage" },
  // Quote requests open from the Customers page; people who read quotes without managing customers
  // (Billing) get their own menu line instead.
  { to: "/quotes", label: "Quote requests", perm: "quotes.manage", unless: "customers.manage" },
  // Sales people and order people both use it, so either permission shows it.
  { to: "/change-parts", label: "Change parts", perm: "orders.view|cpsales.view" },
  { to: "/parts-orders", label: "Parts orders", perm: "partsorders.view" },
  { to: "/people", label: "People", perm: "users.manage" },
  // On phones Portal training and Settings live in the account menu (top right), so the tab bar keeps room for the rest.
  { to: "/learn", label: "Portal training", phone: false },
  { to: "/settings", label: "Settings", phone: false },
];

/** The menu lines one person sees: pages their permissions allow, and Work orders only while the workbook is on. */
export function menuFor(perms: ReadonlySet<string>, switches: { workbook: boolean }): NavItem[] {
  return NAV.filter((n) => (!n.perm || n.perm.split("|").some((p) => perms.has(p))) && (!n.unless || !perms.has(n.unless)) && (!n.workbook || switches.workbook));
}
