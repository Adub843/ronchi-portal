// Pieces shared by Parts orders and Shipping: the notes box that saves itself, the history list and
// the shipment status pill.
import { useEffect, useRef, useState } from "react";
import { PO_LABELS } from "../../../src/shared/parts-orders";
import { ISSUE_LABELS } from "../../../src/shared/shipping";
import { api, fmtTime } from "../api";
import { t } from "../i18n";
import { Empty, toast } from "./ui";

const enc = encodeURIComponent;

/**
 * The notes box. Saves by itself a moment after typing stops, when Enter is pressed and when the box
 * is left. Shift+Enter starts a new line. If someone else changes the notes, the box picks that up
 * unless it is being typed in.
 */
export function AutoNotes({ id, initial, editable, path }: { id: string; initial: string | null; editable: boolean; path: string }) {
  const [text, setText] = useState(initial ?? "");
  const [state, setState] = useState<"" | "saving" | "saved" | "error">("");
  const saved = useRef(initial ?? "");
  const timer = useRef<number | undefined>(undefined);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (document.activeElement !== box.current && (initial ?? "") !== saved.current) {
      saved.current = initial ?? "";
      setText(initial ?? "");
    }
  }, [initial]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function save(v: string) {
    window.clearTimeout(timer.current);
    if (v === saved.current) return;
    setState("saving");
    try {
      await api(`${path}/${enc(id)}/notes`, { method: "PUT", body: { notes: v } });
      saved.current = v;
      setState("saved");
    } catch (x) {
      setState("error");
      toast((x as Error).message);
    }
  }
  if (!editable) return <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{initial || <span className="muted">{t("No notes yet.")}</span>}</p>;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <textarea ref={box} className="po-notes" value={text} maxLength={5000} aria-label={t("Notes")} placeholder={t("Calls, emails, what the customer said…")}
        onChange={(e) => { const v = e.target.value; setText(v); setState(""); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => save(v), 800); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(text); } }}
        onBlur={() => save(text)} />
      <span className="muted small1" aria-live="polite">
        {state === "saving" ? t("Saving…") : state === "saved" ? t("Saved") : state === "error" ? t("Not saved. Check your connection.") : t("Saves as you type. Enter saves now, Shift+Enter starts a new line.")}
      </span>
    </div>
  );
}

export const SHIP_LABELS: Record<string, string> = { to_pick: "To pick", packed: "Packed", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled" };

export function ShipPill({ status }: { status: string }) {
  const cls = status === "delivered" || status === "shipped" ? "p-ok" : status === "cancelled" ? "p-mute" : "p-info";
  return <span className={`pill ${cls}`}>{t(SHIP_LABELS[status] ?? status)}</span>;
}

const SAID: Record<string, string> = {
  "po.create": "started this quote",
  "po.from_request": "started this quote from the customer's request",
  "po.update": "changed",
  "po.notes": "changed the notes",
  "po.lines": "changed the lines",
  "po.revise": "revised the quote",
  "po.shipment": "made a shipment",
  "po.shipment.status": "updated a shipment",
  "po.file.add": "added files",
  "po.file.remove": "removed a file",
  "inbound.create": "added this shipment",
  "inbound.update": "changed",
  "inbound.lines": "changed the lines",
  "inbound.receive": "received parts",
  "inbound.issue": "wrote down a problem",
  "inbound.issue.resolve": "sorted out a problem",
  "inbound.issue.reopen": "reopened a problem",
  "inbound.file.add": "added files",
  "inbound.file.remove": "removed a file",
  "outbound.create": "made this shipment",
  "outbound.update": "changed",
  "outbound.status": "moved it on",
  "outbound.file.add": "added files",
  "outbound.file.remove": "removed a file",
};
const STATUS_SAID: Record<string, string> = { sent: "marked the quote sent", booked: "booked the order", lost: "marked it lost", quote: "reopened the quote", closed: "closed the order", cancelled: "cancelled the order" };

/** Plain names for the fields that show up in "changed" lines. */
const FIELD_NAMES: Record<string, string> = {
  ...PO_LABELS, supplier: "Supplier", reference: "Reference", mode: "Shipped by", tracking: "Tracking number", expected_date: "Expected",
  stage: "Stage", customs_status: "Customs", broker: "Customs broker", customs_notes: "Customs notes", notes: "Notes", carrier_id: "Carrier",
  service: "Service", boxes: "Boxes", weight_lb: "Weight (lb)", ship_date: "Ship date", ship_to: "Ship to",
};

export function History({ items }: { items: { at: string; action: string; who: string | null; detail: any }[] }) {
  // Notes save as people type: show one line per person per run of saves.
  const list = items.filter((h, i) => !(h.action.endsWith(".notes") && items[i - 1]?.action === h.action && items[i - 1]?.who === h.who));
  return (
    <div className="panel">
      <h2>{t("History")}</h2>
      {!list.length && <Empty>{t("No changes yet.")}</Empty>}
      <ul className="cp-history">
        {list.map((h, i) => {
          const d = h.detail ?? {};
          let what = SAID[h.action] ? t(SAID[h.action]!) : t("changed");
          if (h.action === "po.status") what = t(STATUS_SAID[d.to] ?? "changed");
          if ((h.action === "outbound.status" || h.action === "po.shipment.status") && d.to) what = `${what}: ${d.number ? `${d.number} ` : ""}${t(SHIP_LABELS[d.to] ?? d.to)}`;
          if (h.action === "po.shipment" && d.number) what = `${what} ${d.number}`;
          if (h.action === "po.revise") what = `${what} (${d.from} → ${d.to})`;
          return (
            <li key={i}>
              <span className="muted">{fmtTime(h.at)}</span> <strong>{h.who ?? t("Someone")}</strong> {what}
              {d.reason && <span className="muted"> · {d.reason}</span>}
              {d.customer_po && <span className="muted"> · {t("PO {po}", { po: d.customer_po })}</span>}
              {d.changes && (
                <ul>
                  {Object.entries(d.changes as Record<string, [unknown, unknown]>).map(([k, [a, b]]) => (
                    <li key={k}>{FIELD_NAMES[k] ? t(FIELD_NAMES[k]!) : k}: <s className="muted">{String(a ?? "–")}</s> → {String(b ?? "–")}</li>
                  ))}
                </ul>
              )}
              {Array.isArray(d.after) && <ul><li>{d.after.join(", ") || "–"}</li></ul>}
              {Array.isArray(d.lines) && typeof d.lines[0] === "string" && <ul><li>{d.lines.join(", ")}</li></ul>}
              {h.action === "inbound.receive" && Array.isArray(d.lines) && (
                <ul>{d.lines.map((l: any, j: number) => <li key={j}>{t("Line {n}", { n: l.line })} {l.part ?? ""}: {t("{n} good", { n: l.qty })}{l.damaged ? `, ${t("{n} damaged", { n: l.damaged })}` : ""}{l.bin ? ` → ${l.bin}` : ""}</li>)}</ul>
              )}
              {d.kind && h.action.startsWith("inbound.issue") && <span className="muted"> · {(ISSUE_LABELS as Record<string, string>)[d.kind] ? t((ISSUE_LABELS as Record<string, string>)[d.kind]!) : d.kind}{d.note ? `: ${d.note}` : ""}{d.resolution ? `: ${d.resolution}` : ""}</span>}
              {Array.isArray(d.names) && <span className="muted"> · {d.names.join(", ")}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
