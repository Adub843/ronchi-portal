import { useState } from "react";
import { api, fmtTime, type Me } from "../api";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad } from "../components/ui";
import { navigate } from "../router";

const ROLE_LABELS: Record<string, string> = { admin: "Admin", billing: "Billing", scheduling: "Scheduling", service: "Service", sales: "Sales", engineering: "Engineering", tech: "Techs" };

export function Boards(_: { me: Me }) {
  const { data, error } = useLoad(() => api("/boards"));
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api("/boards", { body: { name, description: desc, audience: roles } });
      navigate(`/boards/${r.id}`);
    } catch (x) {
      setErr((x as Error).message);
    }
  }

  return (
    <>
      <PageHead title="Message boards" sub="Talk across service, engineering, sales and Paolo in one place.">
        <button className="btn primary" onClick={() => setOpen(!open)}>{open ? "Cancel" : "New board"}</button>
      </PageHead>
      {open && (
        <form className="panel stack" onSubmit={create}>
          <div className="field"><label htmlFor="bn">Board name</label><input id="bn" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="for example 3069MB capper, or Service team" /></div>
          <div className="field"><label htmlFor="bd">What it's for (optional)</label><input id="bd" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} /></div>
          <fieldset className="field">
            <label>Who can see it</label>
            <div className="row">
              {Object.entries(ROLE_LABELS).map(([k, v]) => (
                <label key={k} className="row" style={{ gap: 4 }}>
                  <input type="checkbox" checked={roles.includes(k)} onChange={(e) => setRoles(e.target.checked ? [...roles, k] : roles.filter((r) => r !== k))} /> {v}
                </label>
              ))}
            </div>
            <span className="muted">Leave all unticked for everyone on staff. You can always see boards you create.</span>
          </fieldset>
          <ErrorNote error={err} />
          <div><button className="btn primary" type="submit">Create board</button></div>
        </form>
      )}
      <ErrorNote error={error} />
      <div className="panel">
        {data && !data.boards.length && <Empty>No boards yet. Create the first one.</Empty>}
        <div className="tbl">
          <table>
            {data?.boards.length ? (
              <thead><tr><th>Board</th><th>Who can see it</th><th>Messages</th><th>Last message</th></tr></thead>
            ) : null}
            <tbody>
              {data?.boards.map((b: any) => (
                <tr key={b.id}>
                  <td><Link to={`/boards/${b.id}`}><b>{b.name}</b></Link>{b.description && <div className="muted">{b.description}</div>}</td>
                  <td>{b.audience ? JSON.parse(b.audience).map((r: string) => ROLE_LABELS[r] ?? r).join(", ") : <span className="pill p-info">All staff</span>}</td>
                  <td>{b.post_count}</td>
                  <td className="muted">{b.last_post_at ? fmtTime(b.last_post_at) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export function BoardPage({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useLoad(() => api(`/boards/${encodeURIComponent(id)}`), [id]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api(`/boards/${encodeURIComponent(id)}/posts`, { body: { body: text, parentId: replyTo?.id } });
      setText("");
      setReplyTo(null);
      reload();
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  async function act(path: string, method: string, body?: unknown) {
    try {
      await api(path, { method, body });
      reload();
    } catch (x) {
      toast((x as Error).message);
    }
  }

  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  // Show newest threads first; replies under their message, oldest first.
  const top = data.posts.filter((p: any) => !p.parent_id).sort((a: any, b: any) => b.pinned - a.pinned || b.created_at.localeCompare(a.created_at));
  const replies = (pid: string) => data.posts.filter((p: any) => p.parent_id === pid).sort((a: any, b: any) => a.created_at.localeCompare(b.created_at));

  const Post = ({ p, reply }: { p: any; reply?: boolean }) => (
    <div className={`post${reply ? " reply" : ""}${p.pinned ? " pinned" : ""}`}>
      <div className="meta">
        <b>{p.author}</b><span>{fmtTime(p.created_at)}</span>{p.edited_at && <span>(edited)</span>}{p.pinned ? <span className="pill p-warn">Pinned</span> : null}
      </div>
      {/* Shown as text: React escapes it, so nothing typed can run as code. */}
      <div className="body">{p.body}</div>
      <div className="row" style={{ gap: 12 }}>
        {!reply && <button className="linkish" onClick={() => setReplyTo(p)}>Reply</button>}
        {data.canModerate && !reply && <button className="linkish" onClick={() => act(`/boards/${id}/posts/${p.id}`, "PATCH", { pinned: !p.pinned })}>{p.pinned ? "Unpin" : "Pin"}</button>}
        {(p.user_id === me.id || data.canModerate) && <button className="linkish" onClick={() => act(`/boards/${id}/posts/${p.id}`, "DELETE")}>Remove</button>}
      </div>
    </div>
  );

  return (
    <>
      <PageHead title={data.board.name} sub={data.board.description ?? undefined}>
        <Link to="/boards" className="btn">All boards</Link>
        {data.canModerate && <button className="btn" onClick={async () => { await act(`/boards/${id}/archive`, "POST", {}); navigate("/boards"); }}>Archive</button>}
      </PageHead>
      <form className="panel stack" onSubmit={post}>
        {replyTo && (
          <div className="row muted">Replying to {replyTo.author}<button type="button" className="linkish" onClick={() => setReplyTo(null)}>Cancel</button></div>
        )}
        <div className="field">
          <label htmlFor="msg">{replyTo ? "Your reply" : "New message"}</label>
          <textarea id="msg" value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} required />
        </div>
        <ErrorNote error={err} />
        <div><button className="btn primary" type="submit">Post</button></div>
      </form>
      <div className="panel">
        {!top.length && <Empty>No messages yet.</Empty>}
        {top.map((p: any) => (
          <div key={p.id}>
            <Post p={p} />
            {replies(p.id).map((r: any) => <Post key={r.id} p={r} reply />)}
          </div>
        ))}
      </div>
    </>
  );
}
