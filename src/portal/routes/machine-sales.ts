// Machine sales: new-machine deals from the first call to final payment (src/shared/machine-sales.ts has
// the fields, stages and rules). Modeled on the pipeline boards and deal pages of the sales tools rated
// best by their users (research note in project files, "Machine sales tracking software.md").
//
// Who: machinesales.view to see, .add/.edit/.remove to change, .prices to see or set a deal's dollar
// value. Values are never sent to someone without .prices, and their saves keep the value already there.
// Every change goes to the audit log (never with the value in it) and shows as the deal's history.
// A save sends the revision it started from; a stale one is refused.
//
// Quotes (src/shared/machine-quotes.ts): revisions Q1, Q2 ... on a deal. Opening or building one needs
// machinesales.prices; without it a person only sees that a quote exists, its status and dates.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { randomId } from "../../shared/crypto";
import {
  DATE_FIELDS, DAY, DEAL_FIELDS, DEAL_LABELS, DEAL_MAX, LINE, MONEY_FIELDS, MONTH, NOTE_KINDS, NUMBER_FIELDS, SELLING, SOLD,
  isOpen, isStage, stageNeeds, type DealField, type Stage,
} from "../../shared/machine-sales";
import { QUOTE_FIELDS, QUOTE_KINDS, QUOTE_LABELS, QUOTE_MAX, nextStatuses, quoteNumber, quoteTotals, readQuoteLines, type QuoteField, type QuoteLine, type QuoteStatus } from "../../shared/machine-quotes";
import { MAX_DEAL_IMPORT } from "../../shared/machine-forecast";
import { paymentAmount, readMilestones, type Milestone } from "../../shared/machine-orders";
import type { AppEnv } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, has, requirePerm } from "../lib/http";

export const machineSales = new Hono<AppEnv>();

type Row = Record<string, any>;
const number = (seq: number) => `M-${seq}`;

function num(v: unknown, what: string, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,%\s]/g, "")) : NaN;
  if (!Number.isFinite(n)) fail(400, `${what} must be a number.`);
  if (n < 0) fail(400, `${what} can't be less than 0.`);
  if (n > max) fail(400, `${what} can't be more than ${max}.`);
  return Math.round(n * 100) / 100;
}

function text(v: unknown, max: number, what: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") fail(400, `${what} must be text.`);
  const t = v.trim();
  if (t.length > max) fail(400, `${what} is too long (limit ${max} characters).`);
  return t || null;
}

/** The deal fields present in `b`, checked and tidied. The value only for people who may see it. */
function clean(b: Row, prices: boolean): Partial<Record<DealField, string | number | null>> {
  const out: Partial<Record<DealField, string | number | null>> = {};
  for (const f of DEAL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(b, f)) continue;
    const what = DEAL_LABELS[f];
    if (MONEY_FIELDS.has(f) && !prices) continue;
    if (f === "funded") { out[f] = b[f] === true || b[f] === 1 || b[f] === "1" ? 1 : 0; continue; }
    if (NUMBER_FIELDS.has(f)) { out[f] = num(b[f], what, f === "chance" ? 100 : f === "speed_bpm" ? 5000 : 1_000_000_000); continue; }
    let v = text(b[f], DEAL_MAX[f], what);
    if (v && DATE_FIELDS.has(f) && !DAY.test(v)) fail(400, `${what} must be a date.`);
    if (v && f === "expected_po" && !MONTH.test(v)) fail(400, `${what} must be a month.`);
    if (v && f === "machine") v = v.toUpperCase();
    out[f] = v;
  }
  if ("customer" in out && !out.customer) fail(400, "Customer is required.");
  return out;
}

function hide<T extends Row>(row: T): T {
  const out: Row = { ...row };
  for (const k of MONEY_FIELDS) delete out[k];
  return out as T;
}

const shape = (d: Row, prices: boolean) => {
  const row = { ...d, number: number(d.seq), funded: !!d.funded, open: isOpen(d.stage) };
  return prices ? row : hide(row);
};

function historyDetail(detail: string | null): Row {
  if (!detail) return {};
  try {
    return JSON.parse(detail) as Row;
  } catch {
    return {};
  }
}

