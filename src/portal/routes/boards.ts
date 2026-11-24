// Message boards and private chats.
//
// Boards are team rooms: open to all staff, or only to some roles. Anyone on staff can make one.
// Chats are private conversations between people (one-to-one or a small group). Only the people
// in a chat can see it, admins included (Aaron's choice, 2026-11-24).
// Both live in the boards table (kind = 'board' or 'chat') and share the same screens.
//
// Messages are plain text: the app never renders them as HTML, so nothing anyone types can
// run as code. Files sent with a message go to R2 and are only served to people who can see
// that board or chat (see routes/files.ts).
import { Hono, type Context } from "hono";
import { randomId } from "../../shared/crypto";
import { cleanName, fileInfo, fileProblem, MAX_FILES_PER_MESSAGE, MAX_MESSAGE_BYTES } from "../../shared/files";
import type { AppEnv, SessionUser } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, mustStr, requirePerm, str } from "../lib/http";
import { can, isRole } from "../lib/roles";

export const boards = new Hono<AppEnv>();

export interface BoardRow {
  id: string; kind: "board" | "chat"; name: string; description: string | null; audience: string | null; machine_id: string | null;
  created_by: string; created_at: string; archived_at: string | null; locked: number;
}

const MAX_CHAT_PEOPLE = 30;

/** Who can see a board or chat. `member` = this person is listed in the chat's members. */
export function canSee(user: SessionUser, b: Pick<BoardRow, "kind" | "audience">, member: boolean): boolean {
  if (b.kind === "chat") return member; // private: members only, admins too
  if (user.role === "admin" || !b.audience) return true;
  try {
    const roles = JSON.parse(b.audience) as string[];
    return roles.includes(user.role);
  } catch {
    return false; // a damaged audience list hides the board rather than showing it to everyone
  }
}

async function isMember(db: D1Database, boardId: string, userId: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?").bind(boardId, userId).first());
}

export async function loadBoard(db: D1Database, user: SessionUser, id: string): Promise<BoardRow> {
  const b = await db.prepare("SELECT * FROM boards WHERE id = ?").bind(id).first<BoardRow>();
  // Same answer for "doesn't exist" and "not allowed", so ids can't be probed.
  if (!b || !canSee(user, b, b.kind === "chat" && (await isMember(db, b.id, user.id)))) fail(404, "Not found.");
  return b;
}

/** Board: the creator or a moderator. Chat: whoever started it. */
function moderates(u: SessionUser, b: BoardRow): boolean {
  if (b.kind === "chat") return b.created_by === u.id;
  return can(u.role, "boards.moderate") || b.created_by === u.id;
}

function canPost(u: SessionUser, b: BoardRow): boolean {
  return !b.archived_at && (!b.locked || moderates(u, b));
}

/** The chat list for one person: boards or chats, newest activity first, with unread counts. */
async function listFor(db: D1Database, u: SessionUser, kind: "board" | "chat", archived = false) {
  const memberJoin = kind === "chat" ? "JOIN board_members me ON me.board_id = b.id AND me.user_id = ?1" : "";
  const { results } = await db.prepare(
    `SELECT b.*,
            (SELECT MAX(created_at) FROM posts p WHERE p.board_id = b.id AND p.deleted_at IS NULL AND p.kind = 'post') AS last_post_at,
            m.serial AS machine_serial,
            (SELECT COUNT(*) FROM posts p WHERE p.board_id = b.id AND p.deleted_at IS NULL AND p.kind = 'post' AND p.user_id != ?1
                AND p.created_at > COALESCE((SELECT last_read_at FROM board_reads r WHERE r.user_id = ?1 AND r.board_id = b.id), '')) AS unread,
            COALESCE((SELECT muted FROM board_reads r WHERE r.user_id = ?1 AND r.board_id = b.id), 0) AS muted,
            lp.user_id AS last_user_id, lu.name AS last_author, substr(lp.body, 1, 120) AS last_body,
            (SELECT COUNT(*) FROM attachments a WHERE a.post_id = lp.id AND a.deleted_at IS NULL) AS last_files,
            (SELECT json_group_array(json_object('id', mu.id, 'name', mu.name)) FROM board_members bm JOIN users mu ON mu.id = bm.user_id
              WHERE bm.board_id = b.id) AS members
       FROM boards b ${memberJoin}
       LEFT JOIN machines m ON m.id = b.machine_id
       LEFT JOIN posts lp ON lp.id = (SELECT id FROM posts p WHERE p.board_id = b.id AND p.deleted_at IS NULL AND p.kind = 'post' ORDER BY p.created_at DESC LIMIT 1)
       LEFT JOIN users lu ON lu.id = lp.user_id
      WHERE b.kind = ?2 AND b.archived_at IS ${archived ? "NOT NULL" : "NULL"}
      ORDER BY COALESCE(last_post_at, b.created_at) DESC`,
  ).bind(u.id, kind).all<BoardRow & { unread: number; muted: number; members: string }>();
  return results
    .filter((b) => canSee(u, b, true))
    .map((b) => ({ ...b, members: kind === "chat" ? (JSON.parse(b.members) as { id: string; name: string }[]) : undefined }));
}

