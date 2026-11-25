// DEMO ONLY. Shipping and receiving in the preview, with example shipments. Customers, suppliers,
// parts and tracking numbers are made up. Works like routes/shipping.ts, kept in this browser.
import { isOpen, isShipped } from "../../../src/shared/change-parts";
import { cleanName, fileInfo, fileProblem } from "../../../src/shared/files";
import { cleanPackages, firstStatus, isDirection, isStatusFor, nextNumber, packageTotals, receiveStatus, trackingLinks, DONE_STATUSES } from "../../../src/shared/shipping";

export class ShippingFail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface Ctx { me: { id: string; name: string }; perms: Set<string>; users: { id: string; name: string }[]; orders: any[]; jobs: () => any[]; partsOrder: (id: string) => any | null; machines: { id: string; serial: string; model: string | null }[]; newId: () => string; pdf: (title: string) => Blob }

let ships: any[] | null = null;
let lines: any[] = [];
let files: any[] = [];
let hist: any[] = [];
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const today = () => day(0);

function seed(c: Ctx) {
  const at = new Date(Date.now() - 2 * 86400000).toISOString();
  const mk = (s: any, items: [string | null, string, number, number?, string?][]) => {
    const row = { id: c.newId(), revision: 1, created_at: at, updated_at: at, packages: [], freight_options: [], removed_at: null, problem: null, problem_note: null, source_type: null, source_id: null, ...s };
    items.forEach(([part_code, description, qty, qty_received = 0, bin], i) => lines.push({ id: c.newId(), shipment_id: row.id, line_no: i + 1, part_code, description, qty, qty_received, bin: bin ?? null, hold: 0, hold_note: null }));
    hist.push({ shipment_id: row.id, at, action: "shipment.create", who: "Meagan Hooper", detail: null });
    return row;
  };
  const y = new Date().getFullYear();
  const origin = "Ronchi America\nShipping dock\n(example address)";
  ships = [
    mk({ number: `SH-${y}-0007`, direction: "out", kind: "spare_parts", status: "to_pack", party: "Example Foods Inc.", machine: "4222TP", reference: "PO 5521", address: "1200 Example Pkwy\nAtlanta, GA 30336", origin, contact_name: "Dana Smith", contact_phone: "(404) 555-0142", contact_email: "dana.smith@example.com", carrier: "ups", service: "Ground", planned_date: day(1), packages: [{ type: "box", count: 2, weight: 14, length: 18, width: 12, height: 10 }] },
      [["R-10442", "Piston O-ring kit", 4], ["R-2210", "Star wheel 38 mm", 1]]),
    mk({ number: `SH-${y}-0006`, direction: "out", kind: "machine", status: "packed", party: "Example Home Care", machine: "4212MB", reference: "PO HC-311", address: "88 Example Ave\nChicago, IL 60609", origin, contact_name: "Sam Ortiz", contact_phone: "(312) 555-0110", contact_email: "sam.ortiz@example.com", carrier: "odfl", service: "LTL standard", planned_date: day(2), freight_class: "85", freight_options: ["liftgate", "appointment"], bol_number: "RA-BOL-1188", packages: [{ type: "crate", count: 2, weight: 1850, length: 120, width: 60, height: 84 }, { type: "pallet", count: 1, weight: 420, length: 48, width: 40, height: 50 }] },
      [[null, "Monoblock 4212MB (2 crates)", 1], [null, "Change parts and spares (1 pallet)", 1]]),
    mk({ number: `SH-${y}-0005`, direction: "out", kind: "change_parts", status: "shipped", party: "Example Pharma Co.", machine: "3069MB", reference: "PO 88-1204", address: "4500 Example Rd\nColumbus, OH 43219", origin, contact_name: "Lee Park", contact_email: "lpark@example.com", carrier: "fedex", service: "Express Saver", tracking: "771234567890", shipped_date: day(-1), planned_date: day(-1), packages: [{ type: "box", count: 1, weight: 22 }] },
      [["CP-3069-50", "50 ml format set (star wheels, guides)", 1]]),
    mk({ number: `RC-${y}-0012`, direction: "in", kind: "from_italy", status: "expected", party: "Ronchi Mario S.p.A.", reference: "IT-ORD-2026-88", carrier: "forwarder", mode: "ocean", vessel: "Example Aurora 2251W", container: "EXMU1234567", broker: "Example Customs Brokers", bol_number: "EXBL8877", planned_date: day(9), notes: "Two machines and spares for stock." },
      [["4230MB", "Monoblock 4230MB", 1], ["R-10442", "Piston O-ring kit", 20], ["R-7781", "Capping head clutch", 4]]),
    mk({ number: `RC-${y}-0011`, direction: "in", kind: "supplier", status: "partly_received", party: "Example Seals Co.", reference: "RA PO 2026-441", carrier: "ups", tracking: "1Z999AA10123456784", planned_date: day(-2), shipped_date: day(-1), problem: "short", problem_note: "Only 6 of 10 seal kits in the box. Supplier says the rest ship Friday." },
      [["S-220", "Seal kit, filling valve", 10, 6, "Shelf B3"], ["S-118", "Gasket set", 5, 5, "Shelf B4"]]),
    mk({ number: `RC-${y}-0010`, direction: "in", kind: "samples", status: "expected", party: "Example Home Care", reference: "Fill test trigger bottles", carrier: "ups", planned_date: day(3) },
      [[null, "Sample bottles 500 ml", 24], [null, "Trigger caps", 24]]),
  ];
  // The middle receipt has a doubtful part on quality hold.
  const held = lines.find((l) => l.part_code === "S-118")!;
  held.hold = 1;
  held.hold_note = "Wrong durometer? Checking with engineering.";
  const pod = { id: c.newId(), shipment_id: ships[2].id, user_id: c.me.id, name: "Packed box photo.pdf", ext: "pdf", blob: c.pdf("Packed box photo (example)"), created_at: at };
  files.push({ ...pod, size: pod.blob.size, url: URL.createObjectURL(pod.blob) });
}

