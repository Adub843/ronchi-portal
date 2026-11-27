// Offline check of the 3D click-to-row mapping: for every parts list with a 3D model, load the GLB
// the way the viewer does (three.js GLTFLoader), link pieces to rows the way the viewer does
// (codeOf + autoLink, same code), then "click" every piece and record which row it lands on.
// Reads C:/ronchi-cad/mapcheck/{sheets,rows}.json and models/*.glb. Writes results.json.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { codeOf, listedCode } from "../web/catalog/codes";
import { autoLink, baseName, type PartRow } from "../web/catalog/autolink";

const dir = process.argv[2] ?? "C:/ronchi-cad/mapcheck";
const only = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
const json = (f: string) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8").replace(/^\uFEFF/, ""));
type Sheet = { id: string; serial: string; code: string | null; title: string; model_ref: string | null; mesh_map: string | null };
type Row = { sheet_id: string; pos: string | null; code: string; qty: number | null; name_en: string | null; name_it: string | null; maker: string | null; maker_pn: string | null };
const sheets: Sheet[] = json("sheets.json");
const rowsBy = new Map<string, Row[]>();
for (const r of json("rows.json") as Row[]) (rowsBy.get(r.sheet_id) ?? rowsBy.set(r.sheet_id, []).get(r.sheet_id)!).push(r);

const unitOf = (root: THREE.Object3D, m: THREE.Object3D) => {
  const p = m.parent;
  return p && p !== root && p.children.length > 0 && p.children.every((c) => (c as THREE.Mesh).isMesh) ? p : m;
};

const cache = new Map<string, Promise<THREE.Object3D | null>>();
function load(file: string) {
  if (!cache.has(file)) {
    cache.set(file, new Promise((res) => {
      if (!existsSync(file)) return res(null);
      const b = readFileSync(file);
      new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "", (g) => res(g.scene), () => res(null));
    }));
  }
  return cache.get(file)!;
}

const out: unknown[] = [];
let n = 0;
for (const s of sheets) {
  if (only && !only.has(s.id) && !only.has(s.serial)) continue;
  const file = `${dir}/models/${s.model_ref ?? s.id}.glb`;
  const scene = await load(file);
  const rows = rowsBy.get(s.id) ?? [];
  if (!scene) { out.push({ id: s.id, serial: s.serial, code: s.code, title: s.title, error: "model not loaded" }); continue; }
  const root = scene.clone(true);
  const meshMap = s.mesh_map ? JSON.parse(s.mesh_map) : {};
  const codes = new Map<string, string | null>();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { codes.set(o.uuid, codeOf(o.name, meshMap)); if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const known = new Set(rows.map((r) => r.code));
  // link(), as in Model3D.tsx
  const parts: PartRow[] = rows.map((r) => ({ code: r.code, qty: r.qty, names: [r.name_en, r.name_it, r.maker, r.maker_pn] }));
  const squeezed = new Set<string>();
  if (!process.env.OLD) root.traverse((o) => {
    const c = codes.get(o.uuid) ?? null;
    if (!o.name || (c && known.has(c))) return;
    const l = listedCode(o.name, known);
    if (l) { codes.set(o.uuid, l); squeezed.add(o.uuid); }
  });
  const have = new Set<string>();
  for (const c of codes.values()) if (c) have.add(c);
  const units = new Map<THREE.Object3D, { names: string[]; verts: number }>();
  for (const m of meshes) {
    let listed = false;
    for (let o: THREE.Object3D | null = m; o; o = o.parent) { const c = codes.get(o.uuid); if (c && known.has(c)) { listed = true; break; } }
    if (listed) continue;
    const u = unitOf(root, m);
    const e = units.get(u) ?? units.set(u, { names: [u.name], verts: 0 }).get(u)!;
    if (m !== u) e.names.push(m.name);
    e.verts += m.geometry.getAttribute("position")?.count ?? 0;
  }
  const free = parts.filter((p) => !have.has(p.code));
  const auto = new Map<string, { code: string; sure: boolean }>();
  if (units.size && free.length) {
    const list = [...units].map(([o, e]) => ({ id: o.uuid, names: e.names, sig: `${[...new Set(e.names.slice(1).map(baseName))].sort().join(",") || baseName(o.name)}|${e.verts}` }));
    for (const [id, l] of autoLink(list, free)) { codes.set(id, l.code); auto.set(id, l); }
  }
  // Click every piece (hitPart, as in Model3D.tsx), one result per part (unit).
  const seen = new Set<string>();
  const pieces: { name: string; code: string | null; how: string }[] = [];
  const hitRows = new Map<string, number>();
  for (const mesh of meshes) {
    let found: { o: THREE.Object3D; code: string } | null = null;
    let deepest: THREE.Object3D | null = null;
    for (let o: THREE.Object3D | null = mesh; o; o = o.parent) {
      const c = codes.get(o.uuid);
      if (!c) continue;
      if (known.has(c)) { found = { o, code: c }; break; }
      deepest ??= o;
    }
    const unit = unitOf(root, mesh);
    const key = found ? found.o.uuid : unit.uuid;
    if (seen.has(key)) continue;
    seen.add(key);
    if (found) {
      const a = auto.get(found.o.uuid);
      pieces.push({ name: found.o.name || mesh.name, code: found.code, how: a ? (a.sure ? "name" : "guess") : "code" });
      hitRows.set(found.code, (hitRows.get(found.code) ?? 0) + 1);
    } else {
      const own = deepest && (deepest === unit || deepest === mesh) ? codes.get(deepest.uuid)! : null;
      pieces.push({ name: unit.name || mesh.name || "-", code: own, how: own ? "code-not-listed" : "none" });
    }
  }
  const rowsNo3D = rows.filter((r) => !hitRows.has(r.code)).map((r) => ({ pos: r.pos, code: r.code, name: r.name_en ?? r.name_it }));
  out.push({
    id: s.id, serial: s.serial, code: s.code, title: s.title, model: s.model_ref ?? s.id, rows: rows.length,
    pieces: pieces.length,
    landed: pieces.filter((p) => p.how === "code" || p.how === "name" || p.how === "guess").length,
    byCode: pieces.filter((p) => p.how === "code").length,
    byName: pieces.filter((p) => p.how === "name").length,
    guessed: pieces.filter((p) => p.how === "guess").length,
    notListed: pieces.filter((p) => p.how === "code-not-listed"),
    noRow: pieces.filter((p) => p.how === "none").map((p) => p.name),
    guesses: pieces.filter((p) => p.how === "guess").map((p) => `${p.name} -> ${p.code}`),
    links: pieces.filter((p) => p.how === "name" || p.how === "code").map((p) => `${p.name} -> ${p.code}`),
    rowsNo3D,
  });
  if (++n % 250 === 0) console.log(`${n} sheets`);
}
writeFileSync(`${dir}/${only ? "results-sample.json" : "results.json"}`, JSON.stringify(out));
console.log(`checked ${out.length} sheets`);
