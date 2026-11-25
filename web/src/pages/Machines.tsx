import { useState } from "react";
import { api, can, fmtTime, type Me } from "../api";
import { t } from "../i18n";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad } from "../components/ui";
import { navigate } from "../router";
import { StatusPill } from "./ChangeParts";

export function Machines({ me }: { me: Me }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, error } = useLoad(() => api(`/machines?q=${encodeURIComponent(query)}`), [query]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ serial: "", model: "", customer: "", site: "" });
  const [err, setErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api("/machines", { body: form });
      navigate(`/machines/${r.id}`);
    } catch (x) {
      setErr((x as Error).message);
    }
  }

  return (
    <>
      <PageHead title={t("Machines")} sub={t("Every Ronchi machine in the field, by machine number.")}>
        {can(me, "machines.add") && <button className="btn primary" onClick={() => setAdding(!adding)}>{adding ? t("Cancel") : t("Add machine")}</button>}
      </PageHead>
      {adding && (
        <form className="panel grid g2" onSubmit={add}>
          {(["serial", "model", "customer", "site"] as const).map((k) => (
            <div className="field" key={k}>
              <label htmlFor={`m-${k}`}>{{ serial: t("Machine number"), model: t("Model"), customer: t("Customer"), site: t("Site") }[k]}</label>
              <input id={`m-${k}`} value={form[k]} required={k === "serial"} placeholder={k === "serial" ? "3069MB" : ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
          <ErrorNote error={err} />
          <div><button className="btn primary" type="submit">{t("Save machine")}</button></div>
        </form>
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
        <input className="panel" style={{ flex: 1, padding: "10px 12px", font: "inherit" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search by machine number, model, customer or site")} aria-label={t("Search machines")} />
        <button className="btn" type="submit">{t("Search")}</button>
      </form>
      <ErrorNote error={error} />
      <div className="panel tbl">
        {data && !data.machines.length && <Empty>{query ? t("No machines match.") : t("No machines yet. They'll be loaded from the MACHINE_MANUALS folders.")}</Empty>}
        {!!data?.machines.length && (
          <table>
            <thead><tr><th>{t("Machine")}</th><th>{t("Model")}</th><th>{t("Customer")}</th><th>{t("Site")}</th></tr></thead>
            <tbody>
              {data.machines.map((m: any) => (
                <tr key={m.id}>
                  <td className="mono"><Link to={`/machines/${m.id}`}>{m.serial}</Link></td>
                  <td>{m.model ?? "–"}</td><td>{m.customer ?? "–"}</td><td>{m.site ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export function MachinePage({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useLoad(() => api(`/machines/${encodeURIComponent(id)}`), [id]);
  const [edit, setEdit] = useState<any>(null);
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const m = data.machine;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/machines/${encodeURIComponent(id)}`, { method: "PATCH", body: edit });
      setEdit(null);
      reload();
      toast(t("Saved"));
    } catch (x) {
      toast((x as Error).message);
    }
  }

  return (
    <>
      <PageHead title={m.serial} sub={[m.model, m.customer, m.site].filter(Boolean).join(" · ") || undefined}>
        <Link to="/machines" className="btn">{t("All machines")}</Link>
        {can(me, "machines.edit") && !edit && (
          <button className="btn" onClick={() => setEdit({ model: m.model ?? "", customer: m.customer ?? "", site: m.site ?? "", notes: m.notes ?? "", sharepointUrl: m.sharepoint_url ?? "" })}>{t("Edit")}</button>
        )}
      </PageHead>
      {edit ? (
        <form className="panel grid g2" onSubmit={save}>
          {(["model", "customer", "site", "sharepointUrl"] as const).map((k) => (
            <div className="field" key={k}>
              <label htmlFor={`e-${k}`}>{{ model: t("Model"), customer: t("Customer"), site: t("Site"), sharepointUrl: t("SharePoint folder link") }[k]}</label>
              <input id={`e-${k}`} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
            </div>
          ))}
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="e-notes">{t("Notes")}</label>
            <textarea id="e-notes" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
          </div>
          <div className="row"><button className="btn primary" type="submit">{t("Save")}</button><button className="btn" type="button" onClick={() => setEdit(null)}>{t("Cancel")}</button></div>
        </form>
      ) : (
        <div className="grid g2">
          <div className="panel">
            <h2>{t("Details")}</h2>
            <p style={{ whiteSpace: "pre-wrap" }}>{m.notes || <span className="muted">{t("No notes yet.")}</span>}</p>
            {m.sharepoint_url && <p><a href={m.sharepoint_url} target="_blank" rel="noopener noreferrer">{t("Open the SharePoint folder")}</a></p>}
            <p className="muted">{t("Updated {when}", { when: fmtTime(m.updated_at) })}</p>
          </div>
          <div className="panel">
            <h2>{t("Boards")}</h2>
            {data.boards.length ? data.boards.map((b: any) => <p key={b.id}><Link to={`/boards/${b.id}`}>{b.name}</Link></p>) : <Empty>{t("No boards for this machine yet.")}</Empty>}
            <p className="muted">{t("Manuals, service reports, history and remote sessions attach here in later steps.")}</p>
          </div>
          {data.orders && (
            <div className="panel" style={{ gridColumn: "1 / -1" }}>
              <h2>{t("Change-part orders")}</h2>
              {data.orders.length ? (
                <div className="tbl">
                  <table>
                    <tbody>
                      {data.orders.map((o: any) => (
                        <tr key={o.id}><td><Link to={`/change-parts/${o.id}`}>{o.part || t("Order")}</Link></td><td><StatusPill status={o.status} /></td><td className="muted">{o.ship_date ?? ""}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty>{t("No change-part orders for this machine.")}</Empty>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
