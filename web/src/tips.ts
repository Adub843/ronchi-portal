// Instruction notes a person closed with the ×. Saved to their login (server table user_tips),
// so a note closed on the computer stays closed on the phone. Settings > Show tips again brings them back.
import { useEffect, useState } from "react";
import { api } from "./api";

let hidden = new Set<string>();
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((f) => f());

function load(): Promise<void> {
  loading ??= api<{ hidden: string[] }>("/prefs/tips").then(
    (r) => { hidden = new Set(r.hidden); tell(); },
    () => { loading = null; },
  );
  return loading;
}

function useTips(): Set<string> {
  const [, redraw] = useState(0);
  useEffect(() => {
    const f = () => redraw((n) => n + 1);
    listeners.add(f);
    void load();
    return () => { listeners.delete(f); };
  }, []);
  return hidden;
}

/** Whether the person closed this note. Redraws when the list loads or changes. */
export function useTipHidden(id: string): boolean {
  return useTips().has(id);
}

/** How many notes the person closed, for Settings > Show tips again. */
export function useHiddenTipCount(): number {
  return useTips().size;
}

export function hideTip(id: string): void {
  hidden.add(id);
  tell();
  api("/prefs/tips", { body: { id } }).catch(() => { hidden.delete(id); tell(); });
}

export async function showAllTips(): Promise<void> {
  await api("/prefs/tips", { method: "DELETE" });
  hidden = new Set();
  tell();
}
