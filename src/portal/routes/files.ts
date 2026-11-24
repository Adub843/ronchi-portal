// Opening a file that was sent in a board or chat. Only people who can see that board or chat
// get it; everyone else gets the same "Not found" as a file that doesn't exist.
// Photos (JPEG, PNG, GIF, WebP) can be shown inside the chat; every other file is always a download,
// served with the type from src/shared/files.ts, never the type the uploader's browser claimed.
import { Hono } from "hono";
import { fileInfo } from "../../shared/files";
import type { AppEnv } from "../env";
import { fail, requirePerm } from "../lib/http";
import { loadBoard } from "./boards";

export const files = new Hono<AppEnv>();

files.get("/:id", async (c) => {
  const u = requirePerm(c, "boards.use");
  const a = await c.env.DB.prepare("SELECT id, board_id, name FROM attachments WHERE id = ? AND deleted_at IS NULL")
    .bind(c.req.param("id")).first<{ id: string; board_id: string; name: string }>();
  if (!a) fail(404, "Not found.");
  await loadBoard(c.env.DB, u, a.board_id); // 404 unless this person can see the chat
  const info = fileInfo(a.name);
  const obj = await c.env.FILES.get(`files/${a.id}`);
  if (!obj || !info) fail(404, "Not found.");
  const inline = info.kind === "image" && c.req.query("download") === undefined;
  const ascii = a.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return new Response(obj.body, {
    headers: {
      "Content-Type": info.type,
      "Content-Length": String(obj.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      // Files never change once sent, so the browser may keep its own copy (never shared caches).
      "Cache-Control": "private, max-age=86400",
      // Even if a file were opened directly, it can't run anything.
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
