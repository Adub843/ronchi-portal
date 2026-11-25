// Shipping and receiving (/shipping).
//   /shipping                    tiles, then incoming and outgoing shipments (search, or scan a label)
//   /shipping/in/new             expect a shipment (from Ronchi Italy or another supplier)
//   /shipping/in/<id>            one incoming shipment: customs, receive in parts, problems with photos
//   /shipping/out/new            a new outgoing shipment (parts order, change-part order, or other)
//   /shipping/ship/<orderId>     a new outgoing shipment from that parts order
//   /shipping/out/<id>           one outgoing shipment: to pick → packed → shipped → delivered
//   /shipping/out/<id>/slip      its packing slip, ready to print (no prices: the portal has no money)
//   /shipping/carriers           carriers and their tracking links
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CUSTOMS, CUSTOMS_LABELS, IN_MODE_LABELS, IN_MODES, IN_STAGE_LABELS, IN_STAGES, ISSUE_KINDS, ISSUE_LABELS, OUT_LABELS, templateProblem, trackingHint, trackingUrl,
  type Customs, type InStage, type IssueKind,
} from "../../../src/shared/shipping";
import { api, can, fmtTime, type Me } from "../api";
import { shortDay, todayLocal } from "../components/dates";
import { downloadCsv, FileBox } from "../components/FileBox";
import { History, ShipPill } from "../components/orders";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad } from "../components/ui";
import { t } from "../i18n";
import { navigate } from "../router";

const enc = encodeURIComponent;

export function Shipping({ me, path }: { me: Me; path: string }) {
  const p = path.split("/").filter(Boolean); // ["shipping", ...]
  if (p[1] === "carriers") return <Carriers me={me} />;
  if (p[1] === "in" && p[2] === "new") return <NewInbound me={me} />;
  if (p[1] === "in" && p[2]) return <InboundPage key={p[2]} id={p[2]} me={me} />;
  if (p[1] === "out" && p[2] === "new") return <NewOutbound me={me} />;
  if (p[1] === "ship" && p[2]) return <NewOutbound me={me} orderId={p[2]} />;
  if (p[1] === "out" && p[2] && p[3] === "slip") return <PackingSlip key={p[2]} id={p[2]} me={me} />;
  if (p[1] === "out" && p[2]) return <OutboundPage key={p[2]} id={p[2]} me={me} />;
  return <Dashboard me={me} tab={p[1] === "incoming" ? "in" : "out"} />;
}

interface Carrier { id: string; name: string; mode: string; url_template: string | null; checked: number; active: number; updated_by?: string | null; updated_at?: string | null }
function useCarriers() {
  return useLoad<{ carriers: Carrier[] }>(() => api("/shipping/carriers"));
}

function TrackLink({ url, n }: { url: string | null | undefined; n: string | null | undefined }) {
  if (!n) return <span className="muted">–</span>;
  return url ? <a href={url} target="_blank" rel="noopener noreferrer" className="mono" title={t("Open the carrier's tracking page")}>{n}</a> : <span className="mono">{n}</span>;
}

function InPills({ s }: { s: { shown: string; customs_status: string; open_issues: number } }) {
  const cls = s.shown === "Received" ? "p-ok" : s.shown === "Cancelled" ? "p-mute" : s.shown === "Partly received" ? "p-warn" : "p-info";
  return (
    <span className="po-pills">
      <span className={`pill ${cls}`}>{t(s.shown)}</span>
      {s.customs_status === "held" && <span className="pill p-acc">{t("Held at customs")}</span>}
      {s.open_issues > 0 && <span className="pill p-warn">{t("Problems: {n}", { n: s.open_issues })}</span>}
    </span>
  );
}

// ---------- scanning ----------

/** The browser's own barcode reader (Chrome and Edge on Android, Windows and Mac). Elsewhere the button doesn't show: type the number instead. */
function ScanButton({ onCode }: { onCode: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;
  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stop || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const Detector = (window as unknown as { BarcodeDetector: new () => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        const detector = new Detector();
        const look = async () => {
          if (stop || !video.current) return;
          const found = await detector.detect(video.current).catch(() => []);
          const code = found[0]?.rawValue?.trim();
          if (code) { onCode(code.slice(0, 80)); setOpen(false); return; }
          timer = window.setTimeout(look, 250);
        };
        look();
      } catch {
        toast(t("The camera couldn't start. Type the number instead."));
        setOpen(false);
      }
    })();
    return () => { stop = true; window.clearTimeout(timer); stream?.getTracks().forEach((tr) => tr.stop()); };
  }, [open, onCode]);
  if (!supported) return null;
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(!open)}>{open ? t("Stop scanning") : t("Scan")}</button>
      {open && (
        <div className="panel sh-scan">
          <video ref={video} muted playsInline aria-label={t("Camera")} />
          <span className="muted">{t("Point the camera at the barcode or QR code on the label.")}</span>
        </div>
      )}
    </>
  );
}

// ---------- the dashboard ----------

type Tile = "arriving" | "lateIn" | "toShip" | "shippedWeek" | "transit" | null;

