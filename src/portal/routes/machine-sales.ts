// Machine sales: new-machine deals from the first call to final payment (src/shared/machine-sales.ts has
// the fields, stages and rules). Modeled on the pipeline boards and deal pages of the sales tools rated
// best by their users (research note in project files, "Machine sales tracking software.md").
//
// Who: machinesales.view to see, .add/.edit/.remove to change, .prices to see or set a deal's dollar
// value. Values are never sent to someone without .prices, and their saves keep the value already there.
// Every change goes to the audit log (never with the value in it) and shows as the deal's history.
// A save sends the revision it started from; a stale one is refused.
import { Hono } from "hono";
import { randomId } from "../../shared/crypto";
import {
  DATE_FIELDS, DAY, DEAL_FIELDS, DEAL_LABELS, DEAL_MAX, MONEY_FIELDS, MONTH, NOTE_KINDS, NUMBER_FIELDS, SOLD,
  isOpen, isStage, stageNeeds, type DealField, type Stage,
} from "../../shared/machine-sales";
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

function historyChanges(detail: string | null): Row | null {
  if (!detail) return null;
  try {
    return (JSON.parse(detail) as Row).changes ?? null;
  } catch {
    return null;
  }
}

const LIST_COLS = "id, seq, customer, site, title, machine_type, value, chance, expected_po, owner, funded, next_step, next_step_date, hold_until, customer_po, target_ship, machine, lost_reason, stage, prev_stage, stage_at, won_at, lost_at, closed_at, created_at, updated_at";

machineSales.get("/", async (c) => {
  const u = requirePerm(c, "machinesales.view");
  const prices = has(u, "machinesales.prices");
  const { results } = await c.env.DB.prepare(`SELECT ${LIST_COLS} FROM machine_deals WHERE removed_at IS NULL ORDER BY updated_at DESC LIMIT 2000`).all<Row>();
  return c.json({ deals: results.map((d) => shape(d, prices)) });
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
  const [notes, hist, machines] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT n.id, n.kind, n.body, n.created_at AS at, u.name AS who FROM machine_deal_notes n LEFT JOIN users u ON u.id = n.created_by WHERE n.deal_id = ? ORDER BY n.created_at DESC LIMIT 300").bind(id),
    c.env.DB.prepare("SELECT a.at, a.action, a.detail, u.name AS who FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.target_type = 'machine_deal' AND a.target_id = ? ORDER BY a.at DESC LIMIT 200").bind(id),
    // The customer's machines already in the field, for people who may see Machines.
    c.env.DB.prepare("SELECT id, serial, model, site FROM machines WHERE customer = ? COLLATE NOCASE ORDER BY serial LIMIT 100").bind(has(u, "machines.view") ? d.customer : ""),
  ]);
  return c.json({
    deal: shape(d, has(u, "machinesales.prices")),
    notes: notes!.results,
    history: (hist!.results as Row[]).map((h) => ({ at: h.at, action: h.action, who: h.who, changes: historyChanges(h.detail) })),
    machines: machines!.results,
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
  await audit(c.env.DB, { userId: u.id, action: "machine_deal.update", targetType: "machine_deal", targetId: id, detail: { changes: diff }, ip: c.get("ip") });
  return c.json({ ok: true, revision: rev });
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
