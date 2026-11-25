import { describe, expect, it } from "vitest";
import { guessCarrier, isStatusFor, nextNumber, receiveStatus, statusesFor, trackingLinks, cleanPackages, packageTotals } from "../../src/shared/shipping";

describe("tracking links (no outside service: the carrier's own public tracking page)", () => {
  it("builds the carrier's tracking page for each number", () => {
    expect(trackingLinks("ups", "1Z999AA10123456784")).toEqual([{ number: "1Z999AA10123456784", url: "https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784" }]);
    expect(trackingLinks("fedex", "123456789012")[0]!.url).toBe("https://www.fedex.com/fedextrack/?trknbr=123456789012");
    expect(trackingLinks("usps", "9400100000000000000000")[0]!.url).toBe("https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100000000000000000");
  });
  it("splits several numbers (one per package) on commas, spaces or new lines", () => {
    expect(trackingLinks("ups", "1Z1, 1Z2\n1Z3").map((l) => l.number)).toEqual(["1Z1", "1Z2", "1Z3"]);
  });
  it("gives no link for a carrier without a public tracking page, but keeps the number", () => {
    expect(trackingLinks("pickup", "ABC")).toEqual([{ number: "ABC", url: null }]);
    expect(trackingLinks("ups", "")).toEqual([]);
  });
  it("for LTL carriers without a fill-in link, opens their tracking page and asks to paste the PRO", () => {
    expect(trackingLinks("odfl", "07812345678")).toEqual([{ number: "07812345678", url: "https://www.odfl.com/us/en/tools/trace-track-ltl-freight.html", copy: true }]);
  });
});

describe("guessing the carrier from a tracking number", () => {
  it("knows the common parcel formats", () => {
    expect(guessCarrier("1Z999AA10123456784")).toBe("ups");
    expect(guessCarrier("9400100000000000000000")).toBe("usps");
    expect(guessCarrier("123456789012")).toBe("fedex");
    expect(guessCarrier("hello")).toBeNull();
  });
});

describe("statuses", () => {
  it("outgoing and incoming have their own steps", () => {
    expect(statusesFor("out")).toEqual(["to_pack", "packed", "shipped", "delivered", "on_hold", "cancelled"]);
    expect(statusesFor("in")).toEqual(["expected", "arrived", "partly_received", "received", "on_hold", "cancelled"]);
    expect(isStatusFor("out", "received")).toBe(false);
    expect(isStatusFor("in", "received")).toBe(true);
  });
  it("works out a receipt's status from what has come in so far", () => {
    expect(receiveStatus([{ qty: 4, qty_received: 0 }])).toBe("arrived");
    expect(receiveStatus([{ qty: 4, qty_received: 2 }, { qty: 1, qty_received: 1 }])).toBe("partly_received");
    expect(receiveStatus([{ qty: 4, qty_received: 4 }, { qty: 1, qty_received: 2 }])).toBe("received");
    expect(receiveStatus([])).toBe("received");
  });
});

describe("shipment numbers", () => {
  it("counts up within the year, SH for outgoing and RC for incoming", () => {
    expect(nextNumber("out", 2026, null)).toBe("SH-2026-0001");
    expect(nextNumber("out", 2026, "SH-2026-0041")).toBe("SH-2026-0042");
    expect(nextNumber("in", 2027, "RC-2027-9999")).toBe("RC-2027-10000");
  });
});

describe("packages", () => {
  it("keeps crates, pallets and boxes with weight and size, and adds them up", () => {
    const p = cleanPackages([{ type: "crate", count: 2, weight: 850, length: 96, width: 48, height: 72 }, { type: "box", count: 1, weight: 12.5 }]);
    expect(p).toHaveLength(2);
    expect(packageTotals(p)).toEqual({ pieces: 3, weight: 1712.5 });
  });
  it("refuses nonsense", () => {
    expect(() => cleanPackages([{ type: "rocket", count: 1 }])).toThrow(/type/);
    expect(() => cleanPackages([{ type: "box", count: 0 }])).toThrow(/count/i);
    expect(() => cleanPackages([{ type: "box", count: 1, weight: -3 }])).toThrow(/weight/i);
    expect(() => cleanPackages("x")).toThrow();
  });
});
