import { describe, expect, it } from "vitest";
import { pollDelay, POLL } from "../../web/src/poll";

// How often the staff app asks the server for new messages. Each ask is one Worker request and a
// few database reads, so these numbers decide most of the portal's Cloudflare usage.
describe("pollDelay", () => {
  it("checks often while someone is looking at the page and using it", () => {
    expect(pollDelay({ visible: true, idleMs: 0 })).toBe(POLL.active);
    expect(pollDelay({ visible: true, idleMs: POLL.idleAfter - 1 })).toBe(POLL.active);
  });

  it("slows down when the page is open but nobody has touched it for a while", () => {
    expect(pollDelay({ visible: true, idleMs: POLL.idleAfter })).toBe(POLL.idle);
  });

  it("barely checks when the tab is in the background", () => {
    expect(pollDelay({ visible: false, idleMs: 0 })).toBe(POLL.hidden);
  });

  it("never checks faster than every 15 seconds", () => {
    expect(POLL.active).toBeGreaterThanOrEqual(15_000);
    expect(POLL.idle).toBeGreaterThan(POLL.active);
    expect(POLL.hidden).toBeGreaterThan(POLL.idle);
  });
});
