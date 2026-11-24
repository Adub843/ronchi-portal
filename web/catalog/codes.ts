// Matching 3D part names to Ronchi part codes. Kept apart from the 3D viewer so pages can use it
// without loading three.js.

const CODE_IN_NAME = /^((?:[A-Z]{2,3}\d{6}(?:_\d{1,3})?)|\d{10})(?=$|[^0-9])/i;

/** The part code a node stands for: from the mesh map, else from the start of its name. */
export function codeOf(name: string, meshMap: Record<string, string>): string | null {
  if (!name) return null;
  if (meshMap[name]) return meshMap[name]!;
  const m = CODE_IN_NAME.exec(name.trim());
  // CAD names copies "GF010526-1", "GF010526-2": the code is the part before the dash.
  // Staff can map any other name to its code in the sheet's mesh map.
  return m ? m[1]!.toUpperCase() : null;
}
