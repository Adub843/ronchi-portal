// Shipping and receiving: one list of everything going out and coming in, each shipment's page (tracking,
// packages, items, checking deliveries in, photos and papers, printable packing slip and bill of lading),
// and the form to make or change one. Server side: src/portal/routes/shipping.ts.
// The shipping documents (packing slip, bill of lading) print in English, since they go to US carriers and customers.
import { useMemo, useRef, useState } from "react";
import { toCsv } from "../../../src/shared/csv";
import { ACCEPT, fileProblem, fmtSize } from "../../../src/shared/files";
import {
  CARRIERS, carrierName, freightClass, FREIGHT_LABEL, FREIGHT_OPTIONS, guessCarrier, KIND_LABEL, KINDS, MODE_LABEL, MODES, PACKAGE_LABEL, PACKAGE_TYPES,
  packageTotals, PROBLEM_LABEL, PROBLEMS, STATUS_LABEL, statusesFor, type Direction, type Package, type Status,
} from "../../../src/shared/shipping";
import { api, apiForm, can, fmtDate, fmtTime, type Me } from "../api";
import logoUrl from "../assets/ronchi-logo.png";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad } from "../components/ui";
import { t } from "../i18n";
import { navigate } from "../router";

const STATUS_CLASS: Record<string, string> = {
  to_pack: "p-warn", packed: "p-info", shipped: "p-info", delivered: "p-ok",
  expected: "p-info", arrived: "p-warn", partly_received: "p-warn", received: "p-ok", on_hold: "p-acc", cancelled: "p-acc",
};

export function ShipStatus({ status }: { status: string }) {
  return <span className={`pill ${STATUS_CLASS[status] ?? "p-info"}`}>{t(STATUS_LABEL[status as Status] ?? status)}</span>;
}

/** What a shipment is for, when the person can't open it (so the name isn't shown). */
const SOURCE_NAME = { job: "a job", cp_order: "a change-part order", parts_order: "a parts order" } as const;

const pieces = (n: number) => (n === 1 ? t("1 piece") : t("{n} pieces", { n }));
const dir = (d: Direction) => (d === "out" ? t("Going out") : t("Coming in"));
const today = () => new Date().toISOString().slice(0, 10);

/** Tracking numbers as links to the carrier's own tracking page. For LTL carriers the number is copied to paste there. */
export function Tracking({ links, compact }: { links: { number: string; url: string | null; copy?: true }[]; compact?: boolean }) {
  if (!links.length) return compact ? null : <span className="muted">{t("No tracking number yet.")}</span>;
  return (
    <span className="row" style={{ gap: 6 }}>
      {links.map((l) => l.url ? (
        <a key={l.number} className="btn small mono" href={l.url} target="_blank" rel="noopener noreferrer"
          title={l.copy ? t("Opens the carrier's tracking page. The number is copied: paste it there.") : t("Track on the carrier's site")}
          onClick={() => { if (l.copy) navigator.clipboard?.writeText(l.number).then(() => toast(t("Number copied. Paste it on the carrier's page.")), () => undefined); }}>
          {l.number} ↗
        </a>
      ) : <span key={l.number} className="chip mono">{l.number}</span>)}
    </span>
  );
}

// ---- The list ----

type Tile = { id: string; view?: string; status?: string; direction?: Direction; label: string };
const TILES: Tile[] = [
  { id: "to_pack", status: "to_pack", direction: "out", label: "To pack" },
  { id: "packed", status: "packed", direction: "out", label: "Packed, ready to go" },
  { id: "shipped", status: "shipped", direction: "out", label: "On the way to customers" },
  { id: "expected", status: "expected", direction: "in", label: "Expected in" },
  { id: "arrived", status: "arrived", direction: "in", label: "Arrived, not checked in" },
  { id: "partly_received", status: "partly_received", direction: "in", label: "Partly received" },
  { id: "problems", view: "problems", label: "Problems" },
  { id: "hold", view: "hold", label: "Parts on quality hold" },
];

