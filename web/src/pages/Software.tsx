// Software downloads (Aaron, 2026-11-25), in the knowledge base (the technical reference side).
//  - SoftwareShelf: the packages ("New laptop setup", "Allen-Bradley (legacy)") as tiles on the knowledge base page.
//  - SoftwarePicker: the pop-up. It loads the package's list, one line per folder (and per loose file),
//    people tick what they want and press Download: everything comes down in one go.
//  - SoftwareManage (/kb/software): where people allowed to manage software make packages and upload
//    single installers or whole program folders. Big files go up in pieces (src/shared/software.ts).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError, can, type Me } from "../api";
import { t } from "../i18n";
import { Empty, ErrorNote, toast, useLoad } from "../components/ui";
import { navigate } from "../router";
import { cleanFolder, fmtBytes, groupByFolder, type SoftwareFile } from "../../../src/shared/software";

interface Pkg { id: string; name: string; description: string; legacy: boolean; files: number; size: number }
type FileRow = SoftwareFile & { url?: string };

const nFiles = (n: number) => (n === 1 ? t("1 file") : t("{n} files", { n }));
const fileHref = (f: FileRow) => f.url ?? `/api/software/files/${encodeURIComponent(f.id)}`;

// ---------- Tiles on the knowledge base page ----------

