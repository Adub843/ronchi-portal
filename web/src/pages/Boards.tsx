import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type Me } from "../api";
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
      <div className="panel chatlist">
        {data && !data.boards.length && <Empty>No boards yet. Create the first one.</Empty>}
        {data?.boards.map((b: any) => (
          <Link key={b.id} to={`/boards/${b.id}`} className="chatrow">
            <span className="avatar" aria-hidden="true">{initials(b.name)}</span>
            <span className="chatrow-main">
              <span className="chatrow-top">
                <b>{b.name}</b>
                <span className={`chatrow-time${b.unread ? " new" : ""}`}>{b.last_post_at ? when(b.last_post_at) : ""}</span>
              </span>
              <span className="chatrow-bottom">
                <span className="chatrow-last">{b.last_message ?? (b.description || "No messages yet")}</span>
                {b.unread > 0 && <span className="badge" aria-label={`${b.unread} unread`}>{b.unread > 99 ? "99+" : b.unread}</span>}
              </span>
              <span className="chatrow-who">{b.audience ? JSON.parse(b.audience).map((r: string) => ROLE_LABELS[r] ?? r).join(", ") : "All staff"}</span>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}

/** Two letters for a board's round badge, like a chat app's contact picture. */
function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Time for the chat list: today shows the time, this week the day, older the date. */
function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now.getTime() - 86400000);
  if (sameDay(d, yesterday)) return "Yesterday";
  if (now.getTime() - d.getTime() < 6 * 86400000) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function dayLabel(d: Date): string {
  const now = new Date();
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, new Date(now.getTime() - 86400000))) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

