// The knowledge base's shared rules: document types, the article layout, search words and the
// customer-data scan. Used by the staff portal (which owns the articles) and the help center
// (which only ever receives a published, customer-safe copy).
import { scanForCustomerData as privacyScan, type PrivacyFinding, type PrivateTerms } from "./privacy";
export type { PrivateTerms };

/** Document types, in the order the filters show them. The code prefix matches the Training Center (RA-OPL-001...). */
export const KB_KINDS = {
  opl: { label: "One Point Lesson", prefix: "RA-OPL" },
  howto: { label: "How-to", prefix: "RA-HOW" },
  known_issue: { label: "Known issue", prefix: "RA-KI" },
  quick_note: { label: "Quick note", prefix: "RA-QN" },
  reference: { label: "Reference", prefix: "RA-REF" },
  training: { label: "Training", prefix: "RA-TRN" },
  verification: { label: "Trainee verification", prefix: "RA-VER" },
} as const;
export type KbKind = keyof typeof KB_KINDS;
export const isKbKind = (v: unknown): v is KbKind => typeof v === "string" && Object.prototype.hasOwnProperty.call(KB_KINDS, v);

/** The Training Center's type codes (inv2.json "t") mapped to kinds. */
export const KIND_FROM_CODE: Record<string, KbKind> = { OPL: "opl", HOW: "howto", KI: "known_issue", QN: "quick_note", REF: "reference", TRN: "training", VER: "verification" };

export const KB_CATEGORIES = ["Mechanical", "Electrical", "Software", "Changeover"] as const;

/** Team-made articles are numbered from 501 per type, the same rule as the Training Center's quick-create tool. */
export const FIRST_TEAM_NUMBER = 501;

/** An article code: RA-OPL-002, RA-QN-501. */
export const KB_CODE = /^RA-(OPL|HOW|KI|QN|REF|TRN|VER)-\d{3,5}$/;

// ---------- Article layout (the Training Center's document format, without photos) ----------

export interface KbStep { title?: string; text?: string[]; callouts?: KbCallout[] }
export interface KbCallout { kind?: string; label?: string; text: string }
export interface KbBlock {
  heading?: string;
  text?: string[];
  bullets?: string[];
  steps?: KbStep[];
  table?: { cols: string[]; rows: string[][] };
  callouts?: KbCallout[];
}
export interface KbContent {
  meta?: Record<string, string>;
  safety?: string[];
  tools?: string[];
  blocks?: KbBlock[];
}

const s = (v: unknown, max = 4000): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const list = (v: unknown, max = 200): string[] => (Array.isArray(v) ? v.map((x) => s(x)).filter((x): x is string => !!x).slice(0, max) : []);

function cleanCallouts(v: unknown): KbCallout[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((c) => {
    const text = s(c?.text);
    return text ? [{ kind: s(c?.kind, 20) ?? "note", label: s(c?.label, 60) ?? undefined, text }] : [];
  }).slice(0, 20);
}

/** Keep only the parts of an article layout we know how to show. Photos are dropped (they come with the PDF). */
export function cleanContent(raw: unknown): KbContent {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const meta: Record<string, string> = {};
  if (r.meta && typeof r.meta === "object") {
    for (const [k, v] of Object.entries(r.meta).slice(0, 20)) {
      const key = s(k, 40);
      const val = s(v, 300);
      if (key && val) meta[key] = val;
    }
  }
  const blocks: KbBlock[] = (Array.isArray(r.blocks) ? r.blocks : []).slice(0, 200).map((b: any) => {
    const out: KbBlock = {};
    if (s(b?.heading, 200)) out.heading = s(b.heading, 200)!;
    if (list(b?.text).length) out.text = list(b.text);
    if (list(b?.bullets).length) out.bullets = list(b.bullets);
    if (Array.isArray(b?.steps)) {
      out.steps = b.steps.slice(0, 200).map((st: any) => {
        const step: KbStep = {};
        if (typeof st === "string") return { text: [st.slice(0, 4000)] };
        if (s(st?.title, 200)) step.title = s(st.title, 200)!;
        if (list(st?.text).length) step.text = list(st.text);
        if (cleanCallouts(st?.callouts).length) step.callouts = cleanCallouts(st.callouts);
        return step;
      }).filter((st: KbStep) => st.title || st.text?.length);
    }
    if (b?.table && Array.isArray(b.table.rows)) {
      out.table = {
        cols: list(b.table.cols, 12),
        rows: b.table.rows.slice(0, 300).map((row: unknown) => (Array.isArray(row) ? row.slice(0, 12).map((c) => String(c ?? "").slice(0, 1000)) : [])),
      };
    }
    if (cleanCallouts(b?.callouts).length) out.callouts = cleanCallouts(b.callouts);
    return out;
  }).filter((b: KbBlock) => Object.keys(b).length > 0);
  const out: KbContent = {};
  if (Object.keys(meta).length) out.meta = meta;
  if (list(r.safety).length) out.safety = list(r.safety);
  if (list(r.tools).length) out.tools = list(r.tools);
  if (blocks.length) out.blocks = blocks;
  return out;
}

