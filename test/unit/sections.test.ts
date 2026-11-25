// Command center switches: every part of the portal must be switchable. A new part of the portal
// (shipping and receiving, parts orders...) adds a line to SECTIONS in src/portal/lib/settings.ts;
// this test fails if its permissions are left out, so nothing new slips past the owner's switches.
import { describe, expect, it } from "vitest";
import { SECTIONS } from "../../src/portal/lib/settings";
import { ADMIN_ONLY, rolePermissions } from "../../src/portal/lib/roles";

describe("command center sections", () => {
  it("every permission (except the admin-only ones) belongs to exactly one section switch", () => {
    const owned = new Map<string, string[]>();
    for (const [id, s] of Object.entries(SECTIONS)) for (const p of s.perms) owned.set(p, [...(owned.get(p) ?? []), id]);
    for (const p of rolePermissions("admin")) {
      if (ADMIN_ONLY.has(p)) expect(owned.has(p), p).toBe(false);
      else expect(owned.get(p), p).toHaveLength(1);
    }
  });
});
