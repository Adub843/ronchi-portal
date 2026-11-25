// On/off switches for whole parts of the portal (lib/switches.ts). Everyone signed in can read them,
// so the menu knows what to show; only admins can change them.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, requirePerm, requireUser } from "../lib/http";
import { isSwitch, readSwitches } from "../lib/switches";

export const switches = new Hono<AppEnv>();

switches.get("/", async (c) => {
  requireUser(c);
  return c.json({ switches: await readSwitches(c.env.DB) });
});

switches.put("/:name", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const name = c.req.param("name");
  if (!isSwitch(name)) fail(404, "Not found.");
  const b = await body(c);
  if (typeof b.on !== "boolean") fail(400, "Say on or off.");
  await c.env.DB.prepare(
    "INSERT INTO feature_switches (name, is_on, set_by, set_at) VALUES (?,?,?,?) ON CONFLICT (name) DO UPDATE SET is_on = excluded.is_on, set_by = excluded.set_by, set_at = excluded.set_at",
  ).bind(name, b.on ? 1 : 0, admin.id, now()).run();
  await audit(c.env.DB, { userId: admin.id, action: "switch.set", targetType: "switch", targetId: name, detail: { on: b.on }, ip: c.get("ip") });
  return c.json({ switches: await readSwitches(c.env.DB) });
});
