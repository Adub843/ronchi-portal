// The assembly tree of a STEP file, read straight from its text. The 3D reader (occt-import-js)
// keeps only the top two levels of a big assembly and flattens the rest into a list of parts, so
// sub-assemblies such as GF083234 inside Creo's 4071.stp vanish. Their names are still in the file:
// PRODUCT gives each part or assembly its name, and NEXT_ASSEMBLY_USAGE_OCCURRENCE says what is
// used inside what. Plain text work, so it runs the same in the browser and in Node.

export interface StepNode {
  name: string;
  children: StepNode[];
}

const STR = "'((?:[^']|'')*)'";
const REF = "#(\\d+)";
const S = "\\s*";
const PRODUCT = new RegExp(`#(\\d+)${S}=${S}PRODUCT${S}\\(${S}${STR}`, "g");
const FORMATION = new RegExp(`#(\\d+)${S}=${S}PRODUCT_DEFINITION_FORMATION(?:_WITH_SPECIFIED_SOURCE)?${S}\\(${S}${STR}${S},${S}${STR}${S},${S}${REF}`, "g");
const DEFINITION = new RegExp(`#(\\d+)${S}=${S}PRODUCT_DEFINITION${S}\\(${S}${STR}${S},${S}${STR}${S},${S}${REF}`, "g");
const USAGE = new RegExp(`NEXT_ASSEMBLY_USAGE_OCCURRENCE${S}\\(${S}${STR}${S},${S}${STR}${S},${S}${STR}${S},${S}${REF}${S},${S}${REF}`, "g");

/**
 * Every use of every assembly and part under the top assembly, in file order. Null when the file
 * has no assemblies. The file is read in chunks so a 300 MB STEP never becomes one huge string.
 */
export function readStepTree(bytes: Uint8Array, chunk = 16 * 1024 * 1024): StepNode | null {
  const products = new Map<string, string>();
  const formations = new Map<string, string>();
  const definitions = new Map<string, string>();
  const usages: [string, string][] = [];
  const dec = new TextDecoder("latin1");
  let carry = "";
  for (let at = 0; at < bytes.length; at += chunk) {
    const text = carry + dec.decode(bytes.subarray(at, Math.min(bytes.length, at + chunk)));
    // Only whole entities: everything up to the last ";" now, the rest with the next chunk.
    const end = at + chunk >= bytes.length ? text.length : text.lastIndexOf(";") + 1;
    const whole = text.slice(0, end);
    carry = text.slice(end);
    for (const m of whole.matchAll(PRODUCT)) products.set(m[1]!, m[2]!.replace(/''/g, "'"));
    for (const m of whole.matchAll(FORMATION)) formations.set(m[1]!, m[4]!);
    for (const m of whole.matchAll(DEFINITION)) definitions.set(m[1]!, m[4]!);
    for (const m of whole.matchAll(USAGE)) usages.push([m[4]!, m[5]!]);
  }
  if (!usages.length) return null;

  const nameOf = (def: string) => products.get(formations.get(definitions.get(def) ?? "") ?? "") ?? "";
  const inside = new Map<string, string[]>();
  const used = new Set<string>();
  for (const [parent, child] of usages) {
    if (!inside.has(parent)) inside.set(parent, []);
    inside.get(parent)!.push(child);
    used.add(child);
  }
  const build = (def: string, seen: Set<string>): StepNode => ({
    name: nameOf(def),
    // A loop in a broken file would never end; stop at it.
    children: (inside.get(def) ?? []).filter((c) => !seen.has(c)).map((c) => build(c, new Set(seen).add(c))),
  });
  const tops = [...inside.keys()].filter((d) => !used.has(d));
  if (tops.length === 1) return build(tops[0]!, new Set(tops));
  return { name: "", children: tops.map((d) => build(d, new Set([d]))) };
}

/** The 3D reader's tree: each node's own parts as indexes into its list of meshes. */
export interface PartTree {
  name: string;
  meshes: number[];
  children: PartTree[];
}

/**
 * The 3D reader's tree with its flattened parts put back into the sub-assemblies the STEP tree
 * says they belong to. Parts are matched by name, in order, within the node the reader put them
 * on. Anything that doesn't match stays where the reader put it, so a tree that doesn't fit the
 * STEP file comes back unchanged.
 */
export function regroup(root: PartTree, meshNames: readonly string[], step: StepNode): PartTree {
  const claimed = new Set<StepNode>();
  // The first unclaimed use of this name in the STEP subtree, outermost first.
  const find = (name: string, under: StepNode): StepNode | null => {
    let level = [under];
    while (level.length) {
      const next: StepNode[] = [];
      for (const s of level) {
        if (s.name === name && !claimed.has(s)) return s;
        next.push(...s.children);
      }
      level = next;
    }
    return null;
  };

  const place = (node: PartTree, match: StepNode | null): PartTree => {
    const childMatches = node.children.map((c) => {
      const s = c.name ? find(c.name, match ?? step) : null;
      if (s) claimed.add(s);
      return s;
    });
    const out: PartTree = { name: node.name, meshes: [], children: [] };
    if (match && node.meshes.length) {
      // This node's parts in the STEP file, with the sub-assemblies between it and each part,
      // leaving out what the reader kept as separate child nodes.
      const queues = new Map<string, StepNode[][]>();
      const walk = (s: StepNode, path: StepNode[]) => {
        for (const c of s.children) {
          if (claimed.has(c)) continue;
          if (c.children.length) walk(c, [...path, c]);
          else {
            if (!queues.has(c.name)) queues.set(c.name, []);
            queues.get(c.name)!.push(path);
          }
        }
      };
      walk(match, []);
      const groups = new Map<StepNode, PartTree>();
      const groupFor = (path: StepNode[]): PartTree => {
        let at = out;
        for (const s of path) {
          let g = groups.get(s);
          if (!g) {
            g = { name: s.name, meshes: [], children: [] };
            groups.set(s, g);
            at.children.push(g);
          }
          at = g;
        }
        return at;
      };
      for (const i of node.meshes) {
        const path = queues.get(meshNames[i] ?? "")?.shift();
        (path ? groupFor(path) : out).meshes.push(i);
      }
    } else out.meshes.push(...node.meshes);
    out.children.push(...node.children.map((c, k) => place(c, childMatches[k]!)));
    return out;
  };
  return place(root, root.name ? find(root.name, step) : null);
}
