// The main menu shows each person only the pages they can use (web/src/nav.ts).
import { describe, expect, it } from "vitest";
import { menuFor } from "../../web/src/nav";

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
