// The customer app's language: English, Spanish or Italian, kept on this device.
// Every text on screen goes through t("English text"); the Spanish and Italian are in
// i18n-dict.ts. test/unit/parts-i18n.test.ts fails if one is missing.
import { useEffect, useState } from "react";
import type { Lang } from "../../web/catalog/words";
import { ES, IT } from "./i18n-dict";

export type { Lang };
export const LANGS: { id: Lang; name: string }[] = [
  { id: "en", name: "English" },
  { id: "es", name: "Español" },
  { id: "it", name: "Italiano" },
];
const KEY = "ronchi-parts.lang";
const LOCALES: Record<Lang, string> = { en: "en-US", es: "es-US", it: "it-IT" };

let current: Lang = (() => {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "en" || v === "es" || v === "it") return v;
  } catch {
    /* storage blocked */
  }
  const nav = (navigator.language || "en").slice(0, 2);
  return nav === "es" || nav === "it" ? nav : "en";
})();
const listeners = new Set<() => void>();

export const getLang = () => current;
export function setLang(l: Lang) {
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* fine */
  }
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}
export function useLang(): Lang {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    return () => void listeners.delete(f);
  }, []);
  return current;
}

export function t(text: string, vars?: Record<string, string | number>): string {
  let out = (current === "es" ? ES[text] : current === "it" ? IT[text] : null) ?? text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(LOCALES[current], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
