// The parts catalog's shapes, used by the staff portal, the customer parts site and both apps.
//
// A machine's catalog is a set of SHEETS. Each sheet is one exploded drawing from chapter 11 of
// the machine's manual ("Tavole costruttive / Construction tables"), or one 3D assembly. A sheet
// lists ROWS: balloon number, part code, quantity. Part names live once per part code in PARTS,
// because the same part (for example GF010526) is used on many machines.

/** Where a sheet sits in the catalog tree, like the Mario portal's three groups (plus kits). */
export const SECTIONS = ["machine", "format", "elevator", "kit"] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_NAMES: Record<Section, string> = {
  machine: "Machine components",
  format: "Format components",
  elevator: "Elevators",
  kit: "Kits",
};

/** A clickable area on a drawing, as fractions of the image (0 to 1), so it fits any size. */
export interface Hotspot {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetRow {
  pos: string;          // balloon number on the drawing, for example "12"
  code: string;         // Ronchi part code, for example GF010526, CM009450_195, 0000025133
  rev: string | null;   // drawing revision letter
  nameIt: string;
  nameEn: string;
  qty: number | null;
  unit: string | null;  // "m" for pipe sold by the meter, otherwise pieces
}

export interface ParsedSheet {
  page: number;                  // 1-based page in the PDF
  code: string | null;           // the assembly this drawing shows
  rev: string | null;
  titleIt: string;
  titleEn: string;
  group: string | null;          // the chapter 11 group heading, for example "Gruppi tappatore / Capping units"
  rows: SheetRow[];
  balloons: (Hotspot & { pos: string })[];
  warnings: string[];
}

/** Ronchi part codes: two or three letters and six digits (with an optional _1.._999 variant), or ten-digit kit numbers. */
export const PART_CODE = /^(?:[A-Z]{2,3}\d{6}(?:_\d{1,3})?|\d{10})$/;

export function isPartCode(s: string): boolean {
  return PART_CODE.test(s.trim().toUpperCase());
}

/** Clean a part code as typed or read (spaces, lower case) into its stored form, or null. */
export function cleanPartCode(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const c = s.trim().toUpperCase().replace(/\s+/g, "");
  return PART_CODE.test(c) ? c : null;
}
