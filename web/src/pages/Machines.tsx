import { useState } from "react";
import { api, can, fmtTime, type Me } from "../api";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad } from "../components/ui";
import { navigate } from "../router";

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
      <PageHead title="Machines" sub="Every Ronchi machine in the field, by machine number.">
        {can(me, "machines.edit") && <button className="btn primary" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "Add machine"}</button>}
      </PageHead>
      {adding && (
        <form className="panel grid g2" onSubmit={add}>
          {(["serial", "model", "customer", "site"] as const).map((k) => (
            <div className="field" key={k}>
              <label htmlFor={`m-${k}`}>{{ serial: "Machine number", model: "Model", customer: "Customer", site: "Site" }[k]}</label>
              <input id={`m-${k}`} value={form[k]} required={k === "serial"} placeholder={k === "serial" ? "3069MB" : ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
          <ErrorNote error={err} />
          <div><button className="btn primary" type="submit">Save machine</button></div>
        </form>
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
        <input className="panel" style={{ flex: 1, padding: "10px 12px", font: "inherit" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by machine number, model, customer or site" aria-label="Search machines" />
        <button className="btn" type="submit">Search</button>
      </form>
      <ErrorNote error={error} />
      <div className="panel tbl">
        {data && !data.machines.length && <Empty>{query ? "No machines match." : "No machines yet. They'll be loaded from the MACHINE_MANUALS folders."}</Empty>}
        {!!data?.machines.length && (
          <table>
            <thead><tr><th>Machine</th><th>Model</th><th>Customer</th><th>Site</th></tr></thead>
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
      toast("Saved");
    } catch (x) {
      toast((x as Error).message);
    }
  }

  return (
    <>
      <PageHead title={m.serial} sub={[m.model, m.customer, m.site].filter(Boolean).join(" · ") || undefined}>
        <Link to="/machines" className="btn">All machines</Link>
        {can(me, "machines.edit") && !edit && (
          <button className="btn" onClick={() => setEdit({ model: m.model ?? "", customer: m.customer ?? "", site: m.site ?? "", notes: m.notes ?? "", sharepointUrl: m.sharepoint_url ?? "" })}>Edit</button>
        )}
      </PageHead>
      {edit ? (
        <form className="panel grid g2" onSubmit={save}>
          {(["model", "customer", "site", "sharepointUrl"] as const).map((k) => (
            <div className="field" key={k}>
              <label htmlFor={`e-${k}`}>{{ model: "Model", customer: "Customer", site: "Site", sharepointUrl: "SharePoint folder link" }[k]}</label>
              <input id={`e-${k}`} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
            </div>
          ))}
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="e-notes">Notes</label>
            <textarea id="e-notes" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
          </div>
          <div className="row"><button className="btn primary" type="submit">Save</button><button className="btn" type="button" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>
      ) : (
        <div className="grid g2">
          <div className="panel">
            <h2>Details</h2>
            <p style={{ whiteSpace: "pre-wrap" }}>{m.notes || <span className="muted">No notes yet.</span>}</p>
            {m.sharepoint_url && <p><a href={m.sharepoint_url} target="_blank" rel="noopener noreferrer">Open the SharePoint folder</a></p>}
            <p className="muted">Updated {fmtTime(m.updated_at)}</p>
          </div>
          <div className="panel">
            <h2>Boards</h2>
            {data.boards.length ? data.boards.map((b: any) => <p key={b.id}><Link to={`/boards/${b.id}`}>{b.name}</Link></p>) : <Empty>No boards for this machine yet.</Empty>}
            <p className="muted">Manuals, service reports, history and remote sessions attach here in later steps.</p>
          </div>
        </div>
      )}
    </>
  );
}
