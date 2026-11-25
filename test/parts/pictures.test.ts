// Part pictures and 3D views on the customer parts site: published by the portal, served only to
// companies whose machines use that part or parts list, always sandboxed.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { adminCall, company, customer, publish } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);

/** Publish like helpers.publish, with a picture on MB000300 and an iso view on the top sheet. */
async function publishWithPictures(serial: string, suffix = "") {
  const s = await publish(serial, suffix);
  const sheets = await env.PARTS_DB.prepare("SELECT id FROM sheets WHERE serial = ?").bind(serial).all<{ id: string }>();
  await env.PARTS_DB.prepare("UPDATE parts SET picture_at = '2026-11-25T00:00:00Z' WHERE code = 'MB000300'").run();
  await env.PARTS_DB.prepare("UPDATE sheets SET views = '[\"iso\"]' WHERE id = ?").bind(s.top).run();
  expect(sheets.results).toHaveLength(2);
  return s;
}

describe("part pictures on the parts site", () => {
  it("the publish door takes pictures and views as PNG or WebP only", async () => {
    const s = await publish("3301AA");
    expect((await adminCall("/files/parts/MB000300/picture", { method: "PUT", raw: "<svg onload=alert(1)>", type: "image/svg+xml" })).status).toBe(400);
    expect((await adminCall("/files/parts/not-a-code/picture", { method: "PUT", raw: PNG, type: "image/png" })).status).toBe(400);
    expect((await adminCall("/files/parts/MB000300/picture", { method: "PUT", raw: PNG, type: "image/png" })).status).toBe(200);
    expect((await adminCall(`/files/sheets/${s.top}/views/iso`, { method: "PUT", raw: PNG, type: "image/png" })).status).toBe(200);
    expect((await adminCall(`/files/sheets/${s.top}/views/iso`, { method: "PUT", raw: PNG, type: "image/png", key: null })).status).toBe(404);
  });

  it("publish keeps a part's picture time and a sheet's views, and drops anything else", async () => {
    const res = await adminCall("/publish", {
      body: {
        machine: { serial: "3401AA" },
        sheets: [{ id: "sheet-3401AA-top", title: "Head", views: ["iso", "../etc", "top"], rows: [{ pos: "1", code: "MB000300", qty: 1 }] }],
        parts: [{ code: "MB000300", nameEn: "O-ring", pictureAt: "2026-11-25T10:00:00.000Z" }],
      },
    });
    expect(res.status).toBe(200);
    const sheet = await env.PARTS_DB.prepare("SELECT views FROM sheets WHERE id = 'sheet-3401AA-top'").first<{ views: string }>();
    expect(JSON.parse(sheet!.views)).toEqual(["iso", "top"]);
    const part = await env.PARTS_DB.prepare("SELECT picture_at FROM parts WHERE code = 'MB000300'").first<{ picture_at: string }>();
    expect(part!.picture_at).toBe("2026-11-25T10:00:00.000Z");
  });

  it("customers see pictures and views of their own machines only, sandboxed", async () => {
    const a = await company(["3501AA"]);
    await company(["3502BB"]);
    const sa = await publishWithPictures("3501AA");
    const sb = await publishWithPictures("3502BB");
    await env.PARTS_FILES.put("parts/MB000300/picture", PNG, { httpMetadata: { contentType: "image/png" } });
    await env.PARTS_FILES.put(`sheets/${sa.top}/view-iso`, PNG, { httpMetadata: { contentType: "image/png" } });
    await env.PARTS_FILES.put(`sheets/${sb.top}/view-iso`, PNG, { httpMetadata: { contentType: "image/png" } });
    await env.PARTS_FILES.put("parts/MB350201/picture", PNG, { httpMetadata: { contentType: "image/png" } });
    await env.PARTS_DB.prepare("UPDATE parts SET picture_at = 'x' WHERE code = 'MB350201'").run();
    const c = await customer(a);

    const sub = await c.json(`/api/sheets/${sa.sub}`);
    expect(sub.data.rows.find((r: any) => r.code === "MB000300").picture).toBeTruthy();
    const top = await c.json(`/api/sheets/${sa.top}`);
    expect(top.data.sheet.views).toEqual(["iso"]);
    expect(top.data.rows.find((r: any) => r.code === "MB000200").picture).toBeNull();
    const machine = await c.json("/api/machines/3501AA");
    expect(machine.data.sheets.find((x: any) => x.id === sa.top).views).toEqual(["iso"]);

    const pic = await c.fetch("/api/parts/MB000300/picture");
    expect(pic.status).toBe(200);
    expect(pic.headers.get("content-type")).toBe("image/png");
    expect(pic.headers.get("content-security-policy")).toContain("sandbox");
    const view = await c.fetch(`/api/sheets/${sa.top}/views/iso`);
    expect(view.status).toBe(200);
    expect(view.headers.get("content-security-policy")).toContain("sandbox");

    // Another company's part and parts list: not found, even though the files exist.
    expect((await c.fetch("/api/parts/MB350201/picture")).status).toBe(404);
    expect((await c.fetch(`/api/sheets/${sb.top}/views/iso`)).status).toBe(404);
    // A view the sheet doesn't list, and a part without a picture: not found.
    expect((await c.fetch(`/api/sheets/${sa.top}/views/top`)).status).toBe(404);
    expect((await c.fetch("/api/parts/MB000200/picture")).status).toBe(404);
  });

  it("republishing deletes the views of parts lists that are gone", async () => {
    await company(["3601AA"]);
    const first = await publishWithPictures("3601AA");
    await env.PARTS_FILES.put(`sheets/${first.top}/view-iso`, PNG);
    await publish("3601AA", "-v2");
    expect(await env.PARTS_FILES.get(`sheets/${first.top}/view-iso`)).toBeNull();
  });
});
