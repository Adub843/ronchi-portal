// Opening a file that was sent in a board or chat. Only people who can see that board or chat
// get it; everyone else gets the same "Not found" as a file that doesn't exist.
// Photos (JPEG, PNG, GIF, WebP) can be shown inside the chat; every other file is always a download,
// served with the type from src/shared/files.ts, never the type the uploader's browser claimed.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { fail, requirePerm } from "../lib/http";
import { serveFile } from "../lib/serve-file";
import { loadBoard } from "./boards";

export const files = new Hono<AppEnv>();

files.get("/:id", async (c) => {
  const u = requirePerm(c, "boards.use");
  const a = await c.env.DB.prepare("SELECT id, board_id, name FROM attachments WHERE id = ? AND deleted_at IS NULL")
    .bind(c.req.param("id")).first<{ id: string; board_id: string; name: string }>();
  if (!a) fail(404, "Not found.");
  await loadBoard(c.env.DB, u, a.board_id); // 404 unless this person can see the chat
  return serveFile(c.env.FILES, `files/${a.id}`, a.name, { download: c.req.query("download") !== undefined });
});
