// Files on a parts order or a shipment: the list, and a button to add photos and paperwork.
// Same rules as chat and job files (src/shared/files.ts): safe types only, 25 MB each.
import { useRef, useState } from "react";
import { ACCEPT, fileProblem, fmtSize } from "../../../src/shared/files";
import { api, apiForm, can, fmtTime, type Me } from "../api";
import { t } from "../i18n";
import { Empty, toast } from "./ui";

export interface BoxFile { id: string; name: string; size: number; created_at: string; by_name?: string | null; issue_id?: string | null; url?: string }

/** `base` is the API area, for example "/parts-orders" or "/shipping". Files are served from `${base}/files/<id>`. */
export function fileHref(base: string, f: BoxFile, download = true) {
  return f.url ?? `/api${base}/files/${encodeURIComponent(f.id)}${download ? "?download=1" : ""}`;
}

export function FileBox({ me, base, uploadTo, files, canEdit, onChange, empty, extra }: {
  me: Me; base: string; uploadTo: string; files: BoxFile[]; canEdit: boolean; onChange: () => void; empty: string; extra?: Record<string, string>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function add(list: FileList | null) {
    if (!list?.length) return;
    for (const f of Array.from(list)) {
      const p = fileProblem(f.name, f.size);
      if (p) return toast(`${f.name}: ${t(p)}`);
    }
    const form = new FormData();
    for (const f of Array.from(list)) form.append("files", f);
    for (const [k, v] of Object.entries(extra ?? {})) form.append(k, v);
    setBusy(true);
    try {
      await apiForm(uploadTo, form);
      toast(t("Added"));
      onChange();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function remove(f: BoxFile) {
    try {
      await api(`${base}/files/${encodeURIComponent(f.id)}`, { method: "DELETE" });
      onChange();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {files.length ? (
        <ul className="filelist">
          {files.map((f) => (
            <li key={f.id}>
              <a href={fileHref(base, f)} download={f.name}>{f.name}</a>
              <span className="muted"> · {fmtSize(f.size)}{f.by_name ? ` · ${f.by_name}` : ""} · {fmtTime(f.created_at)}</span>
              {canEdit && <button className="linkish" style={{ marginLeft: 8 }} onClick={() => remove(f)} aria-label={t("Remove {name}", { name: f.name })}>{t("Remove")}</button>}
            </li>
          ))}
        </ul>
      ) : <Empty>{empty}</Empty>}
      {canEdit && can(me, "files.send") && (
        <div>
          <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => add(e.target.files)} />
          <button className="btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? t("Adding…") : t("Add files")}</button>
        </div>
      )}
    </div>
  );
}

/** Save a CSV the server made (exports are logged there). */
export async function downloadCsv(path: string, name: string) {
  try {
    const res = await fetch(`/api${path}`, { credentials: "same-origin" });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Something went wrong.");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([await res.text()], { type: "text/csv" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) {
    toast((e as Error).message);
  }
}