/** A quote row as sent to the app. Lines, terms and the total only for people who may see values. */
function shapeQuote(q: Row, dealSeq: number, prices: boolean): Row {
  const base = { id: q.id, rev: q.rev, number: quoteNumber(number(dealSeq), q.rev), kind: q.kind, status: q.status, valid_until: q.valid_until, sent_at: q.sent_at, decided_at: q.decided_at, updated_at: q.updated_at };
  if (!prices) return base;
  let lines: QuoteLine[] = [];
  try { lines = JSON.parse(q.lines) as QuoteLine[]; } catch { /* keep empty */ }
  return { ...base, lead_time: q.lead_time, payment_terms: q.payment_terms, delivery_terms: q.delivery_terms, warranty: q.warranty, notes: q.notes, discount_pct: q.discount_pct, lines, totals: quoteTotals(lines, q.discount_pct), revision: q.revision };
}

const LIST_COLS = "id, seq, customer, site, title, machine_type, value, chance, expected_po, owner, funded, next_step, next_step_date, hold_until, customer_po, target_ship, machine, lost_reason, stage, prev_stage, stage_at, won_at, lost_at, closed_at, created_at, updated_at";

machineSales.get("/", async (c) => {
  const u = requirePerm(c, "machinesales.view");
  const prices = has(u, "machinesales.prices");
  const { results } = await c.env.DB.prepare(
    `SELECT ${LIST_COLS}, (SELECT MIN(m.due) FROM machine_deal_milestones m WHERE m.deal_id = machine_deals.id AND m.done IS NULL AND m.due IS NOT NULL) AS next_milestone
       FROM machine_deals WHERE removed_at IS NULL ORDER BY updated_at DESC LIMIT 2000`,
  ).all<Row>();
  return c.json({ deals: results.map((d) => shape(d, prices)) });
});

/**
 * What the Forecast tab needs besides the deal list: the payments not yet in, with what each is worth.
 * Only for people who may see deal values. (Registered before "/:id" so "forecast" isn't read as a deal.)
 */
