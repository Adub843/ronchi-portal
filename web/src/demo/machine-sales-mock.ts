// DEMO ONLY. Machine sales in the preview, with made-up customers, machines and values.
// Follows routes/machine-sales.ts closely (same shared rules), without a server.
import { DEAL_FIELDS, LINE, MONEY_FIELDS, NUMBER_FIELDS, SELLING, SOLD, isOpen, isStage, stageNeeds, type Stage } from "../../../src/shared/machine-sales";
import { paymentAmount, readMilestones } from "../../../src/shared/machine-orders";
import { QUOTE_FIELDS, nextStatuses, quoteNumber, quoteTotals, readQuoteLines, type QuoteLine } from "../../../src/shared/machine-quotes";

export class MachineSalesFail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const fail = (s: number, m: string): never => { throw new MachineSalesFail(s, m); };

interface Ctx { me: { id: string; name: string }; perms: Set<string>; newId: () => string; machines: (customer: string) => Row[] }
type Row = Record<string, any>;

let deals: Row[] | null = null;
let notes: Row[] = [];
let history: Row[] = [];
let quotes: Row[] = [];
let miles: Row[] = [];
const nowIso = () => new Date().toISOString();
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const ym = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7); };
const ago = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

function seed(c: Ctx) {
  let seq = 1000;
  const d = (stage: Stage, inStage: number, f: Row): Row => {
    const row: Row = { id: c.newId(), seq: ++seq, stage, stage_at: ago(inStage), prev_stage: null, funded: 0, revision: 1, removed_at: null, created_at: ago(inStage + 20), updated_at: ago(Math.min(inStage, 3)), created_by_name: "Andrew Yang", updated_by_name: "Andrew Yang", ...f };
    if (SOLD.has(stage)) { row.won_at = ago(inStage + 30); row.created_at = ago(inStage + 30 + 240); }
    history.push({ deal: row.id, at: row.created_at, action: "machine_deal.create", who: "Andrew Yang", changes: { customer: [null, row.customer], stage: [null, "lead"] } });
    return row;
  };
  deals = [
    d("lead", 5, { customer: "Example Snacks", site: "Dallas, TX", title: "Sauce filler, 12 heads", machine_type: "EXACTA filler", value: 420000, expected_po: ym(9), owner: "Andrew Yang", lead_source: "PACK EXPO", next_step: "Intro call with plant manager", next_step_date: day(3) }),
    d("lead", 21, { customer: "Example Cosmetics", site: "Newark, NJ", title: "Lotion filler and capper", value: 610000, expected_po: ym(12), owner: "Michele Falsini", lead_source: "Website" }),
    d("qualified", 12, { customer: "Example Home Care", site: "Charlotte, NC", title: "Trigger sprayer capper", machine_type: "SIRIO capper", speed_bpm: 120, value: 380000, expected_po: ym(6), owner: "Andrew Yang", lead_source: "Existing customer", funded: 1, next_step: "Site visit to measure the line", next_step_date: day(8), contact: "Sam Ortiz", contact_email: "sam.ortiz@example.com" }),
    d("specs", 20, { customer: "Example Pharma Co.", site: "Raleigh, NC", title: "24-head filler with capper", machine_type: "EXACTA filler, SIRIO capper", speed_bpm: 200, formats: "250 ml, 500 ml and 1 L round", value: 1250000, expected_po: ym(4), owner: "Michele Falsini", lead_source: "Ronchi Italy", funded: 1, next_step: "Samples arrive for testing", next_step_date: day(-2), contact: "Lee Park", contact_email: "lpark@example.com", contact_phone: "(919) 555-0117" }),
    d("budget_quote", 9, { customer: "Example Beverage LLC", site: "Atlanta, GA", title: "Unscrambler and puck inserter", value: 540000, expected_po: ym(5), owner: "Andrew Yang", lead_source: "Existing customer", next_step: "Follow up on budget approval", next_step_date: day(5) }),
    d("firm_quote", 18, { customer: "Example Foods Inc.", site: "Atlanta, GA", title: "Monoblock filler capper, 16 heads", machine_type: "EXACTA monoblock", speed_bpm: 160, formats: "500 ml and 1 L", value: 980000, expected_po: ym(1), decision_date: day(20), owner: "Andrew Yang", lead_source: "Existing customer", funded: 1, competitor: "Another builder", next_step: "Review revision B with purchasing", next_step_date: day(2), contact: "Dana Smith", contact_email: "dana.smith@example.com", contact_phone: "(404) 555-0142", notes: "Wants FAT in Italy with two operators. Asked about lead time for a third format." }),
    d("negotiation", 6, { customer: "Example Labs", site: "Columbus, OH", title: "Lab-scale filler", value: 290000, chance: 90, expected_po: ym(0), owner: "Michele Falsini", funded: 1, next_step: "Send final terms", next_step_date: day(1) }),
    d("won", 4, { customer: "Example Home Care", site: "Charlotte, NC", title: "Filler line 3 upgrade", value: 760000, owner: "Andrew Yang", customer_po: "EHC-44120", funded: 1, next_step: "Deposit invoice sent, waiting on payment", next_step_date: day(6), target_ship: day(210) }),
    d("build", 60, { customer: "Example Beverage LLC", site: "Atlanta, GA", title: "32-head rotary filler", machine_type: "EXACTA filler", value: 1640000, owner: "Andrew Yang", customer_po: "PO-55001", funded: 1, next_step: "Confirm FAT date with Italy", next_step_date: day(14), target_ship: day(75), machine: "4301TP" }),
    d("install", 10, { customer: "Example Pharma Co.", site: "Raleigh, NC", title: "Capper for line 2", value: 430000, owner: "Michele Falsini", customer_po: "XP-4388", funded: 1, next_step: "SAT with customer QA", next_step_date: day(4), machine: "4288MB" }),
    { ...d("on_hold", 40, { customer: "Example Cosmetics", site: "Newark, NJ", title: "Second lotion line", value: 700000, owner: "Michele Falsini", hold_until: day(45) }), prev_stage: "budget_quote" },
    { ...d("lost", 70, { customer: "Example Snacks", site: "Dallas, TX", title: "Dry seasoning filler", value: 350000, owner: "Andrew Yang", lost_reason: "Project cancelled", competitor: null }), prev_stage: "firm_quote", lost_at: ago(70) },
    { ...d("paid", 120, { customer: "Example Foods Inc.", site: "Atlanta, GA", title: "Capper, 8 heads", value: 510000, owner: "Andrew Yang", customer_po: "EF-80112", funded: 1, machine: "4222TP" }), closed_at: ago(120) },
  ];
  const build = deals.find((x) => x.stage === "build")!;
  miles = [
    { id: c.newId(), deal: build.id, kind: "date", label: "Engineering approved", due: day(-40), done: day(-38) },
    { id: c.newId(), deal: build.id, kind: "date", label: "Factory acceptance test (FAT)", due: day(45), done: null },
    { id: c.newId(), deal: build.id, kind: "date", label: "Shipped", due: day(75), done: null },
    { id: c.newId(), deal: build.id, kind: "date", label: "Installed and started up (SAT)", due: day(110), done: null },
    { id: c.newId(), deal: build.id, kind: "payment", label: "Deposit with order", pct: 40, amount: null, due: day(-55), done: day(-50), invoice_no: "EX-1001" },
    { id: c.newId(), deal: build.id, kind: "payment", label: "Before shipment", pct: 50, amount: null, due: day(60), done: null, invoice_no: null },
    { id: c.newId(), deal: build.id, kind: "payment", label: "After start-up", pct: 10, amount: null, due: day(130), done: null, invoice_no: null },
  ];
  const firm = deals.find((x) => x.stage === "firm_quote")!;
  const firmLines: QuoteLine[] = [
    { description: "EXACTA monoblock filler capper, 16 heads", detail: "For 500 ml and 1 L round bottles at 160 a minute. Change parts for both formats included.", origin: "italy", qty: 1, unit_price: 905000, optional: false },
    { description: "Infeed and discharge conveyors", detail: null, origin: "us", qty: 1, unit_price: 48000, optional: false },
    { description: "Installation, start-up and operator training", detail: "Two field service engineers, two weeks on site.", origin: "us", qty: 1, unit_price: 42000, optional: false },
    { description: "Change parts for a third format", detail: null, origin: "italy", qty: 1, unit_price: 26500, optional: true },
  ];
  const terms = { valid_until: day(30), lead_time: "26 weeks from order and approved samples", payment_terms: "Example terms: a deposit with the order, the balance before shipment", delivery_terms: "Delivered to the customer's dock", warranty: "12 months from start-up", notes: null, discount_pct: 1.5 };
  quotes = [
    { id: c.newId(), deal: firm.id, rev: 2, kind: "firm", status: "sent", ...terms, lines: firmLines, sent_at: ago(4), decided_at: null, revision: 3, updated_at: ago(4) },
    { id: c.newId(), deal: firm.id, rev: 1, kind: "budget", status: "superseded", ...terms, discount_pct: null, lines: firmLines.slice(0, 1), sent_at: ago(40), decided_at: null, revision: 3, updated_at: ago(4) },
  ];
  notes = [
    { id: c.newId(), deal: firm.id, kind: "call", body: "Dana says purchasing wants net 30 on the last 5%. Revision B goes to them Monday.", at: ago(2), who: "Andrew Yang" },
    { id: c.newId(), deal: firm.id, kind: "visit", body: "Walked line 2 with maintenance. Floor space is fine, air supply needs a second drop.", at: ago(16), who: "Andrew Yang" },
  ];
}