boards.get("/", async (c) => {
  const u = requirePerm(c, "boards.use");
  const kind = c.req.query("kind") === "chat" ? "chat" : "board";
  return c.json({ boards: await listFor(c.env.DB, u, kind) });
});

/** Archived boards, for moderators to look through and restore. */
boards.get("/archived", async (c) => {
  const u = requirePerm(c, "boards.moderate");
  return c.json({ boards: await listFor(c.env.DB, u, "board", true) });
});

/** Everyone on staff who can be added to a chat. */
boards.get("/people", async (c) => {
  const u = requirePerm(c, "boards.use");
  const { results } = await c.env.DB.prepare("SELECT id, name, role FROM users WHERE status = 'active' AND id != ? ORDER BY name").bind(u.id).all();
  return c.json({ people: results });
});

/**
 * New messages from other people since `since`, for the pop-up alerts on a computer and the
 * unread counts on the menu. Muted chats never pop up. Returns the server's time to ask from next.
 */
boards.get("/updates", async (c) => {
  const u = requirePerm(c, "boards.use");
  const at = now();
  const [boardList, chatList] = await Promise.all([listFor(c.env.DB, u, "board"), listFor(c.env.DB, u, "chat")]);
  const unread = { boards: boardList.reduce((n, b) => n + b.unread, 0), chats: chatList.reduce((n, b) => n + b.unread, 0) };
  const since = c.req.query("since") ?? "";
  if (!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(since)) return c.json({ now: at, posts: [], unread });
  const floor = new Date(Date.now() - 10 * 60000).toISOString(); // never more than the last 10 minutes
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.board_id, substr(p.body, 1, 160) AS body, p.created_at, u.name AS author, b.name AS board_name, b.kind, b.audience,
            (SELECT COUNT(*) FROM attachments a WHERE a.post_id = p.id) AS files,
            COALESCE((SELECT muted FROM board_reads r WHERE r.user_id = ?1 AND r.board_id = b.id), 0) AS muted,
            EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = b.id AND m.user_id = ?1) AS member
       FROM posts p JOIN boards b ON b.id = p.board_id JOIN users u ON u.id = p.user_id
      WHERE p.created_at > ?2 AND p.user_id != ?1 AND p.deleted_at IS NULL AND p.kind = 'post' AND b.archived_at IS NULL
      ORDER BY p.created_at DESC LIMIT 50`,
  ).bind(u.id, since > floor ? since : floor).all<{ id: string; board_id: string; body: string; created_at: string; author: string; board_name: string; kind: "board" | "chat"; audience: string | null; files: number; muted: number; member: number }>();
  const posts = results
    .filter((p) => !p.muted && canSee(u, p, !!p.member))
    .slice(0, 5)
    .map(({ audience: _a, muted: _m, member: _x, ...p }) => p);
  return c.json({ now: at, posts, unread });
});

/** Mark every board and chat read. */
boards.post("/read-all", async (c) => {
  const u = requirePerm(c, "boards.use");
  const all = [...(await listFor(c.env.DB, u, "board")), ...(await listFor(c.env.DB, u, "chat"))];
  const at = now();
  const stmt = c.env.DB.prepare(
    "INSERT INTO board_reads (user_id, board_id, last_read_at) VALUES (?,?,?) ON CONFLICT (user_id, board_id) DO UPDATE SET last_read_at = excluded.last_read_at",
  );
  if (all.length) await c.env.DB.batch(all.map((b) => stmt.bind(u.id, b.id, at)));
  return c.json({ ok: true });
});

boards.post("/", async (c) => {
  const u = requirePerm(c, "boards.use");
  const b = await body(c);
  const name = mustStr(b.name, 80, "Board name");
  const description = str(b.description, 500);
  let audience: string | null = null;
  if (Array.isArray(b.audience) && b.audience.length) {
    if (!b.audience.every(isRole)) fail(400, "Unknown role in who can see it.");
    const roles = [...new Set([...(b.audience as string[]), u.role])]; // the creator can always see their board
    audience = JSON.stringify(roles);
  }
  let machineId: string | null = null;
  if (typeof b.machineId === "string" && b.machineId) {
    const m = await c.env.DB.prepare("SELECT id FROM machines WHERE id = ?").bind(b.machineId).first();
    if (!m) fail(400, "Unknown machine.");
    machineId = b.machineId;
  }
  const id = randomId();
  await c.env.DB.prepare("INSERT INTO boards (id, kind, name, description, audience, machine_id, created_by, created_at) VALUES (?,'board',?,?,?,?,?,?)")
    .bind(id, name, description, audience, machineId, u.id, now())
    .run();
  await audit(c.env.DB, { userId: u.id, action: "board.create", targetType: "board", targetId: id, detail: { name, audience }, ip: c.get("ip") });
  return c.json({ id });
});

async function activeUsers(db: D1Database, ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) fail(400, "Pick who to chat with.");
  const unique = [...new Set(ids as string[])];
  if (unique.length > MAX_CHAT_PEOPLE) fail(400, `A chat can have up to ${MAX_CHAT_PEOPLE} people.`);
  if (!unique.length) return [];
  const { results } = await db.prepare(`SELECT id FROM users WHERE status = 'active' AND id IN (${unique.map(() => "?").join(",")})`).bind(...unique).all<{ id: string }>();
  if (results.length !== unique.length) fail(400, "Someone you picked can't be found.");
  return unique;
}

/** Start a private chat. A one-to-one chat that already exists is reopened instead of doubled. */
boards.post("/chats", async (c) => {
  const u = requirePerm(c, "boards.use");
  const b = await body(c);
  const others = (await activeUsers(c.env.DB, b.userIds)).filter((x) => x !== u.id);
  if (!others.length) fail(400, "Pick who to chat with.");
  const name = str(b.name, 80) ?? "";
  if (others.length === 1 && !name) {
    const existing = await c.env.DB.prepare(
      `SELECT b.id FROM boards b WHERE b.kind = 'chat' AND b.name = '' AND b.archived_at IS NULL
         AND (SELECT COUNT(*) FROM board_members m WHERE m.board_id = b.id) = 2
         AND EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = b.id AND m.user_id = ?)
         AND EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = b.id AND m.user_id = ?)`,
    ).bind(u.id, others[0]).first<{ id: string }>();
    if (existing) return c.json({ id: existing.id });
  }
  const id = randomId();
  const at = now();
  const add = c.env.DB.prepare("INSERT INTO board_members (board_id, user_id, added_at) VALUES (?,?,?)");
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO boards (id, kind, name, created_by, created_at) VALUES (?,'chat',?,?,?)").bind(id, name, u.id, at),
    ...[u.id, ...others].map((m) => add.bind(id, m, at)),
  ]);
  return c.json({ id });
});

/** Files on one board or chat, newest first, plus the post they belong to. */
async function filesFor(db: D1Database, boardId: string, postIds?: string[]) {
  if (postIds && !postIds.length) return [];
  const where = postIds ? `post_id IN (${postIds.map(() => "?").join(",")})` : "board_id = ?";
  const { results } = await db.prepare(
    `SELECT a.id, a.post_id, a.name, a.ext, a.size, a.created_at, u.name AS author FROM attachments a JOIN users u ON u.id = a.user_id
      WHERE ${where} AND a.deleted_at IS NULL ORDER BY a.created_at DESC, a.rowid DESC LIMIT 500`,
  ).bind(...(postIds ?? [boardId])).all<{ id: string; post_id: string; name: string; ext: string; size: number; created_at: string; author: string }>();
  return results.map((f) => ({ ...f, kind: fileInfo(f.name)?.kind ?? "doc" }));
}

boards.get("/:id", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  const { results: posts } = await c.env.DB.prepare(
    `SELECT p.id, p.kind, p.parent_id, p.body, p.pinned, p.created_at, p.edited_at, p.user_id, u.name AS author
       FROM posts p JOIN users u ON u.id = p.user_id
      WHERE p.board_id = ? AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 300`,
  ).bind(board.id).all<{ id: string }>();
  const files = await filesFor(c.env.DB, board.id, posts.map((p) => p.id));
  const byPost = new Map<string, typeof files>();
  for (const f of files) byPost.set(f.post_id, [...(byPost.get(f.post_id) ?? []), f]);
  const read = await c.env.DB.prepare("SELECT muted FROM board_reads WHERE user_id = ? AND board_id = ?").bind(u.id, board.id).first<{ muted: number }>();
  const members = board.kind === "chat"
    ? (await c.env.DB.prepare("SELECT u.id, u.name, u.role FROM board_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = ? ORDER BY u.name").bind(board.id).all()).results
    : undefined;
  return c.json({
    board,
    members,
    posts: posts.map((p) => ({ ...p, files: (byPost.get(p.id) ?? []).reverse() })),
    canModerate: moderates(u, board),
    canPost: canPost(u, board),
    muted: !!read?.muted,
  });
});

boards.get("/:id/files", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  return c.json({ files: await filesFor(c.env.DB, board.id) });
});

/** Mark the board read up to now (the chat screen calls this when it shows new messages). */
boards.post("/:id/read", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  await c.env.DB.prepare(
    "INSERT INTO board_reads (user_id, board_id, last_read_at) VALUES (?,?,?) ON CONFLICT (user_id, board_id) DO UPDATE SET last_read_at = excluded.last_read_at",
  ).bind(u.id, board.id, now()).run();
  return c.json({ ok: true });
});

/** Mute or unmute pop-up alerts for one board or chat (for this person only). */
boards.post("/:id/mute", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  const muted = (await body(c)).muted === true ? 1 : 0;
  await c.env.DB.prepare(
    "INSERT INTO board_reads (user_id, board_id, last_read_at, muted) VALUES (?,?,'',?) ON CONFLICT (user_id, board_id) DO UPDATE SET muted = excluded.muted",
  ).bind(u.id, board.id, muted).run();
  return c.json({ muted: !!muted });
});

/** Change a board's name, description, who can see it, or announcement-only. Chats: name and people. */
boards.patch("/:id", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  if (!moderates(u, board)) fail(403, board.kind === "chat" ? "Only the person who started this chat can change it." : "Only the board's creator or a moderator can change it.");
  const b = await body(c);
  const stmts: D1PreparedStatement[] = [];
  if (board.kind === "board") {
    const name = b.name === undefined ? board.name : mustStr(b.name, 80, "Board name");
    const description = b.description === undefined ? board.description : str(b.description, 500);
    let audience = board.audience;
    if (b.audience !== undefined) {
      if (!Array.isArray(b.audience) || !b.audience.every(isRole)) fail(400, "Unknown role in who can see it.");
      audience = b.audience.length ? JSON.stringify([...new Set([...(b.audience as string[]), u.role])]) : null;
    }
    const locked = b.locked === undefined ? board.locked : b.locked === true ? 1 : 0;
    stmts.push(c.env.DB.prepare("UPDATE boards SET name = ?, description = ?, audience = ?, locked = ? WHERE id = ?").bind(name, description, audience, locked, board.id));
  } else {
    if (b.name !== undefined) stmts.push(c.env.DB.prepare("UPDATE boards SET name = ? WHERE id = ?").bind(str(b.name, 80) ?? "", board.id));
    // Older screens sent people changes here too; they follow the same rules as the People panel.
    if (Array.isArray(b.addUserIds) && b.addUserIds.length) await addPeople(c, u, board, b.addUserIds);
    if (Array.isArray(b.removeUserIds)) {
      for (const id of b.removeUserIds as unknown[]) if (typeof id === "string" && id !== u.id) await removePerson(c, u, board, id);
    }
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  await audit(c.env.DB, { userId: u.id, action: `${board.kind}.update`, targetType: board.kind, targetId: board.id, ip: c.get("ip") });
  return c.json({ ok: true });
});

/** Record "Aaron added Steve" (or removed, or left) as a line in the chat. */
function eventPost(db: D1Database, boardId: string, actorId: string, type: "added" | "removed" | "left", names: string[]) {
  return db.prepare("INSERT INTO posts (id, board_id, user_id, body, kind, created_at) VALUES (?,?,?,?,'event',?)")
    .bind(randomId(), boardId, actorId, JSON.stringify({ type, names }), now());
}

/** The words for an event line, in English (used for the .txt export). */
export function eventText(actor: string, body: string): string {
  try {
    const e = JSON.parse(body) as { type: string; names: string[] };
    const names = e.names.join(", ");
    if (e.type === "added") return `${actor} added ${names}`;
    if (e.type === "removed") return `${actor} removed ${names}`;
    if (e.type === "left") return `${actor} left the chat`;
  } catch {
    /* fall through */
  }
  return actor;
}

/** A one-to-one chat: no group name and just two people. */
async function isDirect(db: D1Database, board: BoardRow): Promise<boolean> {
  if (board.name) return false;
  const n = (await db.prepare("SELECT COUNT(*) AS n FROM board_members WHERE board_id = ?").bind(board.id).first<{ n: number }>())!.n;
  return n <= 2;
}

/**
 * Add people to a chat. Anyone in the chat can add people.
 * A one-to-one chat stays private between its two people, so adding someone to it starts a new
 * group chat with all of them instead. Returns the chat the people ended up in.
 */
async function addPeople(c: Context<AppEnv>, u: SessionUser, board: BoardRow, ids: unknown): Promise<string> {
  if (board.kind !== "chat") fail(400, "People can only be added to chats.");
  const db = c.env.DB;
  const { results: current } = await db.prepare("SELECT user_id FROM board_members WHERE board_id = ?").bind(board.id).all<{ user_id: string }>();
  const have = new Set(current.map((m) => m.user_id));
  const add = (await activeUsers(db, ids)).filter((x) => !have.has(x));
  if (!add.length) fail(400, "Pick someone who isn't in this chat yet.");
  if (have.size + add.length > MAX_CHAT_PEOPLE) fail(400, `A chat can have up to ${MAX_CHAT_PEOPLE} people.`);
  const { results: named } = await db.prepare(`SELECT name FROM users WHERE id IN (${add.map(() => "?").join(",")}) ORDER BY name`).bind(...add).all<{ name: string }>();
  const names = named.map((x) => x.name);
  const at = now();
  const member = db.prepare("INSERT OR IGNORE INTO board_members (board_id, user_id, added_at) VALUES (?,?,?)");
  if (await isDirect(db, board)) {
    const id = randomId();
    await db.batch([
      db.prepare("INSERT INTO boards (id, kind, name, created_by, created_at) VALUES (?,'chat','',?,?)").bind(id, u.id, at),
      ...[...have, ...add].map((m) => member.bind(id, m, at)),
    ]);
    await audit(db, { userId: u.id, action: "chat.create", targetType: "chat", targetId: id, detail: { from: board.id }, ip: c.get("ip") });
    return id;
  }
  await db.batch([...add.map((m) => member.bind(board.id, m, at)), eventPost(db, board.id, u.id, "added", names)]);
  await audit(db, { userId: u.id, action: "chat.add_people", targetType: "chat", targetId: board.id, detail: { add }, ip: c.get("ip") });
  return board.id;
}

/** Take someone out of a chat. Only the person who started the chat can do this. */
async function removePerson(c: Context<AppEnv>, u: SessionUser, board: BoardRow, userId: string): Promise<void> {
  if (board.kind !== "chat") fail(400, "People can only be removed from chats.");
  if (!moderates(u, board)) fail(403, "Only the person who started this chat can remove people.");
  if (userId === u.id) fail(400, "To take yourself out, leave the chat.");
  const db = c.env.DB;
  const who = await db.prepare("SELECT u.name FROM board_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = ? AND m.user_id = ?").bind(board.id, userId).first<{ name: string }>();
  if (!who) fail(404, "That person isn't in this chat.");
  await db.batch([
    db.prepare("DELETE FROM board_members WHERE board_id = ? AND user_id = ?").bind(board.id, userId),
    eventPost(db, board.id, u.id, "removed", [who.name]),
  ]);
  await audit(db, { userId: u.id, action: "chat.remove_person", targetType: "chat", targetId: board.id, detail: { userId }, ip: c.get("ip") });
}

/** Add people. Answers with the chat they're now in (a new group when the chat was one-to-one). */
boards.post("/:id/people", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  const id = await addPeople(c, u, board, (await body(c)).userIds);
  return c.json({ id, newChat: id !== board.id });
});

boards.delete("/:id/people/:userId", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  await removePerson(c, u, board, c.req.param("userId"));
  return c.json({ ok: true });
});

/** Leave a group chat. If the person who started it leaves, the longest-standing member takes over. */
boards.post("/:id/leave", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  if (board.kind !== "chat") fail(400, "Only chats can be left.");
  const db = c.env.DB;
  const stmts = [db.prepare("DELETE FROM board_members WHERE board_id = ? AND user_id = ?").bind(board.id, u.id), eventPost(db, board.id, u.id, "left", [])];
  if (board.created_by === u.id) {
    const next = await db.prepare("SELECT user_id FROM board_members WHERE board_id = ? AND user_id != ? ORDER BY added_at, rowid LIMIT 1").bind(board.id, u.id).first<{ user_id: string }>();
    if (next) stmts.push(db.prepare("UPDATE boards SET created_by = ? WHERE id = ?").bind(next.user_id, board.id));
  }
  await db.batch(stmts);
  return c.json({ ok: true });
});

/** Read a message with its files, whether it came as JSON or as a form with files. */
async function readMessage(c: Context<AppEnv>): Promise<{ text: string | null; parentId: string | null; files: File[] }> {
  const type = c.req.header("content-type") ?? "";
  if (!type.startsWith("multipart/form-data")) {
    const b = await body(c);
    return { text: str(b.body, 5000), parentId: typeof b.parentId === "string" && b.parentId ? b.parentId : null, files: [] };
  }
  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    fail(400, "The upload didn't come through. Try again.");
  }
  const files = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  const parent = form.get("parentId");
  const text = form.get("body");
  return { text: str(typeof text === "string" ? text : "", 5000), parentId: typeof parent === "string" && parent ? parent : null, files };
}

boards.post("/:id/posts", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  if (board.archived_at) fail(400, "This board is archived.");
  if (!canPost(u, board)) fail(403, "Only the board's creator and moderators can post here.");
  const { text, parentId, files } = await readMessage(c);
  if (!text && !files.length) fail(400, "Message is required.");
  if (files.length > MAX_FILES_PER_MESSAGE) fail(400, `Send up to ${MAX_FILES_PER_MESSAGE} files at a time.`);
  if (files.reduce((n, f) => n + f.size, 0) > MAX_MESSAGE_BYTES) fail(400, "Those files are too big to send together. Send them in two messages.");
  for (const f of files) {
    const problem = fileProblem(f.name, f.size);
    if (problem) fail(400, `${cleanName(f.name)}: ${problem}`);
  }
  if (parentId) {
    const parent = await c.env.DB.prepare("SELECT id FROM posts WHERE id = ? AND board_id = ? AND deleted_at IS NULL AND kind = 'post'").bind(parentId, board.id).first();
    if (!parent) fail(400, "The message you're replying to is gone.");
  }
  const id = randomId();
  const at = now();
  const stored = files.map((f) => ({ id: randomId(), file: f, name: cleanName(f.name), info: fileInfo(f.name)! }));
  // Files go into R2 first; if any upload fails, the ones already stored are removed and nothing is posted.
  try {
    for (const s of stored) {
      await c.env.FILES.put(`files/${s.id}`, s.file.stream(), {
        httpMetadata: { contentType: s.info.type },
        customMetadata: { board: board.id, post: id, by: u.id },
      });
    }
  } catch (e) {
    await Promise.all(stored.map((s) => c.env.FILES.delete(`files/${s.id}`).catch(() => undefined)));
    throw e;
  }
  const addFile = c.env.DB.prepare("INSERT INTO attachments (id, board_id, post_id, user_id, name, ext, size, created_at) VALUES (?,?,?,?,?,?,?,?)");
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO posts (id, board_id, parent_id, user_id, body, created_at) VALUES (?,?,?,?,?,?)").bind(id, board.id, parentId, u.id, text ?? "", at),
    ...stored.map((s) => addFile.bind(s.id, board.id, id, u.id, s.name, s.info.ext, s.file.size, at)),
  ]);
  return c.json({ id });
});

boards.patch("/:id/posts/:postId", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  const post = await c.env.DB.prepare("SELECT id, user_id FROM posts WHERE id = ? AND board_id = ? AND deleted_at IS NULL AND kind = 'post'").bind(c.req.param("postId"), board.id).first<{ id: string; user_id: string }>();
  if (!post) fail(404, "Not found.");
  const b = await body(c);
  if (b.body !== undefined) {
    if (post.user_id !== u.id) fail(403, "You can only edit your own messages.");
    await c.env.DB.prepare("UPDATE posts SET body = ?, edited_at = ? WHERE id = ?").bind(mustStr(b.body, 5000, "Message"), now(), post.id).run();
  }
  if (b.pinned !== undefined) {
    // Anyone in a private chat can pin; on a board it's the creator or a moderator.
    if (board.kind === "board" && !moderates(u, board)) fail(403, "Only the board's creator or a moderator can pin.");
    await c.env.DB.prepare("UPDATE posts SET pinned = ? WHERE id = ?").bind(b.pinned === true ? 1 : 0, post.id).run();
  }
  return c.json({ ok: true });
});

boards.delete("/:id/posts/:postId", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  const post = await c.env.DB.prepare("SELECT id, user_id FROM posts WHERE id = ? AND board_id = ? AND deleted_at IS NULL AND kind = 'post'").bind(c.req.param("postId"), board.id).first<{ id: string; user_id: string }>();
  if (!post) fail(404, "Not found.");
  if (post.user_id !== u.id && !moderates(u, board)) fail(403, "You can only remove your own messages.");
  // Soft delete: hidden from the chat, kept for the record (files too).
  const at = now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE posts SET deleted_at = ? WHERE id = ?").bind(at, post.id),
    c.env.DB.prepare("UPDATE attachments SET deleted_at = ? WHERE post_id = ? AND deleted_at IS NULL").bind(at, post.id),
  ]);
  if (post.user_id !== u.id) await audit(c.env.DB, { userId: u.id, action: "post.remove", targetType: "post", targetId: post.id, ip: c.get("ip") });
  return c.json({ ok: true });
});

boards.post("/:id/archive", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  if (board.kind !== "board") fail(400, "Chats can't be archived. Leave the chat instead.");
  if (!moderates(u, board)) fail(403, "Only the board's creator or a moderator can archive it.");
  await c.env.DB.prepare("UPDATE boards SET archived_at = ? WHERE id = ?").bind(now(), board.id).run();
  await audit(c.env.DB, { userId: u.id, action: "board.archive", targetType: "board", targetId: board.id, ip: c.get("ip") });
  return c.json({ ok: true });
});

boards.post("/:id/unarchive", async (c) => {
  const u = requirePerm(c, "boards.moderate");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  await c.env.DB.prepare("UPDATE boards SET archived_at = NULL WHERE id = ?").bind(board.id).run();
  await audit(c.env.DB, { userId: u.id, action: "board.unarchive", targetType: "board", targetId: board.id, ip: c.get("ip") });
  return c.json({ ok: true });
});

/** The whole conversation as a text file (boards: creator or moderators; chats: anyone in it). */
boards.get("/:id/export", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  if (board.kind === "board" && !moderates(u, board)) fail(403, "Only the board's creator or a moderator can export it.");
  const { results } = await c.env.DB.prepare(
    `SELECT p.created_at, p.kind, u.name, p.body, (SELECT group_concat(a.name, ', ') FROM attachments a WHERE a.post_id = p.id AND a.deleted_at IS NULL) AS files
       FROM posts p JOIN users u ON u.id = p.user_id WHERE p.board_id = ? AND p.deleted_at IS NULL ORDER BY p.created_at`,
  ).bind(board.id).all<{ created_at: string; kind: string; name: string; body: string; files: string | null }>();
  const title = board.name || "Chat";
  const lines = [`${title}`, `Exported ${now()} by ${u.name}. Times are UTC.`, ""];
  for (const r of results) {
    const when = `[${r.created_at.slice(0, 16).replace("T", " ")}]`;
    lines.push(r.kind === "event" ? `${when} ${eventText(r.name, r.body)}` : `${when} ${r.name}: ${r.body}${r.files ? ` (files: ${r.files})` : ""}`);
  }
  await audit(c.env.DB, { userId: u.id, action: `${board.kind}.export`, targetType: board.kind, targetId: board.id, ip: c.get("ip") });
  const fileName = `${title.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "chat"}.txt`;
  return new Response(lines.join("\r\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName}"` },
  });
});