machineSales.get("/forecast", async (c) => {
  const u = requirePerm(c, "machinesales.view");
  if (!has(u, "machinesales.prices")) fail(403, "Your role doesn't allow this.");
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.label, m.due, m.pct, m.amount, m.invoice_no, d.id AS deal_id, d.seq, d.customer, d.title, d.value
       FROM machine_deal_milestones m JOIN machine_deals d ON d.id = m.deal_id
      WHERE m.kind = 'payment' AND m.done IS NULL AND d.removed_at IS NULL AND d.stage NOT IN ('lost', 'on_hold')
      ORDER BY m.due IS NULL, m.due LIMIT 500`,
  ).all<Row>();
  return c.json({ payments: results.map((m) => ({ id: m.id, label: m.label, due: m.due, invoice_no: m.invoice_no, deal_id: m.deal_id, number: number(m.seq), customer: m.customer, title: m.title, amount: paymentAmount(m as never, m.value) })) });
});

machineSales.get("/:id", async (c) => {
  const u = requirePerm(c, "machinesales.view");
  const id = c.req.param("id");
  const d = await c.env.DB.prepare(
    `SELECT d.*, cu.name AS created_by_name, uu.name AS updated_by_name
       FROM machine_deals d LEFT JOIN users cu ON cu.id = d.created_by LEFT JOIN users uu ON uu.id = d.updated_by
      WHERE d.id = ? AND d.removed_at IS NULL`,
  ).bind(id).first<Row>();
  if (!d) fail(404, "Not found.");
  const [notes, hist, machines, quotes, miles] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT n.id, n.kind, n.body, n.created_at AS at, u.name AS who FROM machine_deal_notes n LEFT JOIN users u ON u.id = n.created_by WHERE n.deal_id = ? ORDER BY n.created_at DESC LIMIT 300").bind(id),
    c.env.DB.prepare("SELECT a.at, a.action, a.detail, u.name AS who FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.target_type = 'machine_deal' AND a.target_id = ? ORDER BY a.at DESC LIMIT 200").bind(id),
    // The customer's machines already in the field, for people who may see Machines.
    c.env.DB.prepare("SELECT id, serial, model, site FROM machines WHERE customer = ? COLLATE NOCASE ORDER BY serial LIMIT 100").bind(has(u, "machines.view") ? d.customer : ""),
    c.env.DB.prepare("SELECT * FROM machine_quotes WHERE deal_id = ? AND removed_at IS NULL ORDER BY rev DESC").bind(id),
    c.env.DB.prepare("SELECT id, kind, label, due, done, pct, amount, invoice_no FROM machine_deal_milestones WHERE deal_id = ? ORDER BY kind, line_no").bind(id),
  ]);
  const prices = has(u, "machinesales.prices");
  const ms = miles!.results as Row[];
  const next = ms.filter((m) => !m.done && m.due).map((m) => m.due as string).sort()[0] ?? null;
  return c.json({
    deal: { ...shape(d, prices), next_milestone: next },
    dates: ms.filter((m) => m.kind === "date").map((m) => ({ id: m.id, label: m.label, due: m.due, done: m.done })),
    // Without See deal values a payment shows its name, when it is due and whether it came in: no amounts.
    payments: ms.filter((m) => m.kind === "payment").map((m) => (prices ? { id: m.id, label: m.label, due: m.due, done: m.done, pct: m.pct, amount: m.amount, invoice_no: m.invoice_no } : { id: m.id, label: m.label, due: m.due, done: m.done })),
    notes: notes!.results,
    history: (hist!.results as Row[]).map((h) => { const x = historyDetail(h.detail); return { at: h.at, action: h.action, who: h.who, changes: x.changes ?? null, quote: x.quote ?? null, status: x.status ?? null }; }),
    machines: machines!.results,
    quotes: (quotes!.results as Row[]).map((q) => shapeQuote(q, d.seq, has(u, "machinesales.prices"))),
  });
});

/** The stage a body asks for, with what that stage needs checked against the deal as it will be saved. */
function stageOf(v: unknown, after: Row): Stage {
  if (!isStage(v)) fail(400, "Pick a stage.");
  const need = stageNeeds(v);
  if (need === "customer_po" && !after.customer_po) fail(400, "Type the customer's PO number first.");
  if (need === "lost_reason" && !after.lost_reason) fail(400, "Say why the deal was lost first.");
  if (need === "hold_until" && !after.hold_until) fail(400, "Pick the date to reconnect first.");
  return v;
}

machineSales.post("/", async (c) => {
  const u = requirePerm(c, "machinesales.add");
  const b = await body(c);
  const f = clean(b, has(u, "machinesales.prices"));
  if (!f.customer) fail(400, "Customer is required.");
  const stage = b.stage === undefined ? "lead" : stageOf(b.stage, f);
  const id = randomId();
  const t = now();
  const row: Row = { ...f, stage, stage_at: t, funded: f.funded ?? 0 };
  if (SOLD.has(stage)) row.won_at = t;
  if (stage === "paid") row.closed_at = t;
  if (stage === "lost") row.lost_at = t;
  const keys = Object.keys(row);
  let seq = 0;
  for (let attempt = 0; ; attempt++) {
    seq = (await c.env.DB.prepare("SELECT COALESCE(MAX(seq), 1000) + 1 AS n FROM machine_deals").first<{ n: number }>())!.n;
    try {
      await c.env.DB.prepare(`INSERT INTO machine_deals (id, seq, ${keys.join(", ")}, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ${keys.map(() => "?").join(", ")}, ?, ?, ?, ?)`)
        .bind(id, seq, ...keys.map((k) => row[k] ?? null), u.id, u.id, t, t).run();
      break;
    } catch (e) {
      if (!/UNIQUE/i.test(String(e)) || attempt >= 3) throw e; // someone took the number: try the next one
    }
  }
  const changes = Object.fromEntries(Object.entries(f).filter(([k, v]) => v != null && v !== 0 && !MONEY_FIELDS.has(k as DealField)).map(([k, v]) => [k, [null, v]]));
  await audit(c.env.DB, { userId: u.id, action: "machine_deal.create", targetType: "machine_deal", targetId: id, detail: { changes: { ...changes, stage: [null, stage] } }, ip: c.get("ip") });
  return c.json({ id, number: number(seq) });
});

machineSales.patch("/:id", async (c) => {
  const u = requirePerm(c, "machinesales.edit");
  const id = c.req.param("id");
  const b = await body(c);
  const before = await c.env.DB.prepare("SELECT * FROM machine_deals WHERE id = ? AND removed_at IS NULL").bind(id).first<Row>();
  if (!before) fail(404, "Not found.");
  const stale = () => fail(409, "Someone else changed this deal while you were editing. Reload to see their changes.");
  if (typeof b.revision !== "number" || b.revision !== before.revision) stale();
  const f = clean(b, has(u, "machinesales.prices"));
  const same = (k: string, v: unknown) => (before[k] ?? null) === (v ?? null);
  const set: Row = Object.fromEntries(Object.entries(f).filter(([k, v]) => !same(k, v)));
  const diff: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(set)) {
    if (MONEY_FIELDS.has(k as DealField)) diff.value = [null, "changed"]; // money stays out of the history, but it still says it changed
    else diff[k] = [before[k] ?? null, v ?? null];
  }
  const t = now();
  if (b.stage !== undefined && b.stage !== before.stage) {
    const s = stageOf(b.stage, { ...before, ...set });
    set.stage = s;
    set.stage_at = t;
    diff.stage = [before.stage, s];
    // On hold and Lost remember where the deal was, so it can be picked back up there.
    set.prev_stage = s === "on_hold" || s === "lost" ? (before.stage === "on_hold" || before.stage === "lost" ? before.prev_stage : before.stage) : null;
    if (SOLD.has(s) && !before.won_at) set.won_at = t;
    if (s === "paid" && !before.closed_at) set.closed_at = t;
    if (s === "lost") set.lost_at = t;
  }
  const keys = Object.keys(set);
  if (!keys.length) return c.json({ ok: true, revision: before.revision });
  const rev = (before.revision as number) + 1;
  const r = await c.env.DB.prepare(`UPDATE machine_deals SET ${keys.map((k) => `${k} = ?, `).join("")}revision = ?, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?`)
    .bind(...keys.map((k) => set[k] ?? null), rev, u.id, t, id, before.revision).run();
  if (!r.meta.changes) stale();
  // Final payment: the machine joins the Machines list, if its number is on the deal and it isn't there yet.
  let machineAdded = false;
  const serial = String(set.machine ?? before.machine ?? "").trim();
  if (set.stage === "paid" && serial) {
    const m = await c.env.DB.prepare("INSERT INTO machines (id, serial, model, customer, site, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (serial) DO NOTHING")
      .bind(randomId(), serial, set.machine_type ?? before.machine_type ?? null, set.customer ?? before.customer, set.site ?? before.site ?? null, t, t).run();
    machineAdded = !!m.meta.changes;
    if (machineAdded) diff.machine_added = [null, serial];
  }
  await audit(c.env.DB, { userId: u.id, action: "machine_deal.update", targetType: "machine_deal", targetId: id, detail: { changes: diff }, ip: c.get("ip") });
  return c.json({ ok: true, revision: rev, machine_added: machineAdded ? serial : null });
});

/** Log a call, visit, email, meeting or note on a deal. Optionally sets the next step in the same go. */
machineSales.post("/:id/notes", async (c) => {
  const u = requirePerm(c, "machinesales.edit");
  const id = c.req.param("id");
  const b = await body(c);
  const d = await c.env.DB.prepare("SELECT id FROM machine_deals WHERE id = ? AND removed_at IS NULL").bind(id).first();
  if (!d) fail(404, "Not found.");
  const kind = b.kind === undefined ? "note" : b.kind;
  if (!(NOTE_KINDS as readonly unknown[]).includes(kind)) fail(400, "Pick what you are logging.");
  const note = text(b.body, 5000, "The note");
  if (!note) fail(400, "Write what happened.");
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO machine_deal_notes (id, deal_id, kind, body, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(randomId(), id, kind, note, u.id, t),
    c.env.DB.prepare("UPDATE machine_deals SET updated_at = ?, updated_by = ? WHERE id = ?").bind(t, u.id, id),
  ]);
  await audit(c.env.DB, { userId: u.id, action: "machine_deal.note", targetType: "machine_deal", targetId: id, detail: { kind }, ip: c.get("ip") });
  return c.json({ ok: true });
});

machineSales.delete("/:id", async (c) => {
  const u = requirePerm(c, "machinesales.remove");
  const id = c.req.param("id");
  const r = await c.env.DB.prepare("UPDATE machine_deals SET removed_at = ?, updated_by = ? WHERE id = ? AND removed_at IS NULL").bind(now(), u.id, id).run();
  if (!r.meta.changes) fail(404, "Not found.");
  await audit(c.env.DB, { userId: u.id, action: "machine_deal.remove", targetType: "machine_deal", targetId: id, ip: c.get("ip") });
  return c.json({ ok: true });
});

// ---------- Quotes ----------

/** The quote fields present in `b`, checked and tidied. */
function cleanQuote(b: Row): Partial<Record<QuoteField, string | number | null>> {
  const out: Partial<Record<QuoteField, string | number | null>> = {};
  for (const f of QUOTE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(b, f)) continue;
    const what = QUOTE_LABELS[f];
    if (f === "discount_pct") { out[f] = num(b[f], what, 100); continue; }
    const v = text(b[f], QUOTE_MAX[f], what);
    if (f === "kind") { if (!(QUOTE_KINDS as readonly unknown[]).includes(v)) fail(400, "Pick budget or firm."); out[f] = v; continue; }
    if (v && f === "valid_until" && !DAY.test(v)) fail(400, `${what} must be a date.`);
    out[f] = v;
  }
  return out;
}

/** Both permissions a person needs to build quotes: change deals and see values. */
function quoteWriter(c: Parameters<typeof requirePerm>[0]) {
  const u = requirePerm(c, "machinesales.edit");
  if (!has(u, "machinesales.prices")) fail(403, "Your role doesn't allow this.");
  return u;
}

async function dealAndQuote(db: D1Database, id: string, qid?: string): Promise<{ deal: Row; quote: Row | null }> {
  const deal = await db.prepare("SELECT * FROM machine_deals WHERE id = ? AND removed_at IS NULL").bind(id).first<Row>();
  if (!deal) fail(404, "Not found.");
  if (!qid) return { deal, quote: null };
  const quote = await db.prepare("SELECT * FROM machine_quotes WHERE id = ? AND deal_id = ? AND removed_at IS NULL").bind(qid, id).first<Row>();
  if (!quote) fail(404, "Not found.");
  return { deal, quote };
}

machineSales.get("/:id/quotes/:qid", async (c) => {
  const u = requirePerm(c, "machinesales.view");
  if (!has(u, "machinesales.prices")) fail(403, "Your role doesn't allow this.");
  const { deal, quote } = await dealAndQuote(c.env.DB, c.req.param("id"), c.req.param("qid"));
  return c.json({ deal: shape(deal, true), quote: shapeQuote(quote!, deal.seq, true) });
});

/** A new draft: empty, or a copy of an earlier revision (copy_from) to change. */
machineSales.post("/:id/quotes", async (c) => {
  const u = quoteWriter(c);
  const db = c.env.DB;
  const id = c.req.param("id");
  const b = await body(c);
  const { deal } = await dealAndQuote(db, id);
  const from = typeof b.copy_from === "string" ? (await dealAndQuote(db, id, b.copy_from)).quote : null;
  const f = cleanQuote(b);
  const kind = f.kind ?? from?.kind ?? (deal.stage === "lead" || deal.stage === "qualified" || deal.stage === "specs" || deal.stage === "budget_quote" ? "budget" : "firm");
  const qid = randomId();
  const t = now();
  let rev = 0;
  for (let attempt = 0; ; attempt++) {
    rev = (await db.prepare("SELECT COALESCE(MAX(rev), 0) + 1 AS n FROM machine_quotes WHERE deal_id = ?").bind(id).first<{ n: number }>())!.n;
    try {
      await db.prepare(
        `INSERT INTO machine_quotes (id, deal_id, rev, kind, status, valid_until, lead_time, payment_terms, delivery_terms, warranty, notes, discount_pct, lines, total, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(qid, id, rev, kind, from?.valid_until ?? null, from?.lead_time ?? null, from?.payment_terms ?? null, from?.delivery_terms ?? null, from?.warranty ?? null, from?.notes ?? null, from?.discount_pct ?? null, from?.lines ?? "[]", from?.total ?? null, u.id, u.id, t, t).run();
      break;
    } catch (e) {
      if (!/UNIQUE/i.test(String(e)) || attempt >= 3) throw e;
    }
  }
  const qn = quoteNumber(number(deal.seq), rev);
  await audit(db, { userId: u.id, action: "machine_deal.quote", targetType: "machine_deal", targetId: id, detail: { quote: qn, status: "draft" }, ip: c.get("ip") });
  return c.json({ id: qid, number: qn });
});

