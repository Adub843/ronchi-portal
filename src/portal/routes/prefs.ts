// Each person's look (theme, light/dark, layout, home tiles), language and pop-up alerts, saved to their login.
import { Hono } from "hono";
import { DEFAULT_THEME, LAYOUT_IDS, THEME_IDS } from "../../shared/themes";
import type { AppEnv } from "../env";
import { now } from "../lib/db";
import { body, fail, requireUser } from "../lib/http";

export const prefs = new Hono<AppEnv>();

const DEFAULTS = { theme: DEFAULT_THEME, mode: "auto", layout: "L2", tiles: null as string[] | null, lang: "en", popups: true };
const LANGS = new Set(["en", "es", "it"]);
const TILE_ID = /^[a-z0-9-]{1,40}$/;

prefs.get("/", async (c) => {
  const u = requireUser(c);
  const row = await c.env.DB.prepare("SELECT theme, mode, layout, tiles, lang, popups FROM user_prefs WHERE user_id = ?").bind(u.id).first<{ theme: string; mode: string; layout: string; tiles: string | null; lang: string; popups: number }>();
  if (!row) return c.json(DEFAULTS);
  // A theme that has since been removed falls back to the Ronchi default.
  const theme = THEME_IDS.has(row.theme) ? row.theme : DEFAULT_THEME;
  return c.json({ ...row, theme, popups: !!row.popups, tiles: row.tiles ? (JSON.parse(row.tiles) as string[]) : null });
});

prefs.put("/", async (c) => {
  const u = requireUser(c);
  const b = await body(c);
  if (b.reset === true) {
    // Back to the Ronchi look. Language and alert choices stay as they are.
    await c.env.DB.prepare("UPDATE user_prefs SET theme = ?, mode = 'auto', layout = 'L2', tiles = NULL, updated_at = ? WHERE user_id = ?").bind(DEFAULT_THEME, now(), u.id).run();
    const kept = await c.env.DB.prepare("SELECT lang, popups FROM user_prefs WHERE user_id = ?").bind(u.id).first<{ lang: string; popups: number }>();
    return c.json({ ...DEFAULTS, ...(kept ? { lang: kept.lang, popups: !!kept.popups } : {}) });
  }
  const theme = typeof b.theme === "string" && THEME_IDS.has(b.theme) ? b.theme : fail(400, "Unknown theme.");
  const mode = b.mode === "light" || b.mode === "dark" || b.mode === "auto" ? b.mode : "auto";
  const layout = typeof b.layout === "string" && LAYOUT_IDS.has(b.layout) ? b.layout : "L2";
  const lang = typeof b.lang === "string" && LANGS.has(b.lang) ? b.lang : b.lang === undefined ? "en" : fail(400, "Unknown language.");
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

// Instruction notes a person closed with the ×. Ids are short names chosen in the app ("people.head").
const TIP_ID = /^[a-z0-9][a-z0-9.-]{0,59}$/;
const TIP_CAP = 300;

prefs.get("/tips", async (c) => {
  const u = requireUser(c);
  const rows = await c.env.DB.prepare("SELECT tip FROM user_tips WHERE user_id = ? ORDER BY tip").bind(u.id).all<{ tip: string }>();
  return c.json({ hidden: rows.results.map((r) => r.tip) });
});

prefs.post("/tips", async (c) => {
  const u = requireUser(c);
  const b = await body(c);
  const id = typeof b.id === "string" && TIP_ID.test(b.id) ? b.id : fail(400, "Unknown tip.");
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM user_tips WHERE user_id = ?").bind(u.id).first<{ n: number }>();
  if ((n?.n ?? 0) >= TIP_CAP) fail(400, "Too many hidden tips. Use Show tips again in Settings.");
  await c.env.DB.prepare("INSERT OR IGNORE INTO user_tips (user_id, tip, hidden_at) VALUES (?,?,?)").bind(u.id, id, now()).run();
  return c.json({ ok: true });
});

prefs.delete("/tips", async (c) => {
  const u = requireUser(c);
  await c.env.DB.prepare("DELETE FROM user_tips WHERE user_id = ?").bind(u.id).run();
  return c.json({ hidden: [] });
});
