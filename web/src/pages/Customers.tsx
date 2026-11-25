// Customer logins for the parts site, and the quote requests they send.
// Each customer company sees only the machines listed here. People sign up with a one-time link
// that staff send them (by email or text); they sign in with a passkey, never a password.
import { useState } from "react";
import { api, can, fmtTime, type Me } from "../api";
import { t } from "../i18n";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad } from "../components/ui";
import { navigate } from "../router";

const enc = encodeURIComponent;
const QUOTE_STATUS: Record<string, string> = { sent: "New", received: "Received", quoted: "Quoted", closed: "Closed" };

export function Customers({ me }: { me: Me }) {
  const { data, error, reload } = useLoad(() => api("/customers"));
  const [name, setName] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api("/customers", { body: { name } });
      setName("");
      setOpen(r.id);
      reload();
    } catch (x) {
      toast((x as Error).message);
    }
  }

  return (
    <>
      <PageHead title={t("Customer logins")} sub={t("Who can sign in to the parts site, and which machines each company sees.")} tip="customers.head">
        {can(me, "quotes.manage") && <Link to="/quotes" className="btn">{t("Quote requests")}</Link>}
      </PageHead>
      <form className="row panel" onSubmit={add}>
        <input style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Company name, as the customer knows it")} aria-label={t("Company name")} required />
        <button className="btn primary" type="submit">{t("Add company")}</button>
      </form>
      <ErrorNote error={error} />
      {data && !data.companies.length && <Empty>{t("No customer companies yet.")}</Empty>}
      {data?.companies.map((co: any) => (
        <Company key={co.id} co={co} open={open === co.id} onToggle={() => setOpen(open === co.id ? null : co.id)} invite={can(me, "customers.invite")} onChange={reload} />
      ))}
    </>
  );
}

