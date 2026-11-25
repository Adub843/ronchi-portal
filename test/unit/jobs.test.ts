import { describe, expect, it } from "vitest";
import { jobEmail, jobLink, mapLinks, normalizeDays, dayRange, daysLabel, JOB_STATUSES, isJobStatus } from "../../src/shared/jobs";

describe("map links", () => {
  it("opens the address in Google Maps, Waze and Apple Maps", () => {
    const l = mapLinks("1 Main St, Pottstown, PA 19464");
    expect(l.google).toBe("https://www.google.com/maps/search/?api=1&query=1%20Main%20St%2C%20Pottstown%2C%20PA%2019464");
    expect(l.waze).toBe("https://waze.com/ul?q=1%20Main%20St%2C%20Pottstown%2C%20PA%2019464&navigate=yes");
    expect(l.apple).toBe("https://maps.apple.com/?daddr=1%20Main%20St%2C%20Pottstown%2C%20PA%2019464");
  });
  it("puts line breaks in the address on one line", () => {
    expect(mapLinks("Plant 2\n55 Oak Rd").google).toContain("Plant%202%2C%2055%20Oak%20Rd");
  });
});

describe("work days", () => {
  it("sorts, removes repeats and refuses anything that isn't a real date", () => {
    expect(normalizeDays(["2026-12-03", "2026-12-01", "2026-12-03"])).toEqual(["2026-12-01", "2026-12-03"]);
    expect(() => normalizeDays(["2026-02-30"])).toThrow(/date/);
    expect(() => normalizeDays(["12/01/2026"])).toThrow(/date/);
    expect(() => normalizeDays("2026-12-01")).toThrow();
  });
  it("caps the number of days", () => {
    expect(() => normalizeDays(dayRange("2026-01-01", "2026-12-31"))).toThrow(/90/);
  });
  it("makes a range of days, optionally skipping weekends", () => {
    expect(dayRange("2026-11-27", "2026-12-01")).toEqual(["2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01"]);
    expect(dayRange("2026-11-27", "2026-12-01", { weekdays: true })).toEqual(["2026-11-27", "2026-11-30", "2026-12-01"]);
    expect(dayRange("2026-12-02", "2026-12-01")).toEqual([]);
  });
  it("describes the days in short", () => {
    expect(daysLabel([])).toBe("No days set");
    expect(daysLabel(["2026-12-01"])).toBe("Dec 1, 2026");
    expect(daysLabel(["2026-12-01", "2026-12-02", "2026-12-03"])).toBe("Dec 1 – Dec 3, 2026 (3 days)");
    expect(daysLabel(["2026-12-01", "2026-12-04"])).toBe("Dec 1 – Dec 4, 2026 (2 days)");
  });
});

describe("statuses", () => {
  it("knows the job statuses", () => {
    expect(JOB_STATUSES).toEqual(["scheduled", "in_progress", "done", "cancelled"]);
    expect(isJobStatus("done")).toBe(true);
    expect(isJobStatus("lost")).toBe(false);
  });
});

describe("the email to a tech", () => {
  const job = {
    id: "abc123", job_number: "J-1042", customer: "Acme Bottling", machine: "4110MB",
    location: "1 Main St, Pottstown, PA", contact_name: "Dana Smith", contact_phone: "555-0100", contact_email: "dana@acme.test",
    work_days: ["2026-12-01", "2026-12-02"], notes: "Bring the 38mm change parts.\n<b>not html</b>",
  };
  const mail = jobEmail(job, { link: jobLink("https://portal.example", "abc123", true), techName: "Elim", by: "Meagan Hooper" });
  it("has the job number, customer and days in the subject", () => {
    expect(mail.subject).toBe("Scheduled: job J-1042, Acme Bottling, Dec 1 – Dec 2, 2026 (2 days)");
  });
  it("links to the job's work order in the workbook, or the job page when the workbook is off", () => {
    expect(mail.text).toContain("https://portal.example/work-orders/abc123");
    expect(mail.html).toContain('href="https://portal.example/work-orders/abc123"');
    expect(jobLink("https://portal.example", "abc123", false)).toBe("https://portal.example/jobs/abc123");
  });
  it("carries the location with map links, the contact and the notes", () => {
    for (const s of ["1 Main St, Pottstown, PA", "Dana Smith", "555-0100", "dana@acme.test", "4110MB", "Bring the 38mm change parts.", "Meagan Hooper"]) expect(mail.text).toContain(s);
    expect(mail.html).toContain("https://waze.com/ul?q=");
    expect(mail.html).toContain("https://maps.apple.com/?daddr=");
  });
  it("never lets typed text become HTML", () => {
    expect(mail.html).not.toContain("<b>not html</b>");
    expect(mail.html).toContain("&lt;b&gt;not html&lt;/b&gt;");
  });
});
