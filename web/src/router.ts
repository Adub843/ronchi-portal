// A very small router: the page is chosen from the address bar path.
// In the demo build (shown inside Claude) the page lives in the address's #name instead,
// for example #boards or #board-<id>, because the demo can't change the path.
import { useEffect, useState } from "react";

export const DEMO = import.meta.env.MODE === "demo";

// "#settings" is reserved where the demo is shown, so the demo uses "#my-settings".
const HASH_ALIAS: Record<string, string> = { "my-settings": "settings" };

function hashToPath(hash: string): string {
  const h = hash.replace(/^#/, "");
  if (!h) return "/";
  const m = /^(board|machine)-([A-Za-z0-9-]+)$/.exec(h);
  if (m) return `/${m[1]}s/${m[2]}`;
  return `/${HASH_ALIAS[h] ?? h}`;
}

/** The href to put on a link for a portal path. */
export function hrefFor(path: string): string {
  if (!DEMO) return path;
  if (path === "/") return "#home";
  const m = /^\/(boards|machines)\/(.+)$/.exec(path);
  if (m) return `#${m[1]!.slice(0, -1)}-${m[2]}`;
  const name = path.slice(1);
  return `#${name === "settings" ? "my-settings" : name}`;
}

function currentPath(): string {
  if (!DEMO) return location.pathname;
  const p = hashToPath(location.hash);
  return p === "/home" ? "/" : p;
}

export function navigate(path: string) {
  if (DEMO) {
    location.hash = hrefFor(path);
  } else {
    if (path === location.pathname) return;
    history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  window.scrollTo(0, 0);
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