export function resetShipping() {
  ships = null;
  lines = [];
  files = [];
  hist = [];
}

const need = (c: Ctx, p: string) => { if (!c.perms.has(p)) throw new ShippingFail(403, "Your role doesn't allow this."); };

export function shippingRoute(method: string, seg: string[], q: URLSearchParams, body: any, c: Ctx): unknown {
  need(c, "shipping.view");
  if (!ships) seed(c);
  const live = ships!.filter((s) => !s.removed_at);
  const linesOf = (id: string) => lines.filter((l) => l.shipment_id === id).sort((a, b) => a.line_no - b.line_no);
  const find = (id: string) => { const s = live.find((x) => x.id === id); if (!s) throw new ShippingFail(404, "Not found."); return s; };
  const log = (s: any, action: string, detail: any = null) => hist.unshift({ shipment_id: s.id, at: new Date().toISOString(), action, who: c.me.name, detail });
  const tellOrder = (s: any, event: "shipped" | "received") => {
    if (s.source_type !== "cp_order") return;
    const o = c.orders.find((x) => x.id === s.source_id);
    if (!o) return;
    if (s.kind === "samples") { const k = event === "shipped" ? "samples_shipped" : "samples_received"; o[k] ||= today(); }
    else if (event === "shipped") { o.ship_date ||= today(); if (isOpen(o.status) && !isShipped(o.status)) o.status = "Shipped to customer"; }
    o.revision++;
  };

  if (seg[1] === "prefill") {
    need(c, "shipping.edit");
    const out: any = { origin: live.find((s) => s.direction === "out" && s.origin)?.origin ?? null };
    const src = q.get("source"), id = q.get("id");
    if (src === "cp_order" && id) {
      const o = c.orders.find((x) => x.id === id);
      if (!o) throw new ShippingFail(404, "Not found.");
      Object.assign(out, { source_type: src, source_id: id, direction: "out", kind: "change_parts", party: o.customer, machine: o.machine, reference: o.customer_po ?? o.ra_po ?? null, label: [o.customer, o.part].filter(Boolean).join(" · "), lines: o.part ? [{ part_code: null, description: o.part, qty: 1 }] : [] });
    } else if (src === "job" && id) {
      const j = c.jobs().find((x) => x.id === id);
      if (!j) throw new ShippingFail(404, "Not found.");
      Object.assign(out, { source_type: src, source_id: id, direction: "out", kind: "spare_parts", party: j.customer, machine: j.machine, address: j.location, contact_name: j.contact_name, contact_phone: j.contact_phone, contact_email: j.contact_email, reference: j.job_number, label: `Job ${j.job_number}` });
    } else if (src === "parts_order" && id) {
      need(c, "partsorders.view");
      const o = c.partsOrder(id);
      if (!o) throw new ShippingFail(404, "Not found.");
      Object.assign(out, {
        source_type: src, source_id: id, direction: "out", kind: "spare_parts", party: o.customer, machine: o.machine ?? null, address: o.ship_to ?? null,
        contact_name: o.contact ?? null, contact_email: o.contact_email ?? null, contact_phone: o.contact_phone ?? null, reference: o.customer_po ?? o.number, label: o.number,
        lines: o.lines.filter((l: any) => l.qty - (l.qty_shipped ?? 0) > 0).map((l: any) => ({ part_code: l.part_code, description: l.description ?? l.part_code ?? "Part", qty: Math.ceil(l.qty - (l.qty_shipped ?? 0)), source_type: "parts_order_line", source_id: l.id })),
      });
    } else if (src) throw new ShippingFail(404, "Not found.");
    return out;
  }
  if (seg[1] === "files" && method === "DELETE") {
    files = files.filter((f) => f.id !== seg[2]);
    return { ok: true };
  }
  if (!seg[1] && method === "GET") {
    const view = q.get("view") ?? "all", dirn = q.get("direction"), status = q.get("status"), text = (q.get("q") ?? "").toLowerCase();
    const link = q.get("link")?.split(":"), machine = q.get("machine")?.toUpperCase();
    const rows = live.filter((s) => {
      if (dirn && s.direction !== dirn) return false;
      if (view === "open" && DONE_STATUSES.has(s.status)) return false;
      if (view === "done" && !DONE_STATUSES.has(s.status)) return false;
      if (view === "problems" && !s.problem) return false;
      if (view === "hold" && !linesOf(s.id).some((l) => l.hold)) return false;
      if (status && s.status !== status) return false;
      if (machine && s.machine !== machine) return false;
      if (link && (s.source_type !== link[0] || s.source_id !== link[1])) return false;
      return !text || [s.number, s.party, s.machine, s.reference, s.tracking, ...linesOf(s.id).flatMap((l) => [l.part_code, l.description])].some((v) => (v ?? "").toLowerCase().includes(text));
    }).sort((a, b) => Number(DONE_STATUSES.has(a.status)) - Number(DONE_STATUSES.has(b.status)) || (a.planned_date ?? "9").localeCompare(b.planned_date ?? "9"));
    const counts: Record<string, number> = { to_pack: 0, packed: 0, shipped: 0, expected: 0, arrived: 0, partly_received: 0, on_hold: 0, problems: 0, hold: 0 };
    const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
    for (const s of live) { if (s.status in counts) bump(s.status); if (s.problem && s.status !== "cancelled") bump("problems"); if (linesOf(s.id).some((l) => l.hold)) bump("hold"); }
    return { shipments: rows.map((s) => ({ ...s, pieces: packageTotals(s.packages).pieces, lines: linesOf(s.id).length, trackingLinks: trackingLinks(s.carrier, s.tracking) })), counts };
  }
  if (!seg[1] && method === "POST") {
    need(c, "shipping.edit");
    if (!isDirection(body.direction)) throw new ShippingFail(400, "Say whether it's going out or coming in.");
    if (!(body.party ?? "").trim()) throw new ShippingFail(400, "Customer or supplier is required.");
    let packages;
    try { packages = cleanPackages(body.packages ?? []); } catch (e) { throw new ShippingFail(400, (e as Error).message); }
    const y = new Date().getFullYear();
    const top = live.filter((s) => s.direction === body.direction).map((s) => s.number).sort().pop() ?? null;
    const now = new Date().toISOString();
    const { lines: ls, ...rest } = body;
    const s = { ...rest, id: c.newId(), number: nextNumber(body.direction, y, top), status: firstStatus(body.direction), packages, machine: (body.machine ?? "").toUpperCase() || null, revision: 1, created_at: now, updated_at: now, removed_at: null, problem: null };
    ships!.unshift(s);
    (ls ?? []).forEach((l: any, i: number) => lines.push({ id: c.newId(), shipment_id: s.id, line_no: i + 1, part_code: l.part_code || null, description: l.description || l.part_code, qty: Number(l.qty) || 1, qty_received: 0, bin: null, hold: 0, hold_note: null }));
    log(s, "shipment.create");
    return { id: s.id, number: s.number };
  }
  const s = find(seg[1]!);
  if (seg[2] === "files") {
    for (const f of (body.files ?? []) as File[]) {
      const p = fileProblem(f.name, f.size);
      if (p) throw new ShippingFail(400, `${cleanName(f.name)}: ${p}`);
      files.unshift({ id: c.newId(), shipment_id: s.id, user_id: c.me.id, name: cleanName(f.name), ext: fileInfo(f.name)!.ext, size: f.size, created_at: new Date().toISOString(), url: URL.createObjectURL(f) });
    }
    log(s, "shipment.file.add");
    return { ids: [] };
  }
  if (seg[2] === "receive") {
    need(c, "shipping.edit");
    if (body.revision !== s.revision) throw new ShippingFail(409, "Someone else changed this shipment while you were editing. Reload to see their changes.");
    const ls = linesOf(s.id);
    for (const x of body.lines ?? []) {
      const l = ls.find((y) => y.id === x.id);
      if (!l) continue;
      if (l.qty_received + Number(x.qty || 0) > l.qty && body.problem !== "over") throw new ShippingFail(400, `More ${l.part_code ?? l.description} than expected (${l.qty}). Note it as "Extra" if that's right.`);
      l.qty_received += Number(x.qty || 0);
      if (x.bin) l.bin = x.bin;
      if (x.hold) { l.hold = 1; l.hold_note = x.hold_note || null; }
    }
    s.status = receiveStatus(ls);
    s.shipped_date ||= today();
    if (s.status === "received") s.done_date ||= today();
    if (body.problem) { s.problem = body.problem; s.problem_note = body.problem_note || null; }
    s.revision++;
    log(s, "shipment.receive", { status: s.status, received: (body.lines ?? []).filter((x: any) => x.qty).map((x: any) => ({ item: ls.find((l) => l.id === x.id)?.part_code ?? ls.find((l) => l.id === x.id)?.description, qty: x.qty, bin: x.bin ?? null })) });
    if (s.status === "received" || s.kind === "samples") tellOrder(s, "received");
    return { ok: true, revision: s.revision, status: s.status };
  }
  if (seg[2] === "lines" && seg[4] === "hold") {
    need(c, "shipping.edit");
    if (body.revision !== s.revision) throw new ShippingFail(409, "Someone else changed this shipment while you were editing. Reload to see their changes.");
    const l = linesOf(s.id).find((x) => x.id === seg[3]);
    if (!l) throw new ShippingFail(404, "Not found.");
    l.hold = body.hold ? 1 : 0;
    if (!body.hold) l.hold_note = null;
    s.revision++;
    log(s, body.hold ? "shipment.hold" : "shipment.hold_clear");
    return { ok: true };
  }
  if (method === "PATCH") {
    need(c, "shipping.edit");
    if (body.revision !== s.revision) throw new ShippingFail(409, "Someone else changed this shipment while you were editing. Reload to see their changes.");
    if (body.status !== undefined && !isStatusFor(s.direction, body.status)) throw new ShippingFail(400, "That step doesn't fit this shipment.");
    const before = s.status;
    const { lines: ls, revision: _r, ...rest } = body;
    if (rest.packages) { try { rest.packages = cleanPackages(rest.packages); } catch (e) { throw new ShippingFail(400, (e as Error).message); } }
    Object.assign(s, rest);
    if (s.machine) s.machine = s.machine.toUpperCase();
    if (s.status !== before) {
      if (s.direction === "out" && (s.status === "shipped" || s.status === "delivered")) s.shipped_date ||= today();
      if (s.status === "delivered") s.done_date ||= today();
      if (s.direction === "in" && s.status === "arrived") s.shipped_date ||= today();
    }
    if (Array.isArray(ls)) {
      const had = linesOf(s.id);
      lines = lines.filter((l) => l.shipment_id !== s.id || ls.some((x: any) => x.id === l.id));
      ls.forEach((x: any, i: number) => {
        const old = had.find((h) => h.id === x.id);
        if (old) Object.assign(old, { line_no: i + 1, part_code: x.part_code || null, description: x.description, qty: Number(x.qty) });
        else lines.push({ id: c.newId(), shipment_id: s.id, line_no: i + 1, part_code: x.part_code || null, description: x.description || x.part_code, qty: Number(x.qty) || 1, qty_received: 0, bin: null, hold: 0, hold_note: null });
      });
    }
    s.revision++;
    s.updated_at = new Date().toISOString();
    log(s, "shipment.update", s.status !== before ? { changes: { status: [before, s.status] } } : null);
    if (s.status !== before && (s.status === "shipped" || s.status === "delivered") && s.direction === "out") tellOrder(s, "shipped");
    return { ok: true, revision: s.revision };
  }
  if (method === "DELETE") {
    need(c, "shipping.edit");
    s.removed_at = new Date().toISOString();
    return { ok: true };
  }
  const name = (id: string) => c.users.find((u) => u.id === id)?.name ?? "";
  const m = c.machines.find((x) => x.serial === s.machine);
  let source = null;
  if (s.source_type === "cp_order") { const o = c.orders.find((x) => x.id === s.source_id); source = { type: "cp_order", id: s.source_id, label: o ? [o.customer, o.part].filter(Boolean).join(" · ") : null, open: !!o && c.perms.has("orders.view") }; }
  if (s.source_type === "parts_order") { const o = c.partsOrder(s.source_id); source = { type: "parts_order", id: s.source_id, label: o ? o.number : null, open: !!o && c.perms.has("partsorders.view") }; }
  if (s.source_type === "job") { const j = c.jobs().find((x) => x.id === s.source_id); source = { type: "job", id: s.source_id, label: j ? `Job ${j.job_number}` : null, open: !!j && c.perms.has("jobs.view") }; }
  return {
    shipment: s,
    lines: linesOf(s.id),
    files: files.filter((f) => f.shipment_id === s.id).map(({ blob: _b, ...f }) => ({ ...f, by_name: name(f.user_id) })),
    totals: packageTotals(s.packages),
    tracking: trackingLinks(s.carrier, s.tracking),
    machine: m ? { id: m.id, serial: m.serial, model: m.model } : null,
    source,
    history: hist.filter((h) => h.shipment_id === s.id),
  };
}
