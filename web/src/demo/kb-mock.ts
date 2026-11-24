// DEMO ONLY. The knowledge base in the preview: the 128 Training Center documents, a few example
// quick notes, and Publish that runs the same customer-data scan as the real portal.
import docs from "./kb-docs.json";
import { cleanContent, CONFIRMABLE, contentText, FIRST_TEAM_NUMBER, guessCategory, isMachineNumber, KB_KINDS, KIND_FROM_CODE, scanForCustomerData, type KbKind } from "../../../src/shared/kb";

export class KbFail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface Article {
  id: string; code: string; kind: KbKind; title: string; summary: string; machine_type: string | null; category: string | null; serial: string | null;
  issue: string; fix: string; content: any; body_text: string; audience: "internal" | "customer"; published_at: string | null; scan_ok: string[];
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string; archived_at: string | null;
}

interface Ctx { me: { id: string; role: string }; perms: Set<string>; machines: { serial: string; customer: string | null; site: string | null }[]; nameOf: (id: string | null) => string | null; newId: () => string }

let store: Article[] | null = null;

function fromDoc(d: any, at: string): Article | null {
  const kind = KIND_FROM_CODE[String(d.type ?? "").toUpperCase()];
  if (!kind) return null;
  const content = cleanContent(d);
  const metaCat = typeof d.meta?.Category === "string" ? d.meta.Category : "";
  return {
    id: d.code.toLowerCase(), code: d.code, kind, title: d.title, summary: d.summary ?? "", machine_type: d.machine ?? null,
    category: ["Mechanical", "Electrical", "Software", "Changeover"].includes(metaCat) ? metaCat : guessCategory(d.title, d.summary, d.machine, d.meta?.Area),
    serial: null, issue: d.issue ?? "", fix: d.fix ?? "", content, body_text: contentText(content), audience: d.audience === "C" ? "customer" : "internal",
    published_at: null, scan_ok: [], created_by: null, updated_by: null, created_at: at, updated_at: at, archived_at: null,
  };
}

function seed(users: { id: string; name: string }[]): Article[] {
  const at = new Date(Date.now() - 6 * 86400000).toISOString();
  const list = ((docs as any).documents as any[]).map((d) => fromDoc(d, at)).filter((a): a is Article => !!a);
  const by = (n: string) => users.find((u) => u.name === n)?.id ?? null;
  const note = (n: number, who: string, days: number, a: Partial<Article>): Article => {
    const when = new Date(Date.now() - days * 86400000).toISOString();
    const content = {};
    return { id: `qn-${n}`, code: `RA-QN-${n}`, kind: "quick_note", summary: "", machine_type: null, category: null, serial: null, issue: "", fix: "", content, body_text: "",
      audience: "internal", published_at: null, scan_ok: [], created_by: by(who), updated_by: by(who), created_at: when, updated_at: when, archived_at: null, title: "", ...a };
  };
  list.unshift(
    note(503, "Patrick Morgan", 1, { title: "Capper torque drops after two hours", machine_type: "Capper", category: "Mechanical", serial: "3069MB",
      issue: "Cap torque drops about 10% after two hours on line 3. The magnetic clutch looked dry.", fix: "Re-greased the magnetic clutch and checked the spring preload. Torque held across a full shift afterwards." }),
    note(502, "Elim Ramirez", 3, { title: "Short fills on heads 7 and 8", machine_type: "Filler", category: "Mechanical", serial: "4222TP",
      issue: "Line 2 filler short-filling on heads 7 and 8 only.", fix: "Replaced the nozzle O-rings on heads 7 and 8 and ran a fill check on all heads." }),
    note(501, "Andrew Jackson", 5, { title: "SERCOS alarm 198 during hooking", machine_type: "Capper", category: "Electrical", serial: "3811CP", audience: "customer",
      issue: "Capper faulted with Alarm 198, Capper SERCOS error, during hooking at Example Pharma Co.", fix: "Found a loose RJ45 on the hybrid SERCOS cable at the drive where the ring stopped. Reseated it; both ports show L solid and S flashing. See RA-KI-001." }),
  );
  return list;
}

