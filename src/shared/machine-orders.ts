// Machine orders: what happens after the customer's PO. Each sold deal has order dates (planned and
// actual: engineering approval, FAT, shipment, start-up ...) and payments (deposit, before shipment,
// after start-up ...). Used by routes/machine-sales.ts and pages/MachineSales.tsx.
//
// Payment amounts are only sent to people who may see deal values (machinesales.prices); everyone
// else sees the payment's name, when it is due and whether it has been paid.

export const MILESTONE_KINDS = ["date", "payment"] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

/** The order dates offered when a deal is first sold. People can rename, remove or add their own. */
export const USUAL_DATES = ["Engineering approved", "Factory acceptance test (FAT)", "Shipped", "Installed and started up (SAT)"] as const;

export const MAX_MILESTONES = 40;
export const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface Milestone {
  id?: string;
  kind: MilestoneKind;
  label: string;
  /** Planned date (a date) or due date (a payment). */
  due: string | null;
  /** The day it happened, or the day the payment arrived. */
  done: string | null;
  /** Payments only. */
  pct: number | null;
  amount: number | null;
  invoice_no: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The milestones as typed, checked and tidied, or what is wrong with them. */
export function readMilestones(raw: unknown, kind: MilestoneKind): { list: Milestone[]; problem?: undefined } | { list?: undefined; problem: string } {
  if (!Array.isArray(raw)) return { problem: "Send the list." };
  if (raw.length > MAX_MILESTONES) return { problem: `Up to ${MAX_MILESTONES} lines.` };
  const list: Milestone[] = [];
  for (const r of raw) {
    const x = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const label = typeof x.label === "string" ? x.label.trim() : "";
    if (!label) return { problem: kind === "payment" ? "Every payment needs a name." : "Every date needs a name." };
    if (label.length > 120) return { problem: "A name is too long (limit 120 characters)." };
    const date = (v: unknown) => (v === null || v === undefined || v === "" ? null : typeof v === "string" && DAY.test(v) ? v : undefined);
    const due = date(x.due), done = date(x.done);
    if (due === undefined || done === undefined) return { problem: "Dates must be dates." };
    const n = (v: unknown, max: number) => {
      if (v === null || v === undefined || v === "") return null;
      const k = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,%\s]/g, "")) : NaN;
      return Number.isFinite(k) && k >= 0 && k <= max ? round2(k) : undefined;
    };
    const pct = kind === "payment" ? n(x.pct, 100) : null;
    const amount = kind === "payment" ? n(x.amount, 1_000_000_000) : null;
    if (pct === undefined) return { problem: "A payment's percent must be between 0 and 100." };
    if (amount === undefined) return { problem: "A payment's amount must be a number." };
    const invoice_no = kind === "payment" && typeof x.invoice_no === "string" ? x.invoice_no.trim().slice(0, 80) || null : null;
    list.push({ id: typeof x.id === "string" ? x.id : undefined, kind, label, due, done, pct, amount, invoice_no });
  }
  return { list };
}

/** What a payment is worth: the amount typed, or its percent of the order value. */
export const paymentAmount = (p: Pick<Milestone, "pct" | "amount">, value: number | null | undefined) =>
  p.amount ?? (p.pct != null && value != null ? round2((value * p.pct) / 100) : null);

/** Where the money stands on an order. */
export function paymentTotals(payments: Pick<Milestone, "pct" | "amount" | "done" | "due">[], value: number | null | undefined, today: string) {
  let planned = 0, paid = 0, overdue = 0;
  for (const p of payments) {
    const a = paymentAmount(p, value) ?? 0;
    planned += a;
    if (p.done) paid += a;
    else if (p.due && p.due < today) overdue += a;
  }
  return { planned: round2(planned), paid: round2(paid), overdue: round2(overdue), open: round2(planned - paid), unplanned: value == null ? null : round2(value - planned) };
}

/** A date or payment is late when its day has passed and it hasn't happened. */
export const milestoneLate = (m: Pick<Milestone, "due" | "done">, today: string) => !m.done && !!m.due && m.due < today;
