// Chats (private, between people) and Boards (team rooms). Both look and work like a phone chat:
// a list of conversations with unread counts, then a conversation with bubbles, replies,
// photos and files. Each has a ⋮ menu with the controls for that list or conversation.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, apiForm, can, fileUrl, type Me } from "../api";
import { ACCEPT, fileProblem, fmtSize, MAX_FILES_PER_MESSAGE, MAX_MESSAGE_BYTES } from "../../../src/shared/files";
import { countsChanged, initials } from "../components/Alerts";
import { Camera, Clip, Close, Dots, Download, FileBadge, Search, Send, BellOff } from "../components/icons";
import { Menu, type MenuItem } from "../components/Menu";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad, Tip } from "../components/ui";
import { loc, t } from "../i18n";
import { navigate } from "../router";
import { roleIds, roleLabel, useRoleNames } from "../roles";
import { NEW_POSTS_EVENT, POLL } from "../poll";

type Kind = "board" | "chat";
const base = (k: Kind) => (k === "chat" ? "/chats" : "/boards");

/** A chat's name: the name it was given, or the other people in it. */
export function chatTitle(b: { kind?: string; name: string; members?: { id: string; name: string }[] }, meId: string): string {
  if (b.name || b.kind !== "chat") return b.name;
  const others = (b.members ?? []).filter((m) => m.id !== meId);
  if (others.length === 1) return others[0]!.name;
  return others.map((m) => m.name.split(" ")[0]).join(", ") || t("Just you");
}

const audienceText = (audience: string | null) => (audience ? (JSON.parse(audience) as string[]).map((r) => roleLabel(r, true)).join(", ") : t("All staff"));

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Time for the chat list: today shows the time, this week the day, older the date. */
function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return d.toLocaleTimeString(loc(), { hour: "numeric", minute: "2-digit" });
  if (sameDay(d, new Date(now.getTime() - 86400000))) return t("Yesterday");
  if (now.getTime() - d.getTime() < 6 * 86400000) return d.toLocaleDateString(loc(), { weekday: "short" });
  return d.toLocaleDateString(loc(), { month: "short", day: "numeric" });
}

function dayLabel(d: Date): string {
  const now = new Date();
  if (sameDay(d, now)) return t("Today");
  if (sameDay(d, new Date(now.getTime() - 86400000))) return t("Yesterday");
  return d.toLocaleDateString(loc(), { weekday: "long", month: "long", day: "numeric" });
}

