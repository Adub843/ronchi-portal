// Staff: bring the pictures Fusion rendered from CAD (scripts/fusion-renders.mjs) into the catalog.
// Staff pick the files Fusion made (manifest.json and the PNGs). Each part picture goes to its part
// number, so it shows on every parts list with that part; the views become this parts list's
// pictures. Pictures are put on white and made smaller (WebP) here in the browser before upload.
import { useState } from "react";
import { api, apiPut } from "../api";
import { t } from "../i18n";
import { ErrorNote, Tip, toast } from "../components/ui";
import { planPictures, type PicturePlan } from "../../catalog/renders";

const enc = encodeURIComponent;
const MAX_BYTES = 5 * 1024 * 1024;

/** A picture on white, at most `longSide` pixels, as WebP (PNG where the browser can't make WebP). */
async function prepare(file: File, longSide: number): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, longSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error(t("The picture couldn't be read.")))), "image/webp", 0.88));
  if (blob.size > MAX_BYTES) throw new Error(t("That picture is too big (5 MB at most)."));
  return blob;
}

const short = (list: string[]) => list.slice(0, 12).join(", ") + (list.length > 12 ? " …" : "");

export function FusionPictures({ machineId, sheet, onDone, onClose }: {
  machineId: string;
  sheet: { id: string; views?: string[] };
  onDone: () => void;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<Map<string, File> | null>(null);
  const [plan, setPlan] = useState<PicturePlan | null>(null);
  const [useViews, setUseViews] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function choose(list: FileList | null) {
    setErr(null);
    setPlan(null);
    if (!list?.length) return;
    try {
      const all = Array.from(list);
      const manifest = all.find((f) => f.name.toLowerCase() === "manifest.json") ?? (all.filter((f) => /\.json$/i.test(f.name)).length === 1 ? all.find((f) => /\.json$/i.test(f.name)) : undefined);
      if (!manifest) throw new Error(t("No manifest.json among the chosen files. Pick every file in the folder Fusion made."));
      let parsed: unknown;
      try {
        parsed = JSON.parse(await manifest.text());
      } catch {
        throw new Error(t("This isn't a Fusion pictures list (manifest.json)."));
      }
      const pics = all.filter((f) => /\.(png|webp)$/i.test(f.name));
      const { codes } = await api<{ codes: string[] }>(`/catalog/machines/${enc(machineId)}/codes`);
      let p: PicturePlan;
      try {
        p = planPictures(parsed, pics.map((f) => f.name), new Set(codes));
      } catch {
        throw new Error(t("This isn't a Fusion pictures list (manifest.json)."));
      }
      setFiles(new Map(pics.map((f) => [f.name.toLowerCase(), f])));
      setPlan(p);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function add() {
    if (!plan || !files) return;
    const jobs = [
      ...(useViews ? plan.views.map((v) => ({ file: v.file, path: `/catalog/sheets/${enc(sheet.id)}/views/${v.view}`, side: 1600 })) : []),
      ...plan.pictures.map((p) => ({ file: p.file, path: `/catalog/parts/${enc(p.code)}/picture`, side: 800 })),
    ];
    const failed: string[] = [];
    let done = 0;
    try {
      for (const [i, j] of jobs.entries()) {
        setBusy(t("Adding picture {n} of {total}…", { n: i + 1, total: jobs.length }));
        try {
          const blob = await prepare(files.get(j.file.toLowerCase())!, j.side);
          await apiPut(j.path, blob, blob.type);
          done++;
        } catch (e) {
          failed.push(`${j.file}: ${(e as Error).message}`);
        }
      }
    } finally {
      setBusy(null);
    }
    toast(t("{n} pictures added", { n: done }));
    if (failed.length) setErr(failed.slice(0, 10).join("\n"));
    else setPlan(null);
    onDone();
  }

  async function removeViews() {
    if (!confirm(t("Remove the views from this parts list?"))) return;
    try {
      await api(`/catalog/sheets/${enc(sheet.id)}/views`, { method: "DELETE" });
      toast(t("Views removed"));
      onDone();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const count = plan ? plan.pictures.length + (useViews ? plan.views.length : 0) : 0;
  return (
    <div className="panel stack">
      <h2>{t("Pictures from Fusion")}</h2>
      <Tip id="catalog.fusion-pictures">{t("Pick every file in the folder Fusion made for this assembly: manifest.json and the pictures. Each part picture goes to the part with the same number, on every parts list that has it. The views become this parts list's pictures.")}</Tip>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <input type="file" multiple accept=".json,.png,.webp,application/json,image/png,image/webp" disabled={!!busy} onChange={(e) => choose(e.target.files)} aria-label={t("Files from Fusion")} />
        {!!sheet.views?.length && <button className="btn small danger" disabled={!!busy} onClick={removeViews}>{t("Remove this parts list's views")}</button>}
        <span className="spacer" />
        <button className="btn small" onClick={onClose}>{t("Close")}</button>
      </div>
      {busy && <p role="status">{busy}</p>}
      <ErrorNote error={err} />
      {plan && (
        <>
          <ul className="small">
            <li>{t("{n} part pictures match this machine's catalog", { n: plan.pictures.length })}</li>
            {plan.views.length > 0 && (
              <li><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={useViews} onChange={(e) => setUseViews(e.target.checked)} /> {t("{n} views for this parts list", { n: plan.views.length })}</label></li>
            )}
            {plan.notInCatalog.length > 0 && <li>{t("Not in this machine's catalog: {list}", { list: short(plan.notInCatalog) })}</li>}
            {plan.noCode.length > 0 && <li>{t("No part number at the start of the name: {list}", { list: short(plan.noCode) })}</li>}
            {plan.missingFiles.length > 0 && <li>{t("Not among the chosen files: {list}", { list: short(plan.missingFiles) })}</li>}
          </ul>
          {plan.pictures.length > 0 && (
            <div className="tbl" style={{ maxHeight: 240, overflow: "auto" }}>
              <table><tbody>
                {plan.pictures.map((p) => <tr key={p.code}><td className="mono">{p.code}</td><td>{p.name}</td></tr>)}
              </tbody></table>
            </div>
          )}
          <div>
            <button className="btn primary" disabled={!!busy || !count} onClick={add}>{count ? t("Add {n} pictures", { n: count }) : t("Nothing to add")}</button>
          </div>
        </>
      )}
    </div>
  );
}