export function BoardPage({ id, me }: { id: string; me: Me }) {
  const bid = encodeURIComponent(id);
  const { data, error, reload } = useLoad(() => api(`/boards/${bid}`), [id]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<any>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const lastCount = useRef(0);
  const atBottom = useRef(true);

  // Stay pinned to the newest message when the box resizes (reply bar, keyboard, longer text),
  // unless the person has scrolled up to read older messages.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => (atBottom.current = el.scrollHeight - el.clientHeight - el.scrollTop < 40);
    const ro = new ResizeObserver(() => atBottom.current && (el.scrollTop = el.scrollHeight));
    el.addEventListener("scroll", onScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [!!data]);

  // New messages show up without refreshing, like a chat app (checks every few seconds while the page is open).
  useEffect(() => {
    const t = window.setInterval(() => document.visibilityState === "visible" && reload(), 5000);
    return () => window.clearInterval(t);
  }, [id]);

  const posts: any[] = data ? [...data.posts].sort((a: any, b: any) => a.created_at.localeCompare(b.created_at)) : [];

  // Jump to the newest message when the chat opens or something new arrives, and mark it read.
  useLayoutEffect(() => {
    if (!data || posts.length === lastCount.current) return;
    const el = scroller.current;
    const mineNewest = posts.at(-1)?.user_id === me.id;
    if (el && (atBottom.current || mineNewest || !lastCount.current)) el.scrollTop = el.scrollHeight;
    lastCount.current = posts.length;
    api(`/boards/${bid}/read`, { body: {} }).catch(() => undefined);
  });

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!text.trim() || sending) return;
    setErr(null);
    setSending(true);
    try {
      await api(`/boards/${bid}/posts`, { body: { body: text, parentId: replyTo?.id } });
      setText("");
      setReplyTo(null);
      reload();
      box.current?.focus();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function act(path: string, method: string, body?: unknown) {
    try {
      await api(path, { method, body });
      setPicked(null);
      reload();
    } catch (x) {
      toast((x as Error).message);
    }
  }

  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const byId = new Map(posts.map((p) => [p.id, p]));
  const pinned = posts.filter((p) => p.pinned).at(-1);

  return (
    <div className="chat">
      <div className="chat-head">
        <span className="avatar" aria-hidden="true">{initials(data.board.name)}</span>
        <div className="chat-title">
          <h1>{data.board.name}</h1>
          <span className="muted">{data.board.description ?? (data.board.audience ? "Some roles" : "All staff")}</span>
        </div>
        {data.canModerate && (
          <button className="btn small" onClick={async () => { await act(`/boards/${bid}/archive`, "POST", {}); navigate("/boards"); }}>Archive</button>
        )}
      </div>
      {pinned && (
        <button type="button" className="chat-pinned" onClick={() => document.getElementById(`m-${pinned.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" })}>
          <span className="pill p-warn">Pinned</span> <span className="chat-pinned-text">{pinned.body}</span>
        </button>
      )}
      <div className="chat-scroll" ref={scroller} role="log" aria-live="polite" aria-label="Messages">
        {!posts.length && <Empty>No messages yet. Say hello.</Empty>}
        {posts.map((p, i) => {
          const d = new Date(p.created_at);
          const prev = posts[i - 1];
          const newDay = !prev || !sameDay(new Date(prev.created_at), d);
          const mine = p.user_id === me.id;
          const grouped = !newDay && prev && prev.user_id === p.user_id && d.getTime() - Date.parse(prev.created_at) < 5 * 60000;
          const parent = p.parent_id ? byId.get(p.parent_id) : null;
          const open = picked === p.id;
          return (
            <div key={p.id}>
              {newDay && <div className="chat-day"><span>{dayLabel(d)}</span></div>}
              <div id={`m-${p.id}`} className={`msg${mine ? " mine" : ""}${grouped ? " grouped" : ""}`}>
                <button type="button" className="bubble" onClick={() => setPicked(open ? null : p.id)} aria-expanded={open} aria-label={`Message from ${p.author}. Tap for options.`}>
                  {!mine && !grouped && <span className="bubble-author">{p.author}</span>}
                  {parent && (
                    <span className="bubble-quote"><b>{parent.user_id === me.id ? "You" : parent.author}</b><span>{parent.body}</span></span>
                  )}
                  {/* Shown as text: React escapes it, so nothing typed can run as code. */}
                  <span className="bubble-text">{p.body}</span>
                  <span className="bubble-meta">{p.edited_at ? "edited · " : ""}{d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                </button>
                {open && (
                  <div className="msg-actions">
                    <button className="btn small" onClick={() => { setReplyTo(p); setPicked(null); box.current?.focus(); }}>Reply</button>
                    <button className="btn small" onClick={() => navigator.clipboard.writeText(p.body).then(() => { toast("Copied"); setPicked(null); }, () => toast("Couldn't copy"))}>Copy</button>
                    {data.canModerate && <button className="btn small" onClick={() => act(`/boards/${bid}/posts/${p.id}`, "PATCH", { pinned: !p.pinned })}>{p.pinned ? "Unpin" : "Pin"}</button>}
                    {(mine || data.canModerate) && <button className="btn small danger" onClick={() => act(`/boards/${bid}/posts/${p.id}`, "DELETE")}>Remove</button>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <form className="chat-compose" onSubmit={send}>
        {replyTo && (
          <div className="compose-reply">
            <span><b>Replying to {replyTo.user_id === me.id ? "yourself" : replyTo.author}</b><span className="muted">{replyTo.body}</span></span>
            <button type="button" className="linkish" onClick={() => setReplyTo(null)} aria-label="Cancel reply">Cancel</button>
          </div>
        )}
        <ErrorNote error={err} />
        <div className="compose-row">
          <textarea
            ref={box}
            id="msg"
            rows={1}
            value={text}
            placeholder="Message"
            aria-label="Message"
            maxLength={5000}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
            }}
            onKeyDown={(e) => {
              // Enter sends on a computer; Shift+Enter makes a new line. Phones use the Send button.
              if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="send" type="submit" disabled={!text.trim() || sending} aria-label="Send">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6 3.3 10l12.6 2-12.6 2z" fill="currentColor" /></svg>
          </button>
        </div>
      </form>
    </div>
  );
}
