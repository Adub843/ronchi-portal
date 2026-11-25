// Part pictures and 3D views from Fusion (scripts/fusion-renders.mjs), and the catalog fixes that
// came with them: 3D kept on a manual re-import, CAD names checked before publishing, part
// numbers checked when typed.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../../src/portal/index";
import { person } from "./helpers";
import { connectPartsSite, partsEnv } from "./parts-site";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);
const GLB = new TextEncoder().encode("glTF....model");

let serialN = 0;
async function machine(fields: Record<string, string> = {}) {
  const serial = `${4600 + ++serialN}MB`;
  const r = await (await person("admin")).json("/api/machines", { body: { serial, model: "ROTOCAP", ...fields } });
  if (r.status !== 200) throw new Error(JSON.stringify(r.data));
  return { id: r.data.id as string, serial };
}

const SHEETS = [
  { key: "p3", page: 3, title: "Capping head", code: "MB000100", rows: [
    { pos: "1", code: "MB000200", qty: 1, nameEn: "Clutch" },
    { pos: "2", code: "GF010526", qty: 4, nameEn: "Screw" },
  ] },
  { key: "p4", parentKey: "p3", page: 4, title: "Clutch", code: "MB000200", rows: [{ pos: "1", code: "MB000300", qty: 2, nameEn: "O-ring" }] },
];

type Who = Awaited<ReturnType<typeof person>>;
const put = (who: Who, path: string, bytes: Uint8Array, type: string) => app.request(`${env.ORIGIN}${path}`, {
  method: "PUT", body: bytes, headers: { cookie: who.cookie, origin: env.ORIGIN, "x-ronchi": "1", "content-type": type, "cf-connecting-ip": who.ip },
}, env);

async function catalog(fields: Record<string, string> = {}) {
  const svc = await person("service");
  const m = await machine(fields);
  const imp = await svc.json(`/api/catalog/machines/${m.id}/import`, { body: { fileName: "a.pdf", pages: 2, sheets: SHEETS } });
  if (imp.status !== 200) throw new Error(JSON.stringify(imp.data));
  const [top, sub] = imp.data.sheets.map((s: any) => s.id as string);
  return { svc, m, top: top!, sub: sub! };
}

describe("part pictures from Fusion (staff)", () => {
  beforeAll(() => connectPartsSite());

  it("a catalog editor adds a part picture; it shows on every parts list with that part", async () => {
    const { svc, top } = await catalog();
    expect((await put(svc, "/api/catalog/parts/GF010526/picture", PNG, "image/png")).status).toBe(200);
    const sheet = await svc.json(`/api/catalog/sheets/${top}`);
    const row = sheet.data.rows.find((r: any) => r.code === "GF010526");
    expect(row.picture).toBeTruthy();
    expect(sheet.data.rows.find((r: any) => r.code === "MB000200").picture).toBeNull();
    const got = await svc.fetch("/api/catalog/parts/GF010526/picture");
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(got.headers.get("content-security-policy")).toContain("sandbox");
    expect((await svc.json("/api/catalog/parts/GF010526")).data.part.picture_at).toBeTruthy();
    // Taking it off.
    expect((await svc.fetch("/api/catalog/parts/GF010526/picture", { method: "DELETE" })).status).toBe(200);
    expect((await svc.fetch("/api/catalog/parts/GF010526/picture")).status).toBe(404);
  });

  it("only catalog editors add pictures, only real PNG or WebP, only for parts in the catalog", async () => {
    const { svc, top } = await catalog();
    const tech = await person("tech");
    expect((await put(tech, "/api/catalog/parts/GF010526/picture", PNG, "image/png")).status).toBe(403);
    expect((await put(tech, `/api/catalog/sheets/${top}/views/iso`, PNG, "image/png")).status).toBe(403);
    expect((await put(svc, "/api/catalog/parts/GF010526/picture", new TextEncoder().encode("<html><script>alert(1)</script>"), "image/png")).status).toBe(400);
    expect((await put(svc, "/api/catalog/parts/GF010526/picture", new TextEncoder().encode("<svg/>"), "image/svg+xml")).status).toBe(400);
    expect((await put(svc, "/api/catalog/parts/ZZ999999/picture", PNG, "image/png")).status).toBe(404);
    expect((await put(svc, "/api/catalog/parts/not-a-code/picture", PNG, "image/png")).status).toBe(404);
    expect((await put(svc, `/api/catalog/sheets/${top}/views/inside`, PNG, "image/png")).status).toBe(404);
  });

  it("3D views land on a parts list and show as its picture in the catalog", async () => {
    const { svc, m, top } = await catalog();
    for (const v of ["iso", "front"]) expect((await put(svc, `/api/catalog/sheets/${top}/views/${v}`, PNG, "image/png")).status).toBe(200);
    expect((await svc.json(`/api/catalog/sheets/${top}`)).data.sheet.views).toEqual(["iso", "front"]);
    const tree = await svc.json(`/api/catalog/machines/${m.id}`);
    expect(tree.data.sheets.find((s: any) => s.id === top).views).toEqual(["iso", "front"]);
    const got = await svc.fetch(`/api/catalog/sheets/${top}/views/front`);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-security-policy")).toContain("sandbox");
    expect((await svc.fetch(`/api/catalog/sheets/${top}/views/top`)).status).toBe(404);
    expect((await svc.fetch(`/api/catalog/sheets/${top}/views`, { method: "DELETE" })).status).toBe(200);
    expect((await svc.json(`/api/catalog/sheets/${top}`)).data.sheet.views).toEqual([]);
    expect(await env.FILES.get(`catalog/${top}/view-iso`)).toBeNull();
  });

  it("lists the part numbers in a machine's catalog, so Fusion names can be matched to them", async () => {
    const { svc, m } = await catalog();
    const r = await svc.json(`/api/catalog/machines/${m.id}/codes`);
    expect(r.data.codes.sort()).toEqual(["GF010526", "MB000100", "MB000200", "MB000300"]);
  });

  it("publish carries part pictures and views to the parts site, and customers see only their own", async () => {
    const { svc, m, top } = await catalog();
    await put(svc, "/api/catalog/parts/MB000300/picture", PNG, "image/png");
    await put(svc, `/api/catalog/sheets/${top}/views/iso`, PNG, "image/png");
    const pub = await svc.json(`/api/catalog/machines/${m.id}/publish`, { body: {} });
    expect(pub.status).toBe(200);
    expect(pub.data.files).toEqual(expect.arrayContaining([top, "pic_MB000300"]));
    const copy = await svc.json(`/api/catalog/machines/${m.id}/publish/files`, { body: { sheets: pub.data.files } });
    expect(copy.data.copied).toBe(2);
    expect(await partsEnv.PARTS_FILES.get("parts/MB000300/picture")).not.toBeNull();
    expect(await partsEnv.PARTS_FILES.get(`sheets/${top}/view-iso`)).not.toBeNull();
    const part = await partsEnv.PARTS_DB.prepare("SELECT picture_at FROM parts WHERE code = 'MB000300'").first<{ picture_at: string | null }>();
    expect(part?.picture_at).toBeTruthy();
    const sheet = await partsEnv.PARTS_DB.prepare("SELECT views FROM sheets WHERE id = ?").bind(top).first<{ views: string }>();
    expect(JSON.parse(sheet!.views)).toEqual(["iso"]);
  });
});

