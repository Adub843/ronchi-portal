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
 * The row of this parts list a node stands for, when its name starts with that row's part number.
 * Italy's files add a revision and copy numbers after the number ("CD052968_1_A.1.1", "CD055542.1"),
 * which codeOf alone reads as a different number or as none. Give it the name as the CAD file has it.
 */
export function listCodeOf(name: string, codes: readonly string[]): string | null {
  const n = name.trim().toUpperCase();
  if (n.length < 6) return null;
  let best: string | null = null;
  for (const code of codes) {
    const c = code.toUpperCase();
    if (c.length >= 6 && c.length > (best?.length ?? 0) && n.startsWith(c) && !/^[0-9A-Z]/.test(n.slice(c.length))) best = code;
  }
  if (best) return best;
  // The list says CM006026_1 and the file only CM006026: fine when no other row shares the number.
  const lead = /^[A-Z]{2,3}\d{6}|^\d{10}/.exec(n)?.[0];
  if (!lead || /^[0-9A-Z]/.test(n.slice(lead.length))) return null;
  const same = codes.filter((code) => code.toUpperCase().replace(/_\d{1,3}$/, "") === lead);
  return same.length === 1 ? same[0]! : null;
}
