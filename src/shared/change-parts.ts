// Change-part orders: the fields, the status list, and reading a spreadsheet (CSV) into orders.
// Used by the portal server (routes/change-parts.ts) and by the staff app (export, preview).
// This replaces the old Change Parts Console; its CSV columns import here unchanged.

/** Every field of an order that people can type, in the order they appear on screen and in exports. */
export const CP_FIELDS = [
  "customer", "machine", "part", "status", "salesperson", "contact", "follow_up", "quote", "customer_po", "ra_po", "aa",
  "samples_received", "samples_shipped", "fill_test", "ship_date", "folder_url", "notes",
] as const;
export type CpField = (typeof CP_FIELDS)[number];
export type CpOrderInput = Partial<Record<CpField, string | null>>;

/** Column names in exports (and the names the importer recognises first). */
export const CP_LABELS: Record<CpField, string> = {
  customer: "Customer",
  machine: "Machine",
  part: "Part",
  status: "Status",
  salesperson: "Salesperson",
  contact: "Customer contact",
  follow_up: "Follow up",
  quote: "Quote #",
  customer_po: "Customer PO",
  ra_po: "RA PO",
  aa: "AA",
  samples_received: "Samples received",
  samples_shipped: "Samples shipped",
  fill_test: "Fill test",
  ship_date: "Ship date",
  folder_url: "Folder link",
  notes: "Notes",
};

// Samples and ship date are free text, as the sheets use them: "Yes", "No", "Mid Nov 2026",
// "Delivered 08/10/2026". When the ship date reads as a real date, the tracker uses it to flag late jobs.

/** Longest text each field may hold. */
export const CP_MAX: Record<CpField, number> = {
  customer: 200, machine: 60, part: 300, status: 60, salesperson: 80, contact: 200, follow_up: 100, quote: 80, customer_po: 80, ra_po: 120, aa: 80,
  samples_received: 300, samples_shipped: 300, fill_test: 300, ship_date: 200, folder_url: 1000, notes: 5000,
};

/** The usual steps of a change-part job. People can also type their own status. */
export const CP_STATUSES = [
  "Open",
  "Quote",
  "Waiting on PO",
  "Waiting on samples",
  "In design",
  "In production",
  "Fill test",
  "Ready to ship",
  "Shipped",
  "On hold",
  "Cancelled",
  "Completed",
] as const;