/** The article as plain readable text: used for search, and as the help center's body. */
export function contentText(c: KbContent): string {
  const out: string[] = [];
  if (c.safety?.length) out.push("Safety", ...c.safety.map((x) => `• ${x}`), "");
  if (c.tools?.length) out.push("Tools and parts", ...c.tools.map((x) => `• ${x}`), "");
  for (const b of c.blocks ?? []) {
    if (b.heading) out.push(b.heading);
    for (const t of b.text ?? []) out.push(t);
    for (const t of b.bullets ?? []) out.push(`• ${t}`);
    (b.steps ?? []).forEach((st, i) => {
      out.push(`${i + 1}. ${st.title ?? ""}`.trim());
      for (const t of st.text ?? []) out.push(`   ${t}`);
      for (const co of st.callouts ?? []) out.push(`   ${co.label ?? "Note"}: ${co.text}`);
    });
    if (b.table) {
      if (b.table.cols.length) out.push(b.table.cols.join(" | "));
      for (const row of b.table.rows) out.push(row.join(" | "));
    }
    for (const co of b.callouts ?? []) out.push(`${co.label ?? "Note"}: ${co.text}`);
    out.push("");
  }
  return out.join("\n").replace(/\*\*/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------- Search ----------

/** Turn what someone typed into a safe full-text query: plain words only, each as a prefix. */
export function toFtsQuery(input: string): string {
  const words = input.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1).slice(0, 8);
  return words.map((w) => `"${w}"*`).join(" ");
}

// ---------- The customer-data scan ----------


export interface ScanHit { what: string; found: string; field: string }

/** Hits a publisher may confirm are not a customer's details (a customer named "Method", Ronchi's own service line).
 *  A machine number or a password can never be waved through. */
export const CONFIRMABLE = new Set(["Customer or site", "Email address", "Phone number"]);

/** Units that follow a 4-digit number in manuals ("2400RPM", "1500V"). Privacy's generic machine-number rule
 *  (four digits then letters) would otherwise refuse them, and a machine number can never be waved through. */
const UNIT = /^\d{4}\s?(V|VAC|VDC|A|MA|W|KW|HZ|RPM|BPM|CPM|MM|CM|M|NM|PSI|BAR|KG|G|MS|S|L|ML|LB|LBS|IN|FT)$/i;

/** True for a Ronchi or RA machine number on its own: 3069MB, 4222TP, RA1018. */
export function isMachineNumber(text: string): boolean {
  const s = text.trim();
  return (/^\d{4}[A-Z]{1,3}$/i.test(s) && !UNIT.test(s)) || /^RA-?\d{4}[A-Z]{0,2}$/i.test(s);
}

const RA_NUMBER = /\bRA-?\d{4}[A-Z]{0,2}\b/gi;
const EMAIL = /[^\s@<>()]{1,64}@[^\s@<>()]{1,190}\.[a-z]{2,24}/gi;
const PHONE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const SECRET = /\b(password|passwd|pwd|passcode|pin code)\s*(:|=|\bis\b)\s*\S+/gi;

const WHAT: Record<PrivacyFinding["kind"], string> = { customer: "Customer or site", site: "Customer or site", machine_number: "Machine number" };

/**
 * Look for anything that must never reach a customer. Names, sites and machine numbers go through the
 * wall's own check (src/shared/privacy.ts) with every customer, site and machine number the portal knows;
 * this adds RA machine numbers, emails, phone numbers and written-down passwords.
 * Returns every hit; publish is refused while any is left.
 */
export function scanForCustomerData(fields: Record<string, string>, terms: PrivateTerms): ScanHit[] {
  const hits: ScanHit[] = [];
  const seen = new Set<string>();
  const add = (what: string, found: string, field: string) => {
    const key = `${found.toLowerCase()}|${field}`;
    if (!seen.has(key)) { seen.add(key); hits.push({ what, found, field }); }
  };
  for (const [field, text] of Object.entries(fields)) {
    if (!text) continue;
    // Machine numbers first, so one that is also a name in the list stays a machine number (never confirmable).
    const found = privacyScan(text, terms).filter((f) => !(f.kind === "machine_number" && UNIT.test(f.match) && !terms.serials.some((s) => s.toLowerCase() === f.match.toLowerCase())));
    for (const f of found) if (f.kind === "machine_number") add(WHAT[f.kind], f.match, field);
    for (const m of text.matchAll(RA_NUMBER)) add("Machine number", m[0], field);
    for (const m of text.matchAll(EMAIL)) add("Email address", m[0], field);
    for (const m of text.matchAll(PHONE)) add("Phone number", m[0].trim(), field);
    for (const m of text.matchAll(SECRET)) add("Password", m[0].split(/\s/)[0]!, field);
    for (const f of found) if (f.kind !== "machine_number") add(WHAT[f.kind], f.match, field);
  }
  return hits;
}

/** The help center keeps four article types; this is how a portal type is shown there. */
export const HELP_KIND: Record<KbKind, "opl" | "howto" | "issue_fix" | "training"> = {
  opl: "opl", howto: "howto", reference: "howto", known_issue: "issue_fix", quick_note: "issue_fix", training: "training", verification: "training",
};

/** A starting category for an imported document, from its own words. Staff can change it. */
export function guessCategory(...texts: (string | null | undefined)[]): (typeof KB_CATEGORIES)[number] {
  const t = texts.filter(Boolean).join(" ").toLowerCase();
  if (/change ?over|size change|format change|change parts?\b/.test(t)) return "Changeover";
  if (/\b(hmi|plc|software|recipe|scada|program|firmware|backup|network|ethernet|ip address|panelview|login|vpn|secomea|cognex|vision|camera|studio 5000|rslogix|factorytalk)\b/.test(t)) return "Software";
  if (/\b(electric|electrical|wiring|wire|sensor|servo|drive|encoder|motor|sercos|power|fuse|relay|voltage|cable|connector|flowmeter|io-link|i\/o)\b/.test(t)) return "Electrical";
  return "Mechanical";
}