function Company({ co, open, invite, onToggle, onChange }: { co: any; open: boolean; invite: boolean; onToggle: () => void; onChange: () => void }) {
  const [serials, setSerials] = useState<string>(() => co.machines.map((m: any) => m.serial).join(", "));
  const [inv, setInv] = useState({ name: "", email: "", role: "standard" });
  const [link, setLink] = useState<string | null>(null);
  const registry = useLoad(() => (open ? api("/machines") : Promise.resolve({ machines: [] })), [open]);

  const call = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast(done);
      onChange();
    } catch (x) {
      toast((x as Error).message);
    }
  };

  return (
    <div className="panel stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>{co.name}</h2>
        {co.status === "disabled" && <span className="cv-tag">{t("Turned off")}</span>}
        <span className="muted">{t("{m} machines · {u} people", { m: co.machines.length, u: co.users.length })}</span>
        <span className="spacer" />
        <button className="btn small" onClick={onToggle} aria-expanded={open}>{open ? t("Close") : t("Manage")}</button>
      </div>
      {open && (
        <>
          <h3>{t("Machines they see")}</h3>
          <p className="muted">{t("Machine numbers, separated by commas. Only machines in the portal's machine list can be added.")}</p>
          <div className="row">
            <input style={{ flex: 1 }} value={serials} onChange={(e) => setSerials(e.target.value)} list={`reg-${co.id}`} placeholder="3651MB, 3069MB" aria-label={t("Machine numbers")} />
            <datalist id={`reg-${co.id}`}>{registry.data?.machines.map((m: any) => <option key={m.id} value={m.serial} />)}</datalist>
            <button className="btn primary" onClick={() => call(() => api(`/customers/${enc(co.id)}/machines`, {
              method: "PUT",
              body: { machines: serials.split(/[\s,;]+/).filter(Boolean).map((serial) => ({ serial })) },
            }), t("Saved"))}>{t("Save machines")}</button>
          </div>
          {co.machines.some((m: any) => !m.published_at) && (
            <p className="note-inline">{t("These machines have no published catalog yet. The customer still sees them, with a note that the catalog is being prepared: {list}", { list: co.machines.filter((m: any) => !m.published_at).map((m: any) => m.serial).join(", ") })}</p>
          )}

          <h3>{t("People")}</h3>
          <div className="tbl">
            <table>
              <thead><tr><th>{t("Name")}</th><th>{t("Email")}</th><th>{t("Can send quote requests")}</th><th>{t("Last sign-in")}</th><th /></tr></thead>
              <tbody>
                {co.users.map((u: any) => (
                  <tr key={u.id}>
                    <td>{u.name}{u.status === "disabled" && <span className="cv-tag">{t("Turned off")}</span>}</td>
                    <td>{u.email}</td>
                    <td><input type="checkbox" disabled={!invite} checked={u.role === "buyer"} aria-label={t("Can send quote requests")} onChange={(e) => call(() => api(`/customers/users/${enc(u.id)}`, { method: "PATCH", body: { role: e.target.checked ? "buyer" : "standard" } }))} /></td>
                    <td>{u.last_sign_in ? fmtTime(u.last_sign_in) : "–"}</td>
                    <td className="row" style={{ gap: 6 }}>
                      {invite && <>
                      <button className="btn small" onClick={() => call(async () => {
                        const r = await api(`/customers/${enc(co.id)}/invites`, { body: { name: u.name, email: u.email, role: u.role } });
                        setLink(r.link);
                      })}>{t("New sign-in link")}</button>
                      <button className="btn small danger" onClick={() => call(() => api(`/customers/users/${enc(u.id)}`, { method: "PATCH", body: { status: u.status === "disabled" ? "active" : "disabled" } }))}>
                        {u.status === "disabled" ? t("Turn on") : t("Turn off")}
                      </button>
                      </>}
                    </td>
                  </tr>
                ))}
                {co.invites.map((i: any) => (
                  <tr key={i.id} className="muted">
                    <td>{i.name}</td><td>{i.email}</td><td>{i.role === "buyer" ? "✓" : ""}</td>
                    <td>{t("Invited, link expires {when}", { when: fmtTime(i.expires_at) })}</td>
                    <td>{invite && <button className="btn small" onClick={() => call(() => api(`/customers/invites/${enc(i.id)}`, { method: "DELETE" }), t("Link cancelled"))}>{t("Cancel link")}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {invite && <form className="grid g2" onSubmit={(e) => {
            e.preventDefault();
            call(async () => {
              const r = await api(`/customers/${enc(co.id)}/invites`, { body: inv });
              setLink(r.link);
              setInv({ name: "", email: "", role: "standard" });
            });
          }}>
            <div className="field"><label htmlFor={`in-${co.id}`}>{t("Name")}</label><input id={`in-${co.id}`} required value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} /></div>
            <div className="field"><label htmlFor={`ie-${co.id}`}>{t("Email")}</label><input id={`ie-${co.id}`} type="email" required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></div>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={inv.role === "buyer"} onChange={(e) => setInv({ ...inv, role: e.target.checked ? "buyer" : "standard" })} /> {t("Can send quote requests (buyer)")}</label>
            <div><button className="btn primary" type="submit">{t("Make sign-up link")}</button></div>
          </form>}
          {link && (
            <div className="note-inline stack">
              <p>{t("Send this link to them yourself (email or text). It works once, for 7 days. Anyone with it can sign up as this person, so send it only to them.")}</p>
              <div className="row"><input readOnly value={link} style={{ flex: 1 }} aria-label={t("Sign-up link")} onFocus={(e) => e.target.select()} />
                <button className="btn" onClick={() => navigator.clipboard.writeText(link).then(() => toast(t("Copied")))}>{t("Copy")}</button></div>
            </div>
          )}
          <div className="row">
            <span className="spacer" />
            <button className="btn danger" onClick={() => {
              const off = co.status !== "disabled";
              if (off && !confirm(t("Turn off {name}? Everyone at this company is signed out and can't sign in until it's turned back on.", { name: co.name }))) return;
              call(() => api(`/customers/${enc(co.id)}`, { method: "PATCH", body: { status: off ? "disabled" : "active" } }));
            }}>{co.status === "disabled" ? t("Turn company on") : t("Turn company off")}</button>
          </div>
        </>
      )}
    </div>
  );
}

export function Quotes({ id, me }: { id?: string; me?: Me }) {
  const [status, setStatus] = useState("");
  const { data, error } = useLoad(() => api(`/quotes${status ? `?status=${status}` : ""}`), [status]);
  if (id) return <QuotePage id={id} me={me ?? null} />;
  return (
    <>
      <PageHead title={t("Quote requests")} sub={t("Parts lists customers sent from the parts site.")} tip="quotes.head">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("Show")}>
          <option value="">{t("All")}</option>
          {Object.entries(QUOTE_STATUS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
        </select>
      </PageHead>
      <ErrorNote error={error} />
      <div className="panel tbl">
        {data && !data.quotes.length && <Empty>{t("No quote requests.")}</Empty>}
        {!!data?.quotes.length && (
          <table>
            <thead><tr><th>{t("Request")}</th><th>{t("Company")}</th><th>{t("Sent by")}</th><th>{t("Items")}</th><th>{t("Sent")}</th><th>{t("Status")}</th></tr></thead>
            <tbody>
              {data.quotes.map((q: any) => (
                <tr key={q.id}>
                  <td className="mono"><Link to={`/quotes/${q.id}`}>{q.number}</Link></td>
                  <td>{q.company}</td><td>{q.sent_by}</td><td>{q.items}</td><td>{fmtTime(q.created_at)}</td>
                  <td>{t(QUOTE_STATUS[q.status] ?? q.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function QuotePage({ id, me }: { id: string; me: Me | null }) {
  const { data, error, reload } = useLoad(() => api(`/quotes/${enc(id)}`), [id]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const q = data.quote;
  return (
    <>
      <PageHead title={q.number} sub={`${q.company} · ${q.sent_by} · ${fmtTime(q.created_at)}`}>
        {can(me, "psales.edit") && <button className="btn primary" onClick={async () => {
          try {
            const r = await api<{ id: string }>("/parts-orders/from-request", { body: { requestId: id } });
            navigate(`/parts-orders/${r.id}`);
          } catch (x) {
            toast((x as Error).message);
          }
        }}>{t("Start a quote from this request")}</button>}
        <select value={q.status} aria-label={t("Status")} onChange={async (e) => {
          try {
            await api(`/quotes/${enc(id)}`, { method: "PATCH", body: { status: e.target.value } });
            reload();
          } catch (x) {
            toast((x as Error).message);
          }
        }}>
          {Object.entries(QUOTE_STATUS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
        </select>
      </PageHead>
      <div className="panel">
        <p>{t("Reply to")}: <a href={`mailto:${q.email}?subject=${enc(q.number)}`}>{q.email}</a> <span className="muted">({q.sent_by_email})</span></p>
        {q.notes && <p style={{ whiteSpace: "pre-wrap" }}>{q.notes}</p>}
      </div>
      <div className="panel tbl">
        <table>
          <thead><tr><th>{t("Part number")}</th><th>{t("Description")}</th><th>{t("Machine")}</th><th>{t("Qty")}</th><th>{t("Note")}</th></tr></thead>
          <tbody>
            {data.lines.map((l: any, i: number) => (
              <tr key={i}>
                <td className="mono">{l.code ? <Link to={`/catalog/p/${l.code}`}>{l.code}</Link> : "–"}</td>
                <td>{l.code ? (l.name_en || l.name_it) : l.description}{l.maker && <small className="cv-maker">{[l.maker, l.maker_pn].filter(Boolean).join(" ")}</small>}</td>
                <td className="mono">{l.serial ?? "–"}</td>
                <td>{l.qty}</td>
                <td>{l.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