/** Save a draft: terms and lines. A quote that was sent is not edited; make a new revision. */
machineSales.patch("/:id/quotes/:qid", async (c) => {
  const u = quoteWriter(c);
  const db = c.env.DB;
  const b = await body(c);
  const { quote } = await dealAndQuote(db, c.req.param("id"), c.req.param("qid"));
  const q = quote!;
  if (q.status !== "draft") fail(400, "This quote was already sent. Make a new revision to change it.");
  if (typeof b.revision !== "number" || b.revision !== q.revision) fail(409, "Someone else changed this quote while you were editing. Reload to see their changes.");
  const set: Row = cleanQuote(b);
  let lines: QuoteLine[] | null = null;
  if (b.lines !== undefined) {
    const r = readQuoteLines(b.lines);
    if (r.problem !== undefined) fail(400, r.problem);
    lines = r.lines;
    set.lines = JSON.stringify(lines);
  }
  if (lines || "discount_pct" in set) {
    const ls = lines ?? (JSON.parse(q.lines) as QuoteLine[]);
    set.total = quoteTotals(ls, "discount_pct" in set ? (set.discount_pct as number | null) : q.discount_pct).total;
  }
  const keys = Object.keys(set);
  if (!keys.length) return c.json({ ok: true, revision: q.revision });
  const r = await db.prepare(`UPDATE machine_quotes SET ${keys.map((k) => `${k} = ?, `).join("")}revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?`)
    .bind(...keys.map((k) => set[k] ?? null), u.id, now(), q.id, q.revision).run();
  if (!r.meta.changes) fail(409, "Someone else changed this quote while you were editing. Reload to see their changes.");
  return c.json({ ok: true, revision: q.revision + 1 });
});

