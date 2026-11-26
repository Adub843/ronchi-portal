// The PC catalog loader: puts 3D on a machine's parts lists in the live portal from one
// whole-machine STEP (or GLB) file, the same way "Add 3D for the whole machine" does in the
// browser, but on the PC, so big files and many machines can be loaded in one go.
//
//   npm run cad:load -- list                          every machine: parts lists, how many have 3D
//   npm run cad:load -- <machine number> <file.stp>   load one machine (add --dry-run to only check,
//                                                     --replace to redo parts lists that already have 3D,
//                                                     --whole to read a STEP file in one go instead of
//                                                     cutting out each assembly)
//   npm run cad:load -- remove <machine number> <parts list number> ...   take 3D off those parts lists
//
// It needs the loader key (made once with `npm run loader:key`), read from the file
// %USERPROFILE%\.ronchi\catalog-loader-key. PORTAL_URL picks the portal (default: the live one).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import occtimportjs from "occt-import-js";
import type * as THREE from "three";
import { findAssemblies } from "../web/catalog/split";
import { cutStep, indexStep } from "../web/catalog/stepsplit";
import { readStepTree } from "../web/catalog/steptree";
import { objectToGlbBytes, occtToObject, STEP_READ_OPTIONS, type OcctResult } from "../web/catalog/step-core";

// three.js's GLB writer uses the browser's FileReader; Node has Blob but no FileReader.
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(b: Blob) { void b.arrayBuffer().then((r) => { this.result = r; this.onloadend?.(); }); }
  readAsDataURL(b: Blob) { void b.arrayBuffer().then((r) => { this.result = `data:${b.type};base64,${Buffer.from(r).toString("base64")}`; this.onloadend?.(); }); }
}
(globalThis as any).FileReader ??= NodeFileReader;

const PORTAL = (process.env.PORTAL_URL ?? "https://ronchi-portal.business-console.workers.dev").replace(/\/$/, "");
const MAX = 95 * 1024 * 1024;
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [cmd, file] = args.filter((a) => !a.startsWith("--"));
if (!cmd) {
  console.error("Usage: npm run cad:load -- list\n       npm run cad:load -- <machine number> <file.stp|.glb> [--dry-run] [--replace]\n       npm run cad:load -- remove <machine number> <parts list number> ...");
  process.exit(2);
}

function key() {
  try {
    return readFileSync(join(homedir(), ".ronchi", "catalog-loader-key"), "utf8").trim();
  } catch {
    console.error("No loader key on this PC. Run `npm run loader:key` once first.");
    process.exit(2);
  }
}
const auth = { authorization: `Bearer ${key()}` };

interface Sheet { id: string; code: string | null; title: string; has_model: boolean }
interface Machine { serial: string; model: string | null; sheets: Sheet[] }
async function machines(): Promise<Machine[]> {
  const r = await fetch(`${PORTAL}/api/catalog-loader/machines`, { headers: auth });
  if (r.status === 404) throw new Error("The portal refused the loader key (or the loader isn't switched on). Run `npm run loader:key` again.");
  if (!r.ok) throw new Error(`The portal answered ${r.status}.`);
  return ((await r.json()) as { machines: Machine[] }).machines;
}

if (cmd === "list") {
  const all = await machines();
  console.log("Machine\tModel\tParts lists\tWith a number\tWith 3D");
  for (const m of all) console.log([m.serial, m.model ?? "", m.sheets.length, m.sheets.filter((s) => s.code).length, m.sheets.filter((s) => s.has_model).length].join("\t"));
  const withCatalog = all.filter((m) => m.sheets.length);
  console.log(`\n${all.length} machines, ${withCatalog.length} with a parts catalog, ${withCatalog.filter((m) => m.sheets.some((s) => s.has_model)).length} with some 3D.`);
  process.exit(0);
}

if (cmd === "remove") {
  const [serialArg, ...codes] = args.filter((a) => !a.startsWith("--")).slice(1);
  const mm = serialArg ? (await machines()).find((x) => x.serial.toUpperCase() === serialArg.toUpperCase()) : undefined;
  if (!mm || !codes.length) { console.error("Give the machine number and the parts list numbers to take 3D off."); process.exit(2); }
  const want = new Set(codes.map((c) => c.toUpperCase()));
  let removed = 0, failed = 0;
  for (const s of mm.sheets) {
    if (!s.code || !want.has(s.code.toUpperCase()) || !s.has_model) continue;
    const r = await fetch(`${PORTAL}/api/catalog-loader/sheets/${s.id}/model`, { method: "DELETE", headers: auth });
    if (r.ok) { removed++; console.log(`  ${s.code} ${s.title}: 3D removed`); }
    else { failed++; console.log(`  ${s.code} ${s.title}: failed (${r.status} ${await r.text()})`); }
  }
  console.log(`\nRemoved 3D from ${removed} parts lists. Failed: ${failed}.`);
  process.exit(failed ? 1 : 0);
}