const words = (q: string) => q.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1).slice(0, 8);

export function kbRoute(method: string, seg: string[], q: URLSearchParams, body: any, ctx: Ctx, users: { id: string; name: string }[]): unknown {
  store ??= seed(users);
  const live = () => store!.filter((a) => !a.archived_at);
  const can = (p: string) => ctx.perms.has(p);
  const need = (p: string) => { if (!can(p)) throw new KbFail(403, "Your role doesn't allow this."); };
  const canEdit = (a: Article) => can("kb.publish") || (can("kb.write") && a.created_by === ctx.me.id);
  const find = (id: string) => { const a = live().find((x) => x.id === id); if (!a) throw new KbFail(404, "Not found."); return a; };
  const now = () => new Date().toISOString();
  const list = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const names = () => ({ customers: list(ctx.machines.map((m) => m.customer)), sites: list(ctx.machines.map((m) => m.site)), serials: list(ctx.machines.map((m) => m.serial)) });
  const pub = (a: Article) => ({ title: a.title, summary: a.summary, issue: a.issue, fix: a.fix, body: a.body_text, machine_type: a.machine_type ?? "", category: a.category ?? "" });
  const scan = (a: Article, ok: string[]) => {
    const okl = new Set(ok.map((w) => w.toLowerCase()));
    return scanForCustomerData(pub(a), names()).filter((h) => !(CONFIRMABLE.has(h.what) && okl.has(h.found.toLowerCase()))).map((h) => ({ ...h, canConfirm: CONFIRMABLE.has(h.what) }));
  };

  if (seg.length === 1 && method === "GET") {
    need("kb.view");
    let text = (q.get("q") ?? "").trim();
    let serials: Set<string> | null = q.get("serial") ? new Set([q.get("serial")!.toUpperCase()]) : null;
    let serial: string | null = q.get("serial")?.toUpperCase() ?? null;
    let customer: { name: string; serials: string[] } | null = null;
    if (isMachineNumber(text)) { serial = text.toUpperCase(); serials = new Set([serial]); text = ""; }
    if (!serials && text.length >= 3) {
      const ms = ctx.machines.filter((m) => m.customer?.toLowerCase() === text.toLowerCase() || m.site?.toLowerCase() === text.toLowerCase());
      if (ms.length) { customer = { name: ms[0]!.customer ?? ms[0]!.site!, serials: ms.map((m) => m.serial) }; serials = new Set(customer.serials); text = ""; }
    }
    const w = words(text);
    let rows = live().filter((a) => {
      const hay = `${a.code} ${a.title} ${a.summary} ${a.issue} ${a.fix} ${a.body_text} ${a.serial ?? ""}`.toLowerCase();
      return w.every((x) => new RegExp(`(^|[^\\p{L}\\p{N}])${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(hay) || hay.includes(x.replace(/(ing|es|s|ed)$/, "")));
    });
    if (serials) rows = rows.filter((a) => serials!.has((a.serial ?? "").toUpperCase()));
    if (!w.length) rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const want: Record<string, string> = {};
    for (const f of ["kind", "machine_type", "category", "audience"]) if (q.get(f)) want[f] = q.get(f)!;
    const keep = (r: any, skip?: string) => Object.entries(want).every(([k, v]) => k === skip || String(r[k] ?? "") === v);
    const facets: Record<string, Record<string, number>> = {};
    for (const f of ["kind", "machine_type", "category", "audience"]) {
      const c: Record<string, number> = {};
      for (const r of rows) if (keep(r, f)) { const v = (r as any)[f]; if (v) c[v] = (c[v] ?? 0) + 1; }
      facets[f] = c;
    }
    const results = rows.filter((r) => keep(r));
    return { results: results.slice(0, 200).map(({ content: _c, body_text: _b, ...r }) => r), total: results.length, facets, serial: customer ? null : serial, customer };
  }

  if (seg[1] === "import" && method === "POST") {
    need("kb.publish");
    let added = 0, updated = 0, skipped = 0;
    for (const d of body.documents ?? []) {
      const a = d?.code ? fromDoc(d, now()) : null;
      if (!a) { skipped++; continue; }
      const old = store!.find((x) => x.code === a.code);
      if (old) { Object.assign(old, { ...a, id: old.id, created_by: old.created_by, published_at: old.published_at, archived_at: null, updated_by: ctx.me.id }); updated++; }
      else { store!.push({ ...a, created_by: ctx.me.id, updated_by: ctx.me.id }); added++; }
    }
    return { added, updated, skipped };
  }

  if (seg.length === 1 && method === "POST") {
    need("kb.write");
    if (!body.title?.trim()) throw new KbFail(400, "Give it a title.");
    const kind = body.kind as KbKind;
    const prefix = KB_KINDS[kind].prefix;
    const n = Math.max(FIRST_TEAM_NUMBER, ...store!.filter((a) => a.code.startsWith(prefix + "-")).map((a) => Number(a.code.split("-")[2]) + 1));
    const text = (body.body ?? "").trim();
    const content = text ? { blocks: [{ text: text.split(/\n{2,}/) }] } : {};
    const at = now();
    const a: Article = { id: ctx.newId(), code: `${prefix}-${n}`, kind, title: body.title.trim(), summary: body.summary ?? "", machine_type: body.machine_type || null,
      category: body.category || guessCategory(body.title, body.issue, body.fix), serial: body.serial ? String(body.serial).toUpperCase() : null, issue: body.issue ?? "", fix: body.fix ?? "",
      content, body_text: contentText(content), audience: body.audience === "customer" ? "customer" : "internal", published_at: null, scan_ok: [],
      created_by: ctx.me.id, updated_by: ctx.me.id, created_at: at, updated_at: at, archived_at: null };
    store!.unshift(a);
    return { id: a.id, code: a.code };
  }

  const a = find(seg[1]!);
  if (seg.length === 2 && method === "GET") {
    need("kb.view");
    const { body_text: _b, ...rest } = a;
    return { article: { ...rest, created_by_name: ctx.nameOf(a.created_by), updated_by_name: ctx.nameOf(a.updated_by) }, canEdit: canEdit(a), canPublish: can("kb.publish"), changedSincePublish: !!a.published_at && a.updated_at > a.published_at };
  }
  if (seg.length === 2 && method === "PATCH") {
    if (!canEdit(a)) throw new KbFail(403, "Only the person who wrote it or a knowledge base editor can change this.");
    for (const k of ["title", "summary", "issue", "fix", "machine_type", "category", "serial", "audience"] as const) if (k in body) (a as any)[k] = body[k] || (k === "machine_type" || k === "category" || k === "serial" ? null : "");
    if (a.serial) a.serial = a.serial.toUpperCase();
    if ("body" in body) { const t = String(body.body).trim(); a.content = t ? { blocks: [{ text: t.split(/\n{2,}/) }] } : {}; a.body_text = contentText(a.content); }
    if (a.audience === "internal") a.published_at = null;
    a.updated_at = now(); a.updated_by = ctx.me.id;
    return { ok: true };
  }
  if (seg.length === 2 && method === "DELETE") {
    if (!canEdit(a)) throw new KbFail(403, "Only the person who wrote it or a knowledge base editor can remove this.");
    a.archived_at = now(); a.published_at = null;
    return { ok: true };
  }
  if (seg[2] === "scan") return { hits: scan(a, a.scan_ok) };
  if (seg[2] === "publish") {
    need("kb.publish");
    if (a.audience !== "customer") throw new KbFail(400, "This article is staff only. Mark it for customers first.");
    const ok = [...new Set([...a.scan_ok, ...(body.notCustomer ?? [])])];
    if (scan(a, ok).length) throw new KbFail(409, "Take out the customer details below, then publish again.");
    a.scan_ok = ok; a.published_at = now();
    return { ok: true };
  }
  if (seg[2] === "unpublish") { need("kb.publish"); a.published_at = null; return { ok: true }; }
  throw new KbFail(404, "Not found.");
}

export function resetKb() {
  store = null;
}