/** "Aaron added Steve Williams", "You removed Lola Parker", "Meagan left the chat", in the person's language. */
function eventText(p: { body: string; user_id: string; author: string }, meId: string): string {
  let e: { type?: string; names?: string[] } = {};
  try {
    e = JSON.parse(p.body);
  } catch {
    /* an unreadable line shows just the name */
  }
  const you = p.user_id === meId;
  const names = (e.names ?? []).join(", ");
  if (e.type === "added") return you ? t("You added {names}", { names }) : t("{who} added {names}", { who: p.author, names });
  if (e.type === "removed") return you ? t("You removed {names}", { names }) : t("{who} removed {names}", { who: p.author, names });
  if (e.type === "left") return you ? t("You left the chat") : t("{who} left the chat", { who: p.author });
  return p.author;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString(loc(), { hour: "numeric", minute: "2-digit" });

// ───────────────────────────── Lists ─────────────────────────────

export function Chats({ me }: { me: Me }) {
  return <ConversationList me={me} kind="chat" />;
}
export function Boards({ me }: { me: Me }) {
  return <ConversationList me={me} kind="board" />;
}

function ConversationList({ me, kind }: { me: Me; kind: Kind }) {
  const { data, error, reload } = useLoad(() => api(kind === "chat" ? "/boards?kind=chat" : "/boards"), [kind]);
  const [creating, setCreating] = useState(false);
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState("");

  // The list stays current on its own, like a phone's chat list: it reloads when the alerts check
  // sees a new message, with a slow check as a backstop for renames and archived boards.
  useEffect(() => {
    const onNew = () => reload();
    window.addEventListener(NEW_POSTS_EVENT, onNew);
    const id = window.setInterval(() => document.visibilityState === "visible" && reload(), POLL.idle);
    return () => {
      window.removeEventListener(NEW_POSTS_EVENT, onNew);
      window.clearInterval(id);
    };
  }, [kind]);

  async function readAll() {
    await api("/boards/read-all", { body: {} }).catch(() => undefined);
    countsChanged();
    reload();
    toast(t("All marked as read"));
  }

  const rows: any[] = (data?.boards ?? []).filter((b: any) => {
    const s = q.trim().toLowerCase();
    return !s || [chatTitle(b, me.id), b.last_body ?? "", b.description ?? ""].some((v) => v.toLowerCase().includes(s));
  });
  const menu: MenuItem[] = [
    { label: t("Mark all as read"), onSelect: readAll },
    { label: archived ? t("Back to open boards") : t("Archived boards"), onSelect: () => setArchived(!archived), hidden: kind !== "board" || !can(me, "boards.moderate") },
  ];

  return (
    <>
      <PageHead
        title={kind === "chat" ? t("Chats") : t("Message boards")}
        sub={kind === "chat" ? t("Private conversations with anyone on staff.") : t("Team rooms for service, engineering, sales and the office.")}
        tip={kind === "chat" ? "chats.head" : "boards.head"}
      >
        {can(me, kind === "chat" ? "chats.start" : "boards.create") && <button className="btn primary" onClick={() => setCreating(!creating)}>{creating ? t("Cancel") : kind === "chat" ? t("New chat") : t("New board")}</button>}
        <Menu label={t("More options")} trigger={<Dots />} items={menu} />
      </PageHead>
      {creating && (kind === "chat" ? <NewChat /> : <NewBoard />)}
      {archived ? (
        <ArchivedBoards />
      ) : (
        <>
          <ErrorNote error={error} />
          <div className="panel chatlist">
            <label className="listsearch">
              <Search size={18} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === "chat" ? t("Search chats") : t("Search boards")} aria-label={kind === "chat" ? t("Search chats") : t("Search boards")} />
            </label>
            {data && !data.boards.length && <Empty>{kind === "chat" ? t("No chats yet. Start one with New chat.") : t("No boards yet. Create the first one.")}</Empty>}
            {rows.map((b) => {
              const title = chatTitle(b, me.id);
              const direct = kind === "chat" && !b.name && (b.members?.length ?? 0) <= 2;
              const who = b.last_user_id === me.id ? t("You") : direct ? "" : (b.last_author ?? "").split(" ")[0];
              const last = b.last_body || (b.last_files ? t("Photo or file") : "");
              return (
                <Link key={b.id} to={`${base(kind)}/${b.id}`} className="chatrow">
                  <span className={`avatar${kind === "chat" ? " person" : ""}`} aria-hidden="true">{initials(title)}</span>
                  <span className="chatrow-main">
                    <span className="chatrow-top">
                      <b>{title}</b>
                      <span className={`chatrow-time${b.unread ? " new" : ""}`}>
                        {!!b.muted && <span className="muted-ic" title={t("Alerts muted")}><BellOff /></span>}
                        {b.last_post_at ? when(b.last_post_at) : ""}
                      </span>
                    </span>
                    <span className="chatrow-bottom">
                      <span className="chatrow-last">
                        {last ? <>{who && <>{who}: </>}{b.last_files > 0 && <span className="inline-ic"><Clip size={13} /></span>}{last}</> : (b.description || t("No messages yet"))}
                      </span>
                      {b.unread > 0 && <span className="badge" aria-label={t("{n} unread", { n: b.unread })}>{b.unread > 99 ? "99+" : b.unread}</span>}
                    </span>
                    {kind === "board" && <span className="chatrow-who">{b.locked ? `${t("Announcements")} · ` : ""}{audienceText(b.audience)}</span>}
                  </span>
                </Link>
              );
            })}
            {data && !!data.boards.length && !rows.length && <Empty>{t("Nothing matches.")}</Empty>}
          </div>
        </>
      )}
    </>
  );
}

function RolePicker({ roles, setRoles }: { roles: string[]; setRoles: (r: string[]) => void }) {
  useRoleNames();
  return (
    <fieldset className="field">
      <label>{t("Who can see it")}</label>
      <div className="row">
        {roleIds().map((k) => (
          <label key={k} className="row" style={{ gap: 4 }}>
            <input type="checkbox" checked={roles.includes(k)} onChange={(e) => setRoles(e.target.checked ? [...roles, k] : roles.filter((r) => r !== k))} /> {roleLabel(k, true)}
          </label>
        ))}
      </div>
      <Tip id="boards.audience" as="span">{t("Leave all unticked for everyone on staff. You can always see boards you create.")}</Tip>
    </fieldset>
  );
}