if (!file) {
  console.error("Give the 3D file after the machine number.");
  process.exit(2);
}
const serial = cmd.toUpperCase();
const m = (await machines()).find((x) => x.serial.toUpperCase() === serial);
if (!m) throw new Error(`Machine ${serial} isn't in the portal.`);
const byCode = new Map<string, Sheet[]>();
for (const s of m.sheets) if (s.code) byCode.set(s.code.toUpperCase(), [...(byCode.get(s.code.toUpperCase()) ?? []), s]);
if (!byCode.size) throw new Error(`Machine ${serial} has no parts lists with an assembly number yet. Import its manual first.`);

const t0 = Date.now();
const secs = (t: number) => ((Date.now() - t) / 1000).toFixed(0);
const bytes = new Uint8Array(readFileSync(file));
const isGlb = /\.glb$/i.test(file);
// The 3D for each parts list found in the file, made when it's needed.
let hits: Map<string, () => Promise<THREE.Object3D | null>>;
if (isGlb || flags.has("--whole")) {
  // The whole file read at once (always for GLB). A big STEP fills occt-import-js's 2 GB memory
  // this way and comes back with no triangles, so STEP files are cut up instead (below).
  let root: THREE.Object3D;
  if (isGlb) {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    root = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "")).scene;
    root.updateMatrixWorld(true);
  } else {
    const occt = await occtimportjs();
    const res = occt.ReadStepFile(bytes, STEP_READ_OPTIONS) as OcctResult;
    if (!res.success) throw new Error("That STEP file couldn't be read. Export it again as STEP AP214 or AP242.");
    root = occtToObject(res, bytes).root;
  }
  console.log(`Read ${file} in ${secs(t0)} s.`);
  hits = new Map([...findAssemblies(root, byCode.keys())].map(([code, node]) => [code, async () => node]));
} else {
  // Find the assemblies in the STEP file's own tree, then cut each one out as a small STEP file
  // and read only that.
  const tree = readStepTree(bytes);
  if (!tree) throw new Error("That STEP file has no assemblies in it. Use --whole to read it as one piece.");
  const index = indexStep(bytes);
  console.log(`Indexed ${file} in ${secs(t0)} s (${index.entities.size} entities).`);
  hits = new Map([...findAssemblies(tree, byCode.keys())].map(([code, node]) => [code, async () => {
    const piece = node.def ? cutStep(index, node.def) : null;
    if (!piece) return null;
    const t = Date.now();
    // A fresh reader each time, so one piece's memory never carries over to the next.
    const occt = await occtimportjs();
    const res = occt.ReadStepFile(piece, STEP_READ_OPTIONS) as OcctResult;
    if (!res.success) { console.log(`  ${code}: its piece of the STEP file couldn't be read`); return null; }
    const tris = res.meshes.reduce((n, m) => n + m.index.array.length / 3, 0);
    console.log(`  ${code} (${node.name}): ${(piece.byteLength / 1048576).toFixed(1)} MB of STEP, ${res.meshes.length} shapes, ${tris} triangles, ${secs(t)} s`);
    return occtToObject(res, piece).root;
  }]));
}
console.log(`${hits.size} of ${byCode.size} parts list numbers are in the 3D file.`);

let saved = 0, skipped = 0, tooBig = 0, failed = 0, empty = 0, bytesSent = 0;
for (const [code, make] of hits) {
  const sheets = byCode.get(code) ?? [];
  if (sheets.every((s) => s.has_model) && !flags.has("--replace")) { skipped += sheets.length; continue; }
  const node = await make();
  // An assembly name with no shapes under it (a placeholder in the CAD), or shapes that came back
  // with no triangles, would load an empty 3D view.
  let triangles = 0;
  node?.traverse((o) => {
    const g = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).geometry : null;
    if (g) triangles += (g.index ? g.index.count : g.getAttribute("position")?.count ?? 0) / 3;
  });
  if (!node || !triangles) { empty += sheets.length; console.log(`  ${code}: no shapes in the 3D file, skipped`); continue; }
  for (const s of sheets) {
    if (s.has_model && !flags.has("--replace")) { skipped++; continue; }
    const glb = await objectToGlbBytes(node);
    if (glb.byteLength > MAX) { tooBig++; console.log(`  ${code} ${s.title}: too big (${(glb.byteLength / 1048576).toFixed(0)} MB)`); continue; }
    if (flags.has("--dry-run")) { console.log(`  ${code} ${s.title}: would load ${(glb.byteLength / 1048576).toFixed(1)} MB`); bytesSent += glb.byteLength; saved++; continue; }
    const r = await fetch(`${PORTAL}/api/catalog-loader/sheets/${s.id}/model`, { method: "PUT", headers: { ...auth, "content-type": "model/gltf-binary" }, body: glb });
    if (r.ok) { saved++; bytesSent += glb.byteLength; console.log(`  ${code} ${s.title}: 3D loaded (${(glb.byteLength / 1048576).toFixed(1)} MB)`); }
    else { failed++; console.log(`  ${code} ${s.title}: failed (${r.status} ${await r.text()})`); }
  }
}
console.log(`\n${flags.has("--dry-run") ? "Would load" : "Loaded"} 3D on ${saved} parts lists (${(bytesSent / 1048576).toFixed(1)} MB). Already had 3D: ${skipped}. Too big: ${tooBig}. Empty in the 3D file: ${empty}. Failed: ${failed}.`);
process.exit(failed ? 1 : 0);
