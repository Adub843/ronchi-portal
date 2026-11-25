// The main menu: one line per page. A page shows only to people with its permission.
// Every page here needs a training area in web/src/learn/guides.ts (test/unit/learn.test.ts checks).
// Which unread count a menu line shows (see Unread in components/Alerts.tsx).
type Count = "boards" | "chats";

export const NAV: { to: string; label: string; perm?: string; count?: Count; phone?: boolean }[] = [
  { to: "/", label: "Home" },
  { to: "/chats", label: "Chats", perm: "boards.use", count: "chats" },
  { to: "/boards", label: "Boards", perm: "boards.use", count: "boards" },
  { to: "/kb", label: "Knowledge base", perm: "kb.view" },
  { to: "/machines", label: "Machines", perm: "machines.view" },
  { to: "/catalog", label: "Parts catalog", perm: "catalog.view" },
  { to: "/customers", label: "Customers", perm: "customers.manage" },
  { to: "/change-parts", label: "Change parts", perm: "orders.view" },
  { to: "/people", label: "People", perm: "users.manage" },
  // On phones Portal training and Settings live in the account menu (top right), so the tab bar keeps room for the rest.
  { to: "/learn", label: "Portal training", phone: false },
  { to: "/settings", label: "Settings", phone: false },
];
