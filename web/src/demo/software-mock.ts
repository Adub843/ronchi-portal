// DEMO ONLY. Software downloads in the preview: two example packages ("New laptop setup" and the
// Allen-Bradley legacy set) whose files are tiny stand-ins kept in this browser, plus uploads that
// work the same way as the real portal (start, send pieces, finish). Sizes shown are the real-world
// sizes of those installers so the pop-up looks like the real thing.
import { cleanFolder, PART_BYTES, sharePointLink, softwareFileName } from "../../../src/shared/software";

export class SoftwareFail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface Pkg { id: string; name: string; description: string; legacy: boolean; position: number; updated_at: string }
interface File { id: string; package_id: string; folder: string; name: string; size: number; url: string | null; parts?: Blob[]; link?: boolean }

let pkgs: Pkg[] | null = null;
let files: File[] = [];

const MB = 1024 * 1024;
const GB = 1024 * MB;

function seed(newId: () => string) {
  const at = new Date(Date.now() - 2 * 86400000).toISOString();
  const laptop: Pkg = { id: "sw-laptop", name: "New laptop setup", description: "Everything a new field service laptop needs, in one place.", legacy: false, position: 1, updated_at: at };
  const ab: Pkg = { id: "sw-ab", name: "Allen-Bradley (legacy)", description: "Older Rockwell programs. Kept on SharePoint (AB Studio 5000 Software folder); Download opens them from there.", legacy: true, position: 2, updated_at: at };
  const f = (p: Pkg, folder: string, name: string, size: number): File => ({
    id: newId(), package_id: p.id, folder, name, size,
    url: URL.createObjectURL(new Blob([`Example file for the Ronchi Portal preview: ${folder ? `${folder}/` : ""}${name}\r\n`], { type: "application/octet-stream" })),
  });
  pkgs = [laptop, ab];
  files = [
    f(laptop, "Studio 5000 Logix Designer v33", "Setup.exe", 3 * MB),
    f(laptop, "Studio 5000 Logix Designer v33", "Studio5000_v33_DVD.iso", 6.2 * GB),
    f(laptop, "Studio 5000 Logix Designer v33/Release notes", "Logix Designer v33 release notes.pdf", 2.4 * MB),
    f(laptop, "FactoryTalk View Studio 14", "FTView_14_DVD.iso", 4.8 * GB),
    f(laptop, "FactoryTalk Linx and RSLinx Classic", "RSLinx Classic 4.30.exe", 310 * MB),
    f(laptop, "FactoryTalk Linx and RSLinx Classic", "FactoryTalk Linx 6.40.exe", 520 * MB),
    f(laptop, "Cognex In-Sight Explorer 6.5", "In-Sight Explorer 6.5.0.exe", 680 * MB),
    f(laptop, "KEPServerEX 6", "KEPServerEX6-6.15.exe", 450 * MB),
    f(laptop, "Secomea LinkManager", "LinkManager_Setup.msi", 95 * MB),
    f(laptop, "Bosch IndraWorks 15", "IndraWorks_15V22.zip", 3.1 * GB),
    f(laptop, "", "Read me first - new laptop checklist.pdf", 0.4 * MB),
    f(laptop, "", "TeamViewer_Setup_x64.exe", 78 * MB),
    f(laptop, "", "7-Zip 24.08 x64.exe", 1.6 * MB),
    f(ab, "RSLogix 5000 v20", "RSLogix5000_v20.04_DVD.iso", 3.4 * GB),
    f(ab, "RSLogix 500 v9", "RSLogix 500 9.05.exe", 410 * MB),
    f(ab, "PanelBuilder32 v3.83", "PanelBuilder32 3.83.zip", 120 * MB),
    f(ab, "RSView32 7.6", "RSView32 7.60.zip", 380 * MB),
    f(ab, "FactoryTalk View ME 6.1", "FTViewME_6.10.iso", 2.2 * GB),
    f(ab, "ControlFLASH 15", "ControlFLASH 15.01.exe", 95 * MB),
    f(ab, "", "BOOTP-DHCP Tool 2.3.exe", 4 * MB),
  ].map((x) => (x.package_id === ab.id ? { ...x, size: 0, link: true } : { ...x, size: Math.round(x.size) }));
}

export function resetSoftware() {
  pkgs = null;
  files = [];
}