const num = (seq: number) => `M-${seq}`;
const shape = (d: Row, prices: boolean) => {
  const next = miles.filter((m) => m.deal === d.id && !m.done && m.due).map((m) => m.due as string).sort()[0] ?? null;
  const out: Row = { ...d, number: num(d.seq), funded: !!d.funded, open: isOpen(d.stage), next_milestone: next };
  if (!prices) for (const k of MONEY_FIELDS) delete out[k];
  return out;
};

const shapeQuote = (q: Row, d: Row, prices: boolean): Row => {
  const base = { id: q.id, rev: q.rev, number: quoteNumber(num(d.seq), q.rev), kind: q.kind, status: q.status, valid_until: q.valid_until, sent_at: q.sent_at, decided_at: q.decided_at, updated_at: q.updated_at };
  return prices ? { ...base, lead_time: q.lead_time, payment_terms: q.payment_terms, delivery_terms: q.delivery_terms, warranty: q.warranty, notes: q.notes, discount_pct: q.discount_pct, lines: q.lines, totals: quoteTotals(q.lines, q.discount_pct), revision: q.revision } : base;
};

export function resetMachineSales() {
  deals = null;
  notes = [];
  history = [];
  quotes = [];
  miles = [];
}

export function machineSalesRoute(method: string, seg: string[], body: any, c: Ctx): any {
  if (!c.perms.has("machinesales.view")) fail(403, "Your role doesn't allow this.");
  if (!deals) seed(c);
  const all = deals!;
  const prices = c.perms.has("machinesales.prices");
  const need = (p: string) => { if (!c.perms.has(p)) fail(403, "Your role doesn't allow this."); };
  const fields = (b: Row) => {
    const out: Row = {};
    for (const f of DEAL_FIELDS) {
      if (!(f in b) || (MONEY_FIELDS.has(f) && !prices)) continue;
      out[f] = f === "funded" ? (b[f] ? 1 : 0) : b[f] === "" || b[f] == null ? null : NUMBER_FIELDS.has(f) ? Number(b[f]) : b[f];
    }
    if (out.machine) out.machine = String(out.machine).toUpperCase();
    return out;
  };
  const stageOf = (v: unknown, after: Row): Stage => {
    if (!isStage(v)) return fail(400, "Pick a stage.");
    const f = stageNeeds(v);
    if (f === "customer_po" && !after.customer_po) fail(400, "Type the customer's PO number first.");
    if (f === "lost_reason" && !after.lost_reason) fail(400, "Say why the deal was lost first.");
    if (f === "hold_until" && !after.hold_until) fail(400, "Pick the date to reconnect first.");
    return v;
  };
  const live = all.filter((d) => !d.removed_at);

  if (seg.length === 1 && method === "GET") return { deals: live.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((d) => shape(d, prices)) };
  if (seg.length === 1 && method === "POST") {
    need("machinesales.add");
    const f = fields(body);
    if (!f.customer) fail(400, "Customer is required.");
    const stage = body.stage ? stageOf(body.stage, f) : "lead";
    const t = nowIso();
    const d: Row = { id: c.newId(), seq: Math.max(1000, ...all.map((x) => x.seq)) + 1, funded: 0, ...f, stage, stage_at: t, prev_stage: null, revision: 1, removed_at: null, created_at: t, updated_at: t, created_by_name: c.me.name, updated_by_name: c.me.name };
    all.push(d);
    history.unshift({ deal: d.id, at: t, action: "machine_deal.create", who: c.me.name, changes: { customer: [null, d.customer], stage: [null, stage] } });
    return { id: d.id, number: num(d.seq) };
  }
  if (seg[1] === "forecast" && method === "GET") {
    need("machinesales.prices");
    return { payments: miles.filter((m) => m.kind === "payment" && !m.done).map((m) => { const x = live.find((y) => y.id === m.deal)!; return { id: m.id, label: m.label, due: m.due, invoice_no: m.invoice_no, deal_id: x.id, number: num(x.seq), customer: x.customer, title: x.title, amount: paymentAmount(m as never, x.value) }; }).sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")) };
  }
  if (seg[1] === "import" && method === "POST") {
    need("machinesales.add");
    const t = nowIso();
    for (const r of body.rows as Row[]) {
      const f = fields(r);
      const stage = r.stage ? stageOf(r.stage, f) : "lead";
      all.push({ id: c.newId(), seq: Math.max(1000, ...all.map((x) => x.seq)) + 1, funded: 0, ...f, stage, stage_at: t, prev_stage: null, revision: 1, removed_at: null, created_at: t, updated_at: t, won_at: SOLD.has(stage) ? t : null, created_by_name: c.me.name, updated_by_name: c.me.name });
    }
    return { ok: true, deals: body.rows.length };
  }
  const d = live.find((x) => x.id === seg[1]);
  if (!d) return fail(404, "Not found.");
  if (seg[2] === "quotes") {
    const writer = () => { need("machinesales.edit"); need("machinesales.prices"); };
    const stale = () => fail(409, "Someone else changed this quote while you were editing. Reload to see their changes.");
    const qn = (q: Row) => quoteNumber(num(d.seq), q.rev);
    const log = (q: Row, status: string, changes?: Row) => history.unshift({ deal: d.id, at: nowIso(), action: "machine_deal.quote", who: c.me.name, quote: qn(q), status, changes: changes ?? null });
    if (!seg[3] && method === "POST") {
      writer();
      const from = body?.copy_from ? quotes.find((x) => x.id === body.copy_from && x.deal === d.id) : null;
      const q: Row = { id: c.newId(), deal: d.id, rev: Math.max(0, ...quotes.filter((x) => x.deal === d.id).map((x) => x.rev)) + 1, kind: body?.kind ?? from?.kind ?? (["lead", "qualified", "specs", "budget_quote"].includes(d.stage) ? "budget" : "firm"), status: "draft", valid_until: from?.valid_until ?? null, lead_time: from?.lead_time ?? null, payment_terms: from?.payment_terms ?? null, delivery_terms: from?.delivery_terms ?? null, warranty: from?.warranty ?? null, notes: from?.notes ?? null, discount_pct: from?.discount_pct ?? null, lines: from ? from.lines.map((l: QuoteLine) => ({ ...l })) : [], sent_at: null, decided_at: null, revision: 1, updated_at: nowIso() };
      quotes.unshift(q);
      log(q, "draft");
      return { id: q.id, number: qn(q) };
    }
    const q = quotes.find((x) => x.id === seg[3] && x.deal === d.id && !x.removed);
    if (!q) return fail(404, "Not found.");
    if (!seg[4] && method === "GET") { need("machinesales.prices"); return { deal: shape(d, true), quote: shapeQuote(q, d, true) }; }
    writer();
    if (!seg[4] && method === "PATCH") {
      if (q.status !== "draft") fail(400, "This quote was already sent. Make a new revision to change it.");
      if (body.revision !== q.revision) stale();
      for (const f of QUOTE_FIELDS) if (f in body) q[f] = body[f] === "" || body[f] == null ? null : f === "discount_pct" ? Number(body[f]) : body[f];
      if (body.lines !== undefined) {
        const r = readQuoteLines(body.lines);
        if (r.problem !== undefined) return fail(400, r.problem);
        q.lines = r.lines;
      }
      q.revision++;
      q.updated_at = nowIso();
      return { ok: true, revision: q.revision };
    }
    if (!seg[4] && method === "DELETE") {
      if (q.status !== "draft") fail(400, "A quote that was sent stays in the record.");
      q.removed = true;
      log(q, "removed");
      return { ok: true };
    }
    if (seg[4] === "status" && method === "POST") {
      if (!nextStatuses(q.status).includes(body.status)) fail(400, "That isn't the next step for this quote.");
      if (body.revision !== q.revision) stale();
      const t = nowIso();
      if (body.status === "sent" && q.status === "draft") {
        const totals = quoteTotals(q.lines, q.discount_pct);
        if (!q.lines.length) fail(400, "Add at least one line before sending the quote.");
        if (!totals.priced) fail(400, "Every line that isn't an option needs a price before the quote is sent.");
        for (const o of quotes) if (o.deal === d.id && o.id !== q.id && o.status === "sent") { o.status = "superseded"; o.revision++; }
        const stage: Stage = q.kind === "budget" ? "budget_quote" : "firm_quote";
        const forward = SELLING.has(d.stage) && LINE.indexOf(stage) > LINE.indexOf(d.stage);
        log(q, "sent", { value: [null, "changed"], ...(forward ? { stage: [d.stage, stage] } : {}) });
        d.value = totals.total;
        if (forward) { d.stage = stage; d.stage_at = t; }
        d.revision++;
        q.sent_at = t;
      } else {
        q.decided_at = body.status === "sent" ? null : t;
        log(q, body.status);
      }
      q.status = body.status;
      q.revision++;
      q.updated_at = d.updated_at = t;
      return { ok: true };
    }
    return fail(404, "Not found.");
  }
  if (seg[2] === "milestones" && method === "PUT") {
    need("machinesales.edit");
    if (body.revision !== d.revision) fail(409, "Someone else changed this deal while you were editing. Reload to see their changes.");
    for (const kind of ["date", "payment"] as const) {
      const raw = body[kind === "date" ? "dates" : "payments"];
      if (raw === undefined) continue;
      if (kind === "payment") need("machinesales.prices");
      const r = readMilestones(raw, kind);
      if (r.problem !== undefined) return fail(400, r.problem);
      miles = [...miles.filter((m) => !(m.deal === d.id && m.kind === kind)), ...r.list.map((m) => ({ ...m, id: c.newId(), deal: d.id }))];
    }
    d.revision++;
    d.updated_at = nowIso();
    return { ok: true, revision: d.revision };
  }
  if (seg[2] === "notes" && method === "POST") {
    need("machinesales.edit");
    if (!String(body.body ?? "").trim()) fail(400, "Write what happened.");
    notes.unshift({ id: c.newId(), deal: d.id, kind: body.kind ?? "note", body: String(body.body).trim(), at: nowIso(), who: c.me.name });
    d.updated_at = nowIso();
    return { ok: true };
  }
  if (method === "GET") {
    return {
      deal: shape(d, prices),
      notes: notes.filter((n) => n.deal === d.id),
      history: history.filter((h) => h.deal === d.id),
      machines: c.perms.has("machines.view") ? c.machines(d.customer) : [],
      dates: miles.filter((m) => m.deal === d.id && m.kind === "date").map((m) => ({ id: m.id, label: m.label, due: m.due, done: m.done })),
      payments: miles.filter((m) => m.deal === d.id && m.kind === "payment").map((m) => (prices ? { id: m.id, label: m.label, due: m.due, done: m.done, pct: m.pct, amount: m.amount, invoice_no: m.invoice_no } : { id: m.id, label: m.label, due: m.due, done: m.done })),
      quotes: quotes.filter((x) => x.deal === d.id && !x.removed).sort((a, b) => b.rev - a.rev).map((x) => shapeQuote(x, d, prices)),
    };
  }
  if (method === "DELETE") {
    need("machinesales.remove");
    d.removed_at = nowIso();
    return { ok: true };
  }
  if (method === "PATCH") {
    need("machinesales.edit");
    if (body.revision !== d.revision) fail(409, "Someone else changed this deal while you were editing. Reload to see their changes.");
    const f = fields(body);
    const changes: Row = {};
    for (const [k, v] of Object.entries(f)) {
      if ((d[k] ?? null) === (v ?? null)) continue;
      if (MONEY_FIELDS.has(k as never)) changes.value = [null, "changed"];
      else changes[k] = [d[k] ?? null, v];
    }
    const t = nowIso();
    const after = { ...d, ...f };
    if (body.stage !== undefined && body.stage !== d.stage) {
      const s = stageOf(body.stage, after);
      changes.stage = [d.stage, s];
      after.prev_stage = s === "on_hold" || s === "lost" ? (d.stage === "on_hold" || d.stage === "lost" ? d.prev_stage : d.stage) : null;
      after.stage = s;
      after.stage_at = t;
    }
    if (!Object.keys(changes).length) return { ok: true, revision: d.revision };
    Object.assign(d, after, { revision: d.revision + 1, updated_at: t, updated_by_name: c.me.name });
    history.unshift({ deal: d.id, at: t, action: "machine_deal.update", who: c.me.name, changes });
    return { ok: true, revision: d.revision };
  }
  return fail(404, "Not found.");
}
