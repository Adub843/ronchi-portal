// A very small router: the page is chosen from the address bar path.
// In the demo build (shown inside Claude) the page lives in the address's #name instead,
// for example #boards or #board-<id>, because the demo can't change the path.
import { useEffect, useState } from "react";

export const DEMO = import.meta.env.MODE === "demo";

// "#settings" is reserved where the demo is shown, so the demo uses "#my-settings".
const HASH_ALIAS: Record<string, string> = { "my-settings": "settings", "admin-controls": "settings/admin" };

function hashToPath(hash: string): string {
  const h = hash.replace(/^#/, "");
  if (!h) return "/";
  const k = /^kb-([A-Za-z0-9_-]+)$/.exec(h);
  if (k) return `/kb/${k[1]}`;
  const m = /^(board|machine|chat|change-part|job|work-order)-([A-Za-z0-9_-]+)$/.exec(h);
  if (m) return `/${m[1]}s/${m[2]}`;
  return `/${HASH_ALIAS[h] ?? h}`;
}

/** The href to put on a link for a portal path. */
export function hrefFor(path: string): string {
  if (!DEMO) return path;
  if (path === "/") return "#home";
  const k = /^\/kb\/(.+)$/.exec(path);
  if (k) return `#kb-${k[1]}`;
  const m = /^\/(boards|machines|chats|change-parts|jobs|work-orders)\/(.+)$/.exec(path);
  if (m) return `#${m[1]!.slice(0, -1)}-${m[2]}`;
  const name = path.slice(1);
  return `#${name === "settings" ? "my-settings" : name === "settings/admin" ? "admin-controls" : name}`;
}

function currentPath(): string {
  if (!DEMO) return location.pathname;
  const p = hashToPath(location.hash);
  return p === "/home" ? "/" : p;
}

// Pages visited inside the portal, so Back returns to the page you came from.
const visited: string[] = [];

export function navigate(path: string, opts: { back?: boolean } = {}) {
  const from = currentPath();
  if (!opts.back && from !== path) visited.push(from);
  if (DEMO) {
    location.hash = hrefFor(path);
  } else {
    if (path === location.pathname) return;
    history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  window.scrollTo(0, 0);
}

/** Where Back goes when there's no earlier page: a chat, board, machine or order goes to its list, anything else to Home. */
export function parentOf(path: string): string {
  if (/^\/catalog\/./.test(path)) return "/catalog";
  if (/^\/quotes\/./.test(path)) return "/quotes";
  if (/^\/kb\/./.test(path)) return "/kb";
  if (/^\/shipping\/./.test(path)) return "/shipping";
  const m = /^\/(boards|machines|chats|change-parts|jobs|work-orders)\/.+$/.exec(path);
  return m ? `/${m[1]}` : "/";
}

/** Back: the page you came from inside the portal, or the page above this one. */
export function goBack() {
  const here = currentPath();
  let to = visited.pop();
  while (to === here) to = visited.pop();
  navigate(to ?? parentOf(here), { back: true });
}

export function usePath(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const on = () => setPath(currentPath());
    window.addEventListener("popstate", on);
    window.addEventListener("hashchange", on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener("hashchange", on);
    };
  }, []);
  return path;
}
