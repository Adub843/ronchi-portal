// Message boards. Anyone on staff can create one (for a team, a machine, a site or an order).
// A board can be open to all staff, or only to some roles. Posts are plain text: the app
// never renders them as HTML, so nothing anyone types can run as code.
// On screen a board works like a phone chat: newest message at the bottom, unread counts,
// replies that quote the message they answer.
import { Hono } from "hono";
import { randomId } from "../../shared/crypto";
import type { AppEnv, SessionUser } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, mustStr, requirePerm, str } from "../lib/http";
import { can, isRole } from "../lib/roles";

export const boards = new Hono<AppEnv>();

interface BoardRow { id: string; name: string; description: string | null; audience: string | null; machine_id: string | null; created_by: string; created_at: string; archived_at: string | null }

function canSee(user: SessionUser, b: BoardRow): boolean {
  if (user.role === "admin" || !b.audience) return true;
  try {
    const roles = JSON.parse(b.audience) as string[];
    return roles.includes(user.role);
  } catch {
    return false; // a damaged audience list hides the board rather than showing it to everyone
  }
}

async function loadBoard(db: D1Database, user: SessionUser, id: string): Promise<BoardRow> {
  const b = await db.prepare("SELECT * FROM boards WHERE id = ?").bind(id).first<BoardRow>();
  // Same answer for "doesn't exist" and "not allowed", so board ids can't be probed.
  if (!b || !canSee(user, b)) fail(404, "Not found.");
  return b;
}

boards.get("/", async (c) => {
  const u = requirePerm(c, "boards.use");
  const { results } = await c.env.DB.prepare(
    `SELECT b.*, (SELECT COUNT(*) FROM posts p WHERE p.board_id = b.id AND p.deleted_at IS NULL) AS post_count,
            (SELECT MAX(created_at) FROM posts p WHERE p.board_id = b.id AND p.deleted_at IS NULL) AS last_post_at,
            m.serial AS machine_serial,
            (SELECT COUNT(*) FROM posts p WHERE p.board_id = b.id AND p.deleted_at IS NULL AND p.user_id != ?1
                AND p.created_at > COALESCE((SELECT last_read_at FROM board_reads r WHERE r.user_id = ?1 AND r.board_id = b.id), '')) AS unread,
            (SELECT u.name || ': ' || substr(p.body, 1, 120) FROM posts p JOIN users u ON u.id = p.user_id
              WHERE p.board_id = b.id AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 1) AS last_message
       FROM boards b LEFT JOIN machines m ON m.id = b.machine_id
      WHERE b.archived_at IS NULL ORDER BY COALESCE(last_post_at, b.created_at) DESC`,
  ).bind(u.id).all<BoardRow & { post_count: number; last_post_at: string | null; machine_serial: string | null; unread: number; last_message: string | null }>();
  return c.json({ boards: results.filter((b) => canSee(u, b)) });
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
  await c.env.DB.prepare("INSERT INTO boards (id, name, description, audience, machine_id, created_by, created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(id, name, description, audience, machineId, u.id, now())
    .run();
  await audit(c.env.DB, { userId: u.id, action: "board.create", targetType: "board", targetId: id, detail: { name, audience }, ip: c.get("ip") });
  return c.json({ id });
});

boards.get("/:id", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.parent_id, p.body, p.pinned, p.created_at, p.edited_at, p.user_id, u.name AS author
       FROM posts p JOIN users u ON u.id = p.user_id
      WHERE p.board_id = ? AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 300`,
  ).bind(board.id).all();
  return c.json({ board, posts: results, canModerate: can(u.role, "boards.moderate") || board.created_by === u.id });
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

boards.post("/:id/posts", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  if (board.archived_at) fail(400, "This board is archived.");
  const b = await body(c);
  const text = mustStr(b.body, 5000, "Message");
  let parentId: string | null = null;
  if (typeof b.parentId === "string" && b.parentId) {
    const parent = await c.env.DB.prepare("SELECT id FROM posts WHERE id = ? AND board_id = ? AND deleted_at IS NULL").bind(b.parentId, board.id).first();
    if (!parent) fail(400, "The message you're replying to is gone.");
    parentId = b.parentId;
  }
  const id = randomId();
  await c.env.DB.prepare("INSERT INTO posts (id, board_id, parent_id, user_id, body, created_at) VALUES (?,?,?,?,?,?)")
    .bind(id, board.id, parentId, u.id, text, now())
    .run();
  return c.json({ id });
});

boards.patch("/:id/posts/:postId", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  const post = await c.env.DB.prepare("SELECT id, user_id FROM posts WHERE id = ? AND board_id = ? AND deleted_at IS NULL").bind(c.req.param("postId"), board.id).first<{ id: string; user_id: string }>();
  if (!post) fail(404, "Not found.");
  const moderator = can(u.role, "boards.moderate") || board.created_by === u.id;
  const b = await body(c);
  if (b.body !== undefined) {
    if (post.user_id !== u.id) fail(403, "You can only edit your own messages.");
    await c.env.DB.prepare("UPDATE posts SET body = ?, edited_at = ? WHERE id = ?").bind(mustStr(b.body, 5000, "Message"), now(), post.id).run();
  }
  if (b.pinned !== undefined) {
    if (!moderator) fail(403, "Only the board's creator or a moderator can pin.");
    await c.env.DB.prepare("UPDATE posts SET pinned = ? WHERE id = ?").bind(b.pinned === true ? 1 : 0, post.id).run();
  }
  return c.json({ ok: true });
});

boards.delete("/:id/posts/:postId", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  const post = await c.env.DB.prepare("SELECT id, user_id FROM posts WHERE id = ? AND board_id = ? AND deleted_at IS NULL").bind(c.req.param("postId"), board.id).first<{ id: string; user_id: string }>();
  if (!post) fail(404, "Not found.");
  const moderator = can(u.role, "boards.moderate") || board.created_by === u.id;
  if (post.user_id !== u.id && !moderator) fail(403, "You can only remove your own messages.");
  // Soft delete: hidden from the board, kept for the record.
  await c.env.DB.prepare("UPDATE posts SET deleted_at = ? WHERE id = ?").bind(now(), post.id).run();
  if (post.user_id !== u.id) await audit(c.env.DB, { userId: u.id, action: "post.remove", targetType: "post", targetId: post.id, ip: c.get("ip") });
  return c.json({ ok: true });
});

boards.post("/:id/archive", async (c) => {
  const u = requirePerm(c, "boards.use");
  const board = await loadBoard(c.env.DB, u, c.req.param("id"));
  if (!(can(u.role, "boards.moderate") || board.created_by === u.id)) fail(403, "Only the board's creator or a moderator can archive it.");
  await c.env.DB.prepare("UPDATE boards SET archived_at = ? WHERE id = ?").bind(now(), board.id).run();
  await audit(c.env.DB, { userId: u.id, action: "board.archive", targetType: "board", targetId: board.id, ip: c.get("ip") });
  return c.json({ ok: true });
});
