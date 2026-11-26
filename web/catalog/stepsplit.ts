// Cutting one assembly (or one part) out of a big STEP file as a small STEP file of its own.
// The 3D reader (occt-import-js) runs in WebAssembly with a 2 GB memory cap; a whole-machine file
// such as Creo's 120-220 MB "sdac" exports fills it while reading, and then every face comes back
// with no triangles. Cut out, each assembly is a few MB and reads in seconds. Plain text work, so it
// runs the same in the browser and in Node.

/** Every entity of a STEP file by id (without "#"), read once so many pieces can be cut from it. */
export interface StepIndex {
  header: string;
  entities: Map<string, string>;
  /** For the few entity kinds the cut follows backwards: id -> ids of those entities that point at it. */
  back: Map<string, string[]>;
  /** The file's MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION contexts, for the colours. */
  presentationContexts: string[];
}

// One entity: "#12=" then anything up to the ";" that ends it, with quoted strings (which may hold
// ";") skipped whole. A doubled quote inside a string ('it''s') reads as two strings back to back,
// which skips the same text and leaves the pattern only one way to match.
const ENTITY = /#(\d+)\s*=\s*((?:[^;']|'[^']*')*);/g;
const STRING = /'[^']*'/g;
const REF = /#(\d+)/g;

/** The entity ids an entity's text points at, leaving out anything inside quoted strings. */
export function refsOf(text: string): string[] {
  return [...text.replace(STRING, "''").matchAll(REF)].map((m) => m[1]!);
}

