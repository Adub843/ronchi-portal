// The app's language: English, Spanish or Italian. Saved to each person's login (prefs.lang),
// and kept on this device too so the sign-in screen opens in the right language.
//
// Every piece of text on screen goes through t("English text"). The Spanish and Italian
// versions are in i18n-dict.ts, keyed by the English text. A test (test/unit/i18n.test.ts)
// fails if any t("...") is missing a Spanish or Italian version.
// Messages people type are never translated; they show exactly as written.
// One exception: the Portal training guides (learn/guides.ts) are long, so each guide carries its own
// English, Spanish and Italian side by side; test/unit/learn.test.ts checks none is missing.
import { useEffect, useState } from "react";
import { ES, IT } from "./i18n-dict";

export type Lang = "en" | "es" | "it";
export const LANGS: { id: Lang; name: string }[] = [
  { id: "en", name: "English" },
  { id: "es", name: "Español" },
  { id: "it", name: "Italiano" },
];
const DICTS: Record<Lang, Record<string, string> | null> = { en: null, es: ES, it: IT };
const LOCALES: Record<Lang, string> = { en: "en-US", es: "es-US", it: "it-IT" };
const KEY = "ronchi.lang";

export const isLang = (v: unknown): v is Lang => v === "en" || v === "es" || v === "it";

let current: Lang = (() => {
  try {
    const v = localStorage.getItem(KEY);
    if (isLang(v)) return v;
  } catch {
    /* storage blocked: English */
  }
  return "en";
})();
const listeners = new Set<() => void>();

export const getLang = () => current;
/** The locale for dates and times in the chosen language. */
export const loc = () => LOCALES[current];

export function setLang(l: Lang) {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* fine */
  }
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}

/** Re-render when the language changes. */
export function useLang(): Lang {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    return () => void listeners.delete(f);
  }, []);
  return current;
}

/** Text in the chosen language. {name} style blanks are filled from `vars`. */
export function t(text: string, vars?: Record<string, string | number>): string {
  let out = DICTS[current]?.[text] ?? text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}