function NewBoard() {
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
    <form className="panel stack" onSubmit={create}>
      <div className="field"><label htmlFor="bn">{t("Board name")}</label><input id="bn" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder={t("for example 3069MB capper, or Service team")} /></div>
      <div className="field"><label htmlFor="bd">{t("What it's for (optional)")}</label><input id="bd" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} /></div>
      <RolePicker roles={roles} setRoles={setRoles} />
      <ErrorNote error={err} />
      <div><button className="btn primary" type="submit">{t("Create board")}</button></div>
    </form>
  );
}

/** Pick people for a chat. Used to start a chat and to add people to one. */
function PeoplePicker({ picked, setPicked, exclude = [] }: { picked: string[]; setPicked: (p: string[]) => void; exclude?: string[] }) {
  const people = useLoad(() => api("/boards/people"));
  const [q, setQ] = useState("");
  const list = (people.data?.people ?? []).filter((p: any) => !exclude.includes(p.id) && (!q || p.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="picker">
      <label className="listsearch">
        <Search size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search people")} aria-label={t("Search people")} />
      </label>
      <div className="picker-list">
        {list.map((p: any) => (
          <label key={p.id} className="picker-row">
            <input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} />
            <span className="avatar person" aria-hidden="true">{initials(p.name)}</span>
            <span><b>{p.name}</b><small className="muted">{roleLabel(p.role)}</small></span>
          </label>
        ))}
        {people.data && !list.length && <Empty>{t("Nothing matches.")}</Empty>}
      </div>
    </div>
  );
}

function NewChat() {
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function start(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api("/boards/chats", { body: { userIds: picked, name: picked.length > 1 ? name : "" } });
      navigate(`/chats/${r.id}`);
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  return (
    <form className="panel stack" onSubmit={start}>
      <b>{t("Who do you want to chat with?")}</b>
      <PeoplePicker picked={picked} setPicked={setPicked} />
      {picked.length > 1 && (
        <div className="field"><label htmlFor="gn">{t("Group name (optional)")}</label><input id="gn" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("for example Atlanta install crew")} /></div>
      )}
      <ErrorNote error={err} />
      <div><button className="btn primary" type="submit" disabled={!picked.length}>{picked.length > 1 ? t("Start group chat") : t("Start chat")}</button></div>
    </form>
  );
}

