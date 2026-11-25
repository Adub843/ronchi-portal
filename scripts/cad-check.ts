// Check a STEP file against a machine's parts lists before loading it into the portal:
// which parts lists would get 3D, and how many 3D parts are named with a part number.
//
//   npm run cad:check -- <file.step> <codes.txt>
//
// codes.txt: the machine's parts-list assembly numbers, one per line (for example from
// wrangler d1 execute ... "SELECT code FROM catalog_sheets s JOIN machines m ON m.id = s.machine_id
// WHERE m.serial = '4071MB' AND code IS NOT NULL"). Runs on the PC; nothing is uploaded.
import { readFileSync } from "node:fs";
import occtimportjs from "occt-import-js";
import { codeOf } from "../web/catalog/codes";
import { findAssemblies } from "../web/catalog/split";

interface OcctNode { name: string; meshes: number[]; children: OcctNode[] }
interface Tree { name: string; children: Tree[]; parts: number }

const [stepPath, codesPath] = process.argv.slice(2);
if (!stepPath || !codesPath) {
  console.error("Usage: npm run cad:check -- <file.step> <codes.txt>");
  process.exit(2);
}
const codes = readFileSync(codesPath, "utf8").split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
const occt = await occtimportjs();
const t0 = Date.now();
const res = occt.ReadStepFile(new Uint8Array(readFileSync(stepPath)), { linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio", linearDeflection: 0.002, angularDeflection: 0.6 }) as { success: boolean; root: OcctNode; meshes: { name: string }[] };
if (!res.success) {
  console.error("That STEP file couldn't be read.");
  process.exit(1);
}
let named = 0, unnamed = 0;
const unnamedSamples = new Set<string>();
// Same shape as the portal's 3D tree: a node's own shapes are leaf children named after the shape,
// so a parts list whose "assembly" is one CAD part (a welded frame, say) is found too.
const build = (n: OcctNode): Tree => {
  const leaves: Tree[] = n.meshes.map((i) => {
    const nm = res.meshes[i]?.name || n.name;
    if (codeOf(nm, {})) named++;
    else { unnamed++; if (unnamedSamples.size < 15) unnamedSamples.add(nm); }
    return { name: nm, children: [], parts: 1 };
  });
  return { name: n.name ?? "", children: [...leaves, ...n.children.map(build)], parts: n.meshes.length };
};
const tree = build(res.root);
const hits = findAssemblies(tree, codes);
console.log(`Read in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${named + unnamed} 3D parts, ${named} named with a part number.`);
console.log(`${hits.size} of ${codes.length} parts lists would get 3D:`);
for (const [code, node] of hits) console.log(`  ${code}  (3D name "${node.name}")`);
if (unnamedSamples.size) console.log(`Some parts without a part number in their name: ${[...unnamedSamples].join(", ")}`);