export function softwareRoute(method: string, seg: string[], body: any, ctx: { perms: Set<string>; newId: () => string }): unknown {
  if (!pkgs) seed(ctx.newId);
  const need = (p: string) => { if (!ctx.perms.has(p)) throw new SoftwareFail(403, "Your role doesn't allow this."); };
  const ready = (p: Pkg) => files.filter((f) => f.package_id === p.id && f.url);
  const shape = (p: Pkg) => ({ ...p, files: ready(p).length, size: ready(p).reduce((n, f) => n + f.size, 0) });
  const pkg = (id: string) => { const p = pkgs!.find((x) => x.id === id); if (!p) throw new SoftwareFail(404, "Not found."); return p; };
  const file = (id: string) => { const f = files.find((x) => x.id === id); if (!f) throw new SoftwareFail(404, "Not found."); return f; };

  if (seg.length === 1 && method === "GET") {
    need("software.view");
    return { packages: [...pkgs!].sort((a, b) => Number(a.legacy) - Number(b.legacy) || a.position - b.position).map(shape) };
  }
  if (seg.length === 1 && method === "POST") {
    need("software.manage");
    if (!String(body.name ?? "").trim()) throw new SoftwareFail(400, "A name is required.");
    const p: Pkg = { id: ctx.newId(), name: String(body.name).trim(), description: String(body.description ?? ""), legacy: body.legacy === true, position: pkgs!.length + 1, updated_at: new Date().toISOString() };
    pkgs!.push(p);
    return { id: p.id };
  }
  if (seg[1] === "files" && seg[2]) {
    const f = file(seg[2]);
    if (seg[3] === "parts" && method === "PUT") {
      need("software.manage");
      const blob: Blob | undefined = body.__blob;
      (f.parts ??= [])[Number(seg[4]) - 1] = blob ?? new Blob([]);
      return { n: Number(seg[4]), etag: `e${seg[4]}` };
    }
    if (seg[3] === "complete") {
      need("software.manage");
      f.url = URL.createObjectURL(new Blob(f.parts ?? [], { type: "application/octet-stream" }));
      delete f.parts;
      return { ok: true };
    }
    if (method === "DELETE") {
      need("software.manage");
      files = files.filter((x) => x !== f);
      return { ok: true };
    }
  }
  if (seg.length === 2 && method === "GET") {
    need("software.view");
    const p = pkg(seg[1]!);
    const list = ready(p).sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
    return { package: shape(p), files: list.map((f) => ({ id: f.id, folder: f.folder, name: f.name, size: f.size, url: f.url, link: !!f.link, opens: !!(f as any).opens })) };
  }
  if (seg.length === 2 && method === "PATCH") {
    need("software.manage");
    const p = pkg(seg[1]!);
    if (body.name !== undefined) p.name = String(body.name).trim() || p.name;
    if (body.description !== undefined) p.description = String(body.description);
    if (body.legacy !== undefined) p.legacy = body.legacy === true;
    return { ok: true };
  }
  if (seg.length === 2 && method === "DELETE") {
    need("software.manage");
    const p = pkg(seg[1]!);
    pkgs = pkgs!.filter((x) => x !== p);
    files = files.filter((f) => f.package_id !== p.id);
    return { ok: true };
  }
  if (seg[2] === "links" && method === "POST") {
    need("software.manage");
    const p = pkg(seg[1]!);
    const folder = cleanFolder(body.folder);
    if (folder === null) throw new SoftwareFail(400, "That folder name can't be used.");
    const list: string[] = Array.isArray(body.links) ? body.links : [];
    for (const url of list) {
      const l = sharePointLink(url);
      if (!l || !l.name) throw new SoftwareFail(400, `That isn't a link to one file on Ronchi's SharePoint: ${url.slice(0, 120)}`);
      files.push({ id: ctx.newId(), package_id: p.id, folder, name: softwareFileName(l.name), size: 0, link: true,
        url: URL.createObjectURL(new Blob([`Preview stand-in. In the real portal this downloads from SharePoint: ${url}\r\n`], { type: "application/octet-stream" })) });
    }
    return { added: list.length };
  }
  if (seg[2] === "files" && method === "POST") {
    need("software.manage");
    const p = pkg(seg[1]!);
    const folder = cleanFolder(body.folder);
    if (folder === null) throw new SoftwareFail(400, "That folder name can't be used.");
    const size = Number(body.size);
    if (!(size > 0)) throw new SoftwareFail(400, "That file is empty.");
    const f: File = { id: ctx.newId(), package_id: p.id, folder, name: softwareFileName(String(body.name ?? "")), size, url: null, parts: [] };
    files.push(f);
    return { id: f.id, partBytes: PART_BYTES, parts: Math.ceil(size / PART_BYTES) };
  }
  throw new SoftwareFail(404, "Not found.");
}