function ArchivedBoards() {
  const { data, reload } = useLoad(() => api("/boards/archived"));
  return (
    <div className="panel chatlist">
      <div className="menu-head" style={{ padding: "10px 16px" }}><b>{t("Archived boards")}</b><small>{t("Hidden from everyone's list. Restore one to bring it back.")}</small></div>
      {data && !data.boards.length && <Empty>{t("No archived boards.")}</Empty>}
      {data?.boards.map((b: any) => (
        <div key={b.id} className="chatrow">
          <span className="avatar" aria-hidden="true">{initials(b.name)}</span>
          <span className="chatrow-main"><b>{b.name}</b><span className="chatrow-last">{b.description ?? audienceText(b.audience)}</span></span>
          <button className="btn small" onClick={async () => { await api(`/boards/${encodeURIComponent(b.id)}/unarchive`, { body: {} }); toast(t("Restored")); reload(); }}>{t("Restore")}</button>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────── Conversation ───────────────────────────

interface Pending { file: File; url: string | null }

export function BoardPage({ id, me }: { id: string; me: Me }) {
  const bid = encodeURIComponent(id);
  const { data, error, reload } = useLoad(() => api(`/boards/${bid}`), [id]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [files, setFiles] = useState<Pending[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [panel, setPanel] = useState<null | "files" | "edit" | "people" | "add">(null);
  const [search, setSearch] = useState<string | null>(null);
  const [viewer, setViewer] = useState<any>(null);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const attach = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
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
  }, [!!data, panel]);

  // New messages show up without refreshing: the alerts check says when this chat has something new.
  // A slower check also picks up edits, removed messages and people added or removed.
  useEffect(() => {
    const onNew = (e: Event) => ((e as CustomEvent<string[]>).detail ?? []).includes(id) && reload();
    window.addEventListener(NEW_POSTS_EVENT, onNew);
    const t = window.setInterval(() => document.visibilityState === "visible" && reload(), 30_000);
    return () => {
      window.removeEventListener(NEW_POSTS_EVENT, onNew);
      window.clearInterval(t);
    };
  }, [id]);

  // Photo previews for files waiting to be sent are freed when they're sent or removed.
  useEffect(() => () => files.forEach((f) => f.url && URL.revokeObjectURL(f.url)), [files]);

  const posts: any[] = useMemo(() => (data ? [...data.posts].sort((a: any, b: any) => a.created_at.localeCompare(b.created_at)) : []), [data]);

  // Jump to the newest message when the chat opens or something new arrives, and mark it read.
  useLayoutEffect(() => {
    if (!data || posts.length === lastCount.current) return;
    const el = scroller.current;
    const mineNewest = posts.at(-1)?.user_id === me.id;
    if (el && (atBottom.current || mineNewest || !lastCount.current)) el.scrollTop = el.scrollHeight;
    lastCount.current = posts.length;
    api(`/boards/${bid}/read`, { body: {} }).then(countsChanged, () => undefined);
  });

  function addFiles(list: FileList | File[] | null) {
    if (!can(me, "files.send")) return;
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      const problem = fileProblem(f.name, f.size);
      if (problem) {
        toast(`${f.name}: ${t(problem)}`);
        continue;
      }
      if (next.length >= MAX_FILES_PER_MESSAGE) {
        toast(t("Send up to {n} files at a time.", { n: MAX_FILES_PER_MESSAGE }));
        break;
      }
      next.push({ file: f, url: /^image\/(jpeg|png|gif|webp)$/.test(f.type) ? URL.createObjectURL(f) : null });
    }
    setFiles(next);
    box.current?.focus();
  }

  function resetBox() {
    setText("");
    setReplyTo(null);
    setEditing(null);
    setFiles([]);
    if (box.current) box.current.style.height = "auto";
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if ((!text.trim() && !files.length) || sending) return;
    if (files.reduce((n, f) => n + f.file.size, 0) > MAX_MESSAGE_BYTES) return setErr(t("Those files are too big to send together. Send them in two messages."));
    setErr(null);
    setSending(true);
    try {
      if (editing) {
        await api(`/boards/${bid}/posts/${encodeURIComponent(editing.id)}`, { method: "PATCH", body: { body: text } });
      } else if (files.length) {
        const form = new FormData();
        form.set("body", text);
        if (replyTo) form.set("parentId", replyTo.id);
        for (const f of files) form.append("files", f.file, f.file.name);
        await apiForm(`/boards/${bid}/posts`, form);
      } else {
        await api(`/boards/${bid}/posts`, { body: { body: text, parentId: replyTo?.id } });
      }
      resetBox();
      atBottom.current = true;
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

  async function exportChat(title: string) {
    try {
      const res = await fetch(`/api/boards/${bid}/export`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Something went wrong.");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = `${title.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "chat"}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (x) {
      toast((x as Error).message);
    }
  }

  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const b = data.board;
  const kind: Kind = b.kind === "chat" ? "chat" : "board";
  const title = chatTitle({ ...b, members: data.members }, me.id);
  const others = (data.members ?? []).filter((m: any) => m.id !== me.id);
  const direct = kind === "chat" && !b.name && others.length <= 1;
  const subtitle = kind === "chat"
    ? direct ? roleLabel(others[0]?.role) : [t("You"), ...others.map((m: any) => m.name)].join(", ")
    : [b.locked ? t("Announcements") : null, b.description ?? audienceText(b.audience)].filter(Boolean).join(" · ");
  const byId = new Map(posts.map((p) => [p.id, p]));
  const pinned = posts.filter((p) => p.pinned).at(-1);
  const s = search?.trim().toLowerCase() ?? "";
  const visible = s ? posts.filter((p) => p.kind !== "event" && p.body.toLowerCase().includes(s) || p.files.some((f: any) => f.name.toLowerCase().includes(s))) : posts;
  const canPin = kind === "chat" || data.canModerate;
  const canExport = kind === "chat" || data.canModerate;

  const menu: MenuItem[] = [
    { heading: title, sub: kind === "chat" ? t("Private chat") : t("Board") },
    { label: t("Search in chat"), onSelect: () => { setSearch(""); setPanel(null); } },
    { label: t("Photos and files"), onSelect: () => setPanel("files") },
    { label: t("Mute alerts"), role: "checkbox", checked: data.muted, onSelect: () => act(`/boards/${bid}/mute`, "POST", { muted: !data.muted }) },
    { label: t("Export chat (.txt)"), onSelect: () => exportChat(title), hidden: !canExport },
    "sep",
    { label: t("People in this chat ({n})", { n: data.members?.length ?? 0 }), onSelect: () => setPanel("people"), hidden: kind !== "chat" },
    { label: t("Add people"), onSelect: () => setPanel("add"), hidden: kind !== "chat" },
    { label: kind === "chat" ? t("Rename group") : t("Edit board"), onSelect: () => setPanel("edit"), hidden: !data.canModerate || direct },
    { label: t("Announcements only"), hint: t("Only you and moderators can post"), role: "checkbox", checked: !!b.locked, onSelect: () => act(`/boards/${bid}`, "PATCH", { locked: !b.locked }), hidden: kind !== "board" || !data.canModerate },
    { label: t("Leave chat"), danger: true, onSelect: async () => { await act(`/boards/${bid}/leave`, "POST", {}); navigate("/chats"); }, hidden: kind !== "chat" || direct },
    { label: t("Archive board"), danger: true, onSelect: async () => { await act(`/boards/${bid}/archive`, "POST", {}); navigate("/boards"); }, hidden: kind !== "board" || !data.canModerate },
  ];

  return (
    <div
      className={`chat${dragging ? " dragging" : ""}`}
      onDragOver={(e) => { if (data.canPost && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (data.canPost) addFiles(e.dataTransfer.files); }}
    >
      <div className="chat-head">
        <span className={`avatar${kind === "chat" ? " person" : ""}`} aria-hidden="true">{initials(title)}</span>
        {kind === "chat" ? (
          <button type="button" className="chat-title as-button" onClick={() => setPanel(panel === "people" || panel === "add" ? null : "people")} aria-label={t("{title}. Show people in this chat.", { title })}>
            <h1>{title}</h1>
            <span className="muted">{data.muted && <span className="muted-ic"><BellOff /></span>}{subtitle}</span>
          </button>
        ) : (
          <div className="chat-title">
            <h1>{title}</h1>
            <span className="muted">{data.muted && <span className="muted-ic"><BellOff /></span>}{subtitle}</span>
          </div>
        )}
        <button type="button" className="iconbtn" aria-label={t("Search in chat")} title={t("Search in chat")} onClick={() => setSearch(search === null ? "" : null)}><Search /></button>
        <Menu label={t("Chat options")} trigger={<Dots />} items={menu} />
      </div>
      {search !== null && (
        <div className="chat-search">
          <Search size={18} />
          <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search messages and file names")} aria-label={t("Search in chat")} />
          {s && <span className="muted">{t("{n} found", { n: visible.length })}</span>}
          <button type="button" className="iconbtn" aria-label={t("Close search")} onClick={() => setSearch(null)}><Close size={18} /></button>
        </div>
      )}
      {pinned && !s && panel === null && (
        <button type="button" className="chat-pinned" onClick={() => document.getElementById(`m-${pinned.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" })}>
          <span className="pill p-warn">{t("Pinned")}</span> <span className="chat-pinned-text">{pinned.body || t("Photo or file")}</span>
        </button>
      )}

      {panel === "files" && <FilesPanel bid={bid} onClose={() => setPanel(null)} onView={setViewer} />}
      {(panel === "people" || panel === "add") && <PeoplePanel key={panel} startAdding={panel === "add"} data={data} me={me} direct={direct} onClose={() => setPanel(null)} onChanged={(newId) => { if (newId) { setPanel(null); navigate(`/chats/${newId}`); } else reload(); }} />}
      {panel === "edit" && <EditPanel data={data} me={me} onClose={() => setPanel(null)} onSaved={() => { setPanel(null); reload(); }} />}

      {panel === null && (
        <div className="chat-scroll" ref={scroller} role="log" aria-live="polite" aria-label={t("Messages")}>
          {!posts.length && <Empty>{t("No messages yet. Say hello.")}</Empty>}
          {s && !visible.length && <Empty>{t("Nothing matches.")}</Empty>}
          {visible.map((p, i) => {
            const d = new Date(p.created_at);
            const prev = visible[i - 1];
            const newDay = !prev || !sameDay(new Date(prev.created_at), d);
            const mine = p.user_id === me.id;
            if (p.kind === "event") {
              return (
                <div key={p.id}>
                  {newDay && <div className="chat-day"><span>{dayLabel(d)}</span></div>}
                  <div className="chat-event" id={`m-${p.id}`}><span>{eventText(p, me.id)} · {clock(p.created_at)}</span></div>
                </div>
              );
            }
            const grouped = !s && !newDay && prev && prev.kind !== "event" && prev.user_id === p.user_id && d.getTime() - Date.parse(prev.created_at) < 5 * 60000;
            const parent = p.parent_id ? byId.get(p.parent_id) : null;
            const open = picked === p.id;
            const photos = p.files.filter((f: any) => f.kind === "image");
            const docs = p.files.filter((f: any) => f.kind !== "image");
            return (
              <div key={p.id}>
                {newDay && <div className="chat-day"><span>{dayLabel(d)}</span></div>}
                <div id={`m-${p.id}`} className={`msg${mine ? " mine" : ""}${grouped ? " grouped" : ""}${open ? " open" : ""}`}>
                  <div className={`bubble${photos.length && !p.body && !docs.length ? " photo-only" : ""}`}>
                    {!mine && !grouped && kind !== "chat" && <span className="bubble-author">{p.author}</span>}
                    {!mine && !grouped && kind === "chat" && !direct && <span className="bubble-author">{p.author}</span>}
                    {parent && (
                      <span className="bubble-quote"><b>{parent.user_id === me.id ? t("You") : parent.author}</b><span>{parent.body || t("Photo or file")}</span></span>
                    )}
                    {!!photos.length && (
                      <span className={`bubble-photos n${Math.min(photos.length, 4)}`}>
                        {photos.slice(0, 4).map((f: any, n: number) => (
                          <button key={f.id} type="button" className="photo" onClick={() => setViewer(f)} aria-label={t("Open photo {name}", { name: f.name })}>
                            <img src={fileUrl(f)} alt={f.name} loading="lazy" />
                            {n === 3 && photos.length > 4 && <span className="more">+{photos.length - 4}</span>}
                          </button>
                        ))}
                      </span>
                    )}
                    {docs.map((f: any) => (
                      <a key={f.id} className="filecard" href={fileUrl(f, true)} download={f.name}>
                        <FileBadge ext={f.ext} kind={f.kind} />
                        <span className="filecard-text"><b>{f.name}</b><small>{fmtSize(f.size)} · {f.ext.toUpperCase()}</small></span>
                        <span className="filecard-dl" aria-label={t("Download")}><Download size={18} /></span>
                      </a>
                    ))}
                    {/* Tap the text (or the time) for Reply, Copy, Edit and the rest. Shown as text: nothing typed can run as code. */}
                    <button type="button" className="bubble-body" onClick={() => setPicked(open ? null : p.id)} aria-expanded={open} aria-label={t("Message from {name}. Tap for options.", { name: mine ? t("You") : p.author })}>
                      {p.body && <span className="bubble-text">{p.body}</span>}
                      <span className="bubble-meta">{p.pinned ? `${t("Pinned")} · ` : ""}{p.edited_at ? `${t("edited")} · ` : ""}{clock(p.created_at)}</span>
                    </button>
                  </div>
                  {open && (
                    <div className="msg-actions">
                      {data.canPost && <button className="btn small" onClick={() => { setReplyTo(p); setEditing(null); setPicked(null); box.current?.focus(); }}>{t("Reply")}</button>}
                      {p.body && <button className="btn small" onClick={() => navigator.clipboard.writeText(p.body).then(() => { toast(t("Copied")); setPicked(null); }, () => toast(t("Couldn't copy")))}>{t("Copy")}</button>}
                      {mine && p.body && <button className="btn small" onClick={() => { setEditing(p); setReplyTo(null); setFiles([]); setText(p.body); setPicked(null); box.current?.focus(); }}>{t("Edit")}</button>}
                      {canPin && <button className="btn small" onClick={() => act(`/boards/${bid}/posts/${p.id}`, "PATCH", { pinned: !p.pinned })}>{p.pinned ? t("Unpin") : t("Pin")}</button>}
                      {(mine || data.canModerate) && <button className="btn small danger" onClick={() => act(`/boards/${bid}/posts/${p.id}`, "DELETE")}>{t("Remove")}</button>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {panel === null && (data.canPost ? (
        <form className="chat-compose" onSubmit={send}>
          {(replyTo || editing) && (
            <div className="compose-reply">
              <span>
                <b>{editing ? t("Editing your message") : replyTo.user_id === me.id ? t("Replying to yourself") : t("Replying to {name}", { name: replyTo.author })}</b>
                <span className="muted">{(editing ?? replyTo).body || t("Photo or file")}</span>
              </span>
              <button type="button" className="linkish" onClick={() => { if (editing) setText(""); setReplyTo(null); setEditing(null); }} aria-label={t("Cancel")}>{t("Cancel")}</button>
            </div>
          )}
          {!!files.length && (
            <div className="compose-files">
              {files.map((f, n) => (
                <span key={n} className="pending">
                  {f.url ? <img src={f.url} alt="" /> : <FileBadge ext={f.file.name.split(".").pop() ?? ""} kind="doc" />}
                  <span className="pending-text"><b>{f.file.name}</b><small>{fmtSize(f.file.size)}</small></span>
                  <button type="button" className="iconbtn" aria-label={t("Remove {name}", { name: f.file.name })} onClick={() => setFiles(files.filter((_, i) => i !== n))}><Close size={16} /></button>
                </span>
              ))}
            </div>
          )}
          <ErrorNote error={err} />
          <div className="compose-row">
            {!editing && can(me, "files.send") && (
              <>
                <button type="button" className="iconbtn compose-btn" aria-label={t("Attach photos or files")} title={t("Attach photos or files")} onClick={() => attach.current?.click()}><Clip /></button>
                <button type="button" className="iconbtn compose-btn touch-only" aria-label={t("Take a photo")} onClick={() => camera.current?.click()}><Camera /></button>
                <input ref={attach} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
                <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              </>
            )}
            <textarea
              ref={box}
              id="msg"
              rows={1}
              value={text}
              placeholder={files.length ? t("Add a message (optional)") : t("Message")}
              aria-label={t("Message")}
              maxLength={5000}
              onChange={(e) => {
                setText(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
              }}
              onPaste={(e) => {
                // Paste a screenshot or copied file straight into the chat.
                if (!editing && e.clipboardData.files.length) {
                  e.preventDefault();
                  addFiles(e.clipboardData.files);
                }
              }}
              onKeyDown={(e) => {
                // Enter sends on a computer; Shift+Enter makes a new line. Phones use the Send button.
                if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button className="send" type="submit" disabled={(!text.trim() && !files.length) || sending} aria-label={editing ? t("Save") : t("Send")}>
              {sending ? <span className="spinner" aria-hidden="true" /> : <Send />}
            </button>
          </div>
          <span className="drop-hint" aria-hidden="true">{t("Drop files to add them")}</span>
        </form>
      ) : (
        <div className="chat-locked">{t("Only the board's creator and moderators can post here.")}</div>
      ))}

      {viewer && <PhotoViewer f={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}

function FilesPanel({ bid, onClose, onView }: { bid: string; onClose: () => void; onView: (f: any) => void }) {
  const { data } = useLoad(() => api(`/boards/${bid}/files`), [bid]);
  const photos = (data?.files ?? []).filter((f: any) => f.kind === "image");
  const docs = (data?.files ?? []).filter((f: any) => f.kind !== "image");
  return (
    <div className="chat-panel">
      <div className="chat-panel-head"><b>{t("Photos and files")}</b><button type="button" className="iconbtn" aria-label={t("Close")} onClick={onClose}><Close /></button></div>
      {data && !data.files.length && <Empty>{t("Nothing has been shared here yet.")}</Empty>}
      {!!photos.length && (
        <>
          <h2>{t("Photos")}</h2>
          <div className="gallery">
            {photos.map((f: any) => <button key={f.id} type="button" className="photo" onClick={() => onView(f)} aria-label={t("Open photo {name}", { name: f.name })}><img src={fileUrl(f)} alt={f.name} loading="lazy" /></button>)}
          </div>
        </>
      )}
      {!!docs.length && (
        <>
          <h2>{t("Files")}</h2>
          {docs.map((f: any) => (
            <a key={f.id} className="filecard wide" href={fileUrl(f, true)} download={f.name}>
              <FileBadge ext={f.ext} kind={f.kind} />
              <span className="filecard-text"><b>{f.name}</b><small>{fmtSize(f.size)} · {f.author} · {when(f.created_at)}</small></span>
              <span className="filecard-dl" aria-label={t("Download")}><Download size={18} /></span>
            </a>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * Who is in a chat. Anyone in it can add people; the person who started it can remove people.
 * Adding someone to a one-to-one chat starts a new group, so the two-person history stays private.
 */
function PeoplePanel({ data, me, direct, startAdding, onClose, onChanged }: { data: any; me: Me; direct: boolean; startAdding: boolean; onClose: () => void; onChanged: (newChatId?: string) => void }) {
  const b = data.board;
  const members: any[] = [...(data.members ?? [])].sort((x, y) => (x.id === me.id ? -1 : y.id === me.id ? 1 : x.name.localeCompare(y.name)));
  const [adding, setAdding] = useState(startAdding);
  const [add, setAdd] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const other = members.find((m) => m.id !== me.id);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const addNow = () => run(async () => {
    const r = await api(`/boards/${encodeURIComponent(b.id)}/people`, { body: { userIds: add } });
    toast(r.newChat ? t("New group chat started") : add.length === 1 ? t("1 person added") : t("{n} people added", { n: add.length }));
    setAdd([]);
    setAdding(false);
    onChanged(r.newChat ? r.id : undefined);
  });
  const removeNow = (m: any) => run(async () => {
    await api(`/boards/${encodeURIComponent(b.id)}/people/${encodeURIComponent(m.id)}`, { method: "DELETE" });
    toast(t("{name} was removed", { name: m.name }));
    setConfirm(null);
    onChanged();
  });
  return (
    <div className="chat-panel stack">
      <div className="chat-panel-head"><b>{t("People in this chat ({n})", { n: members.length })}</b><button type="button" className="iconbtn" aria-label={t("Close")} onClick={onClose}><Close /></button></div>
      <div className="people-list">
        {members.map((m) => (
          <div key={m.id} className="people-row">
            <span className="avatar person" aria-hidden="true">{initials(m.name)}</span>
            <span className="people-text">
              <b>{m.id === me.id ? t("You") : m.name}</b>
              <small className="muted">{[roleLabel(m.role), m.id === b.created_by ? t("Started this chat") : null].filter(Boolean).join(" · ")}</small>
            </span>
            {data.canModerate && m.id !== me.id && !direct && (confirm === m.id ? (
              <span className="people-confirm">
                <button type="button" className="btn small danger" disabled={busy} onClick={() => removeNow(m)}>{t("Remove")}</button>
                <button type="button" className="btn small" onClick={() => setConfirm(null)}>{t("Cancel")}</button>
              </span>
            ) : (
              <button type="button" className="btn small" onClick={() => setConfirm(m.id)} aria-label={t("Remove {name} from this chat", { name: m.name })}>{t("Remove")}</button>
            ))}
          </div>
        ))}
      </div>
      {confirm && <p className="muted small-note">{t("They'll stop seeing this chat, its messages and its files. Everyone in the chat will see that they were removed.")}</p>}
      {adding ? (
        <div className="stack">
          <b>{t("Add people")}</b>
          {direct && other && <p className="muted small-note">{t("This starts a new group chat. Your messages with {name} stay private between the two of you.", { name: other.name })}</p>}
          {!direct && <p className="muted small-note">{t("People you add can see the messages and files already in this chat.")}</p>}
          <PeoplePicker picked={add} setPicked={setAdd} exclude={members.map((m) => m.id)} />
          <div className="row">
            <button type="button" className="btn primary" disabled={!add.length || busy} onClick={addNow}>{direct ? t("Start group chat") : add.length > 1 ? t("Add {n} people", { n: add.length }) : t("Add")}</button>
            <button type="button" className="btn" onClick={() => { setAdding(false); setAdd([]); }}>{t("Cancel")}</button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>{t("Add people")}</button>
        </div>
      )}
      <ErrorNote error={err} />
    </div>
  );
}

function EditPanel({ data, me, onClose, onSaved }: { data: any; me: Me; onClose: () => void; onSaved: () => void }) {
  const b = data.board;
  const [name, setName] = useState(b.name);
  const [desc, setDesc] = useState(b.description ?? "");
  const [roles, setRoles] = useState<string[]>(b.audience ? JSON.parse(b.audience) : []);
  const [err, setErr] = useState<string | null>(null);
  const chat = b.kind === "chat";
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/boards/${encodeURIComponent(b.id)}`, { method: "PATCH", body: chat ? { name } : { name, description: desc, audience: roles } });
      toast(t("Saved"));
      onSaved();
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  return (
    <form className="chat-panel stack" onSubmit={save}>
      <div className="chat-panel-head"><b>{chat ? t("Rename group") : t("Edit board")}</b><button type="button" className="iconbtn" aria-label={t("Close")} onClick={onClose}><Close /></button></div>
      <div className="field"><label htmlFor="en">{chat ? t("Group name (optional)") : t("Board name")}</label><input id="en" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required={!chat} /></div>
      {!chat && <div className="field"><label htmlFor="ed">{t("What it's for (optional)")}</label><input id="ed" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} /></div>}
      {!chat && <RolePicker roles={roles} setRoles={setRoles} />}
      <ErrorNote error={err} />
      <div className="row"><button className="btn primary" type="submit">{t("Save")}</button><button className="btn" type="button" onClick={onClose}>{t("Cancel")}</button></div>
    </form>
  );
}

function PhotoViewer({ f, onClose }: { f: any; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={f.name} onClick={onClose}>
      <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span>{f.name}{f.author ? ` · ${f.author}` : ""}</span>
        <a className="iconbtn" href={fileUrl(f, true)} download={f.name} aria-label={t("Download")} title={t("Download")}><Download /></a>
        <button type="button" className="iconbtn" onClick={onClose} aria-label={t("Close")} title={t("Close")}><Close /></button>
      </div>
      <img src={fileUrl(f)} alt={f.name} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
