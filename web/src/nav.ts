// The main menu: one line per page, gathered under a few headings that each open as a drop-down
// (Aaron, 2026-11-26: "condense the top menu"). A heading shows only the pages a person may open;
// a heading left with one page shows as that page, with no drop-down.
// One line per page. A page shows only to people with its permission (perm), and
// not to people who have `unless` (a permission that already reaches the page another way).
// Every page here needs a training area in web/src/learn/guides.ts (test/unit/learn.test.ts checks).

/** Which unread count a menu line shows. Same names as Unread in components/Alerts.tsx. */
type Count = "boards" | "chats";

/** perm may list several permissions split by "|": any one of them shows the page. */
export interface NavItem { to: string; label: string; group?: string; perm?: string; unless?: string; count?: Count; phone?: boolean; workbook?: boolean }

export const NAV: NavItem[] = [
  { to: "/", label: "Home" },
  { to: "/chats", label: "Chats", group: "Messages", perm: "boards.use", count: "chats" },
  { to: "/boards", label: "Boards", group: "Messages", perm: "boards.use", count: "boards" },
  { to: "/jobs", label: "Jobs", group: "Service", perm: "jobs.view" },
  { to: "/kb", label: "Knowledge base", group: "Service", perm: "kb.view" },
  { to: "/machines", label: "Machines", group: "Machines", perm: "machines.view" },
  { to: "/catalog", label: "Parts catalog", group: "Machines", perm: "catalog.view" },
  // Sales people and order people both use it, so either permission shows it.
  { to: "/change-parts", label: "Change parts", group: "Sales", perm: "orders.view|cpsales.view" },
  { to: "/parts-orders", label: "Parts orders", group: "Sales", perm: "partsorders.view" },
  { to: "/customers", label: "Customers", group: "Sales", perm: "customers.manage" },
  // Quote requests open from the Customers page; people who read quotes without managing customers
  // (Billing) get their own menu line instead.
  { to: "/quotes", label: "Quote requests", group: "Sales", perm: "quotes.manage", unless: "customers.manage" },
  { to: "/shipping", label: "Shipping and receiving", group: "Warehouse", perm: "shipping.view" },
  { to: "/people", label: "People", group: "Admin", perm: "users.manage" },
  // On phones Portal training and Settings live in the account menu (top right), so the tab bar keeps room for the rest.
  { to: "/learn", label: "Portal training", group: "Service", phone: false },
  { to: "/settings", label: "Settings", group: "Admin", phone: false },
];

/** The menu lines one person sees: pages their permissions allow (and any line marked workbook only while the workbook is on). */
export function menuFor(perms: ReadonlySet<string>, switches: { workbook: boolean }): NavItem[] {
  return NAV.filter((n) => (!n.perm || n.perm.split("|").some((p) => perms.has(p))) && (!n.unless || !perms.has(n.unless)) && (!n.workbook || switches.workbook));
}

/** One entry of the top menu: a page on its own, or a heading with the pages under it. */
export type MenuEntry = { page: NavItem } | { group: string; pages: NavItem[] };

/** The top menu one person sees, in menu order. A heading with a single page becomes that page. */
export function groupedMenu(items: NavItem[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const n of items) {
    if (!n.group) { out.push({ page: n }); continue; }
    const have = out.find((e) => "group" in e && e.group === n.group) as { group: string; pages: NavItem[] } | undefined;
    if (have) have.pages.push(n);
    else out.push({ group: n.group, pages: [n] });
  }
  return out.map((e) => ("group" in e && e.pages.length === 1 ? { page: e.pages[0]! } : e));
}

/** False when the page at `path` needs a permission this person lacks. The menu already hides those pages;
 *  this also covers an address typed in, bookmarked or opened from a link, so nobody sees an empty page
 *  with forms they can't use. The server refuses the data either way. */
export function pageAllowed(path: string, perms: ReadonlySet<string>): boolean {
  const section = "/" + (path.split("/")[1] ?? "");
  const item = NAV.find((n) => n.to === section);
  return !item?.perm || item.perm.split("|").some((p) => perms.has(p));
}

/** Work orders used to be their own pages (/work-orders...). Now each is the Work order tab of its job. */
export function fromOldAddress(path: string): string {
  if (path === "/work-orders") return "/jobs";
  if (path === "/work-orders/billing") return "/jobs/billing";
  const m = /^\/work-orders\/([A-Za-z0-9_-]+)(?:\/work-order)?$/.exec(path); // also old preview links #work-order-<id>/work-order
  return m ? `/jobs/${m[1]}/work-order` : path;
}
