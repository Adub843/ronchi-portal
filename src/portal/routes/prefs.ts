// Each person's look (theme, light/dark, layout, home tiles), language and pop-up alerts, saved to their login.
// Which looks and languages people can pick, and what new people start with, are admin controls in Settings.
import { Hono } from "hono";
import { LAYOUT_IDS, THEME_IDS } from "../../shared/themes";
import type { AppEnv } from "../env";
import { now } from "../lib/db";
import { body, fail, requireUser } from "../lib/http";
import { getSettings } from "../lib/settings-store";

export const prefs = new Hono<AppEnv>();

function starting() {
  const s = getSettings();
  return { theme: s.look.defaultTheme, mode: "auto", layout: "L2", tiles: null as string[] | null, lang: s.languages.default as string, popups: s.look.popupsDefault };
}
const themeOk = (id: string) => THEME_IDS.has(id) && getSettings().look.allowedThemes.includes(id);
const langOk = (id: string) => (getSettings().languages.allowed as string[]).includes(id);
const TILE_ID = /^[a-z0-9-]{1,40}$/;

prefs.get("/", async (c) => {
  const u = requireUser(c);
  const row = await c.env.DB.prepare("SELECT theme, mode, layout, tiles, lang, popups FROM user_prefs WHERE user_id = ?").bind(u.id).first<{ theme: string; mode: string; layout: string; tiles: string | null; lang: string; popups: number }>();
  const start = starting();
  if (!row) return c.json(start);
  // A theme or language that has since been removed (or turned off by an admin) falls back to the starting one.
  const theme = themeOk(row.theme) ? row.theme : start.theme;
  const lang = langOk(row.lang) ? row.lang : start.lang;
  return c.json({ ...row, theme, lang, popups: !!row.popups, tiles: row.tiles ? (JSON.parse(row.tiles) as string[]) : null });
});

prefs.put("/", async (c) => {
  const u = requireUser(c);
  const b = await body(c);
  const start = starting();
  if (b.reset === true) {
    // Back to the starting look (Ronchi unless an admin changed it). Language and alert choices stay as they are.
    await c.env.DB.prepare("UPDATE user_prefs SET theme = ?, mode = 'auto', layout = 'L2', tiles = NULL, updated_at = ? WHERE user_id = ?").bind(start.theme, now(), u.id).run();
    const kept = await c.env.DB.prepare("SELECT lang, popups FROM user_prefs WHERE user_id = ?").bind(u.id).first<{ lang: string; popups: number }>();
    return c.json({ ...start, ...(kept ? { lang: langOk(kept.lang) ? kept.lang : start.lang, popups: !!kept.popups } : {}) });
  }
  const theme = typeof b.theme === "string" && THEME_IDS.has(b.theme) ? (themeOk(b.theme) ? b.theme : fail(400, "Your admin has turned that look off.")) : fail(400, "Unknown theme.");
  const mode = b.mode === "light" || b.mode === "dark" || b.mode === "auto" ? b.mode : "auto";
  const layout = typeof b.layout === "string" && LAYOUT_IDS.has(b.layout) ? b.layout : "L2";
  const lang = typeof b.lang === "string" && ["en", "es", "it"].includes(b.lang)
    ? (langOk(b.lang) ? b.lang : fail(400, "Your admin has turned that language off."))
    : b.lang === undefined ? start.lang : fail(400, "Unknown language.");
  const popups = b.popups === false ? 0 : 1;
  let tiles: string | null = null;
  if (Array.isArray(b.tiles)) {
    if (b.tiles.length > 30 || !b.tiles.every((t) => typeof t === "string" && TILE_ID.test(t))) fail(400, "Unknown tiles.");
    tiles = JSON.stringify(b.tiles);
  }
  await c.env.DB.prepare(
    `INSERT INTO user_prefs (user_id, theme, mode, layout, tiles, lang, popups, updated_at) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme, mode = excluded.mode, layout = excluded.layout, tiles = excluded.tiles,
       lang = excluded.lang, popups = excluded.popups, updated_at = excluded.updated_at`,
  ).bind(u.id, theme, mode, layout, tiles, lang, popups, now()).run();
  return c.json({ theme, mode, layout, tiles: tiles ? JSON.parse(tiles) : null, lang, popups: !!popups });
});