/**
 * Send a draft, or record the customer's answer. Sending replaces the quote that was out before,
 * sets the deal's value to this quote's total, and moves a deal that is still being sold forward to
 * the matching quote stage (never backward).
 */
machineSales.post("/:id/quotes/:qid/status", async (c) => {
  const u = quoteWriter(c);
  const db = c.env.DB;
  const id = c.req.param("id");
  const b = await body(c);
  const { deal, quote } = await dealAndQuote(db, id, c.req.param("qid"));
  const q = quote!;
  const to = b.status as QuoteStatus;
  if (!nextStatuses(q.status).includes(to)) fail(400, "That isn't the next step for this quote.");
  if (typeof b.revision !== "number" || b.revision !== q.revision) fail(409, "Someone else changed this quote while you were editing. Reload to see their changes.");
  const t = now();
  const qn = quoteNumber(number(deal.seq), q.rev);
  const stmts: D1PreparedStatement[] = [];
  if (to === "sent" && q.status === "draft") {
    const lines = JSON.parse(q.lines) as QuoteLine[];
    const totals = quoteTotals(lines, q.discount_pct);
    if (!lines.length) fail(400, "Add at least one line before sending the quote.");
    if (!totals.priced) fail(400, "Every line that isn't an option needs a price before the quote is sent.");
    const stage = q.kind === "budget" ? "budget_quote" : "firm_quote";
    const forward = SELLING.has(deal.stage) && LINE.indexOf(stage) > LINE.indexOf(deal.stage);
    stmts.push(
      db.prepare("UPDATE machine_quotes SET status = 'sent', sent_at = ?, total = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?").bind(t, totals.total, u.id, t, q.id, q.revision),
      db.prepare("UPDATE machine_quotes SET status = 'superseded', revision = revision + 1, updated_at = ? WHERE deal_id = ? AND id <> ? AND status = 'sent' AND removed_at IS NULL").bind(t, id, q.id),
      forward
        ? db.prepare("UPDATE machine_deals SET value = ?, stage = ?, stage_at = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ?").bind(totals.total, stage, t, u.id, t, id)
        : db.prepare("UPDATE machine_deals SET value = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ?").bind(totals.total, u.id, t, id),
    );
    const [r] = await db.batch(stmts);
    if (!r?.meta.changes) fail(409, "Someone else changed this quote while you were editing. Reload to see their changes.");
    await audit(db, { userId: u.id, action: "machine_deal.quote", targetType: "machine_deal", targetId: id, detail: { quote: qn, status: "sent", changes: { value: [null, "changed"], ...(forward ? { stage: [deal.stage, stage] } : {}) } }, ip: c.get("ip") });
    return c.json({ ok: true });
  }
  const r = await db.prepare("UPDATE machine_quotes SET status = ?, decided_at = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?")
    .bind(to, to === "sent" ? null : t, u.id, t, q.id, q.revision).run();
  if (!r.meta.changes) fail(409, "Someone else changed this quote while you were editing. Reload to see their changes.");
  await db.prepare("UPDATE machine_deals SET updated_at = ?, updated_by = ? WHERE id = ?").bind(t, u.id, id).run();
  await audit(db, { userId: u.id, action: "machine_deal.quote", targetType: "machine_deal", targetId: id, detail: { quote: qn, status: to }, ip: c.get("ip") });
  return c.json({ ok: true });
});