/** The entity's type: PRODUCT_DEFINITION, or the first type of a complex entity "(A() B() ...)". */
export function kindOf(text: string | undefined): string {
  return text?.match(/^\(?\s*([A-Z_0-9]+)/)?.[1] ?? "";
}

// Kinds the cut reaches by following references backwards (who points at this?).
const BACK_KINDS = new Set([
  "PRODUCT_DEFINITION_SHAPE",
  "NEXT_ASSEMBLY_USAGE_OCCURRENCE",
  "SHAPE_DEFINITION_REPRESENTATION",
  "CONTEXT_DEPENDENT_SHAPE_REPRESENTATION",
  "SHAPE_REPRESENTATION_RELATIONSHIP",
  "STYLED_ITEM",
  "OVER_RIDING_STYLED_ITEM",
]);

/** Read a STEP file into an index. The file is read in chunks so a 300 MB file never becomes one huge string. */
export function indexStep(bytes: Uint8Array, chunk = 16 * 1024 * 1024): StepIndex {
  const entities = new Map<string, string>();
  const back = new Map<string, string[]>();
  const presentationContexts: string[] = [];
  const dec = new TextDecoder("latin1");
  let header = "";
  let carry = "";
  let inData = false;
  for (let at = 0; at < bytes.length; at += chunk) {
    let text = carry + dec.decode(bytes.subarray(at, Math.min(bytes.length, at + chunk)));
    if (!inData) {
      const d = text.indexOf("DATA;");
      if (d < 0) { carry = text; continue; }
      header = text.slice(0, d);
      text = text.slice(d + 5);
      inData = true;
    }
    ENTITY.lastIndex = 0;
    let end = 0;
    for (let m = ENTITY.exec(text); m; m = ENTITY.exec(text)) {
      const id = m[1]!;
      const body = m[2]!;
      entities.set(id, body);
      end = ENTITY.lastIndex;
      const kind = kindOf(body);
      // A complex entity such as (REPRESENTATION_RELATIONSHIP() ..._WITH_TRANSFORMATION() SHAPE_...())
      // is reached forwards from its CONTEXT_DEPENDENT_SHAPE_REPRESENTATION, never backwards.
      if (BACK_KINDS.has(kind) && !body.startsWith("(")) {
        for (const r of refsOf(body)) {
          let list = back.get(r);
          if (!list) back.set(r, (list = []));
          list.push(id);
        }
      }
      if (kind === "MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION") {
        const ctx = refsOf(body).at(-1);
        if (ctx) presentationContexts.push(ctx);
      }
    }
    carry = text.slice(end);
  }
  return { header, entities, back, presentationContexts };
}

/**
 * A small STEP file holding one PRODUCT_DEFINITION (an assembly or a part) and everything under
 * it: its products, the uses of each inside the other with their placements, the shapes, the units
 * and contexts they point at, and the colours of the kept shapes. Nothing above it comes along, so
 * the piece sits at its own origin. Null when there is no such definition.
 */
export function cutStep(index: StepIndex, def: string): Uint8Array | null {
  const { entities, back } = index;
  if (kindOf(entities.get(def)) !== "PRODUCT_DEFINITION") return null;
  const keep = new Set<string>();
  const todo: string[] = [];
  const close = (id: string) => {
    todo.push(id);
    while (todo.length) {
      const x = todo.pop()!;
      if (keep.has(x)) continue;
      const body = entities.get(x);
      if (body === undefined) continue;
      keep.add(x);
      for (const r of refsOf(body)) if (!keep.has(r)) todo.push(r);
    }
  };
  // Which backward links to follow from a kept entity of this kind.
  const follow = (id: string, kind: string, from: string): boolean => {
    const k = kindOf(entities.get(from));
    if (k === "PRODUCT_DEFINITION") {
      if (kind === "PRODUCT_DEFINITION_SHAPE") return true;
      // Only the uses inside this definition, never the ones that put it inside something else.
      if (kind === "NEXT_ASSEMBLY_USAGE_OCCURRENCE") return refsOf(entities.get(id)!)[0] === from;
      return false;
    }
    if (k === "NEXT_ASSEMBLY_USAGE_OCCURRENCE") return kind === "PRODUCT_DEFINITION_SHAPE";
    if (k === "PRODUCT_DEFINITION_SHAPE") return kind === "SHAPE_DEFINITION_REPRESENTATION" || kind === "CONTEXT_DEPENDENT_SHAPE_REPRESENTATION";
    if (/REPRESENTATION$/.test(k)) return kind === "SHAPE_REPRESENTATION_RELATIONSHIP";
    return false;
  };
  close(def);
  // Every kept entity is checked once for backward links, including those kept along the way.
  const checked = new Set<string>();
  for (let again = true; again; ) {
    again = false;
    for (const from of keep) {
      if (checked.has(from)) continue;
      checked.add(from);
      for (const id of back.get(from) ?? []) {
        if (!keep.has(id) && follow(id, kindOf(entities.get(id)), from)) { close(id); again = true; }
      }
    }
  }
  // Colours: the styles on kept shapes, gathered under one presentation of their own (the file's
  // own presentation lists the styles of the whole machine).
  const styles: string[] = [];
  for (const from of [...keep]) {
    for (const id of back.get(from) ?? []) {
      const k = kindOf(entities.get(id));
      if ((k === "STYLED_ITEM" || k === "OVER_RIDING_STYLED_ITEM") && !keep.has(id)) { close(id); styles.push(id); }
    }
  }
  const ctx = index.presentationContexts[0];
  if (styles.length && ctx) close(ctx);
  const lines = [...keep].sort((a, b) => Number(a) - Number(b)).map((i) => `#${i}=${entities.get(i)};`);
  if (styles.length && ctx) {
    lines.push(`#${maxId(index) + 1}=MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(${styles.map((s) => `#${s}`).join(",")}),#${ctx});`);
  }
  const text = `${index.header}DATA;\n${lines.join("\n")}\nENDSEC;\nEND-ISO-10303-21;\n`;
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

const maxIds = new WeakMap<StepIndex, number>();
function maxId(index: StepIndex): number {
  let m = maxIds.get(index);
  if (m === undefined) {
    m = 0;
    for (const k of index.entities.keys()) if (Number(k) > m) m = Number(k);
    maxIds.set(index, m);
  }
  return m;
}