export function SoftwareShelf({ me }: { me: Me }) {
  const { data, error } = useLoad<{ packages: Pkg[] }>(() => api("/software"), []);
  const [open, setOpen] = useState<Pkg | null>(null);
  if (!can(me, "software.view")) return null;
  const list = data?.packages ?? [];
  if (data && !list.length && !can(me, "software.manage")) return null;
  return (
    <section className="panel sw-shelf" aria-labelledby="sw-h">
      <div className="row sw-shelf-head">
        <div>
          <h2 id="sw-h">{t("Software and setup files")}</h2>
          <p className="muted small-note">{t("Installers and program folders for laptops and machines. Open one, tick what you need and download it all at once.")}</p>
        </div>
        {can(me, "software.manage") && <button className="btn small" onClick={() => navigate("/kb/software")}>{t("Manage software")}</button>}
      </div>
      <ErrorNote error={error} />
      {data && !list.length && <Empty>{t("No software yet. Press Manage software to make the first package.")}</Empty>}
      <div className="sw-tiles">
        {list.map((p) => (
          <button key={p.id} className="sw-tile" onClick={() => setOpen(p)}>
            <span className="sw-tile-ic" aria-hidden="true">⬇</span>
            <span className="sw-tile-name">{p.name}{p.legacy && <span className="pill p-warn">{t("Legacy")}</span>}</span>
            {p.description && <span className="muted sw-tile-desc">{p.description}</span>}
            <span className="muted mono sw-tile-meta">{nFiles(p.files)} · {fmtBytes(p.size)}</span>
          </button>
        ))}
      </div>
      {open && <SoftwarePicker pkg={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

// ---------- The pop-up ----------

type Line = { key: string; label: string; files: FileRow[]; size: number; folder: boolean };

interface Progress { done: number; total: number; bytes: number; totalBytes: number; current: string; failed: string[]; finished: boolean; where: "folder" | "downloads" }

/** Chrome and Edge on a computer can save into a folder the person picks, keeping the package's folders. */
const canPickFolder = () => typeof (window as any).showDirectoryPicker === "function";

export function SoftwarePicker({ pkg, onClose }: { pkg: Pkg; onClose: () => void }) {
  const { data, error } = useLoad<{ package: Pkg; files: FileRow[] }>(() => api(`/software/${encodeURIComponent(pkg.id)}`), [pkg.id]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openLines, setOpenLines] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Progress | null>(null);
  const stop = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy()) onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  });
  const busy = () => !!progress && !progress.finished;

  const files = data?.files ?? [];
  const g = groupByFolder(files);
  const lines: Line[] = [
    ...g.folders.map((f) => ({ key: `d:${f.name}`, label: f.name, files: f.files, size: f.size, folder: true })),
    ...g.loose.map((f) => ({ key: `f:${f.id}`, label: f.name, files: [f], size: f.size, folder: false })),
  ];
  const chosen = files.filter((f) => picked.has(f.id));
  const chosenBytes = chosen.reduce((n, f) => n + f.size, 0);
  const state = (l: Line) => {
    const n = l.files.filter((f) => picked.has(f.id)).length;
    return n === 0 ? "none" : n === l.files.length ? "all" : "some";
  };
  const toggle = (ids: string[], on: boolean) => setPicked((p) => {
    const next = new Set(p);
    for (const id of ids) on ? next.add(id) : next.delete(id);
    return next;
  });

  async function download() {
    if (!chosen.length) return;
    stop.current = false;
    let dir: any = null;
    if (canPickFolder()) {
      try {
        dir = await (window as any).showDirectoryPicker({ id: "ronchi-software", mode: "readwrite", startIn: "downloads" });
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // they closed the folder picker
        dir = null; // not allowed here (for example inside a preview): fall back to plain downloads
      }
    }
    const p: Progress = { done: 0, total: chosen.length, bytes: 0, totalBytes: chosenBytes, current: "", failed: [], finished: false, where: dir ? "folder" : "downloads" };
    setProgress({ ...p });
    const root = dir ? await dir.getDirectoryHandle(winName(pkg.name), { create: true }) : null;
    for (const f of chosen) {
      if (stop.current) break;
      p.current = f.folder ? `${f.folder}/${f.name}` : f.name;
      setProgress({ ...p });
      try {
        if (root) await saveInto(root, f, (n) => { p.bytes += n; setProgress({ ...p }); });
        else { await clickDownload(f); p.bytes += f.size; }
      } catch {
        p.failed.push(p.current);
      }
      p.done++;
      setProgress({ ...p });
    }
    p.finished = true;
    p.current = "";
    setProgress({ ...p });
  }

  const pct = progress ? Math.round((progress.totalBytes ? progress.bytes / progress.totalBytes : progress.done / progress.total) * 100) : 0;

  // Drawn on the page body: a panel's blur would otherwise squeeze the pop-up inside that panel.
  return createPortal(
    <div className="sw-overlay" onClick={() => !busy() && onClose()}>
      <div className="sw-dialog panel" role="dialog" aria-modal="true" aria-labelledby="sw-title" tabIndex={-1} ref={box} onClick={(e) => e.stopPropagation()}>
        <div className="sw-dialog-head">
          <div>
            <h2 id="sw-title">{pkg.name}{pkg.legacy && <span className="pill p-warn">{t("Legacy")}</span>}</h2>
            {pkg.description && <p className="muted small-note">{pkg.description}</p>}
          </div>
          <button className="iconbtn" aria-label={t("Close")} disabled={busy()} onClick={onClose}>✕</button>
        </div>

        <ErrorNote error={error} />
        {!data && !error && <div className="sw-loading" role="status"><span className="sw-spin" aria-hidden="true" />{t("Loading the file list…")}</div>}

        {data && !progress && (
          <>
            {!lines.length ? <Empty>{t("Nothing has been uploaded to this package yet.")}</Empty> : (
              <>
                <div className="row sw-allrow">
                  <label className="sw-check"><input type="checkbox" checked={chosen.length === files.length && files.length > 0} ref={(el) => { if (el) el.indeterminate = chosen.length > 0 && chosen.length < files.length; }} onChange={(e) => toggle(files.map((f) => f.id), e.target.checked)} /> <strong>{t("Select all")}</strong></label>
                  <span className="muted small-note">{t("{n} folders and files", { n: lines.length })} · {fmtBytes(data.package.size)}</span>
                </div>
                <ul className="sw-list">
                  {lines.map((l) => {
                    const s = state(l);
                    const expanded = openLines.has(l.key);
                    return (
                      <li key={l.key} className={s !== "none" ? "on" : ""}>
                        <div className="sw-line">
                          <label className="sw-check">
                            <input type="checkbox" checked={s === "all"} ref={(el) => { if (el) el.indeterminate = s === "some"; }} onChange={(e) => toggle(l.files.map((f) => f.id), e.target.checked)} />
                            <span className="sw-ic" aria-hidden="true">{l.folder ? "📁" : "📄"}</span>
                            <span className="sw-name">{l.label}</span>
                          </label>
                          <span className="muted mono sw-size">{l.folder ? `${nFiles(l.files.length)} · ` : ""}{fmtBytes(l.size)}</span>
                          {l.folder && (
                            <button className="linkish small" aria-expanded={expanded} onClick={() => setOpenLines((o) => { const n = new Set(o); expanded ? n.delete(l.key) : n.add(l.key); return n; })}>
                              {expanded ? t("Hide files") : t("Show files")}
                            </button>
                          )}
                        </div>
                        {l.folder && expanded && (
                          <ul className="sw-sub">
                            {l.files.map((f) => (
                              <li key={f.id}>
                                <label className="sw-check"><input type="checkbox" checked={picked.has(f.id)} onChange={(e) => toggle([f.id], e.target.checked)} /> <span className="mono sw-path">{f.folder.split("/").slice(1).concat(f.name).join(" / ")}</span></label>
                                <span className="muted mono sw-size">{fmtBytes(f.size)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="muted small-note sw-how">
                  {canPickFolder()
                    ? t("You choose a folder on your computer and everything is saved there, folders and all.")
                    : t("Each file goes to your Downloads folder. If the browser asks, allow it to download several files.")}
                </p>
              </>
            )}
            <div className="row sw-foot">
              <span className="sw-count">{chosen.length ? t("{n} files selected · {size}", { n: chosen.length, size: fmtBytes(chosenBytes) }) : t("Tick the folders or files you want")}</span>
              <button className="btn" onClick={onClose}>{t("Cancel")}</button>
              <button className="btn primary" disabled={!chosen.length} onClick={download}>{t("Download")}</button>
            </div>
          </>
        )}

        {progress && (
          <div className="sw-progress" role="status" aria-live="polite">
            <progress max={100} value={pct} />
            <p className="small-note">
              {progress.finished
                ? progress.failed.length
                  ? t("{n} of {total} files downloaded. These didn't come down:", { n: progress.total - progress.failed.length, total: progress.total })
                  : progress.where === "folder"
                    ? t("All {total} files are saved in the folder you chose, inside {name}.", { total: progress.total, name: winName(pkg.name) })
                    : t("All {total} files were sent to your Downloads folder.", { total: progress.total })
                : t("Downloading {n} of {total}: {file}", { n: Math.min(progress.done + 1, progress.total), total: progress.total, file: progress.current })}
            </p>
            {progress.finished && progress.failed.length > 0 && <ul className="mono small-note">{progress.failed.map((f) => <li key={f}>{f}</li>)}</ul>}
            <p className="muted small-note mono">{fmtBytes(progress.bytes)} / {fmtBytes(progress.totalBytes)}</p>
            <div className="row sw-foot">
              {progress.finished
                ? <><button className="btn" onClick={() => setProgress(null)}>{t("Pick more")}</button><button className="btn primary" onClick={onClose}>{t("Done")}</button></>
                : <button className="btn" onClick={() => { stop.current = true; }}>{t("Stop after this file")}</button>}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** A folder name Windows will accept. */
function winName(s: string) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f"<>|:*?\\/]/g, "-").trim() || "Software";
}

/** Fetch one file, waiting and trying again if the portal says "too many requests". */
async function fetchFile(f: FileRow): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(fileHref(f), { credentials: "same-origin" });
    if (res.ok) return res;
    if (res.status === 429 && attempt < 4) { await new Promise((r) => setTimeout(r, 15000)); continue; }
    throw new ApiError(res.status, "Download failed.");
  }
}

/** Save one file into the chosen folder, making its folders on the way. Streams, so big installers never sit in memory. */
async function saveInto(root: any, f: FileRow, onBytes: (n: number) => void) {
  let dir = root;
  for (const part of f.folder.split("/").filter(Boolean)) dir = await dir.getDirectoryHandle(winName(part), { create: true });
  const handle = await dir.getFileHandle(winName(f.name), { create: true });
  const res = await fetchFile(f);
  const out = await handle.createWritable();
  const count = new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, ctl) { onBytes(chunk.byteLength); ctl.enqueue(chunk); } });
  await res.body!.pipeThrough(count).pipeTo(out);
}

/** Without a folder picker: hand each file to the browser as a normal download, a moment apart. */
async function clickDownload(f: FileRow) {
  const a = document.createElement("a");
  a.href = fileHref(f);
  a.download = f.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  await new Promise((r) => setTimeout(r, 900));
}

// ---------- Managing packages and uploads (/kb/software) ----------

interface Upload { key: string; name: string; folder: string; size: number; sent: number; state: "waiting" | "sending" | "done" | "failed"; error?: string }

export function SoftwareManage({ me }: { me: Me }) {
  const { data, error, reload } = useLoad<{ packages: Pkg[] }>(() => api("/software"), []);
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "", legacy: false });
  if (!can(me, "software.manage")) return <ErrorNote error={t("Your role doesn't allow this.")} />;
  const list = data?.packages ?? [];
  const current = list.find((p) => p.id === sel) ?? null;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api("/software", { body: form });
      setForm({ name: "", description: "", legacy: false });
      setSel(r.id);
      reload();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <>
      <div className="pagehead row">
        <div>
          <h1>{t("Manage software")}</h1>
          <p className="muted">{t("Make packages like New laptop setup and upload installers or whole program folders. Everyone with Download software sees them in the knowledge base.")}</p>
        </div>
        <button className="btn" onClick={() => navigate("/kb")}>{t("Back to the knowledge base")}</button>
      </div>
      <ErrorNote error={error} />
      <div className="sw-manage">
        <aside className="panel sw-pkgs">
          <h2>{t("Packages")}</h2>
          {data && !list.length && <p className="muted small-note">{t("No packages yet.")}</p>}
          <ul>
            {list.map((p) => (
              <li key={p.id}>
                <button className={`sw-pkg${p.id === sel ? " on" : ""}`} onClick={() => setSel(p.id)}>
                  <span>{p.name}{p.legacy && <span className="pill p-warn">{t("Legacy")}</span>}</span>
                  <span className="muted mono">{nFiles(p.files)} · {fmtBytes(p.size)}</span>
                </button>
              </li>
            ))}
          </ul>
          <form className="sw-new" onSubmit={create}>
            <h3>{t("New package")}</h3>
            <label>{t("Name")}<input value={form.name} maxLength={120} required onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("For example: New laptop setup")} /></label>
            <label>{t("What it's for")}<input value={form.description} maxLength={500} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <label className="sw-check"><input type="checkbox" checked={form.legacy} onChange={(e) => setForm({ ...form, legacy: e.target.checked })} /> {t("Legacy software (older machines)")}</label>
            <button className="btn primary" type="submit">{t("Make package")}</button>
          </form>
        </aside>
        <div className="panel sw-pkg-body">
          {current ? <PackageEditor key={current.id} pkg={current} onChanged={reload} onRemoved={() => { setSel(null); reload(); }} /> : <Empty>{t("Pick a package on the left, or make a new one.")}</Empty>}
        </div>
      </div>
    </>
  );
}

function PackageEditor({ pkg, onChanged, onRemoved }: { pkg: Pkg; onChanged: () => void; onRemoved: () => void }) {
  const { data, error, reload } = useLoad<{ package: Pkg; files: FileRow[] }>(() => api(`/software/${encodeURIComponent(pkg.id)}`), [pkg.id]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [into, setInto] = useState("");
  const [sure, setSure] = useState(false);
  const [edit, setEdit] = useState({ name: pkg.name, description: pkg.description, legacy: pkg.legacy });
  const filesIn = useRef<HTMLInputElement>(null);
  const folderIn = useRef<HTMLInputElement>(null);
  const running = uploads.some((u) => u.state === "waiting" || u.state === "sending");

  async function send(list: File[]) {
    const base = cleanFolder(into);
    if (base === null) return toast(t("That folder name can't be used."));
    const jobs = list.map((f, i) => {
      // A folder upload keeps the folders it came in (webkitRelativePath is "Folder/Sub/file.exe").
      const rel = (f as any).webkitRelativePath as string | undefined;
      const sub = rel ? rel.split("/").slice(0, -1).join("/") : "";
      return { file: f, up: { key: `${Date.now()}-${i}`, name: f.name, folder: [base, sub].filter(Boolean).join("/"), size: f.size, sent: 0, state: "waiting" as const } };
    });
    setUploads((u) => [...u, ...jobs.map((j) => j.up)]);
    const set = (key: string, patch: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    for (const { file, up } of jobs) {
      set(up.key, { state: "sending" });
      try {
        await uploadOne(pkg.id, file, up.folder, (sent) => set(up.key, { sent }));
        set(up.key, { state: "done", sent: file.size });
      } catch (e) {
        set(up.key, { state: "failed", error: (e as Error).message });
      }
    }
    reload();
    onChanged();
    if (filesIn.current) filesIn.current.value = "";
    if (folderIn.current) folderIn.current.value = "";
  }

  async function save() {
    try {
      await api(`/software/${pkg.id}`, { method: "PATCH", body: edit });
      toast(t("Saved."));
      onChanged();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function removeFile(f: FileRow) {
    try {
      await api(`/software/files/${f.id}`, { method: "DELETE" });
      reload();
      onChanged();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function removePkg() {
    if (!sure) return setSure(true);
    try {
      await api(`/software/${pkg.id}`, { method: "DELETE" });
      toast(t("Removed"));
      onRemoved();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const g = groupByFolder(data?.files ?? []);
  return (
    <>
      <div className="sw-edit">
        <label>{t("Name")}<input value={edit.name} maxLength={120} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
        <label>{t("What it's for")}<input value={edit.description} maxLength={500} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
        <label className="sw-check"><input type="checkbox" checked={edit.legacy} onChange={(e) => setEdit({ ...edit, legacy: e.target.checked })} /> {t("Legacy software (older machines)")}</label>
        <div className="row">
          <button className="btn" onClick={save}>{t("Save")}</button>
          <button className="btn danger" onClick={removePkg}>{sure ? t("Yes, remove the package and its files") : t("Remove package")}</button>
        </div>
      </div>

      <div
        className="sw-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (!running) send([...e.dataTransfer.files]); }}
      >
        <h3>{t("Add files")}</h3>
        <label>{t("Put them in this folder (optional)")}<input value={into} onChange={(e) => setInto(e.target.value)} placeholder={t("For example: Studio 5000 v33")} /></label>
        <div className="row">
          <button className="btn primary" disabled={running} onClick={() => filesIn.current?.click()}>{t("Upload files")}</button>
          <button className="btn" disabled={running} onClick={() => folderIn.current?.click()}>{t("Upload a whole folder")}</button>
          <input ref={filesIn} type="file" multiple hidden onChange={(e) => send([...(e.target.files ?? [])])} />
          <input ref={folderIn} type="file" multiple hidden {...({ webkitdirectory: "", directory: "" } as any)} onChange={(e) => send([...(e.target.files ?? [])])} />
        </div>
        <p className="muted small-note">{t("Any kind of file, up to 50 GB each. A whole folder keeps its folders. Big installers go up in 50 MB pieces, so keep this page open until they finish. A setup folder with thousands of small files downloads faster as one zip.")}</p>
      </div>

      {uploads.length > 0 && (
        <ul className="sw-uploads">
          {uploads.map((u) => (
            <li key={u.key}>
              <span className="mono sw-path">{u.folder ? `${u.folder}/` : ""}{u.name}</span>
              <progress max={u.size || 1} value={u.sent} />
              <span className={`small-note ${u.state === "failed" ? "sw-bad" : "muted"}`}>
                {u.state === "done" ? t("Uploaded") : u.state === "failed" ? u.error : u.state === "waiting" ? t("Waiting") : `${fmtBytes(u.sent)} / ${fmtBytes(u.size)}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3>{t("In this package")}</h3>
      <ErrorNote error={error} />
      {data && !data.files.length && <Empty>{t("Nothing has been uploaded to this package yet.")}</Empty>}
      {g.folders.map((d) => (
        <details key={d.name} className="sw-folder">
          <summary><span aria-hidden="true">📁</span> <strong>{d.name}</strong> <span className="muted mono">{nFiles(d.files.length)} · {fmtBytes(d.size)}</span></summary>
          <ul>{d.files.map((f) => <FileLine key={f.id} f={f} onRemove={() => removeFile(f)} />)}</ul>
        </details>
      ))}
      {g.loose.length > 0 && <ul className="sw-loose">{g.loose.map((f) => <FileLine key={f.id} f={f} onRemove={() => removeFile(f)} />)}</ul>}
    </>
  );
}

function FileLine({ f, onRemove }: { f: FileRow; onRemove: () => void }) {
  const [sure, setSure] = useState(false);
  return (
    <li className="sw-fileline">
      <span className="mono sw-path">{f.folder ? `${f.folder}/` : ""}{f.name}</span>
      <span className="muted mono">{fmtBytes(f.size)}</span>
      <button className="linkish small" onClick={() => (sure ? onRemove() : setSure(true))}>{sure ? t("Yes, remove") : t("Remove")}</button>
    </li>
  );
}

/** Start the file, send it piece by piece, then finish it. Retries a piece twice if the connection drops. */
async function uploadOne(pkgId: string, file: File, folder: string, onSent: (n: number) => void) {
  const start = await api<{ id: string; partBytes: number; parts: number }>(`/software/${encodeURIComponent(pkgId)}/files`, { body: { name: file.name, folder, size: file.size } });
  const parts: { n: number; etag: string }[] = [];
  for (let n = 1; n <= start.parts; n++) {
    const piece = file.slice((n - 1) * start.partBytes, Math.min(n * start.partBytes, file.size));
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`/api/software/files/${encodeURIComponent(start.id)}/parts/${n}`, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/octet-stream", "X-Ronchi": "1" }, body: piece });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new ApiError(res.status, (data as any).error ?? "Upload failed.");
        parts.push({ n, etag: (data as any).etag });
        break;
      } catch (e) {
        if (attempt >= 2 || (e instanceof ApiError && e.status < 500 && e.status !== 429)) {
          await api(`/software/files/${encodeURIComponent(start.id)}`, { method: "DELETE" }).catch(() => undefined);
          throw e;
        }
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
    onSent(Math.min(n * start.partBytes, file.size));
  }
  await api(`/software/files/${encodeURIComponent(start.id)}/complete`, { body: { parts } });
}