/** Statuses that mean the job is finished, so it drops off the Open list. */
const DONE = /^(shipped|delivered|closed|complete[d]?|cancel+ed|canceled|invoiced|done)\b/i;
export const isOpen = (status: string | null | undefined) => !DONE.test((status ?? "").trim());

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Turn 2026-11-24, 11/24/2026, 11/24/26 or December 11, 2026 into 2026-11-24. Anything else gives null. */
export function normalDate(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  let y: number, m: number, d: number;
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(v);
  if (mt) [y, m, d] = [+mt[1]!, +mt[2]!, +mt[3]!];
  else if ((mt = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(v))) {
    [m, d, y] = [+mt[1]!, +mt[2]!, +mt[3]!];
    if (y < 100) y += 2000;
  } else if ((mt = /^([a-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/i.exec(v)) && MONTHS.includes(mt[1]!.toLowerCase())) {
    [m, d, y] = [MONTHS.indexOf(mt[1]!.toLowerCase()) + 1, +mt[2]!, +mt[3]!];
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** A folder link must be an https SharePoint or OneDrive address. */
export const FOLDER_LINK = /^https:\/\/[a-z0-9-]+(?:-my)?\.sharepoint\.com\//i;

// ---------- reading a CSV ----------

/** Split CSV text into rows of cells. Handles quotes, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// Other names a column might have in older sheets. Matched after lower-casing and dropping
// everything but letters and digits, so "Cust. P.O. #" and "customer po" both become "custpo".
const ALIASES: Record<CpField, string[]> = {
  customer: ["customer", "customername", "client", "company", "account"],
  machine: ["machine", "machineno", "machinenumber", "serial", "serialno", "serialnumber", "machineserial", "sn", "mfgno"],
  part: ["part", "parts", "changepart", "changeparts", "description", "partdescription", "item", "project", "projectname", "format", "bottle", "container"],
  status: ["status", "stage", "state", "projectstatus", "openorcompleted"],
  contact: ["contact", "customercontact", "contactname", "buyer"],
  follow_up: ["followup", "followupdate", "nextfollowup", "nextstep"],
  salesperson: ["salesperson", "sales", "salesrep", "rep", "owner", "accountmanager"],
  quote: ["quote", "quoteno", "quotenumber", "quotation"],
  customer_po: ["customerpo", "custpo", "customerpono", "custpono", "po", "pono", "ponumber", "customerponumber", "poreceived"],
  ra_po: ["rapo", "rapono", "ronchipo", "ronchiamericapo", "internalpo", "morpo", "morpono"],
  aa: ["aa", "aano", "aanumber", "projectaa", "projectnoaano", "projectno"],
  samples_received: ["samplesreceived", "samplereceived", "samplesrec", "samplesrcvd", "samplesin", "receivedsamples", "samplesrecived"],
  samples_shipped: ["samplesshipped", "sampleshipped", "samplesout", "samplessent", "samplessenttoitaly", "samplestoitaly"],
  fill_test: ["filltest", "filltrial", "test", "trial", "filltestresult", "filltestdate"],
  ship_date: ["shipdate", "shippingdate", "dateshipped", "eta", "deliverydate", "estshipdate", "estimatedshipdate"],
  folder_url: ["folder", "folderlink", "link", "folderurl", "sharepoint", "sharepointlink", "url", "linktofolder"],
  notes: ["notes", "note", "comments", "comment", "remarks"],
};
const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Which column of the sheet feeds which field. Columns nobody recognises are listed so they can go into Notes. */
export function mapHeader(header: string[]): { map: Partial<Record<CpField, number>>; unknown: { index: number; name: string }[]; extraPart: number[] } {
  const map: Partial<Record<CpField, number>> = {};
  let extraPart: number[] | undefined;
  const unknown: { index: number; name: string }[] = [];
  header.forEach((h, index) => {
    const k = key(h);
    if (!k) return;
    // A second "part" column (sheets with both Project Name and Part Description) joins the first.
    if (map.part !== undefined && ALIASES.part.includes(k)) {
      (extraPart ??= []).push(index);
      return;
    }
    const field = CP_FIELDS.find((f) => map[f] === undefined && (key(CP_LABELS[f]) === k || ALIASES[f].includes(k)));
    if (field) map[field] = index;
    else unknown.push({ index, name: h.trim() });
  });
  return { map, unknown, extraPart: extraPart ?? [] };
}

export interface ImportResult {
  orders: CpOrderInput[];
  matched: { field: CpField; column: string }[];
  extra: string[];       // columns kept in Notes
  skipped: number;       // rows with no customer and no part
  problems: string[];    // first few things to fix, in plain words
}

export const IMPORT_MAX_ROWS = 3000;

/** Read a whole CSV export (from the old console or the SharePoint master sheet) into orders. */
export function readOrdersCsv(text: string): ImportResult {
  const rows = parseCsv(text);
  const problems: string[] = [];
  if (rows.length < 2) return { orders: [], matched: [], extra: [], skipped: 0, problems: ["The file needs a header row and at least one order."] };
  const header = rows[0]!;
  const { map, unknown, extraPart } = mapHeader(header);
  if (map.customer === undefined && map.part === undefined) problems.push("No Customer or Part column found. Check the first row has column names.");
  const body = rows.slice(1, IMPORT_MAX_ROWS + 1);
  if (rows.length - 1 > IMPORT_MAX_ROWS) problems.push(`Only the first ${IMPORT_MAX_ROWS} rows are read.`);
  let skipped = 0;
  const orders: CpOrderInput[] = [];
  for (const r of body) {
    const o: CpOrderInput = {};
    const extraNotes: string[] = [];
    for (const f of CP_FIELDS) {
      const i = map[f];
      if (i === undefined) continue;
      let v = (r[i] ?? "").trim();
      if (f === "part") v = [v, ...extraPart.map((j) => (r[j] ?? "").trim())].filter(Boolean).join(": ");
      if (!v) continue;
      if (f === "folder_url" && !FOLDER_LINK.test(v)) { extraNotes.push(`${CP_LABELS[f]}: ${v}`); continue; }
      if (f === "machine") v = v.toUpperCase();
      o[f] = v.slice(0, CP_MAX[f]);
    }
    for (const u of unknown) {
      const v = (r[u.index] ?? "").trim();
      if (v) extraNotes.push(`${u.name}: ${v}`);
    }
    if (extraNotes.length) o.notes = [o.notes, ...extraNotes].filter(Boolean).join("\n").slice(0, CP_MAX.notes);
    if (!o.customer && !o.part) { skipped++; continue; }
    if (!o.customer) o.customer = "(no customer)";
    orders.push(o);
  }
  return {
    orders,
    matched: CP_FIELDS.filter((f) => map[f] !== undefined).map((f) => ({ field: f, column: header[map[f]!]!.trim() })),
    extra: unknown.map((u) => u.name),
    skipped,
    problems,
  };
}

// ---------- the sales side ----------

/** Steps of a change-part sale, before it's sold. "Lost" ends it; "Sold" is not a stage: selling makes it an order. */
export const CP_SALE_STAGES = ["New request", "Waiting on samples", "Quoting", "Quote sent", "Follow up", "On hold", "Lost"] as const;

/** A sale is still being worked unless it was lost. */
export const isSaleOpen = (status: string | null | undefined) => !/^(lost|cancel+ed|canceled|no sale|declined)\b/i.test((status ?? "").trim());

/** Fields that belong to the sale; the rest (samples, fill test, ship date, RA PO, AA) start once it's an order. */
export const CP_SALE_FIELDS: readonly CpField[] = ["customer", "machine", "part", "status", "salesperson", "contact", "follow_up", "quote", "customer_po", "folder_url", "notes"];
