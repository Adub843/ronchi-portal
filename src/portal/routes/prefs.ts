// Each person's look (theme, light/dark, layout, home tiles), saved to their login.
import { Hono } from "hono";
import { DEFAULT_THEME, LAYOUT_IDS, THEME_IDS } from "../../shared/themes";
import type { AppEnv } from "../env";
import { now } from "../lib/db";
import { body, fail, requireUser } from "../lib/http";

export const prefs = new Hono<AppEnv>();

const DEFAULTS = { theme: DEFAULT_THEME, mode: "auto", layout: "L2", tiles: null as string[] | null };
const TILE_ID = /^[a-z0-9-]{1,40}$/;

prefs.get("/", async (c) => {
  const u = requireUser(c);
  const row = await c.env.DB.prepare("SELECT theme, mode, layout, tiles FROM user_prefs WHERE user_id = ?").bind(u.id).first<{ theme: string; mode: string; layout: string; tiles: string | null }>();
  if (!row) return c.json(DEFAULTS);
  // A theme that has since been removed falls back to the Ronchi default.
  const theme = THEME_IDS.has(row.theme) ? row.theme : DEFAULT_THEME;
  return c.json({ ...row, theme, tiles: row.tiles ? (JSON.parse(row.tiles) as string[]) : null });
});

prefs.put("/", async (c) => {
  const u = requireUser(c);
  const b = await body(c);
  if (b.reset === true) {
    await c.env.DB.prepare("DELETE FROM user_prefs WHERE user_id = ?").bind(u.id).run();
    return c.json(DEFAULTS);
  }
  const theme = typeof b.theme === "string" && THEME_IDS.has(b.theme) ? b.theme : fail(400, "Unknown theme.");
  const mode = b.mode === "light" || b.mode === "dark" || b.mode === "auto" ? b.mode : "auto";
  const layout = typeof b.layout === "string" && LAYOUT_IDS.has(b.layout) ? b.layout : "L2";
  let tiles: string | null = null;
  if (Array.isArray(b.tiles)) {
    if (b.tiles.length > 30 || !b.tiles.every((t) => typeof t === "string" && TILE_ID.test(t))) fail(400, "Unknown tiles.");
    tiles = JSON.stringify(b.tiles);
  }
  await c.env.DB.prepare(
    `INSERT INTO user_prefs (user_id, theme, mode, layout, tiles, updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme, mode = excluded.mode, layout = excluded.layout, tiles = excluded.tiles, updated_at = excluded.updated_at`,
  ).bind(u.id, theme, mode, layout, tiles, now()).run();
  return c.json({ theme, mode, layout, tiles: tiles ? JSON.parse(tiles) : null });
});