describe("catalog fixes", () => {
  beforeAll(() => connectPartsSite());

  it("importing the manual again keeps the 3D model and views of parts lists with the same number", async () => {
    const { svc, m, top } = await catalog();
    expect((await put(svc, `/api/catalog/sheets/${top}/model`, GLB, "model/gltf-binary")).status).toBe(200);
    await svc.json(`/api/catalog/sheets/${top}`, { method: "PATCH", body: { meshMap: { "Bolt-1": "GF010526" } } });
    await put(svc, `/api/catalog/sheets/${top}/views/iso`, PNG, "image/png");
    const again = await svc.json(`/api/catalog/machines/${m.id}/import`, { body: { fileName: "b.pdf", pages: 2, sheets: SHEETS } });
    const newTop = again.data.sheets[0].id;
    expect(newTop).not.toBe(top);
    const s = await svc.json(`/api/catalog/sheets/${newTop}`);
    expect(s.data.sheet.model).toEqual({ size: GLB.byteLength, meshMap: { "Bolt-1": "GF010526" } });
    expect(s.data.sheet.views).toEqual(["iso"]);
    expect((await svc.fetch(`/api/catalog/sheets/${newTop}/model`)).status).toBe(200);
    expect((await svc.fetch(`/api/catalog/sheets/${newTop}/views/iso`)).status).toBe(200);
    // The old sheet's files are gone.
    expect(await env.FILES.get(`catalog/${top}/model.glb`)).toBeNull();
  });

  it("a customer name in the 3D part names blocks publishing", async () => {
    const { svc, m, top } = await catalog({ customer: "Zenith Bottlers", site: "Lakeside" });
    await svc.json(`/api/catalog/sheets/${top}`, { method: "PATCH", body: { meshMap: { "Zenith Bottlers guide rail": "GF010526" } } });
    const r = await svc.json(`/api/catalog/machines/${m.id}/publish`, { body: {} });
    expect(r.status).toBe(400);
    expect(r.data.error).toContain("Zenith Bottlers");
  });

  it("a mistyped assembly number is refused, not quietly wiped", async () => {
    const { svc, m, top } = await catalog();
    const bad = await svc.json(`/api/catalog/sheets/${top}`, { method: "PATCH", body: { code: "MB0001OO" } });
    expect(bad.status).toBe(400);
    expect((await svc.json(`/api/catalog/sheets/${top}`)).data.sheet.code).toBe("MB000100");
    expect((await svc.json(`/api/catalog/sheets/${top}`, { method: "PATCH", body: { code: "" } })).status).toBe(200);
    expect((await svc.json(`/api/catalog/sheets/${top}`)).data.sheet.code).toBeNull();
    expect((await svc.json(`/api/catalog/machines/${m.id}/sheets`, { body: { title: "Kit", code: "nope" } })).status).toBe(400);
  });
});
