// Applies a person's chosen theme to the page by setting CSS variables on <html>.
import { THEMES } from "../../src/shared/themes";

export interface Prefs { theme: string; mode: "auto" | "light" | "dark"; layout: string; tiles: string[] | null }

const VARS = ["--bg", "--panel", "--solid", "--ink", "--muted", "--line", "--accent", "--accent-soft", "--ok", "--ok-soft", "--steel", "--steel-ink"];

export function applyTheme(p: Prefs) {
  const root = document.documentElement;
  for (const v of VARS) root.style.removeProperty(v);
  const theme = THEMES.find((t) => t.id === p.theme);
  if (!theme?.tokens) {
    // Ronchi workbook theme: the stylesheet already has light and dark versions.
    if (p.mode === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", p.mode);
    return;
  }
  const t = theme.tokens;
  root.setAttribute("data-theme", t.dark ? "dark" : "light");
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  set("--bg", t.bg);
  set("--solid", t.solid);
  set("--panel", t.solid);
  set("--ink", t.ink);
  set("--muted", t.muted);
  set("--line", t.line);
  set("--accent", t.accent);
  set("--accent-soft", `color-mix(in srgb, ${t.accent} 14%, ${t.solid})`);
  set("--ok", t.ok);
  set("--ok-soft", t.okSoft);
  set("--steel", t.steel);
  set("--steel-ink", t.steelInk);
}

export { THEMES };
