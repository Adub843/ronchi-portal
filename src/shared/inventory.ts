// Inventory: what is on the shelves at Ronchi America, part by part and shelf by shelf.
// Used by the portal server (routes/inventory.ts) and the staff app (pages/Inventory.tsx).
//
// Built the way the stock tools rated best by their users work (research note in project files,
// "Inventory software.md"): every change in quantity is one row in a ledger that is never edited
// (stock_moves), and the quantity on hand is the running total of those rows, kept per shelf in
// stock_levels. Reserved is what confirmed parts orders hold from our stock; available is on hand
// less reserved. Costs and stock value are only sent to people with inventory.prices.

export const MOVE_TYPES = ["receive", "issue", "move", "adjust", "opening"] as const;
export type MoveType = (typeof MOVE_TYPES)[number];
export const MOVE_LABELS: Record<MoveType, string> = {
  receive: "Put into stock",
  issue: "Taken out",
  move: "Moved shelf",
  adjust: "Count corrected",
  opening: "Opening stock",
};

/** Why a count was corrected. A reason is required, as in the stock tools the research looked at. */
export const ADJUST_REASONS = ["Counted", "Damaged", "Lost", "Found", "Wrong part number", "Used on a job, not recorded", "Other"] as const;
/** Why stock was taken out by hand. */
export const ISSUE_REASONS = ["Parts order", "Field service job", "Warranty", "Sample", "Returned to supplier", "Scrapped", "Other"] as const;

export const ITEM_FIELDS = ["description", "bin", "reorder_point", "reorder_qty", "unit_cost", "notes", "active"] as const;
export type ItemField = (typeof ITEM_FIELDS)[number];
export const ITEM_LABELS: Record<ItemField, string> = {
  description: "Description",
  bin: "Usual shelf",
  reorder_point: "Reorder when at or below",
  reorder_qty: "Reorder quantity",
  unit_cost: "Cost each",
  notes: "Notes",
  active: "Kept in stock",
};

export const MAX_IMPORT = 2000;

export interface StockRow { on_hand: number; reserved: number; reorder_point: number | null; active?: boolean | number }
export const available = (r: Pick<StockRow, "on_hand" | "reserved">) => Math.round((r.on_hand - r.reserved) * 1000) / 1000;
/** Out: nothing on the shelf of a part we mean to keep (it has a reorder point) or that an order is waiting for.
 *  A part that only passed through for one customer order and has gone is not "out of stock". */
export const isOut = (r: StockRow) => r.active !== false && r.active !== 0 && r.on_hand <= 0 && (r.reorder_point != null || r.reserved > 0);
/** Low: a reorder point is set and what is free to use has fallen to it (and something is still on the shelf). */
export const isLow = (r: StockRow) => r.active !== false && r.active !== 0 && r.reorder_point != null && available(r) <= r.reorder_point && !isOut(r);

/** Spreadsheet column names people use, mapped to the import's fields. */
export const IMPORT_COLUMNS: Record<string, "part_code" | "description" | "location" | "qty" | "reorder_point" | "reorder_qty" | "unit_cost"> = {
  "part": "part_code", "part number": "part_code", "part no": "part_code", "part #": "part_code", "code": "part_code", "part code": "part_code", "item": "part_code",
  "description": "description", "name": "description",
  "shelf": "location", "bin": "location", "location": "location",
  "qty": "qty", "quantity": "qty", "on hand": "qty", "count": "qty",
  "reorder point": "reorder_point", "min": "reorder_point", "reorder at": "reorder_point",
  "reorder qty": "reorder_qty", "reorder quantity": "reorder_qty",
  "cost": "unit_cost", "unit cost": "unit_cost", "cost each": "unit_cost",
};

/** Read a pasted or uploaded CSV into import rows. Returns the rows and the lines that couldn't be read. */
export function readStockCsv(csv: string): { rows: Record<string, string>[]; problems: string[] } {
  const lines = parseCsv(csv.replace(/^﻿/, "")).filter((r) => r.some((c) => c.trim()));
  const problems: string[] = [];
  if (lines.length < 2) return { rows: [], problems: ["The file needs a heading line and at least one part."] };
  const head = lines[0]!.map((h) => IMPORT_COLUMNS[h.trim().toLowerCase()] ?? null);
  if (!head.includes("part_code")) problems.push("No Part number column was found.");
  if (!head.includes("qty")) problems.push("No Quantity column was found.");
  if (problems.length) return { rows: [], problems };
  const rows: Record<string, string>[] = [];
  lines.slice(1).forEach((cells, i) => {
    const row: Record<string, string> = {};
    head.forEach((f, j) => { if (f) row[f] = (cells[j] ?? "").trim(); });
    if (!row.part_code) { problems.push(`Line ${i + 2} has no part number.`); return; }
    if (!/^\d+(?:[.,]\d+)?$/.test((row.qty ?? "").replace(/\s/g, ""))) { problems.push(`Line ${i + 2}: the quantity must be a number.`); return; }
    rows.push(row);
  });
  return { rows, problems };
}

function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const sep = (text.split(/\r?\n/, 1)[0] ?? "").split(";").length > (text.split(/\r?\n/, 1)[0] ?? "").split(",").length ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); out.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}
