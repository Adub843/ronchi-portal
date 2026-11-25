// Autosave for the workbook's paperwork (Aaron, 2026-11-25: it should "update every time a user presses
// enter or changes anything or uploads a file"). Each field saves on its own about 600 ms after the last
// keystroke, at once on Enter or when the field is left, and before the page closes. A small line on the
// page says "Saving…", "All changes saved" or what went wrong.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { t } from "../i18n";
import { toast } from "./ui";

// ---- The page-wide save status ----
let pending = 0;
let failed: string | null = null;
let savedAt = 0;
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());

/** Run a save and keep the status line up to date. Errors show as a toast and on the status line, then rethrow. */
export async function track<T>(p: Promise<T>): Promise<T> {
  pending++;
  tell();
  try {
    const r = await p;
    failed = null;
    savedAt = Date.now();
    return r;
  } catch (e) {
    failed = (e as Error).message;
    toast((e as Error).message);
    throw e;
  } finally {
    pending--;
    tell();
  }
}

export function SaveStatus() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  if (pending) return <span className="save-state busy" role="status"><span className="spinner" aria-hidden="true" />{t("Saving…")}</span>;
  if (failed) return <span className="save-state bad" role="status">{t("Not saved: {why}", { why: t(failed) })}</span>;
  if (savedAt) return <span className="save-state ok" role="status">{t("All changes saved")}</span>;
  return null;
}

// Save everything still waiting when the page is closed or the person goes elsewhere.
const flushers = new Set<() => void>();
if (typeof window !== "undefined") window.addEventListener("pagehide", () => flushers.forEach((f) => f()));

/**
 * Local copies of a record's fields that save themselves. `server` is the record as last loaded; it is
 * taken again whenever it changes and nothing typed is still waiting, so live updates from other people
 * show up without throwing away what this person is typing.
 */
export function useFields<T extends Record<string, unknown>>(server: T, save: (patch: Partial<T>) => Promise<unknown>, delay = 600) {
  const [vals, setVals] = useState<T>(server);
  const dirty = useRef<Partial<T>>({});
  const busy = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const saver = useRef(save);
  saver.current = save;
  const key = JSON.stringify(server);

  useEffect(() => {
    if (!Object.keys(dirty.current).length && !busy.current) setVals(server);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const flush = () => {
    window.clearTimeout(timer.current);
    const patch = dirty.current;
    if (!Object.keys(patch).length) return;
    dirty.current = {};
    busy.current++;
    track(saver.current(patch)).catch(() => undefined).finally(() => busy.current--);
  };

  useEffect(() => {
    flushers.add(flush);
    return () => {
      flushers.delete(flush);
      flush(); // leaving the page or closing the row: save what's waiting
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set<K extends keyof T>(k: K, v: T[K], now = false) {
    setVals((x) => ({ ...x, [k]: v }));
    dirty.current = { ...dirty.current, [k]: v };
    window.clearTimeout(timer.current);
    if (now) flush();
    else timer.current = window.setTimeout(flush, delay);
  }

  /** Props for an input or textarea: saves while typing, on Enter (single-line fields) and on leaving the field. */
  function bind<K extends keyof T>(k: K, opts: { multiline?: boolean } = {}) {
    return {
      value: (vals[k] ?? "") as string,
      onChange: (e: { target: { value: string } }) => set(k, e.target.value as T[K]),
      onBlur: flush,
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === "Enter" && (!opts.multiline || e.ctrlKey || e.metaKey)) {
          if (!opts.multiline) e.preventDefault();
          flush();
        }
      },
    };
  }

  return { vals, set, bind, flush };
}