/** Throw a draft away. A quote that was sent stays in the record. */
machineSales.delete("/:id/quotes/:qid", async (c) => {
  const u = quoteWriter(c);
  const { deal, quote } = await dealAndQuote(c.env.DB, c.req.param("id"), c.req.param("qid"));
  if (quote!.status !== "draft") fail(400, "A quote that was sent stays in the record.");
  await c.env.DB.prepare("UPDATE machine_quotes SET removed_at = ?, updated_by = ? WHERE id = ?").bind(now(), u.id, quote!.id).run();
  await audit(c.env.DB, { userId: u.id, action: "machine_deal.quote", targetType: "machine_deal", targetId: deal.id, detail: { quote: quoteNumber(number(deal.seq), quote!.rev), status: "removed" }, ip: c.get("ip") });
  return c.json({ ok: true });
});

// ---------- Order dates and payments ----------

/**
 * Save a sold deal's order dates and/or its payments. Each list sent replaces the one saved.
 * Payments need See deal values as well; someone without it can still keep the dates.
 */
machineSales.put("/:id/milestones", async (c) => {
  const u = requirePerm(c, "machinesales.edit");
  const db = c.env.DB;
  const id = c.req.param("id");
  const b = await body(c);
  const { deal } = await dealAndQuote(db, id);
  if (typeof b.revision !== "number" || b.revision !== deal.revision) fail(409, "Someone else changed this deal while you were editing. Reload to see their changes.");
  const lists: ["date" | "payment", Milestone[]][] = [];
  const changes: Record<string, [unknown, unknown]> = {};
  for (const kind of ["date", "payment"] as const) {
    const raw = b[kind === "date" ? "dates" : "payments"];
    if (raw === undefined) continue;
    if (kind === "payment" && !has(u, "machinesales.prices")) fail(403, "Your role doesn't allow this.");
    const r = readMilestones(raw, kind);
    if (r.problem !== undefined) fail(400, r.problem);
    lists.push([kind, r.list]);
    const had = (await db.prepare("SELECT label, done FROM machine_deal_milestones WHERE deal_id = ? AND kind = ? ORDER BY line_no").bind(id, kind).all<{ label: string; done: string | null }>()).results;
    const say = (ls: { label: string; done: string | null }[]) => ls.map((m) => `${m.label}${m.done ? ` (${m.done})` : ""}`).join("; ") || null;
    if (say(had) !== say(r.list)) changes[kind === "date" ? "order_dates" : "payments"] = [say(had), say(r.list)]; // names and days only: never amounts
  }
  if (!lists.length) fail(400, "Send the order dates or the payments.");
  const t = now();
  const rev = deal.revision + 1;
  const guard = "(SELECT revision FROM machine_deals WHERE id = ?) = ?";
  const stmts: D1PreparedStatement[] = [db.prepare("UPDATE machine_deals SET revision = ?, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?").bind(rev, u.id, t, id, deal.revision)];
  for (const [kind, list] of lists) {
    stmts.push(db.prepare(`DELETE FROM machine_deal_milestones WHERE deal_id = ? AND kind = ? AND ${guard}`).bind(id, kind, id, rev));
    list.forEach((m, i) => stmts.push(db.prepare(`INSERT INTO machine_deal_milestones (id, deal_id, kind, line_no, label, due, done, pct, amount, invoice_no) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`)
      .bind(randomId(), id, m.kind, i + 1, m.label, m.due, m.done, m.pct, m.amount, m.invoice_no, id, rev)));
  }
  const [r] = await db.batch(stmts);
  if (!r?.meta.changes) fail(409, "Someone else changed this deal while you were editing. Reload to see their changes.");
  if (Object.keys(changes).length) await audit(db, { userId: u.id, action: "machine_deal.update", targetType: "machine_deal", targetId: id, detail: { changes }, ip: c.get("ip") });
  return c.json({ ok: true, revision: rev });
});