export function Shipping({ me }: { me: Me }) {
  const [direction, setDirection] = useState<"" | Direction>("");
  const [tile, setTile] = useState<Tile | null>(null);
  const [view, setView] = useState("open");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const params = new URLSearchParams({ view: tile?.view ?? view, ...(tile?.status ? { status: tile.status } : {}), ...((tile?.direction ?? direction) ? { direction: tile?.direction ?? direction } : {}), q: query });
  const { data, error } = useLoad(() => api(`/shipping?${params}`), [params.toString()]);
  const edit = can(me, "shipping.edit");

  function exportCsv() {
    const head = ["Number", "Direction", "Kind", "Status", "Customer or supplier", "Machine", "Reference", "Carrier", "Tracking", "Pieces", "Planned", "Shipped or arrived", "Delivered or received", "Problem"];
    const rows = (data?.shipments ?? []).map((s: any) => [s.number, s.direction === "out" ? "Out" : "In", KIND_LABEL[s.kind] ?? s.kind, STATUS_LABEL[s.status as Status] ?? s.status, s.party, s.machine ?? "", s.reference ?? "", s.carrier === "other" ? s.carrier_other ?? "Other" : carrierName(s.carrier), (s.tracking ?? "").replace(/\s+/g, " "), String(s.pieces), s.planned_date ?? "", s.shipped_date ?? "", s.done_date ?? "", s.problem ? PROBLEM_LABEL[s.problem as keyof typeof PROBLEM_LABEL] : ""]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toCsv(head, rows)], { type: "text/csv" }));
    a.download = `shipments-${today()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <>
      <PageHead title={t("Shipping and receiving")} sub={t("Everything going out to customers and coming in from Italy, suppliers and customers, in one place.")} tip="shipping.head">
        <button className="btn" onClick={exportCsv} disabled={!data?.shipments.length}>{t("Export CSV")}</button>
        {edit && <button className="btn" onClick={() => startShipment({ direction: "in" })}>{t("Expect a delivery")}</button>}
        {edit && <Link to="/shipping/new" className="btn primary">{t("New shipment")}</Link>}
      </PageHead>
      <ErrorNote error={error} />
      <div className="cp-tiles ship-tiles">
        {TILES.map((x) => {
          const n = data?.counts?.[x.id] ?? 0;
          const on = tile?.id === x.id;
          return (
            <button key={x.id} type="button" className={`panel cp-tile${on ? " on" : ""}${(x.id === "problems" || x.id === "hold" || x.id === "arrived") && n ? " warn" : ""}`} aria-pressed={on} onClick={() => setTile(on ? null : x)}>
              <span className="n">{data ? n : "–"}</span><span className="l">{t(x.label)}</span>
            </button>
          );
        })}
      </div>
      <div className="row">
        <div className="seg" role="radiogroup" aria-label={t("Show")}>
          {([["", t("Both ways")], ["out", t("Going out")], ["in", t("Coming in")]] as const).map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={direction === v && !tile} className={direction === v && !tile ? "on" : ""} onClick={() => { setTile(null); setDirection(v); }}>{l}</button>
          ))}
        </div>
        <div className="seg" role="radiogroup" aria-label={t("Which")}>
          {([["open", t("Open")], ["done", t("Finished")], ["all", t("All")]] as const).map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={view === v && !tile} className={view === v && !tile ? "on" : ""} onClick={() => { setTile(null); setView(v); }}>{l}</button>
          ))}
        </div>
        <form className="row" style={{ flex: 1 }} onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
          <input className="panel" style={{ flex: 1, minWidth: 180, padding: "8px 12px", font: "inherit" }} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search number, customer, supplier, machine, PO, tracking or part")} aria-label={t("Search shipments")} />
          <button className="btn" type="submit">{t("Search")}</button>
        </form>
      </div>
      <ShipmentTable rows={data?.shipments ?? null} empty={query ? t("No shipments match.") : t("Nothing here. New shipments and expected deliveries show up here.")} />
    </>
  );
}

export function ShipmentTable({ rows, empty }: { rows: any[] | null; empty: string }) {
  return (
    <div className="panel tbl">
      {rows && !rows.length && <Empty>{empty}</Empty>}
      {!!rows?.length && (
        <table className="ships">
          <thead><tr><th>{t("Shipment")}</th><th>{t("Customer or supplier")}</th><th>{t("Carrier and tracking")}</th><th>{t("Date")}</th><th>{t("Status")}</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="mono"><Link to={`/shipping/${s.id}`}>{s.number}</Link><div className="muted small1">{s.direction === "out" ? "↑ " : "↓ "}{t(KIND_LABEL[s.kind] ?? s.kind)}</div></td>
                <td>{s.party}{(s.machine || s.reference) && <div className="muted small1">{[s.machine, s.reference].filter(Boolean).join(" · ")}</div>}</td>
                <td>{s.carrier ? <div className="small1">{s.carrier === "other" ? s.carrier_other ?? t("Other") : t(carrierName(s.carrier))}</div> : null}<Tracking links={s.trackingLinks ?? []} compact /></td>
                <td className="small1">{s.done_date ? fmtDate(s.done_date) : s.shipped_date ? fmtDate(s.shipped_date) : s.planned_date ? <>{fmtDate(s.planned_date)}{s.planned_date < today() && <div className="muted">{t("Planned")}</div>}</> : <span className="muted">–</span>}</td>
                <td><ShipStatus status={s.status} />{s.problem && <div><span className="pill p-acc">{t(PROBLEM_LABEL[s.problem as keyof typeof PROBLEM_LABEL] ?? s.problem)}</span></div>}{s.pieces > 0 && <div className="muted small1">{pieces(s.pieces)}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * The shipments for an order, job or machine, shown on that page, with a button to ship it.
 * Hidden when shipping is switched off or the person can't see shipments.
 */
export function LinkedShipments({ me, link, machine, shipLabel }: { me: Me; link?: { type: "cp_order" | "job" | "parts_order"; id: string }; machine?: string; shipLabel?: string }) {
  const q = link ? `link=${link.type}:${encodeURIComponent(link.id)}` : `machine=${encodeURIComponent(machine ?? "")}`;
  const { data } = useLoad(() => (can(me, "shipping.view") ? api(`/shipping?${q}`) : Promise.resolve(null)), [q]);
  if (!can(me, "shipping.view") || !data) return null;
  return (
    <div className="panel stack" style={{ gridColumn: "1 / -1" }}>
      <div className="row">
        <h2 style={{ margin: 0 }}>{t("Shipments")}</h2>
        <span className="spacer" />
        {link && can(me, "shipping.edit") && <button className="btn small" onClick={() => startShipment({ source: link.type, id: link.id })}>{shipLabel ?? t("Ship this")}</button>}
      </div>
      {data.shipments.length ? <ShipmentTable rows={data.shipments} empty="" /> : <span className="muted">{t("Nothing shipped or received for this yet.")}</span>}
    </div>
  );
}

// A new shipment opened from another page (an order or job) remembers what it's for. The real portal also
// reads ?source=...&id=... (or ?parts_order=<id>) from the address, so other pages can link straight here.
let pending: { source?: string; id?: string; direction?: Direction } | null = null;
export function startShipment(p: { source?: string; id?: string; direction?: Direction }) {
  pending = p;
  navigate("/shipping/new");
}
function takePending() {
  const p = pending ?? {};
  pending = null;
  const qs = new URLSearchParams(typeof location !== "undefined" ? location.search || location.hash.split("?")[1] || "" : "");
  const source = p.source ?? qs.get("source") ?? (qs.get("parts_order") ? "parts_order" : qs.get("cp_order") ? "cp_order" : qs.get("job") ? "job" : undefined);
  const id = p.id ?? qs.get("id") ?? qs.get("parts_order") ?? qs.get("cp_order") ?? qs.get("job") ?? undefined;
  const direction = p.direction ?? (qs.get("direction") === "in" ? "in" : undefined);
  return { source, id, direction };
}

// ---- One shipment ----

export function ShipmentPage({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useLoad(() => api(`/shipping/${encodeURIComponent(id)}`), [id]);
  const [editing, setEditing] = useState(false);
  const [doc, setDoc] = useState<null | "packing" | "bol">(null);
  const [shipping, setShipping] = useState(false);
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const s = data.shipment;
  const edit = can(me, "shipping.edit");
  const out = s.direction === "out";

  async function step(status: string, extra: Record<string, unknown> = {}) {
    try {
      await api(`/shipping/${encodeURIComponent(s.id)}`, { method: "PATCH", body: { revision: s.revision, status, ...extra } });
      toast(t("Saved"));
      setShipping(false);
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function remove() {
    if (!confirm(t("Remove shipment {number}? It stays in the activity log.", { number: s.number }))) return;
    try {
      await api(`/shipping/${encodeURIComponent(s.id)}`, { method: "DELETE" });
      navigate("/shipping");
    } catch (e) {
      toast((e as Error).message);
    }
  }

  if (editing) return <ShipmentForm shipment={{ ...s, lines: data.lines }} onDone={() => { setEditing(false); reload(); }} />;
  if (doc) return <PrintDoc kind={doc} data={data} onClose={() => setDoc(null)} />;

  const next = out
    ? ({ to_pack: ["packed", t("Mark packed")], packed: ["shipped", t("Mark shipped")], shipped: ["delivered", t("Mark delivered")] } as Record<string, [string, string]>)[s.status]
    : ({ expected: ["arrived", t("Mark arrived")] } as Record<string, [string, string]>)[s.status];
  const customerMail = out && s.contact_email && (s.status === "shipped" || s.status === "delivered") ? shippedMail(data) : null;

  return (
    <>
      <PageHead title={`${s.number} · ${s.party}`} sub={[dir(s.direction), t(KIND_LABEL[s.kind] ?? s.kind), s.machine, s.reference].filter(Boolean).join(" · ")}>
        <ShipStatus status={s.status} />
        {edit && next && (next[0] === "shipped" ? <button className="btn primary" onClick={() => setShipping(true)}>{next[1]}</button> : <button className="btn primary" onClick={() => step(next[0])}>{next[1]}</button>)}
        {out && <button className="btn" onClick={() => setDoc("packing")}>{t("Packing slip")}</button>}
        {out && <button className="btn" onClick={() => setDoc("bol")}>{t("Bill of lading")}</button>}
        {customerMail && <a className="btn" href={customerMail}>{t("Email the customer")}</a>}
        {edit && <button className="btn" onClick={() => setEditing(true)}>{t("Edit")}</button>}
        {edit && <button className="btn" onClick={remove}>{t("Remove")}</button>}
      </PageHead>
      {shipping && <ShipNow s={s} onSave={(extra) => step("shipped", extra)} onCancel={() => setShipping(false)} />}
      {s.problem && (
        <div className="panel stack problem" role="status">
          <b>{t(PROBLEM_LABEL[s.problem as keyof typeof PROBLEM_LABEL] ?? s.problem)}</b>
          {s.problem_note && <span style={{ whiteSpace: "pre-wrap" }}>{s.problem_note}</span>}
          {edit && <div><button className="btn small" onClick={() => step(s.status, { problem: null, problem_note: null })}>{t("Problem sorted out")}</button></div>}
        </div>
      )}
      <div className="grid g2">
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>{out ? t("Ship to") : t("Coming from")}</h2>
          <b>{s.party}</b>
          {s.address ? <span style={{ whiteSpace: "pre-wrap" }}>{s.address}</span> : <span className="muted">{t("No address yet.")}</span>}
          {(s.contact_name || s.contact_phone || s.contact_email) && (
            <div className="stack" style={{ gap: 2 }}>
              {s.contact_name && <span>{s.contact_name}</span>}
              {s.contact_phone && <a href={`tel:${s.contact_phone.replace(/[^\d+]/g, "")}`}>{s.contact_phone}</a>}
              {s.contact_email && <a href={`mailto:${s.contact_email}`}>{s.contact_email}</a>}
            </div>
          )}
          {data.source && (data.source.open ? <Link to={data.source.type === "job" ? `/jobs/${data.source.id}` : data.source.type === "cp_order" ? `/change-parts/${data.source.id}` : `/parts-orders/${data.source.id}`}>{t("For: {what}", { what: data.source.label ?? "" })}</Link> : <span className="muted">{t("For: {what}", { what: data.source.label ?? t(SOURCE_NAME[data.source.type as keyof typeof SOURCE_NAME] ?? "an order") })}</span>)}
          {data.machine && <Link to={`/machines/${data.machine.id}`}>{t("Machine {serial}", { serial: data.machine.serial })}</Link>}
        </div>
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>{t("Carrier and tracking")}</h2>
          <span>{s.carrier ? (s.carrier === "other" ? s.carrier_other ?? t("Other") : t(carrierName(s.carrier))) : <span className="muted">{t("No carrier yet.")}</span>}{s.service && ` · ${s.service}`}</span>
          <Tracking links={data.tracking} />
          {s.bol_number && <span>{t("Bill of lading")}: <span className="mono">{s.bol_number}</span></span>}
          {!out && (s.mode || s.vessel || s.container || s.broker) && (
            <span className="small1">{[s.mode && t(MODE_LABEL[s.mode as keyof typeof MODE_LABEL]), s.vessel, s.container && `${t("Container")} ${s.container}`, s.broker && `${t("Customs broker")}: ${s.broker}`].filter(Boolean).join(" · ")}</span>
          )}
          <Dates s={s} />
        </div>
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>{t("Packages")}</h2>
          {s.packages.length ? (
            <>
              <table className="mini">
                <tbody>
                  {s.packages.map((p: Package, i: number) => (
                    <tr key={i}><td>{p.count} × {t(PACKAGE_LABEL[p.type])}</td><td>{p.weight ? `${p.weight} lb` : ""}</td><td>{p.length && p.width && p.height ? `${p.length} × ${p.width} × ${p.height} in` : ""}</td></tr>
                  ))}
                </tbody>
              </table>
              <span className="muted">{pieces(data.totals.pieces)}{data.totals.weight ? ` · ${data.totals.weight} lb` : ""}{s.freight_class ? ` · ${t("Class")} ${s.freight_class}` : ""}</span>
            </>
          ) : <span className="muted">{t("No packages entered yet.")}</span>}
          {!!s.freight_options.length && <div className="row" style={{ gap: 6 }}>{s.freight_options.map((o: string) => <span key={o} className="chip">{t(FREIGHT_LABEL[o as keyof typeof FREIGHT_LABEL] ?? o)}</span>)}</div>}
        </div>
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>{t("Notes")}</h2>
          {s.notes ? <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{s.notes}</p> : <span className="muted">{t("Nothing added.")}</span>}
        </div>
        <div className="panel stack" style={{ gridColumn: "1 / -1" }}>
          <h2 style={{ margin: 0 }}>{out ? t("What's in it") : t("What's coming, and what came in")}</h2>
          {out ? <Lines lines={data.lines} /> : <Receive s={s} lines={data.lines} edit={edit} onDone={reload} />}
        </div>
        <div className="panel stack" style={{ gridColumn: "1 / -1" }}>
          <h2 style={{ margin: 0 }}>{t("Photos and papers")}</h2>
          <p className="muted" style={{ margin: 0 }}>{out ? t("Photos of the packed crate, the signed bill of lading, proof of delivery.") : t("Packing list, bill of lading or air waybill, customs papers, photos of any damage.")}</p>
          <ShipmentFiles shipmentId={s.id} files={data.files} me={me} onChange={reload} />
        </div>
        <div className="panel stack" style={{ gridColumn: "1 / -1" }}>
          <h2 style={{ margin: 0 }}>{t("History")}</h2>
          <ul className="history">
            {data.history.map((h: any, i: number) => <li key={i}><span className="muted">{fmtTime(h.at)}</span> · {h.who ?? t("Someone")} · {historyText(h)}</li>)}
          </ul>
        </div>
      </div>
    </>
  );
}

function historyText(h: { action: string; detail: any }): string {
  const what: Record<string, string> = {
    "shipment.create": t("made this shipment"), "shipment.update": t("changed it"), "shipment.receive": t("checked items in"),
    "shipment.hold": t("put an item on quality hold"), "shipment.hold_clear": t("cleared a quality hold"),
    "shipment.file.add": t("added files"), "shipment.file.remove": t("removed a file"), "shipment.remove": t("removed it"),
  };
  let out = what[h.action] ?? h.action;
  const st = h.detail?.changes?.status?.[1] ?? (h.action === "shipment.receive" ? h.detail?.status : null);
  if (st) out += `: ${t(STATUS_LABEL[st as Status] ?? st)}`;
  if (h.action === "shipment.receive" && h.detail?.received?.length) out += ` (${h.detail.received.map((r: any) => `${r.item} ${r.qty}${r.bin ? ` → ${r.bin}` : ""}`).join(", ")})`;
  return out;
}

function Dates({ s }: { s: any }) {
  const out = s.direction === "out";
  const rows: [string, string | null][] = [
    [out ? t("Ship by") : t("Expected"), s.planned_date],
    [out ? t("Shipped") : t("Arrived"), s.shipped_date],
    [out ? t("Delivered") : t("Fully received"), s.done_date],
  ];
  return <div className="row small1" style={{ gap: 12 }}>{rows.filter(([, v]) => v).map(([l, v]) => <span key={l}>{l}: <b>{fmtDate(v!)}</b></span>)}</div>;
}

/** Marking shipped: the carrier and tracking numbers, filled in on the spot. */
function ShipNow({ s, onSave, onCancel }: { s: any; onSave: (extra: Record<string, unknown>) => void; onCancel: () => void }) {
  const [carrier, setCarrier] = useState<string>(s.carrier ?? "");
  const [tracking, setTracking] = useState<string>(s.tracking ?? "");
  const [bol, setBol] = useState<string>(s.bol_number ?? "");
  return (
    <form className="panel grid g3" onSubmit={(e) => { e.preventDefault(); onSave({ carrier: carrier || null, tracking, bol_number: bol }); }}>
      <div className="field">
        <label htmlFor="sn-carrier">{t("Carrier")}</label>
        <CarrierSelect id="sn-carrier" value={carrier} onChange={setCarrier} />
      </div>
      <div className="field">
        <label htmlFor="sn-track">{t("Tracking or PRO numbers")}</label>
        <input id="sn-track" className="mono" value={tracking} onChange={(e) => { setTracking(e.target.value); const g = guessCarrier(e.target.value.split(/[\s,]+/)[0] ?? ""); if (g && !carrier) setCarrier(g); }} placeholder="1Z…" />
      </div>
      <div className="field">
        <label htmlFor="sn-bol">{t("Bill of lading number")}</label>
        <input id="sn-bol" className="mono" value={bol} onChange={(e) => setBol(e.target.value)} />
      </div>
      <div className="row" style={{ gridColumn: "1 / -1" }}>
        <button className="btn primary" type="submit">{t("Mark shipped")}</button>
        <button className="btn" type="button" onClick={onCancel}>{t("Cancel")}</button>
      </div>
    </form>
  );
}

function CarrierSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("Not chosen yet")}</option>
      <optgroup label={t("Parcel")}>{CARRIERS.filter((c) => !c.freight && c.url).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
      <optgroup label={t("Freight")}>{CARRIERS.filter((c) => c.freight).map((c) => <option key={c.id} value={c.id}>{t(c.name)}</option>)}</optgroup>
      <optgroup label={t("Other")}>{CARRIERS.filter((c) => !c.freight && !c.url).map((c) => <option key={c.id} value={c.id}>{t(c.name)}</option>)}</optgroup>
    </select>
  );
}

function Lines({ lines }: { lines: any[] }) {
  if (!lines.length) return <span className="muted">{t("No items listed yet.")}</span>;
  return (
    <table className="mini">
      <thead><tr><th>#</th><th>{t("Part number")}</th><th>{t("Description")}</th><th>{t("Qty")}</th></tr></thead>
      <tbody>{lines.map((l) => <tr key={l.id}><td>{l.line_no}</td><td className="mono">{l.part_code ?? ""}</td><td>{l.description}</td><td>{l.qty}</td></tr>)}</tbody>
    </table>
  );
}

/** Incoming: what's expected, what came in so far, and (for shipping editors) checking items in. */
function Receive({ s, lines, edit, onDone }: { s: any; lines: any[]; edit: boolean; onDone: () => void }) {
  const [got, setGot] = useState<Record<string, { qty: string; bin: string; hold: boolean; note: string }>>({});
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const open = edit && s.status !== "received" && s.status !== "cancelled";
  const row = (id: string) => got[id] ?? { qty: "", bin: "", hold: false, note: "" };
  const set = (id: string, k: string, v: unknown) => setGot((g) => ({ ...g, [id]: { ...row(id), [k]: v } }));

  async function checkIn(all: boolean) {
    setBusy(true);
    try {
      const body = lines.map((l) => {
        const r = row(l.id);
        const qty = all ? Math.max(0, l.qty - l.qty_received) : Number(r.qty || 0);
        return { id: l.id, qty, bin: r.bin || undefined, ...(r.hold ? { hold: true, hold_note: r.note } : {}) };
      });
      const r = await api(`/shipping/${encodeURIComponent(s.id)}/receive`, { body: { revision: s.revision, lines: body, problem: problem || undefined, problem_note: note || undefined } });
      toast(r.status === "received" ? t("All checked in") : t("Checked in"));
      setGot({});
      setProblem("");
      setNote("");
      onDone();
    } catch (e) {
      toast((e as Error).message);
      if ((e as { status?: number }).status === 409) onDone(); // load the newest version; the counts typed here stay
    } finally {
      setBusy(false);
    }
  }
  async function clearHold(l: any) {
    try {
      await api(`/shipping/${encodeURIComponent(s.id)}/lines/${encodeURIComponent(l.id)}/hold`, { body: { revision: s.revision, hold: false } });
      onDone();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  if (!lines.length) return <span className="muted">{t("No items listed yet. Edit the shipment to add what's expected.")}</span>;
  return (
    <div className="stack">
      <table className="mini recv">
        <thead><tr><th>{t("Part number")}</th><th>{t("Description")}</th><th>{t("Expected")}</th><th>{t("Received")}</th><th>{t("Where it went")}</th>{open && <th>{t("Came in now")}</th>}{open && <th>{t("Hold")}</th>}</tr></thead>
        <tbody>
          {lines.map((l) => {
            const r = row(l.id);
            const left = l.qty - l.qty_received;
            return (
              <tr key={l.id} className={l.hold ? "held" : undefined}>
                <td className="mono">{l.part_code ?? ""}</td>
                <td>{l.description}{!!l.hold && <div><span className="pill p-acc">{t("Quality hold")}</span>{l.hold_note && <span className="muted small1"> {l.hold_note}</span>}{edit && <button className="linkish" style={{ marginLeft: 6 }} onClick={() => clearHold(l)}>{t("Clear hold")}</button>}</div>}</td>
                <td>{l.qty}</td>
                <td className={l.qty_received >= l.qty ? "ok" : l.qty_received ? "part" : undefined}>{l.qty_received}</td>
                <td>{l.bin ?? <span className="muted">–</span>}</td>
                {open && <td><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}><input type="number" min={0} inputMode="numeric" style={{ width: 70 }} value={r.qty} placeholder={String(Math.max(0, left))} onChange={(e) => set(l.id, "qty", e.target.value)} aria-label={t("How many came in")} /><input style={{ width: 110 }} value={r.bin} placeholder={t("Shelf or bin")} onChange={(e) => set(l.id, "bin", e.target.value)} aria-label={t("Shelf or bin")} /></div></td>}
                {open && <td><label className="row" style={{ gap: 4 }}><input type="checkbox" checked={r.hold} onChange={(e) => set(l.id, "hold", e.target.checked)} />{r.hold && <input style={{ width: 120 }} value={r.note} placeholder={t("Why")} onChange={(e) => set(l.id, "note", e.target.value)} aria-label={t("Why it's on hold")} />}</label></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {open && (
        <div className="grid g2">
          <div className="field">
            <label htmlFor="r-problem">{t("Anything wrong?")}</label>
            <select id="r-problem" value={problem} onChange={(e) => setProblem(e.target.value)}>
              <option value="">{t("No, all good")}</option>
              {PROBLEMS.map((p) => <option key={p} value={p}>{t(PROBLEM_LABEL[p])}</option>)}
            </select>
          </div>
          {problem && (
            <div className="field">
              <label htmlFor="r-note">{t("What happened")}</label>
              <input id="r-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Crate corner crushed, 2 kits missing… add photos below")} />
            </div>
          )}
          <div className="row" style={{ gridColumn: "1 / -1" }}>
            <button className="btn primary" disabled={busy} onClick={() => checkIn(false)}>{t("Check in what I counted")}</button>
            <button className="btn" disabled={busy} onClick={() => checkIn(true)}>{t("Everything arrived")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ShipmentFiles({ shipmentId, files, me, onChange }: { shipmentId: string; files: any[]; me: Me; onChange: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function add(list: FileList | null) {
    if (!list?.length) return;
    for (const f of Array.from(list)) {
      const p = fileProblem(f.name, f.size);
      if (p) return toast(`${f.name}: ${t(p)}`);
    }
    const form = new FormData();
    for (const f of Array.from(list)) form.append("files", f);
    setBusy(true);
    try {
      await apiForm(`/shipping/${encodeURIComponent(shipmentId)}/files`, form);
      toast(t("Added"));
      onChange();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function remove(f: any) {
    try {
      await api(`/shipping/files/${encodeURIComponent(f.id)}`, { method: "DELETE" });
      onChange();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {files.length ? (
        <ul className="filelist">
          {files.map((f) => (
            <li key={f.id}>
              <a href={f.url ?? `/api/shipping/files/${encodeURIComponent(f.id)}?download=1`} download={f.name}>{f.name}</a>
              <span className="muted"> · {fmtSize(f.size)} · {f.by_name ?? ""} · {fmtTime(f.created_at)}</span>
              {(f.user_id === me.id || can(me, "shipping.edit")) && <button className="linkish" style={{ marginLeft: 8 }} onClick={() => remove(f)} aria-label={t("Remove {name}", { name: f.name })}>{t("Remove")}</button>}
            </li>
          ))}
        </ul>
      ) : <span className="muted">{t("No files yet.")}</span>}
      {can(me, "files.send") && (
        <div>
          <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => add(e.target.files)} />
          <button className="btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? t("Adding…") : t("Add photos or files")}</button>
        </div>
      )}
    </div>
  );
}

/** "Your order has shipped" email, opened in the person's own email app (no email service needed). */
function shippedMail(data: any): string {
  const s = data.shipment;
  const lines = [
    `Hello${s.contact_name ? " " + s.contact_name.split(" ")[0] : ""},`,
    "",
    `Your Ronchi America shipment ${s.number}${s.reference ? ` (your reference ${s.reference})` : ""} ${s.status === "delivered" ? "was delivered" : "has shipped"}${s.shipped_date ? ` on ${s.shipped_date}` : ""}.`,
    s.carrier ? `Carrier: ${s.carrier === "other" ? s.carrier_other ?? "" : carrierName(s.carrier)}${s.service ? `, ${s.service}` : ""}` : "",
    ...data.tracking.map((l: any) => `Tracking ${l.number}${l.url ? `: ${l.url}` : ""}`),
    data.totals.pieces ? `${data.totals.pieces} piece(s)${data.totals.weight ? `, ${data.totals.weight} lb` : ""}` : "",
    "",
    ...(data.lines.length ? ["What's in it:", ...data.lines.map((l: any) => `- ${l.qty} x ${l.part_code ? l.part_code + " " : ""}${l.description}`), ""] : []),
    "Thank you,",
    "Ronchi America",
  ].filter((x, i, a) => x !== "" || a[i - 1] !== "");
  return `mailto:${encodeURIComponent(s.contact_email)}?subject=${encodeURIComponent(`Ronchi America shipment ${s.number}${s.reference ? ` (${s.reference})` : ""}`)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

// ---- Printable packing slip and bill of lading (English: they go to US carriers and customers) ----

function PrintDoc({ kind, data, onClose }: { kind: "packing" | "bol"; data: any; onClose: () => void }) {
  const s = data.shipment;
  const carrier = s.carrier === "other" ? s.carrier_other ?? "" : carrierName(s.carrier);
  return (
    <div className="printdoc">
      <div className="row noprint" style={{ marginBottom: 12 }}>
        <button className="btn primary" onClick={() => window.print()}>{t("Print or save as PDF")}</button>
        <button className="btn" onClick={onClose}>{t("Close")}</button>
      </div>
      <div className="paper">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <img src={logoUrl} alt="Ronchi" style={{ height: 40 }} />
          <span className="spacer" />
          <div style={{ textAlign: "right" }}>
            <h1 style={{ margin: 0 }}>{kind === "packing" ? "Packing slip" : "Straight bill of lading"}</h1>
            <div className="mono">{s.number}{kind === "bol" && s.bol_number ? ` · BOL ${s.bol_number}` : ""}</div>
            <div>Date: {s.shipped_date ?? today()}</div>
          </div>
        </div>
        <div className="grid g2" style={{ marginTop: 16 }}>
          <div><b>{kind === "bol" ? "Shipper" : "From"}</b><div style={{ whiteSpace: "pre-wrap" }}>{s.origin ?? "Ronchi America"}</div></div>
          <div><b>{kind === "bol" ? "Consignee" : "Ship to"}</b><div>{s.party}</div><div style={{ whiteSpace: "pre-wrap" }}>{s.address ?? ""}</div>{(s.contact_name || s.contact_phone) && <div>Attn: {[s.contact_name, s.contact_phone].filter(Boolean).join(", ")}</div>}</div>
        </div>
        <div className="row" style={{ marginTop: 12, gap: 24 }}>
          {s.reference && <span>Customer PO / reference: <b>{s.reference}</b></span>}
          {s.machine && <span>Machine: <b>{s.machine}</b></span>}
          {carrier && <span>Carrier: <b>{carrier}</b>{s.service ? ` (${s.service})` : ""}</span>}
          {s.tracking && <span>{kind === "bol" ? "PRO" : "Tracking"}: <b className="mono">{s.tracking.split(/[\s,]+/).join(", ")}</b></span>}
        </div>
        {kind === "packing" ? (
          <table className="mini" style={{ marginTop: 16 }}>
            <thead><tr><th>#</th><th>Part number</th><th>Description</th><th>Qty</th></tr></thead>
            <tbody>{data.lines.map((l: any) => <tr key={l.id}><td>{l.line_no}</td><td className="mono">{l.part_code ?? ""}</td><td>{l.description}</td><td>{l.qty}</td></tr>)}</tbody>
          </table>
        ) : (
          <table className="mini" style={{ marginTop: 16 }}>
            <thead><tr><th>Pieces</th><th>Type</th><th>Weight (lb)</th><th>Dimensions (in)</th><th>Class</th><th>Description</th></tr></thead>
            <tbody>
              {s.packages.map((p: Package, i: number) => (
                <tr key={i}><td>{p.count}</td><td>{PACKAGE_LABEL[p.type]}</td><td>{p.weight ? p.weight * p.count : ""}</td><td>{p.length && p.width && p.height ? `${p.length} × ${p.width} × ${p.height}` : ""}</td><td>{s.freight_class ?? ""}</td><td>{i === 0 ? (s.kind === "machine" ? `Packaging machinery${s.machine ? ` (${s.machine})` : ""}` : "Machine parts") : ""}</td></tr>
              ))}
              <tr><td><b>{data.totals.pieces}</b></td><td /><td><b>{data.totals.weight || ""}</b></td><td colSpan={3} /></tr>
            </tbody>
          </table>
        )}
        {kind === "bol" && (
          <>
            {!!s.freight_options.length && <p>Special services: {s.freight_options.map((o: string) => FREIGHT_LABEL[o as keyof typeof FREIGHT_LABEL] ?? o).join(", ")}</p>}
            {s.notes && <p style={{ whiteSpace: "pre-wrap" }}>Special instructions: {s.notes}</p>}
            <p className="small1">Received, subject to the classifications and tariffs in effect on the date of issue of this bill of lading, the property described above in apparent good order, except as noted.</p>
            <div className="grid g3 sign">
              <div>Shipper signature / date</div><div>Carrier signature / pickup date</div><div>Consignee signature / delivery date</div>
            </div>
          </>
        )}
        {kind === "packing" && (
          <p className="small1" style={{ marginTop: 16 }}>{data.totals.pieces ? `${data.totals.pieces} piece(s)${data.totals.weight ? `, ${data.totals.weight} lb total` : ""}. ` : ""}Questions about this shipment? Contact Ronchi America and quote {s.number}.</p>
        )}
      </div>
    </div>
  );
}

// ---- Make or change a shipment ----

const EMPTY_LINE = { id: null as string | null, part_code: "", description: "", qty: "1", source_type: null as string | null, source_id: null as string | null };

export function NewShipment() {
  const p = useMemo(takePending, []);
  const pre = useLoad(() => api(`/shipping/prefill${p.source && p.id ? `?source=${encodeURIComponent(p.source)}&id=${encodeURIComponent(p.id)}` : ""}`), []);
  if (pre.error) return <ErrorNote error={pre.error} />;
  if (!pre.data) return null;
  const { label, ...start } = pre.data;
  return <ShipmentForm shipment={null} start={{ direction: p.direction ?? "out", ...start }} forWhat={label} onDone={(id) => navigate(id ? `/shipping/${id}` : "/shipping")} />;
}

export function ShipmentForm({ shipment, start, forWhat, onDone }: { shipment: any | null; start?: any; forWhat?: string | null; onDone: (id: string | null) => void }) {
  const init = shipment ?? start ?? {};
  const [f, setF] = useState<any>(() => ({
    direction: init.direction ?? "out", kind: init.kind ?? (init.direction === "in" ? "from_italy" : "spare_parts"), status: init.status ?? "",
    party: init.party ?? "", machine: init.machine ?? "", reference: init.reference ?? "", address: init.address ?? "", origin: init.origin ?? "",
    contact_name: init.contact_name ?? "", contact_phone: init.contact_phone ?? "", contact_email: init.contact_email ?? "",
    carrier: init.carrier ?? "", carrier_other: init.carrier_other ?? "", service: init.service ?? "", tracking: init.tracking ?? "", bol_number: init.bol_number ?? "",
    freight_class: init.freight_class ?? "", freight_options: init.freight_options ?? [], planned_date: init.planned_date ?? "",
    mode: init.mode ?? "", vessel: init.vessel ?? "", container: init.container ?? "", broker: init.broker ?? "", notes: init.notes ?? "",
    packages: (init.packages ?? []).map((p: any) => ({ ...p, weight: p.weight ?? "", length: p.length ?? "", width: p.width ?? "", height: p.height ?? "" })),
    lines: (init.lines ?? []).map((l: any) => ({ ...EMPTY_LINE, ...l, part_code: l.part_code ?? "", qty: String(l.qty) })),
  }));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const out = f.direction === "out";
  const freight = out && (f.kind === "machine" || CARRIERS.find((c) => c.id === f.carrier)?.freight);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const body: any = {
      ...f,
      packages: f.packages.map((p: any) => ({ type: p.type, count: Number(p.count), weight: p.weight === "" ? null : Number(p.weight), length: p.length === "" ? null : Number(p.length), width: p.width === "" ? null : Number(p.width), height: p.height === "" ? null : Number(p.height) })),
      lines: f.lines.filter((l: any) => l.description.trim() || l.part_code.trim()).map((l: any) => ({ ...l, qty: Number(l.qty) })),
    };
    if (!body.status) delete body.status;
    try {
      if (shipment) {
        delete body.direction;
        await api(`/shipping/${encodeURIComponent(shipment.id)}`, { method: "PATCH", body: { ...body, revision: shipment.revision } });
        toast(t("Saved"));
        onDone(shipment.id);
      } else {
        if (start?.source_type) Object.assign(body, { source_type: start.source_type, source_id: start.source_id });
        const r = await api("/shipping", { body });
        toast(t("Saved as {number}", { number: r.number }));
        onDone(r.id);
      }
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const text = (k: string, label: string, opts: { required?: boolean; type?: string; placeholder?: string; mono?: boolean; wide?: boolean; rows?: number } = {}) => (
    <div className="field" style={opts.wide ? { gridColumn: "1 / -1" } : undefined}>
      <label htmlFor={`s-${k}`}>{label}{opts.required && " *"}</label>
      {opts.rows ? <textarea id={`s-${k}`} rows={opts.rows} value={f[k]} placeholder={opts.placeholder} onChange={(e) => set(k, e.target.value)} />
        : <input id={`s-${k}`} type={opts.type ?? "text"} value={f[k]} required={opts.required} placeholder={opts.placeholder} className={opts.mono ? "mono" : undefined} onChange={(e) => set(k, e.target.value)} />}
    </div>
  );
  const setPkg = (i: number, k: string, v: unknown) => set("packages", f.packages.map((p: any, j: number) => (j === i ? { ...p, [k]: v } : p)));
  const setLine = (i: number, k: string, v: unknown) => set("lines", f.lines.map((l: any, j: number) => (j === i ? { ...l, [k]: v } : l)));
  const first = f.packages[0];
  const suggested = first ? freightClass(Number(first.weight) || null, Number(first.length) || null, Number(first.width) || null, Number(first.height) || null) : null;
  const totals = packageTotals(f.packages.filter((p: any) => Number(p.count) > 0).map((p: any) => ({ ...p, count: Number(p.count), weight: Number(p.weight) || null })));

  return (
    <>
      <PageHead title={shipment ? t("Edit {number}", { number: shipment.number }) : out ? t("New shipment") : t("Expect a delivery")} sub={forWhat ? t("For: {what}", { what: forWhat }) : undefined} />
      <form className="stack" onSubmit={save}>
        <div className="panel grid g2">
          {!shipment && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <div className="seg" role="radiogroup" aria-label={t("Direction")}>
                {(["out", "in"] as const).map((d) => <button key={d} type="button" role="radio" aria-checked={f.direction === d} className={f.direction === d ? "on" : ""} onClick={() => setF((x: any) => ({ ...x, direction: d, kind: KINDS[d][0] }))}>{d === "out" ? t("Going out (ship)") : t("Coming in (receive)")}</button>)}
              </div>
            </div>
          )}
          <div className="field">
            <label htmlFor="s-kind">{t("What is it")}</label>
            <select id="s-kind" value={f.kind} onChange={(e) => set("kind", e.target.value)}>{KINDS[f.direction as Direction].map((k) => <option key={k} value={k}>{t(KIND_LABEL[k] ?? k)}</option>)}</select>
          </div>
          {shipment && (
            <div className="field">
              <label htmlFor="s-status">{t("Status")}</label>
              <select id="s-status" value={f.status} onChange={(e) => set("status", e.target.value)}>{statusesFor(f.direction).map((k) => <option key={k} value={k}>{t(STATUS_LABEL[k])}</option>)}</select>
            </div>
          )}
          {text("party", out ? t("Customer") : t("Supplier or sender"), { required: true })}
          {text("machine", t("Machine number"), { mono: true, placeholder: "4110MB" })}
          {text("reference", out ? t("Customer PO or reference") : t("PO, RMA or Italy order number"), { mono: true })}
          {text("planned_date", out ? t("Ship by") : t("Expected"), { type: "date" })}
          {text("address", out ? t("Ship to address") : t("Ship from address"), { wide: true, rows: 3 })}
          {out && text("origin", t("Ship from (our dock)"), { wide: true, rows: 2, placeholder: t("Kept from the last shipment") })}
        </div>
        <div className="panel grid g3">
          <h2 style={{ gridColumn: "1 / -1", margin: 0 }}>{out ? t("Contact at delivery") : t("Contact")}</h2>
          {text("contact_name", t("Name"))}
          {text("contact_phone", t("Phone"), { type: "tel" })}
          {text("contact_email", t("Email"), { type: "email" })}
        </div>
        <div className="panel grid g3">
          <h2 style={{ gridColumn: "1 / -1", margin: 0 }}>{t("Carrier and tracking")}</h2>
          <div className="field"><label htmlFor="s-carrier">{t("Carrier")}</label><CarrierSelect id="s-carrier" value={f.carrier} onChange={(v) => set("carrier", v)} /></div>
          {f.carrier === "other" ? text("carrier_other", t("Carrier name")) : text("service", t("Service"), { placeholder: t("Ground, 2nd Day Air, LTL standard…") })}
          {text("tracking", t("Tracking or PRO numbers"), { mono: true, placeholder: t("One per package") })}
          {text("bol_number", out ? t("Bill of lading number") : t("Bill of lading or air waybill"), { mono: true })}
          {!out && (
            <>
              <div className="field"><label htmlFor="s-mode">{t("How it travels")}</label><select id="s-mode" value={f.mode} onChange={(e) => set("mode", e.target.value)}><option value="">–</option>{MODES.map((m) => <option key={m} value={m}>{t(MODE_LABEL[m])}</option>)}</select></div>
              {text("vessel", t("Vessel or flight"))}
              {text("container", t("Container"), { mono: true })}
              {text("broker", t("Customs broker"))}
            </>
          )}
        </div>
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>{t("Packages")}</h2>
          {f.packages.map((p: any, i: number) => (
            <div key={i} className="row pkgrow">
              <input type="number" min={1} style={{ width: 64 }} value={p.count} onChange={(e) => setPkg(i, "count", e.target.value)} aria-label={t("How many")} />
              <select value={p.type} onChange={(e) => setPkg(i, "type", e.target.value)} aria-label={t("Package type")}>{PACKAGE_TYPES.map((x) => <option key={x} value={x}>{t(PACKAGE_LABEL[x])}</option>)}</select>
              <input type="number" min={0} step="0.1" style={{ width: 90 }} value={p.weight} placeholder={t("lb each")} onChange={(e) => setPkg(i, "weight", e.target.value)} aria-label={t("Weight of each, in pounds")} />
              <input type="number" min={0} style={{ width: 64 }} value={p.length} placeholder="L in" onChange={(e) => setPkg(i, "length", e.target.value)} aria-label={t("Length in inches")} />
              <input type="number" min={0} style={{ width: 64 }} value={p.width} placeholder="W in" onChange={(e) => setPkg(i, "width", e.target.value)} aria-label={t("Width in inches")} />
              <input type="number" min={0} style={{ width: 64 }} value={p.height} placeholder="H in" onChange={(e) => setPkg(i, "height", e.target.value)} aria-label={t("Height in inches")} />
              <button type="button" className="linkish" onClick={() => set("packages", f.packages.filter((_: any, j: number) => j !== i))}>{t("Remove")}</button>
            </div>
          ))}
          <div className="row">
            <button type="button" className="btn small" onClick={() => set("packages", [...f.packages, { type: f.kind === "machine" ? "crate" : "box", count: 1, weight: "", length: "", width: "", height: "" }])}>{t("Add a package")}</button>
            {totals.pieces > 0 && <span className="muted">{pieces(totals.pieces)}{totals.weight ? ` · ${totals.weight} lb` : ""}</span>}
          </div>
          {freight && (
            <div className="grid g2">
              <div className="stack" style={{ gap: 4 }}>
                {text("freight_class", t("Freight class"), { placeholder: suggested ?? "85" })}
                {suggested && suggested !== f.freight_class && <button type="button" className="linkish small1" style={{ alignSelf: "flex-start" }} onClick={() => set("freight_class", suggested)}>{t("Use class {n} (from the first package's weight and size; check with the carrier)", { n: suggested })}</button>}
              </div>
              <div className="field">
                <span className="label">{t("Freight extras")}</span>
                <div className="row" style={{ gap: 10 }}>
                  {FREIGHT_OPTIONS.map((o) => (
                    <label key={o} className="row" style={{ gap: 4 }}><input type="checkbox" checked={f.freight_options.includes(o)} onChange={(e) => set("freight_options", e.target.checked ? [...f.freight_options, o] : f.freight_options.filter((x: string) => x !== o))} />{t(FREIGHT_LABEL[o])}</label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>{out ? t("What's in it") : t("What's coming")}</h2>
          {f.lines.map((l: any, i: number) => (
            <div key={l.id ?? `n${i}`} className="row pkgrow">
              <input className="mono" style={{ width: 130 }} value={l.part_code} placeholder={t("Part number")} onChange={(e) => setLine(i, "part_code", e.target.value)} aria-label={t("Part number")} />
              <input style={{ flex: 1, minWidth: 160 }} value={l.description} placeholder={t("Description")} onChange={(e) => setLine(i, "description", e.target.value)} aria-label={t("Description")} />
              <input type="number" min={1} style={{ width: 70 }} value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} aria-label={t("Qty")} />
              <button type="button" className="linkish" onClick={() => set("lines", f.lines.filter((_: any, j: number) => j !== i))}>{t("Remove")}</button>
            </div>
          ))}
          <div><button type="button" className="btn small" onClick={() => set("lines", [...f.lines, { ...EMPTY_LINE }])}>{t("Add an item")}</button></div>
        </div>
        <div className="panel">{text("notes", t("Notes"), { rows: 4, placeholder: t("Dock hours, special handling, anything the next person should know.") })}</div>
        <ErrorNote error={err} />
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy}>{t("Save")}</button>
          <button className="btn" type="button" onClick={() => onDone(shipment?.id ?? null)}>{t("Cancel")}</button>
        </div>
      </form>
    </>
  );
}
