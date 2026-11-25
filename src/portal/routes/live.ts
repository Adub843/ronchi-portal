// GET /api/live: the change numbers for each area (lib/live.ts), for open pages to know what to reload.
// People with chats get the same numbers with their alerts check, so this is only asked by the others.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireUser } from "../lib/http";
import { readRevs } from "../lib/live";

export const live = new Hono<AppEnv>();

live.get("/", async (c) => {
  requireUser(c);
  return c.json({ revs: await readRevs(c.env.DB) });
});