function Dashboard({ me, tab: start }: { me: Me; tab: "in" | "out" }) {
  const { data, error } = useLoad<{ inbound: any[]; outbound: any[]; kpis: any }>(() => api("/shipping"));
  const [tab, setTab] = useState<"in" | "out">(start);
  const [tile, setTile] = useState<Tile>(null);
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(false);
  const k = data?.kpis;
  const today = todayLocal();
  const weekStart = (() => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
  const in7 = (() => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const inbound = useMemo(() => (data?.inbound ?? []).filter((s) => {
    const open = s.shown !== "Received" && s.shown !== "Cancelled";
    if (tile === "arriving" && !(open && s.shown !== "Partly received" && s.expected_date && s.expected_date >= today && s.expected_date <= in7)) return false;
    if (tile === "lateIn" && !(open && !["Arrived", "Partly received"].includes(s.shown) && s.expected_date && s.expected_date < today)) return false;
    if (!tile && !showDone && !words.length && !open) return false;
    return match([s.number, s.supplier, s.reference, s.tracking, s.carrier].join(" "));
  }), [data, tile, q, showDone]);
  const outbound = useMemo(() => (data?.outbound ?? []).filter((s) => {
    if (tile === "toShip" && !((s.status === "to_pick" || s.status === "packed") && (!s.ship_date || s.ship_date <= today))) return false;
    if (tile === "shippedWeek" && !((s.status === "shipped" || s.status === "delivered") && s.ship_date >= weekStart && s.ship_date <= today)) return false;
    if (tile === "transit" && s.status !== "shipped") return false;
    if (!tile && !showDone && !words.length && (s.status === "delivered" || s.status === "cancelled")) return false;
    return match([s.number, s.customer, s.order_number, s.order_po, s.tracking, s.carrier].join(" "));
  }), [data, tile, q, showDone]);

  const tiles: { id: Exclude<Tile, null>; tab: "in" | "out"; n: number | undefined; l: string; warn?: boolean }[] = [
    { id: "arriving", tab: "in", n: k?.arrivingThisWeek, l: t("Arriving this week") },
    { id: "lateIn", tab: "in", n: k?.lateInbound, l: t("Late coming in"), warn: true },
    { id: "toShip", tab: "out", n: k?.toShipToday, l: t("To ship today"), warn: true },
    { id: "shippedWeek", tab: "out", n: k?.shippedThisWeek, l: t("Shipped this week") },
    { id: "transit", tab: "out", n: k?.inTransit, l: t("In transit") },
  ];

  return (
    <>
      <PageHead title={t("Shipping and receiving")} sub={t("What is coming in from Italy and suppliers, and what is going out to customers.")} tip="shipping.head">
        <button className="btn" onClick={() => downloadCsv(`/shipping/export?kind=${tab}`, `${tab === "in" ? "incoming" : "outgoing"}-shipments-${today}.csv`)}>{t("Export CSV")}</button>
        <Link to="/shipping/carriers" className="btn">{t("Carriers")}</Link>
        {can(me, "ship.edit") && <Link to="/shipping/in/new" className="btn">{t("Expect a shipment")}</Link>}
        {can(me, "ship.edit") && <Link to="/shipping/out/new" className="btn primary">{t("New shipment")}</Link>}
      </PageHead>
      <ErrorNote error={error} />
      <div className="cp-tiles five">
        {tiles.map((x) => (
          <button key={x.id} type="button" className={`panel cp-tile${tile === x.id ? " on" : ""}${x.warn && x.n ? " warn" : ""}`} aria-pressed={tile === x.id} onClick={() => { setTile(tile === x.id ? null : x.id); setTab(x.tab); }}>
            <span className="n">{x.n ?? "–"}</span><span className="l">{x.l}</span>
          </button>
        ))}
      </div>
      {!!k && (k.heldAtCustoms > 0 || k.openIssues > 0) && (
        <p className="sh-alert" role="status">
          {k.heldAtCustoms > 0 && <span>{t("Held at customs: {n}", { n: k.heldAtCustoms })}</span>}
          {k.openIssues > 0 && <span>{t("Receiving problems still open: {n}", { n: k.openIssues })}</span>}
        </p>
      )}
      <div className="row cp-filters">
        <div className="row cp-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "out"} className={`btn${tab === "out" ? " primary" : ""}`} onClick={() => setTab("out")}>{t("Outgoing")}</button>
          <button type="button" role="tab" aria-selected={tab === "in"} className={`btn${tab === "in" ? " primary" : ""}`} onClick={() => setTab("in")}>{t("Incoming")}</button>
        </div>
        <input className="panel" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === "in" ? t("Search number, supplier, reference or tracking") : t("Search number, customer, order, PO or tracking")} aria-label={t("Search shipments")} />
        <ScanButton onCode={(code) => { setQ(code); setTile(null); }} />
        <label className="row sh-done"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> {tab === "in" ? t("Show received") : t("Show delivered")}</label>
      </div>
      {tile && <p className="muted">{t("Showing: {what}.", { what: tiles.find((x) => x.id === tile)!.l })} <button className="linkish" onClick={() => setTile(null)}>{t("Show all")}</button></p>}
      <div className="panel tbl">
        {tab === "in" ? (
          <>
            {data && !inbound.length && <Empty>{data.inbound.length ? t("Nothing matches.") : t("No incoming shipments yet. When Italy or a supplier ships, add it with Expect a shipment.")}</Empty>}
            {!!inbound.length && (
              <table className="cp-table">
                <thead><tr><th>{t("Number")}</th><th>{t("Supplier")}</th><th className="hide-sm">{t("Carrier")}</th><th className="hide-sm">{t("Tracking")}</th><th>{t("Expected")}</th><th>{t("Status")}</th><th className="hide-sm num">{t("Received")}</th></tr></thead>
                <tbody>
                  {inbound.map((s) => (
                    <tr key={s.id}>
                      <td className="nowrap"><Link to={`/shipping/in/${s.id}`} className="mono">{s.number}</Link></td>
                      <td>{s.supplier}{s.reference && <small className="muted po-sub">{s.reference}</small>}</td>
                      <td className="hide-sm">{s.carrier ?? t(IN_MODE_LABELS[s.mode as keyof typeof IN_MODE_LABELS] ?? "Other")}</td>
                      <td className="hide-sm"><TrackLink url={s.tracking_url} n={s.tracking} /></td>
                      <td className="nowrap">{s.expected_date ? <span className={s.expected_date < today && !["Arrived", "Partly received", "Received", "Cancelled"].includes(s.shown) ? "pill p-acc" : ""}>{shortDay(s.expected_date)}</span> : "–"}</td>
                      <td><InPills s={s} /></td>
                      <td className="hide-sm num nowrap">{s.qty_received} / {s.qty_expected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <>
            {data && !outbound.length && <Empty>{data.outbound.length ? t("Nothing matches.") : t("Nothing shipped yet. Open a booked parts order and press Ship, or press New shipment.")}</Empty>}
            {!!outbound.length && (
              <table className="cp-table">
                <thead><tr><th>{t("Number")}</th><th>{t("Customer")}</th><th className="hide-sm">{t("Carrier")}</th><th className="hide-sm">{t("Tracking")}</th><th className="hide-sm">{t("Ship date")}</th><th>{t("Status")}</th><th className="hide-sm num">{t("Qty")}</th></tr></thead>
                <tbody>
                  {outbound.map((s) => (
                    <tr key={s.id}>
                      <td className="nowrap"><Link to={`/shipping/out/${s.id}`} className="mono">{s.number}</Link></td>
                      <td>{s.customer}{(s.order_number || s.source === "change_part") && <small className="muted po-sub">{s.order_number ?? t("Change parts")}</small>}</td>
                      <td className="hide-sm">{[s.carrier, s.service].filter(Boolean).join(" ") || "–"}</td>
                      <td className="hide-sm"><TrackLink url={s.tracking_url} n={s.tracking} /></td>
                      <td className="hide-sm nowrap">{shortDay(s.ship_date)}</td>
                      <td><ShipPill status={s.status} /></td>
                      <td className="hide-sm num">{s.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ---------- typed lines (incoming, and outgoing that isn't from a parts order) ----------

interface TypedLine { id?: string; part_code: string; description: string; qty: string; min?: number }
const blank = (): TypedLine => ({ part_code: "", description: "", qty: "1" });
const typedBody = (lines: TypedLine[]) => lines.filter((l) => l.part_code.trim() || l.description.trim()).map((l) => ({ id: l.id, part_code: l.part_code, description: l.description, qty: Number(l.qty), qty_expected: Number(l.qty) }));

function TypedLines({ lines, setLines }: { lines: TypedLine[]; setLines: (l: TypedLine[]) => void }) {
  const set = (i: number, patch: Partial<TypedLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="po-lines-edit">
      <div className="po-line three head" aria-hidden="true"><span>{t("Part code")}</span><span>{t("Description")}</span><span>{t("Qty")}</span><span /></div>
      {lines.map((l, i) => (
        <div className="po-line three" key={l.id ?? `n${i}`}>
          <input className="code mono" value={l.part_code} onChange={(e) => set(i, { part_code: e.target.value })} placeholder={t("Part code")} aria-label={t("Line {n} part code", { n: i + 1 })} maxLength={60} />
          <input className="desc" value={l.description} onChange={(e) => set(i, { description: e.target.value })} placeholder={t("Description")} aria-label={t("Line {n} description", { n: i + 1 })} maxLength={300} />
          <input className="qty" type="number" min={Math.max(1, l.min ?? 0)} max={100000} step={1} inputMode="numeric" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} aria-label={t("Line {n} quantity", { n: i + 1 })} />
          <button type="button" className="linkish x" disabled={(l.min ?? 0) > 0} aria-label={t("Remove line {n}", { n: i + 1 })} onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div><button type="button" className="btn small" onClick={() => setLines([...lines, blank()])}>{t("Add line")}</button></div>
    </div>
  );
}

function CarrierSelect({ id, value, onChange, carriers }: { id: string; value: string; onChange: (v: string) => void; carriers: Carrier[] }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("Not chosen yet")}</option>
      {carriers.filter((c) => c.active || c.id === value).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

// ---------- incoming ----------

function NewInbound({ me }: { me: Me }) {
  const carriers = useCarriers();
  const [f, setF] = useState<Record<string, string>>({ supplier: "", mode: "courier", customs_status: "pending", carrier_id: "" });
  const [lines, setLines] = useState<TypedLine[]>([blank()]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!can(me, "ship.edit")) return <ErrorNote error="Your role doesn't allow this." />;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ id: string; hint: string | null }>("/shipping/inbound", { body: { ...f, carrier_id: f.carrier_id || null, lines: typedBody(lines) } });
      toast(r.hint ? t(r.hint) : t("Added"));
      navigate(`/shipping/in/${r.id}`);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const input = (k: string, lbl: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field"><label htmlFor={`ni-${k}`}>{lbl}</label><input id={`ni-${k}`} value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></div>
  );
  return (
    <>
      <PageHead title={t("Expect a shipment")} sub={t("Parts or machines on their way to us. Receive them here when they arrive.")} />
      <form className="stack" onSubmit={save}>
        <div className="panel grid g3 cp-form">
          {input("supplier", t("Supplier"), { required: true, autoFocus: true, placeholder: "Ronchi Mario S.p.A.", maxLength: 200 })}
          {input("reference", t("Their order or our PO"), { maxLength: 80 })}
          <div className="field"><label htmlFor="ni-mode">{t("Shipped by")}</label>
            <select id="ni-mode" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{IN_MODES.map((m) => <option key={m} value={m}>{t(IN_MODE_LABELS[m])}</option>)}</select>
          </div>
          <div className="field"><label htmlFor="ni-carrier">{t("Carrier")}</label><CarrierSelect id="ni-carrier" value={f.carrier_id ?? ""} onChange={(v) => setF({ ...f, carrier_id: v })} carriers={carriers.data?.carriers ?? []} /></div>
          {input("tracking", t("Tracking, container or bill of lading number"), { maxLength: 60, className: "mono" })}
          {input("expected_date", t("Expected"), { type: "date" })}
          <div className="field"><label htmlFor="ni-customs">{t("Customs")}</label>
            <select id="ni-customs" value={f.customs_status} onChange={(e) => setF({ ...f, customs_status: e.target.value })}>{CUSTOMS.map((c) => <option key={c} value={c}>{t(CUSTOMS_LABELS[c])}</option>)}</select>
          </div>
          {input("broker", t("Customs broker"), { maxLength: 120 })}
        </div>
        <div className="panel">
          <h2>{t("What's coming")}</h2>
          <TypedLines lines={lines} setLines={setLines} />
        </div>
        <ErrorNote error={err} />
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy}>{t("Add shipment")}</button>
          <Link to="/shipping/incoming" className="btn">{t("Cancel")}</Link>
        </div>
      </form>
    </>
  );
}

type InPanel = null | "edit" | "receive" | "issue" | "lines";

function InboundPage({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useLoad<any>(() => api(`/shipping/inbound/${enc(id)}`), [id]);
  const carriers = useCarriers();
  const [panel, setPanel] = useState<InPanel>(null);
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const s = data.inbound;
  const edit = can(me, "ship.edit");
  const open = s.shown !== "Received" && s.shown !== "Cancelled";
  const done = () => { setPanel(null); reload(); };
  return (
    <>
      <PageHead title={s.number} sub={[s.supplier, s.reference].filter(Boolean).join(" · ")}>
        <InPills s={s} />
        {edit && !panel && open && <button className="btn primary" onClick={() => setPanel("receive")}>{t("Receive")}</button>}
        {edit && !panel && <button className="btn" onClick={() => setPanel("issue")}>{t("Write down a problem")}</button>}
        {edit && !panel && <button className="btn" onClick={() => setPanel("edit")}>{t("Edit")}</button>}
      </PageHead>
      {panel === "receive" && <ReceivePanel s={s} lines={data.lines} onDone={done} onCancel={() => setPanel(null)} />}
      {panel === "issue" && <IssuePanel s={s} lines={data.lines} onDone={done} onCancel={() => setPanel(null)} />}
      {panel === "edit" ? (
        <InboundForm s={s} carriers={carriers.data?.carriers ?? []} onDone={done} onCancel={() => setPanel(null)} />
      ) : (
        <div className="grid g2">
          <div className="panel">
            <h2>{t("Shipment")}</h2>
            <dl className="po-dl">
              <div><dt>{t("Shipped by")}</dt><dd>{t(IN_MODE_LABELS[s.mode as keyof typeof IN_MODE_LABELS] ?? "Other")}{s.carrier ? ` · ${s.carrier}` : ""}</dd></div>
              <div><dt>{t("Tracking")}</dt><dd><TrackLink url={s.tracking_url} n={s.tracking} /></dd></div>
              <div><dt>{t("Expected")}</dt><dd>{shortDay(s.expected_date)}</dd></div>
              <div><dt>{t("Stage")}</dt><dd>{t(IN_STAGE_LABELS[s.stage as InStage])}</dd></div>
              {s.received_at && <div><dt>{t("All received")}</dt><dd>{fmtTime(s.received_at)}</dd></div>}
            </dl>
            {s.notes && <p className="pre">{s.notes}</p>}
          </div>
          <div className="panel">
            <h2>{t("Customs")}</h2>
            <dl className="po-dl">
              <div><dt>{t("Status")}</dt><dd><span className={`pill ${s.customs_status === "held" ? "p-acc" : s.customs_status === "released" ? "p-ok" : s.customs_status === "pending" ? "p-warn" : "p-mute"}`}>{t(CUSTOMS_LABELS[s.customs_status as Customs])}</span></dd></div>
              <div><dt>{t("Customs broker")}</dt><dd>{s.broker ?? "–"}</dd></div>
            </dl>
            {s.customs_notes ? <p className="pre">{s.customs_notes}</p> : <p className="muted">{t("No broker notes.")}</p>}
          </div>
        </div>
      )}
      <div className="panel">
        <div className="row po-head">
          <h2>{t("Lines")}</h2>
          <span className="spacer" />
          {edit && !panel && <button className="btn small" onClick={() => setPanel("lines")}>{t("Change lines")}</button>}
        </div>
        {panel === "lines" ? <InLinesForm s={s} lines={data.lines} onDone={done} onCancel={() => setPanel(null)} /> : data.lines.length ? (
          <div className="tbl">
            <table className="po-lines">
              <thead><tr><th>#</th><th>{t("Part code")}</th><th>{t("Description")}</th><th className="num">{t("Expected")}</th><th className="num">{t("Received")}</th><th className="num hide-sm">{t("Still to come")}</th><th className="hide-sm">{t("Bin")}</th></tr></thead>
              <tbody>
                {data.lines.map((l: any) => (
                  <tr key={l.id}>
                    <td className="muted">{l.line_no}</td>
                    <td className="mono nowrap">{l.part_code ?? "–"}</td>
                    <td>{l.description ?? "–"}</td>
                    <td className="num">{l.qty_expected}</td>
                    <td className="num">{l.qty_good}{l.qty_damaged ? <span className="muted"> {t("+{n} damaged", { n: l.qty_damaged })}</span> : ""}</td>
                    <td className="num hide-sm">{l.open || ""}</td>
                    <td className="mono hide-sm">{l.bin ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{t("No lines yet. Add what's on the packing list.")}</Empty>}
      </div>
      <Issues me={me} s={s} issues={data.issues} files={data.files} onChange={reload} />
      <div className="grid g2">
        <div className="panel">
          <h2>{t("Paperwork and photos")}</h2>
          <FileBox me={me} base="/shipping" uploadTo={`/shipping/inbound/${enc(s.id)}/files`} files={data.files.filter((f: any) => !f.issue_id)} canEdit={edit} onChange={reload} empty={t("No files yet. Add the packing list, bill of lading or customs papers.")} />
        </div>
        <div className="panel">
          <h2>{t("Received so far")}</h2>
          {data.receipts.length ? (
            <ul className="cp-history">
              {data.receipts.map((r: any, i: number) => (
                <li key={i}><span className="muted">{fmtTime(r.at)}</span> <strong>{r.by_name ?? t("Someone")}</strong> · {t("Line {n}", { n: r.line_no })} <span className="mono">{r.part_code ?? ""}</span>: {t("{n} good", { n: r.qty })}{r.damaged ? `, ${t("{n} damaged", { n: r.damaged })}` : ""}{r.bin ? <> → <span className="mono">{r.bin}</span></> : null}</li>
              ))}
            </ul>
          ) : <Empty>{t("Nothing received yet.")}</Empty>}
        </div>
      </div>
      <History items={data.history} />
    </>
  );
}

function InboundForm({ s, carriers, onDone, onCancel }: { s: any; carriers: Carrier[]; onDone: () => void; onCancel: () => void }) {
  const keys = ["supplier", "reference", "mode", "carrier_id", "tracking", "expected_date", "stage", "customs_status", "broker", "customs_notes", "notes"];
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, s[k] ?? ""])));
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const r = await api<{ hint: string | null }>(`/shipping/inbound/${enc(s.id)}`, { method: "PATCH", body: { ...f, carrier_id: f.carrier_id || null, revision: s.revision } });
      toast(r.hint ? t(r.hint) : t("Saved"));
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  const input = (k: string, lbl: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field"><label htmlFor={`ie-${k}`}>{lbl}</label><input id={`ie-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></div>
  );
  const area = (k: string, lbl: string) => (
    <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor={`ie-${k}`}>{lbl}</label><textarea id={`ie-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} maxLength={k === "notes" ? 5000 : 2000} /></div>
  );
  return (
    <form className="panel grid g3 cp-form" onSubmit={save}>
      {input("supplier", t("Supplier"), { required: true, maxLength: 200 })}
      {input("reference", t("Their order or our PO"), { maxLength: 80 })}
      <div className="field"><label htmlFor="ie-mode">{t("Shipped by")}</label><select id="ie-mode" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{IN_MODES.map((m) => <option key={m} value={m}>{t(IN_MODE_LABELS[m])}</option>)}</select></div>
      <div className="field"><label htmlFor="ie-carrier">{t("Carrier")}</label><CarrierSelect id="ie-carrier" value={f.carrier_id ?? ""} onChange={(v) => setF({ ...f, carrier_id: v })} carriers={carriers} /></div>
      {input("tracking", t("Tracking, container or bill of lading number"), { maxLength: 60 })}
      {input("expected_date", t("Expected"), { type: "date" })}
      <div className="field"><label htmlFor="ie-stage">{t("Stage")}</label><select id="ie-stage" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>{IN_STAGES.map((m) => <option key={m} value={m}>{t(IN_STAGE_LABELS[m])}</option>)}</select></div>
      <div className="field"><label htmlFor="ie-customs">{t("Customs")}</label><select id="ie-customs" value={f.customs_status} onChange={(e) => setF({ ...f, customs_status: e.target.value })}>{CUSTOMS.map((c) => <option key={c} value={c}>{t(CUSTOMS_LABELS[c])}</option>)}</select></div>
      {input("broker", t("Customs broker"), { maxLength: 120 })}
      {area("customs_notes", t("Broker notes"))}
      {area("notes", t("Notes"))}
      <ErrorNote error={err} />
      <div className="row" style={{ gridColumn: "1 / -1" }}>
        <button className="btn primary" type="submit">{t("Save")}</button>
        <button className="btn" type="button" onClick={onCancel}>{t("Cancel")}</button>
      </div>
    </form>
  );
}

function InLinesForm({ s, lines, onDone, onCancel }: { s: any; lines: any[]; onDone: () => void; onCancel: () => void }) {
  const [rows, setRows] = useState<TypedLine[]>(() => (lines.length ? lines.map((l) => ({ id: l.id, part_code: l.part_code ?? "", description: l.description ?? "", qty: String(l.qty_expected), min: l.qty_received })) : [blank()]));
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/shipping/inbound/${enc(s.id)}/lines`, { method: "PUT", body: { revision: s.revision, lines: typedBody(rows) } });
      toast(t("Saved"));
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  return (
    <form className="stack" onSubmit={save}>
      <TypedLines lines={rows} setLines={setRows} />
      <ErrorNote error={err} />
      <div className="row"><button className="btn primary" type="submit">{t("Save lines")}</button><button className="btn" type="button" onClick={onCancel}>{t("Cancel")}</button></div>
    </form>
  );
}

/** Type what came in on each line, in as many goes as it takes. */
function ReceivePanel({ s, lines, onDone, onCancel }: { s: any; lines: any[]; onDone: () => void; onCancel: () => void }) {
  const [got, setGot] = useState<Record<string, { qty: string; damaged: string; bin: string }>>(() => Object.fromEntries(lines.map((l) => [l.id, { qty: "", damaged: "", bin: l.bin ?? "" }])));
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (id: string, patch: Partial<{ qty: string; damaged: string; bin: string }>) => setGot({ ...got, [id]: { ...got[id]!, ...patch } });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = lines.map((l) => ({ line_id: l.id, qty: Number(got[l.id]!.qty || 0), damaged: Number(got[l.id]!.damaged || 0), bin: got[l.id]!.bin })).filter((x) => x.qty || x.damaged);
      const r = await api<{ received: boolean; issues: number }>(`/shipping/inbound/${enc(s.id)}/receive`, { body: { lines: body, note } });
      toast(r.received ? t("Everything on this shipment is received.") : t("Received. The rest stays open."));
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel stack" onSubmit={save}>
      <h2>{t("Receive")}</h2>
      <p className="muted" style={{ margin: 0 }}>{t("Count what came in on each line. Anything damaged or extra is written down as a problem by itself.")}</p>
      <div className="tbl">
        <table className="po-lines sh-receive">
          <thead><tr><th>{t("Part")}</th><th className="num">{t("Still to come")}</th><th>{t("Good")}</th><th>{t("Damaged")}</th><th>{t("Bin")}</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td><span className="mono">{l.part_code ?? ""}</span> <span className="muted">{l.description ?? ""}</span></td>
                <td className="num">{l.open}</td>
                <td><input type="number" min={0} max={100000} inputMode="numeric" value={got[l.id]!.qty} placeholder="0"onChange={(e) => set(l.id, { qty: e.target.value })} aria-label={t("Line {n} good", { n: l.line_no })} /></td>
                <td><input type="number" min={0} max={100000} inputMode="numeric" value={got[l.id]!.damaged} placeholder="0" onChange={(e) => set(l.id, { damaged: e.target.value })} aria-label={t("Line {n} damaged", { n: l.line_no })} /></td>
                <td><input className="mono" value={got[l.id]!.bin} maxLength={40} placeholder="A-03-2" onChange={(e) => set(l.id, { bin: e.target.value })} aria-label={t("Line {n} bin", { n: l.line_no })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button type="button" className="btn small" onClick={() => setGot(Object.fromEntries(lines.map((l) => [l.id, { ...got[l.id]!, qty: l.open ? String(l.open) : got[l.id]!.qty }])))}>{t("Everything still to come arrived")}</button>
      </div>
      <div className="field"><label htmlFor="rc-note">{t("Note (damage, missing paperwork…)")}</label><input id="rc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></div>
      <ErrorNote error={err} />
      <div className="row"><button className="btn primary" type="submit" disabled={busy}>{t("Receive")}</button><button className="btn" type="button" onClick={onCancel}>{t("Cancel")}</button></div>
    </form>
  );
}

function IssuePanel({ s, lines, onDone, onCancel }: { s: any; lines: any[]; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState<{ kind: IssueKind; line_id: string; qty: string; note: string }>({ kind: "short", line_id: "", qty: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/shipping/inbound/${enc(s.id)}/issues`, { body: { ...f, line_id: f.line_id || null, qty: f.qty || null } });
      toast(t("Written down. Add photos to it below."));
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  return (
    <form className="panel grid g3 cp-form" onSubmit={save}>
      <div className="field"><label htmlFor="is-kind">{t("Problem")}</label><select id="is-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as IssueKind })}>{ISSUE_KINDS.map((k) => <option key={k} value={k}>{t(ISSUE_LABELS[k])}</option>)}</select></div>
      <div className="field"><label htmlFor="is-line">{t("Line")}</label><select id="is-line" value={f.line_id} onChange={(e) => setF({ ...f, line_id: e.target.value })}><option value="">{t("The whole shipment")}</option>{lines.map((l) => <option key={l.id} value={l.id}>{`${l.line_no}. ${l.part_code ?? ""} ${l.description ?? ""}`}</option>)}</select></div>
      <div className="field"><label htmlFor="is-qty">{t("How many")}</label><input id="is-qty" type="number" min={0} max={100000} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></div>
      <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="is-note">{t("What happened")}</label><textarea id="is-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={1000} required={f.kind === "other"} /></div>
      <ErrorNote error={err} />
      <div className="row" style={{ gridColumn: "1 / -1" }}><button className="btn primary" type="submit">{t("Write it down")}</button><button className="btn" type="button" onClick={onCancel}>{t("Cancel")}</button></div>
    </form>
  );
}

function Issues({ me, s, issues, files, onChange }: { me: Me; s: any; issues: any[]; files: any[]; onChange: () => void }) {
  const [fixing, setFixing] = useState<string | null>(null);
  const [text, setText] = useState("");
  if (!issues.length) return null;
  const edit = can(me, "ship.edit");
  async function setStatus(id: string, status: "open" | "resolved") {
    try {
      await api(`/shipping/issues/${enc(id)}`, { method: "PATCH", body: { status, resolution: text } });
      setFixing(null);
      setText("");
      onChange();
    } catch (x) {
      toast((x as Error).message);
    }
  }
  return (
    <div className="panel">
      <h2>{t("Problems")}</h2>
      <ul className="sh-issues">
        {issues.map((i) => (
          <li key={i.id} className={i.status === "open" ? "open" : ""}>
            <div className="row">
              <span className={`pill ${i.status === "open" ? "p-acc" : "p-ok"}`}>{t(ISSUE_LABELS[i.kind as IssueKind])}</span>
              {i.qty != null && <strong>{i.qty}</strong>}
              {i.line_no && <span className="muted">{t("Line {n}", { n: i.line_no })} <span className="mono">{i.part_code ?? ""}</span></span>}
              <span className="spacer" />
              <span className="muted small1">{i.by_name ?? ""} · {fmtTime(i.created_at)}</span>
            </div>
            {i.note && <p className="pre">{i.note}</p>}
            {i.status === "resolved" && <p className="muted">{t("Sorted out by {who}: {what}", { who: i.resolved_by_name ?? t("Someone"), what: i.resolution ?? "" })}</p>}
            <FileBox me={me} base="/shipping" uploadTo={`/shipping/inbound/${enc(s.id)}/files`} extra={{ issueId: i.id }} files={files.filter((f: any) => f.issue_id === i.id)} canEdit={edit} onChange={onChange} empty={t("No photos.")} />
            {edit && (fixing === i.id ? (
              <form className="row" onSubmit={(e) => { e.preventDefault(); setStatus(i.id, "resolved"); }}>
                <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("How it was sorted out (claim filed, replacement sent…)")} required maxLength={1000} autoFocus aria-label={t("How it was sorted out")} />
                <button className="btn primary small" type="submit">{t("Mark sorted out")}</button>
                <button className="btn small" type="button" onClick={() => setFixing(null)}>{t("Cancel")}</button>
              </form>
            ) : i.status === "open" ? <button className="btn small" onClick={() => setFixing(i.id)}>{t("Sorted out")}</button> : <button className="linkish" onClick={() => setStatus(i.id, "open")}>{t("Reopen")}</button>)}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- outgoing ----------

function NewOutbound({ me, orderId }: { me: Me; orderId?: string }) {
  const src = useLoad<{ partsOrders: any[]; changeParts: any[] }>(() => api("/shipping/sources"));
  const carriers = useCarriers();
  const [source, setSource] = useState<"parts_order" | "change_part" | "other">(orderId ? "parts_order" : "parts_order");
  const [po, setPo] = useState(orderId ?? "");
  const [cp, setCp] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<TypedLine[]>([blank()]);
  const [f, setF] = useState<Record<string, string>>({ carrier_id: "", service: "", ship_date: todayLocal(), ship_to: "", customer: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const order = src.data?.partsOrders.find((o) => o.id === po);
  useEffect(() => {
    if (order) setQty(Object.fromEntries(order.lines.map((l: any) => [l.id, String(l.to_ship)])));
  }, [order?.id]);
  useEffect(() => {
    const c = src.data?.changeParts.find((o) => o.id === cp);
    if (c) setTyped([{ part_code: "", description: c.part ?? "", qty: "1" }]);
  }, [cp]);
  if (!can(me, "ship.edit")) return <ErrorNote error="Your role doesn't allow this." />;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const lines = source === "parts_order" ? (order?.lines ?? []).map((l: any) => ({ po_line_id: l.id, qty: Number(qty[l.id] || 0) })).filter((l: any) => l.qty > 0) : typedBody(typed);
      const r = await api<{ id: string }>("/shipping/outbound", { body: { ...f, carrier_id: f.carrier_id || null, ship_date: f.ship_date || null, source, po_order_id: po || null, cp_order_id: cp || null, lines } });
      toast(t("Shipment made. Pick and pack it, then mark it shipped."));
      navigate(`/shipping/out/${r.id}`);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const sources: { id: typeof source; l: string }[] = [{ id: "parts_order", l: t("Parts order") }, { id: "change_part", l: t("Change-part order") }, { id: "other", l: t("Something else") }];
  return (
    <>
      <PageHead title={t("New shipment")} sub={t("Pick what goes in the box. Anything left on the order stays backordered until the next shipment.")} />
      <ErrorNote error={src.error} />
      <form className="stack" onSubmit={save}>
        <div className="panel stack">
          <div className="row cp-tabs" role="radiogroup" aria-label={t("What it's for")}>
            {sources.map((s) => <button type="button" key={s.id} role="radio" aria-checked={source === s.id} className={`btn${source === s.id ? " primary" : ""}`} onClick={() => setSource(s.id)}>{s.l}</button>)}
          </div>
          {source === "parts_order" && (
            <>
              <div className="field">
                <label htmlFor="no-po">{t("Parts order")}</label>
                <select id="no-po" value={po} onChange={(e) => setPo(e.target.value)} required>
                  <option value="">{src.data ? (src.data.partsOrders.length ? t("Pick an order") : t("No booked orders are waiting to ship")) : "…"}</option>
                  {(src.data?.partsOrders ?? []).map((o) => <option key={o.id} value={o.id}>{`${o.order_number} · ${o.customer}${o.customer_po ? ` · PO ${o.customer_po}` : ""}`}</option>)}
                </select>
              </div>
              {order && (
                <div className="tbl">
                  <table className="po-lines">
                    <thead><tr><th>#</th><th>{t("Part code")}</th><th>{t("Description")}</th><th className="num">{t("Ordered")}</th><th className="num">{t("Left to ship")}</th><th>{t("In this shipment")}</th></tr></thead>
                    <tbody>
                      {order.lines.map((l: any) => (
                        <tr key={l.id}>
                          <td className="muted">{l.line_no}</td>
                          <td className="mono nowrap">{l.part_code ?? "–"}</td>
                          <td>{l.description ?? "–"}</td>
                          <td className="num">{l.qty}</td>
                          <td className="num">{l.to_ship}</td>
                          <td><input type="number" min={0} max={l.to_ship} inputMode="numeric" value={qty[l.id] ?? ""} disabled={!l.to_ship} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} aria-label={t("Line {n} quantity", { n: l.line_no })} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {source === "change_part" && (
            <div className="field">
              <label htmlFor="no-cp">{t("Change-part order")}</label>
              <select id="no-cp" value={cp} onChange={(e) => setCp(e.target.value)} required>
                <option value="">{t("Pick an order")}</option>
                {(src.data?.changeParts ?? []).map((o) => <option key={o.id} value={o.id}>{[o.customer, o.machine, o.part].filter(Boolean).join(" · ")}</option>)}
              </select>
            </div>
          )}
          {source === "other" && (
            <div className="field"><label htmlFor="no-cust">{t("Going to")}</label><input id="no-cust" value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} required maxLength={200} placeholder={t("Customer, Ronchi Italy, a repair shop…")} /></div>
          )}
          {source !== "parts_order" && <TypedLines lines={typed} setLines={setTyped} />}
        </div>
        <div className="panel grid g3 cp-form">
          <div className="field"><label htmlFor="no-carrier">{t("Carrier")}</label><CarrierSelect id="no-carrier" value={f.carrier_id ?? ""} onChange={(v) => setF({ ...f, carrier_id: v })} carriers={carriers.data?.carriers ?? []} /></div>
          <div className="field"><label htmlFor="no-service">{t("Service")}</label><input id="no-service" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} maxLength={80} placeholder={t("Ground, 2Day, LTL…")} /></div>
          <div className="field"><label htmlFor="no-date">{t("Planned ship date")}</label><input id="no-date" type="date" value={f.ship_date} onChange={(e) => setF({ ...f, ship_date: e.target.value })} /></div>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="no-to">{t("Ship to")}</label><textarea id="no-to" value={f.ship_to} onChange={(e) => setF({ ...f, ship_to: e.target.value })} maxLength={600} placeholder={t("Company, attention, street, city, state, ZIP")} /></div>
        </div>
        <ErrorNote error={err} />
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy}>{t("Make shipment")}</button>
          <button className="btn" type="button" onClick={() => (orderId ? navigate(`/parts-orders/${orderId}`) : navigate("/shipping"))}>{t("Cancel")}</button>
        </div>
      </form>
    </>
  );
}

const OUT_BUTTON: Record<string, string> = { packed: "Mark packed", shipped: "Mark shipped", delivered: "Mark delivered", to_pick: "Back to picking", cancelled: "Cancel shipment" };

function OutboundPage({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useLoad<any>(() => api(`/shipping/outbound/${enc(id)}`), [id]);
  const carriers = useCarriers();
  const [editing, setEditing] = useState(false);
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const s = data.outbound;
  const edit = can(me, "ship.edit");
  async function move(to: string) {
    try {
      await api(`/shipping/outbound/${enc(id)}/status`, { body: { revision: s.revision, to } });
      toast(t(OUT_LABELS[to as keyof typeof OUT_LABELS] ?? "Saved"));
      reload();
    } catch (x) {
      toast((x as Error).message);
      if (to === "shipped") setEditing(true);
    }
  }
  const backTo = s.status === "shipped" ? "packed" : null;
  return (
    <>
      <PageHead title={s.number} sub={[s.customer, s.order_number, data.changePart ? t("Change parts") : null].filter(Boolean).join(" · ")}>
        <ShipPill status={s.status} />
        <Link to={`/shipping/out/${s.id}/slip`} className="btn">{t("Packing slip")}</Link>
        {edit && !editing && (s.moves as string[]).filter((m) => m !== "cancelled" && m !== backTo && !(m === "shipped" && s.status === "delivered")).map((m) => (
          <button key={m} className={`btn${m === "shipped" || (m === "packed" && s.status === "to_pick") || m === "delivered" ? " primary" : ""}`} onClick={() => move(m)}>{t(OUT_BUTTON[m] ?? m)}</button>
        ))}
        {edit && !editing && (s.moves as string[]).includes("cancelled") && <button className="btn danger" onClick={() => move("cancelled")}>{t("Cancel shipment")}</button>}
      </PageHead>
      {s.hint && <p className="sh-alert" role="status"><span>{t(s.hint)}</span></p>}
      {editing ? (
        <OutboundForm s={s} carriers={carriers.data?.carriers ?? []} onDone={() => { setEditing(false); reload(); }} onCancel={() => setEditing(false)} />
      ) : (
        <div className="grid g2">
          <div className="panel">
            <div className="row po-head">
              <h2>{t("Carrier and tracking")}</h2>
              <span className="spacer" />
              {edit && s.status !== "cancelled" && <button className="btn small" onClick={() => setEditing(true)}>{t("Edit")}</button>}
            </div>
            <dl className="po-dl">
              <div><dt>{t("Carrier")}</dt><dd>{[s.carrier, s.service].filter(Boolean).join(" · ") || "–"}</dd></div>
              <div><dt>{t("Tracking")}</dt><dd><TrackLink url={s.tracking_url} n={s.tracking} /></dd></div>
              <div><dt>{s.status === "shipped" || s.status === "delivered" ? t("Shipped") : t("Planned ship date")}</dt><dd>{shortDay(s.ship_date)}</dd></div>
              {s.delivered_at && <div><dt>{t("Delivered")}</dt><dd>{fmtTime(s.delivered_at)}</dd></div>}
              <div><dt>{t("Boxes")}</dt><dd>{s.boxes ?? "–"}</dd></div>
              <div><dt>{t("Weight")}</dt><dd>{s.weight_lb != null ? t("{n} lb", { n: s.weight_lb }) : "–"}</dd></div>
            </dl>
          </div>
          <div className="panel">
            <h2>{t("Going to")}</h2>
            {!(s.ship_to ?? "").startsWith(s.customer) && <p style={{ margin: "0 0 6px" }}><strong>{s.customer}</strong></p>}
            {s.ship_to ? <p className="pre">{s.ship_to}</p> : <p className="muted">{t("No ship-to address yet.")}</p>}
            {data.order && (
              <p>{can(me, "psales.view") ? <Link to={`/parts-orders/${data.order.id}`} className="mono">{data.order.order_number}</Link> : <span className="mono">{data.order.order_number}</span>}
                {data.order.customer_po && <span className="muted"> · {t("PO {po}", { po: data.order.customer_po })}</span>}</p>
            )}
            {data.changePart && (
              <p>{can(me, "orders.view") ? <Link to={`/change-parts/${data.changePart.id}`}>{data.changePart.part ?? t("Change-part order")}</Link> : <span>{data.changePart.part}</span>}
                {data.changePart.customer_po && <span className="muted"> · {t("PO {po}", { po: data.changePart.customer_po })}</span>}</p>
            )}
            {s.notes && <p className="pre muted">{s.notes}</p>}
          </div>
        </div>
      )}
      <div className="panel">
        <h2>{t("In this shipment")}</h2>
        <div className="tbl">
          <table className="po-lines">
            <thead><tr><th>{t("Part code")}</th><th>{t("Description")}</th><th className="num">{t("Qty")}</th>{data.order && <><th className="num">{t("Ordered")}</th><th className="num">{t("Still owed after this")}</th></>}</tr></thead>
            <tbody>
              {data.lines.map((l: any) => (
                <tr key={l.id}>
                  <td className="mono nowrap">{l.part_code ?? "–"}</td>
                  <td>{l.description ?? "–"}</td>
                  <td className="num"><strong>{l.qty}</strong></td>
                  {data.order && <><td className="num">{l.ordered ?? "–"}</td><td className="num">{l.owed ? <span className="pill p-warn">{t("{n} backordered", { n: l.owed })}</span> : "0"}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <h2>{t("Paperwork and photos")}</h2>
        <FileBox me={me} base="/shipping" uploadTo={`/shipping/outbound/${enc(s.id)}/files`} files={data.files} canEdit={edit} onChange={reload} empty={t("No files yet. Add the bill of lading, label or photos of the packed parts.")} />
      </div>
      <History items={data.history} />
    </>
  );
}

function OutboundForm({ s, carriers, onDone, onCancel }: { s: any; carriers: Carrier[]; onDone: () => void; onCancel: () => void }) {
  const keys = ["carrier_id", "service", "tracking", "boxes", "weight_lb", "ship_date", "ship_to", "notes"];
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, s[k] == null ? "" : String(s[k])])));
  const [err, setErr] = useState<string | null>(null);
  const hint = trackingHint(f.carrier_id, f.tracking);
  const tpl = carriers.find((c) => c.id === f.carrier_id)?.url_template;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api(`/shipping/outbound/${enc(s.id)}`, { method: "PATCH", body: { ...f, carrier_id: f.carrier_id || null, ship_date: f.ship_date || null, revision: s.revision } });
      toast(t("Saved"));
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  const input = (k: string, lbl: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field"><label htmlFor={`oe-${k}`}>{lbl}</label><input id={`oe-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></div>
  );
  return (
    <form className="panel grid g3 cp-form" onSubmit={save}>
      <div className="field"><label htmlFor="oe-carrier">{t("Carrier")}</label><CarrierSelect id="oe-carrier" value={f.carrier_id ?? ""} onChange={(v) => setF({ ...f, carrier_id: v })} carriers={carriers} /></div>
      {input("service", t("Service"), { maxLength: 80, placeholder: t("Ground, 2Day, LTL…") })}
      <div className="field">
        <label htmlFor="oe-tracking">{t("Tracking or PRO number")}</label>
        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          <input id="oe-tracking" className="mono grow" value={f.tracking} onChange={(e) => setF({ ...f, tracking: e.target.value })} maxLength={60} autoFocus />
          <ScanButton onCode={(code) => setF((x) => ({ ...x, tracking: code }))} />
        </div>
        {hint && <span className="muted small1">{t(hint)}</span>}
        {f.tracking && tpl && <a className="small1" href={trackingUrl(tpl, f.tracking) ?? undefined} target="_blank" rel="noopener noreferrer">{t("Check it on the carrier's site")}</a>}
      </div>
      {input("boxes", t("Boxes"), { type: "number", min: 0, max: 999, inputMode: "numeric" })}
      {input("weight_lb", t("Weight (lb)"), { type: "number", min: 0, max: 100000, step: "0.1", inputMode: "decimal" })}
      {input("ship_date", t("Ship date"), { type: "date" })}
      <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="oe-to">{t("Ship to")}</label><textarea id="oe-to" value={f.ship_to} onChange={(e) => setF({ ...f, ship_to: e.target.value })} maxLength={600} /></div>
      <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="oe-notes">{t("Notes")}</label><textarea id="oe-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={5000} /></div>
      <ErrorNote error={err} />
      <div className="row" style={{ gridColumn: "1 / -1" }}><button className="btn primary" type="submit">{t("Save")}</button><button className="btn" type="button" onClick={onCancel}>{t("Cancel")}</button></div>
    </form>
  );
}

/** The packing slip: what is in the box and what is still owed. Printed from the browser; no prices. */
function PackingSlip({ id, me }: { id: string; me: Me }) {
  const { data, error } = useLoad<any>(() => api(`/shipping/outbound/${enc(id)}`), [id]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const s = data.outbound;
  const company = me.settings?.brand.company ?? "Ronchi America";
  return (
    <>
      <div className="row slip-actions">
        <Link to={`/shipping/out/${s.id}`} className="btn">{t("Back to the shipment")}</Link>
        <span className="spacer" />
        <button className="btn primary" onClick={() => window.print()}>{t("Print")}</button>
      </div>
      <article className="panel slip">
        <header className="slip-head">
          <div><strong className="slip-co">{company}</strong></div>
          <div className="slip-title"><h1>{t("Packing slip")}</h1><span className="mono">{s.number}</span></div>
        </header>
        <div className="slip-grid">
          <section><h3>{t("Ship to")}</h3><p className="pre">{(s.ship_to ?? "").startsWith(s.customer) ? s.ship_to : <><strong>{s.customer}</strong>{s.ship_to ? `\n${s.ship_to}` : ""}</>}</p></section>
          <section>
            <h3>{t("Order")}</h3>
            <dl className="po-dl">
              {data.order && <div><dt>{t("Our order")}</dt><dd className="mono">{data.order.order_number}</dd></div>}
              {(data.order?.customer_po || data.changePart?.customer_po) && <div><dt>{t("Your PO")}</dt><dd className="mono">{data.order?.customer_po ?? data.changePart?.customer_po}</dd></div>}
              {(data.order?.machine || data.changePart?.machine) && <div><dt>{t("Machine")}</dt><dd className="mono">{data.order?.machine ?? data.changePart?.machine}</dd></div>}
              <div><dt>{t("Ship date")}</dt><dd>{shortDay(s.ship_date)}</dd></div>
            </dl>
          </section>
          <section>
            <h3>{t("Carrier")}</h3>
            <dl className="po-dl">
              <div><dt>{t("Carrier")}</dt><dd>{[s.carrier, s.service].filter(Boolean).join(" · ") || "–"}</dd></div>
              <div><dt>{t("Tracking")}</dt><dd className="mono">{s.tracking ?? "–"}</dd></div>
              <div><dt>{t("Boxes")}</dt><dd>{s.boxes ?? "–"}</dd></div>
              <div><dt>{t("Weight")}</dt><dd>{s.weight_lb != null ? t("{n} lb", { n: s.weight_lb }) : "–"}</dd></div>
            </dl>
          </section>
        </div>
        <table className="slip-lines">
          <thead><tr><th>#</th><th>{t("Part code")}</th><th>{t("Description")}</th>{data.order && <th className="num">{t("Ordered")}</th>}<th className="num">{t("Shipped")}</th>{data.order && <th className="num">{t("Backordered")}</th>}</tr></thead>
          <tbody>
            {data.lines.map((l: any, i: number) => (
              <tr key={l.id}>
                <td>{l.line_no ?? i + 1}</td>
                <td className="mono">{l.part_code ?? ""}</td>
                <td>{l.description ?? ""}</td>
                {data.order && <td className="num">{l.ordered ?? ""}</td>}
                <td className="num"><strong>{l.qty}</strong></td>
                {data.order && <td className="num">{l.owed || ""}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {data.order && data.lines.some((l: any) => l.owed) && <p className="muted">{t("Backordered parts will follow in a later shipment.")}</p>}
        <footer className="slip-foot">
          <span>{t("Received by")}: ______________________</span>
          <span>{t("Date")}: ____________</span>
        </footer>
      </article>
    </>
  );
}

// ---------- carriers ----------

function Carriers({ me }: { me: Me }) {
  const { data, error, reload } = useCarriers();
  const edit = can(me, "ship.edit");
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHead title={t("Carriers")} sub={t("Each carrier's tracking link. {n} is where the tracking number goes. Check a link on the carrier's own site, then tick Checked.")} tip="shipping.carriers">
        <Link to="/shipping" className="btn">{t("Back to shipping")}</Link>
        {edit && <button className="btn primary" onClick={() => setAdding(!adding)}>{adding ? t("Cancel") : t("Add carrier")}</button>}
      </PageHead>
      <ErrorNote error={error} />
      {adding && <AddCarrier onDone={() => { setAdding(false); reload(); }} />}
      <div className="panel tbl">
        <table className="cp-table sh-carriers">
          <thead><tr><th>{t("Carrier")}</th><th>{t("Tracking link")}</th><th>{t("Checked")}</th><th>{t("In the lists")}</th><th /></tr></thead>
          <tbody>{(data?.carriers ?? []).map((c) => <CarrierRow key={c.id} c={c} edit={edit} onSaved={reload} />)}</tbody>
        </table>
      </div>
    </>
  );
}

function CarrierRow({ c, edit, onSaved }: { c: Carrier; edit: boolean; onSaved: () => void }) {
  const [tpl, setTpl] = useState(c.url_template ?? "");
  const problem = tpl ? templateProblem(tpl) : null;
  async function save(body: Record<string, unknown>) {
    try {
      await api(`/shipping/carriers/${enc(c.id)}`, { method: "PATCH", body });
      toast(t("Saved"));
      onSaved();
    } catch (x) {
      toast((x as Error).message);
    }
  }
  return (
    <tr>
      <td><strong>{c.name}</strong><small className="muted po-sub">{t(c.mode === "ltl" ? "Freight (LTL)" : c.mode === "parcel" ? "Parcel" : c.mode === "courier" ? "Courier" : c.mode === "ocean" ? "Ocean" : c.mode === "pickup" ? "Pickup" : "Other")}</small></td>
      <td className="sh-tpl">
        {edit ? <input className="mono" value={tpl} onChange={(e) => setTpl(e.target.value)} placeholder="https://…{n}…" aria-label={t("Tracking link for {name}", { name: c.name })} maxLength={500} /> : <span className="mono">{c.url_template ?? "–"}</span>}
        {problem && <span className="small1 muted">{t(problem)}</span>}
        {!c.checked && c.url_template && <span className="pill p-warn">{t("Check this link")}</span>}
      </td>
      <td><input type="checkbox" checked={!!c.checked} disabled={!edit || !c.url_template} onChange={(e) => save({ checked: e.target.checked })} aria-label={t("{name} link checked", { name: c.name })} /></td>
      <td><input type="checkbox" checked={!!c.active} disabled={!edit} onChange={(e) => save({ active: e.target.checked })} aria-label={t("Show {name} in the lists", { name: c.name })} /></td>
      <td>{edit && tpl !== (c.url_template ?? "") && <button className="btn small primary" disabled={!!problem} onClick={() => save({ url_template: tpl || null })}>{t("Save")}</button>}</td>
    </tr>
  );
}

function AddCarrier({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", mode: "ltl", url_template: "" });
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/shipping/carriers", { body: { ...f, url_template: f.url_template || null } });
      toast(t("Added"));
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  return (
    <form className="panel grid g3 cp-form" onSubmit={save}>
      <div className="field"><label htmlFor="ac-name">{t("Carrier")}</label><input id="ac-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={60} autoFocus /></div>
      <div className="field"><label htmlFor="ac-mode">{t("Kind")}</label>
        <select id="ac-mode" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
          {[["parcel", "Parcel"], ["ltl", "Freight (LTL)"], ["courier", "Courier"], ["ocean", "Ocean"], ["air", "Air freight"], ["other", "Other"]].map(([v, l]) => <option key={v} value={v}>{t(l!)}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor="ac-tpl">{t("Tracking link")}</label><input id="ac-tpl" className="mono" value={f.url_template} onChange={(e) => setF({ ...f, url_template: e.target.value })} placeholder="https://…{n}…" maxLength={500} /></div>
      <ErrorNote error={err} />
      <div className="row" style={{ gridColumn: "1 / -1" }}><button className="btn primary" type="submit">{t("Add carrier")}</button></div>
    </form>
  );
}
