// Matching 3D part names to Ronchi part codes. Kept apart from the 3D viewer so pages can use it
// without loading three.js.

import { PART_CODE } from "../../src/shared/catalog/model";

// Any code PART_CODE accepts, at the start of a name, followed by the end, a separator, or a
// revision or note after an underscore (CA086399_A, GF000023_scatto).
const CODE_IN_NAME = new RegExp(`^(${PART_CODE.source.replace(/^\^|\$$/g, "")})(?=$|[^0-9A-Z_]|_[A-Z])`, "i");

/** The part code a node stands for: from the mesh map, else from the start of its name. */
export function codeOf(name: string, meshMap: Record<string, string>): string | null {
  if (!name) return null;
  if (meshMap[name]) return meshMap[name]!;
  const m = CODE_IN_NAME.exec(name.trim());
  // CAD names copies "GF010526-1", "GF010526-2": the code is the part before the dash.
  // Staff can map any other name to its code in the sheet's mesh map.
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * The list code a node name stands for, when the name only carries it with copy numbers glued on.
 * three.js drops dots from node names, so Creo's "CD075732.1" arrives as "CD0757321" and codeOf
 * can't read it. Only codes on this parts list are tried, so a squeezed name can't invent a code:
 * the name must start with a list code (or, when only one row has it, the code before a row's
 * "_36"-style suffix), followed by at most three glued digits and then nothing or a separator.
 */
export function listedCode(name: string, known: Iterable<string>): string | null {
  const n = name.trim().toUpperCase();
  const fits = (p: string) => n.startsWith(p) && /^\d{0,3}(?:PRT|IPT|IAM|ASM|PAR|SLDPRT|SLDASM)?(?:$|[^0-9A-Z])/.test(n.slice(p.length));
  let best: string | null = null;
  const bases = new Map<string, string[]>();
  for (const k of known) {
    const K = k.toUpperCase();
    if (fits(K) && (!best || K.length > best.length)) best = k;
    const base = /^(.+)_\d+$/.exec(K)?.[1];
    if (base) (bases.get(base) ?? bases.set(base, []).get(base)!).push(k);
  }
  if (best) return best;
  for (const [base, ks] of bases) if (ks.length === 1 && fits(base)) return ks[0]!;
  return null;
}
