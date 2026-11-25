// Matching the pictures Fusion made (scripts/fusion-renders.mjs) to a machine's catalog. Plain
// logic, so it can be tested without a browser. Each part picture goes to the part number at the
// start of its CAD name (the same rule as the 3D viewer, codes.ts); the views go to the parts list.
// A picture whose name has no part number, or whose part isn't in this catalog, is left out and
// listed, so staff can see what didn't match.
import { cleanPartCode, SHEET_VIEWS, type SheetViewName } from "../../src/shared/catalog/model";
import { codeOf } from "./codes";

export interface PicturePlan {
  pictures: { code: string; file: string; name: string }[];
  views: { view: SheetViewName; file: string }[];
  noCode: string[];       // CAD names that don't start with a part number
  notInCatalog: string[]; // part numbers that aren't in this machine's catalog
  missingFiles: string[]; // pictures in the list that weren't among the chosen files
}

const text = (v: unknown, max = 300) => (typeof v === "string" && v.length <= max ? v : null);

/** `manifest` is manifest.json as read; `files` the names of the files staff picked. */
export function planPictures(manifest: unknown, files: string[], known: Set<string>): PicturePlan {
  const m = manifest as { views?: unknown; parts?: unknown } | null;
  if (!m || typeof m !== "object" || !Array.isArray(m.parts) || typeof m.views !== "object" || m.views === null) {
    throw new Error("This isn't a Fusion pictures list (manifest.json).");
  }
  const have = new Set(files.map((f) => f.toLowerCase()));
  const plan: PicturePlan = { pictures: [], views: [], noCode: [], notInCatalog: [], missingFiles: [] };
  const views = m.views as Record<string, unknown>;
  for (const view of SHEET_VIEWS) {
    const file = text(views[view], 200);
    if (!file) continue;
    if (have.has(file.toLowerCase())) plan.views.push({ view, file });
    else plan.missingFiles.push(file);
  }
  const done = new Set<string>();
  for (const p of (m.parts as Record<string, unknown>[]).slice(0, 20000)) {
    const name = text(p?.name) ?? "";
    const file = text(p?.file, 200);
    const code = codeOf(name, {}) ?? cleanPartCode(p?.code);
    if (!file || (code && done.has(code))) continue;
    if (!code) {
      if (name) plan.noCode.push(name);
      continue;
    }
    if (!known.has(code)) {
      if (!plan.notInCatalog.includes(code)) plan.notInCatalog.push(code);
      continue;
    }
    if (!have.has(file.toLowerCase())) {
      plan.missingFiles.push(file);
      continue;
    }
    done.add(code);
    plan.pictures.push({ code, file, name });
  }
  return plan;
}
