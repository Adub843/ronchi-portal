// The knowledge base's shared rules: document types, the article layout, search words and the
// customer-data scan. Used by the staff portal (which owns the articles) and the help center
// (which only ever receives a published, customer-safe copy).

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

/** Ronchi and RA machine numbers: 3069MB, 4222TP, RA1018. The letter endings are the ones in Ronchi's machine list,
 *  so a speed or a voltage ("1500V", "2400RPM") is not mistaken for a machine. */
const MACHINE_NUMBER = /\b(\d{4}(MB|TP|RI|RM|RB|RR|BR|LC|SI|TD|MM|LS|MZ)|RA-?\d{4}[A-Z]{0,2})\b/g;
const EMAIL = /[^\s@<>()]{1,64}@[^\s@<>()]{1,190}\.[a-z]{2,24}/gi;
const PHONE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const SECRET = /\b(password|passwd|pwd|passcode|pin code)\s*(:|=|\bis\b)\s*\S+/gi;

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ");

/**
 * Look for anything that must never reach a customer: a customer or site name from the machine list,
 * a machine number, an email, a phone number, or a password.
 * `names` is every customer and site name the portal knows. Returns every hit; publish is refused if any.
 */
export function scanForCustomerData(fields: Record<string, string>, names: string[]): ScanHit[] {
  const hits: ScanHit[] = [];
  const seen = new Set<string>();
  const add = (what: string, found: string, field: string) => {
    const key = `${found.toLowerCase()}|${field}`;
    if (!seen.has(key)) { seen.add(key); hits.push({ what, found, field }); }
  };
  const wanted = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 3))];
  for (const [field, text] of Object.entries(fields)) {
    if (!text) continue;
    const low = ` ${norm(text)} `;
    for (const m of text.matchAll(MACHINE_NUMBER)) add("Machine number", m[0], field);
    for (const m of text.matchAll(EMAIL)) add("Email address", m[0], field);
    for (const m of text.matchAll(PHONE)) add("Phone number", m[0].trim(), field);
    for (const m of text.matchAll(SECRET)) add("Password", m[0].split(/\s/)[0]!, field);
    // Names last, so a machine number that is also in the machine list stays a machine number (never confirmable).
    for (const name of wanted) {
      const n = norm(name);
      // Whole words only, so "ALPLA" is found but "Al" inside "Alarm" is not.
      const re = new RegExp(`[^\\p{L}\\p{N}]${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\p{L}\\p{N}]`, "u");
      if (re.test(low)) add("Customer or site", name, field);
    }
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
