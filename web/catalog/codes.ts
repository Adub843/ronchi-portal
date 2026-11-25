// Matching 3D part names to Ronchi part codes. Kept apart from the 3D viewer so pages can use it
// without loading three.js.

import { PART_CODE } from "../../src/shared/catalog/model";

// Any code PART_CODE accepts, at the start of a name and followed by the end or a separator.
const CODE_IN_NAME = new RegExp(`^(${PART_CODE.source.replace(/^\^|\$$/g, "")})(?=$|[^0-9A-Z_])`, "i");

/** The part code a node stands for: from the mesh map, else from the start of its name. */
export function codeOf(name: string, meshMap: Record<string, string>): string | null {
  if (!name) return null;
  if (meshMap[name]) return meshMap[name]!;
  const m = CODE_IN_NAME.exec(name.trim());
  // CAD names copies "GF010526-1", "GF010526-2": the code is the part before the dash.
  // Staff can map any other name to its code in the sheet's mesh map.
  return m ? m[1]!.toUpperCase() : null;
}
