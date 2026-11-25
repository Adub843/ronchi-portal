// The main menu shows each person only the pages they can use (web/src/nav.ts).
import { describe, expect, it } from "vitest";
import { fromOldAddress, menuFor, pageAllowed } from "../../web/src/nav";

const paths = (perms: string[], workbook = true) => menuFor(new Set(perms), { workbook }).map((n) => n.to);

describe("the main menu", () => {
  it("hides Jobs from someone who can't see jobs", () => {
    expect(paths(["boards.use", "catalog.view"])).not.toContain("/jobs");
    expect(paths(["jobs.view"])).toContain("/jobs");
  });

  it("has one Jobs line for a visit and its work order, with the workbook on or off (Aaron, 2026-11-25)", () => {
    expect(paths(["jobs.view"])).not.toContain("/work-orders");
    expect(paths(["jobs.view"], false)).toContain("/jobs");
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
    expect(ok("/change-parts/sales", ["cpsales.view"])).toBe(true);
    expect(ok("/change-parts", ["orders.view"])).toBe(true);
  });
});

describe("old Work orders addresses", () => {
  it("open the job's Work order tab", () => {
    expect(fromOldAddress("/work-orders")).toBe("/jobs");
    expect(fromOldAddress("/work-orders/billing")).toBe("/jobs/billing");
    expect(fromOldAddress("/work-orders/abc123")).toBe("/jobs/abc123/work-order");
    expect(fromOldAddress("/jobs/abc123")).toBe("/jobs/abc123");
  });
});
