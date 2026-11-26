// Library mode for the PC catalog loader: every assembly in every STEP file on
// this PC goes onto EVERY machine's parts list with the same number, not just the file's own machine.
// Ronchi reuses assemblies (GF092618 SUPPORT is on 12 machines), so one file fills many machines.
//   npm run cad:library -- [--dry-run] <file.stp> [<file.stp> ...]
// Lists that already have 3D are never touched. One GLB per number per run, uploaded to each list.
import { readFileSync, appendFileSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import occtimportjs from "occt-import-js";
import type * as THREE from "three";
import { cutStep, indexStep } from "../web/catalog/stepsplit";
import { readStepTree, type StepNode } from "../web/catalog/steptree";
import { codeOf } from "../web/catalog/codes";
import { sendModel } from "./cad-send";
import { objectToGlbBytes, occtToObject, STEP_READ_OPTIONS, type OcctResult } from "../web/catalog/step-core";

class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(b: Blob) { void b.arrayBuffer().then((r) => { this.result = r; this.onloadend?.(); }); }
  readAsDataURL(b: Blob) { void b.arrayBuffer().then((r) => { this.result = `data:${b.type};base64,${Buffer.from(r).toString("base64")}`; this.onloadend?.(); }); }
}
(globalThis as any).FileReader ??= NodeFileReader;

const PORTAL = "https://ronchi-portal.business-console.workers.dev";
const MAX = 95 * 1024 * 1024;
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const files = args.filter((a) => !a.startsWith("--"));
const auth = { authorization: `Bearer ${readFileSync(join(homedir(), ".ronchi", "catalog-loader-key"), "utf8").trim()}` };
const LOG = "C:\\ronchi-cad\\probe\\library.tsv";

interface Sheet { id: string; code: string | null; title: string; has_model: boolean }
interface Machine { serial: string; sheets: Sheet[] }
const machines = ((await (await fetch(`${PORTAL}/api/catalog-loader/machines`, { headers: auth })).json()) as { machines: Machine[] }).machines;
// Every parts list still without 3D, by number.
const want = new Map<string, { serial: string; sheet: Sheet }[]>();
for (const m of machines) for (const s of m.sheets) if (s.code && !s.has_model) {
  const c = s.code.toUpperCase();
  if (!want.has(c)) want.set(c, []);
  want.get(c)!.push({ serial: m.serial, sheet: s });
}
console.log(`${want.size} parts list numbers still without 3D, on ${[...want.values()].reduce((n, l) => n + l.length, 0)} parts lists.`);

const done = new Set<string>();
let lists = 0, bytes = 0, empty = 0, failed = 0, tooBig = 0;
for (const file of files) {
  const t0 = Date.now();
  const raw = new Uint8Array(readFileSync(file));
  const tree = readStepTree(raw);
  // The number in the file name (step_GF092618_sdac.stp) stands for the whole file.
  const fileCode = basename(file).match(/(?:^|_)([A-Z]{2}\d{6})(?=_|\.)/i)?.[1]?.toUpperCase();
  const hits = new Map<string, StepNode | "whole">();
  if (fileCode && want.has(fileCode) && !done.has(fileCode)) hits.set(fileCode, "whole");
  if (tree) {
    let level: StepNode[] = [tree];
    while (level.length) {
      const next: StepNode[] = [];
      for (const n of level) {
        const c = codeOf(n.name, {});
        if (c && want.has(c) && !done.has(c) && !hits.has(c)) hits.set(c, n);
        next.push(...n.children);
      }
      level = next;
    }
  }
  console.log(`${basename(file)}: ${hits.size} numbers to fill`);
  if (!hits.size) continue;
  const index = tree ? indexStep(raw) : null;
  for (const [code, node] of hits) {
    const targets = want.get(code)!;
    const piece = node === "whole" ? raw : node.def && index ? cutStep(index, node.def) : null;
    if (!piece) { failed += targets.length; continue; }
    let glb: ArrayBuffer;
    try {
      const res = (await occtimportjs()).ReadStepFile(piece, STEP_READ_OPTIONS) as OcctResult;
      const tris = res.success ? res.meshes.reduce((n, m) => n + m.index.array.length / 3, 0) : 0;
      if (!tris) { empty += targets.length; console.log(`  ${code}: no shapes, skipped`); done.add(code); continue; }
      glb = await objectToGlbBytes(occtToObject(res, piece).root as THREE.Object3D);
    } catch (e) { failed += targets.length; console.log(`  ${code}: ${(e as Error).message}`); continue; }
    done.add(code);
    if (glb.byteLength > MAX) { tooBig += targets.length; continue; }
    let stored = false;
    for (const { serial, sheet } of targets) {
      // "bytes" counts storage: the portal keeps one copy of a model however many parts lists use it.
      if (dry) { lists++; if (!stored) { bytes += glb.byteLength; stored = true; } continue; }
      const r = await sendModel(PORTAL, auth, sheet.id, glb);
      if (r.ok) { lists++; if (!r.shared) bytes += glb.byteLength; appendFileSync(LOG, `${new Date().toISOString()}\t${serial}\t${code}\t${sheet.title}\t${glb.byteLength}\t${basename(file)}\t${r.shared ? "shared" : "sent"}\n`); }
      else { failed++; console.log(`  ${serial} ${code}: failed ${r.error}`); }
    }
    console.log(`  ${code} (${node === "whole" ? "whole file" : node.name}): ${(glb.byteLength / 1048576).toFixed(1)} MB x ${targets.length} lists (${targets.map((t) => t.serial).join(" ")})`);
  }
  console.log(`  ${basename(file)} done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
console.log(`\n${dry ? "Would load" : "Loaded"} 3D on ${lists} parts lists (${(bytes / 1048576).toFixed(1)} MB of new storage). Empty: ${empty}. Too big: ${tooBig}. Failed: ${failed}.`);
