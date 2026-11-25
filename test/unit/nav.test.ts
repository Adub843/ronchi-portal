// The main menu shows each person only the pages they can use (web/src/nav.ts).
import { describe, expect, it } from "vitest";
import { menuFor, pageAllowed } from "../../web/src/nav";

const paths = (perms: string[], workbook = true) => menuFor(new Set(perms), { workbook }).map((n) => n.to);

describe("the main menu", () => {
  it("hides Jobs and Work orders from someone who can't see jobs", () => {
    expect(paths(["boards.use", "catalog.view"])).not.toContain("/jobs");
    expect(paths(["boards.use", "catalog.view"])).not.toContain("/work-orders");
    expect(paths(["jobs.view"])).toEqual(expect.arrayContaining(["/jobs", "/work-orders"]));
  });

  it("hides Work orders when the Ronchi workbook is switched off, and keeps Jobs", () => {
    expect(paths(["jobs.view"], false)).toContain("/jobs");
    expect(paths(["jobs.view"], false)).not.toContain("/work-orders");
  });

  it("gives someone who reads quote requests but doesn't manage customers (Billing) a way to Quote requests", () => {
    expect(paths(["quotes.manage"])).toContain("/quotes");
    // Customer managers reach Quote requests from the Customers page, so it isn't listed twice.
    expect(paths(["quotes.manage", "customers.manage"])).toContain("/customers");
    expect(paths(["quotes.manage", "customers.manage"])).not.toContain("/quotes");
  });

  it("always has Home, Portal training and Settings", () => {
    expect(paths([])).toEqual(["/", "/learn", "/settings"]);
  });
});

describe("opening a page by its address", () => {
  const ok = (path: string, perms: string[]) => pageAllowed(path, new Set(perms));
  it("refuses a page the person's permissions don't reach, even when typed in or linked", () => {
    expect(ok("/people", ["orders.view"])).toBe(false);
    expect(ok("/customers", ["jobs.view"])).toBe(false);
    expect(ok("/machines/3981MB", ["jobs.view"])).toBe(false);
    expect(ok("/kb/abc", ["jobs.view"])).toBe(false);
  });
  it("allows pages the person can use, including Quote requests reached from Customers, and pages with no permission", () => {
    expect(ok("/people", ["users.manage"])).toBe(true);
    expect(ok("/quotes/q1", ["customers.manage", "quotes.manage"])).toBe(true);
    expect(ok("/", [])).toBe(true);
    expect(ok("/learn", [])).toBe(true);
    expect(ok("/settings/admin", [])).toBe(true);
  });
});