// ---------- Import ----------

/** Bring in a sales list from a spreadsheet: one new deal per line. Nothing already in the portal is changed. */
machineSales.post("/import", async (c) => {
  const u = requirePerm(c, "machinesales.add");
  const db = c.env.DB;
  const b = await body(c);
  if (!Array.isArray(b.rows) || !b.rows.length) fail(400, "There is nothing to import.");
  if (b.rows.length > MAX_DEAL_IMPORT) fail(400, `Import up to ${MAX_DEAL_IMPORT} deals at a time.`);
  const prices = has(u, "machinesales.prices");
  const t = now();
  const made: { row: Row; stage: Stage }[] = [];
  for (const [i, raw] of (b.rows as unknown[]).entries()) {
    const x = (raw && typeof raw === "object" ? raw : {}) as Row;
    try {
      const f = clean(x, prices);
      if (!f.customer) fail(400, "Customer is required.");
      made.push({ row: f, stage: x.stage === undefined || x.stage === "" ? "lead" : stageOf(x.stage, f) });
    } catch (e) {
      // Say which line of the spreadsheet is wrong (line 1 is the headings).
      const why = e instanceof HTTPException && e.res ? ((await e.res.clone().json()) as { error?: string }).error : null;
      fail(400, `Line ${i + 2}: ${why ?? "couldn't be read."}`);
    }
  }
  let seq = (await db.prepare("SELECT COALESCE(MAX(seq), 1000) AS n FROM machine_deals").first<{ n: number }>())!.n;
  const stmts: D1PreparedStatement[] = [];
  for (const { row: f, stage } of made) {
    const row: Row = { ...f, stage, stage_at: t, funded: f.funded ?? 0 };
    if (SOLD.has(stage)) row.won_at = t;
    if (stage === "paid") row.closed_at = t;
    if (stage === "lost") row.lost_at = t;
    const keys = Object.keys(row);
    stmts.push(db.prepare(`INSERT INTO machine_deals (id, seq, ${keys.join(", ")}, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ${keys.map(() => "?").join(", ")}, ?, ?, ?, ?)`)
      .bind(randomId(), ++seq, ...keys.map((k) => row[k] ?? null), u.id, u.id, t, t));
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  await audit(db, { userId: u.id, action: "machine_deal.import", targetType: "machine_deal", targetId: "import", detail: { deals: made.length }, ip: c.get("ip") });
  return c.json({ ok: true, deals: made.length });
});
