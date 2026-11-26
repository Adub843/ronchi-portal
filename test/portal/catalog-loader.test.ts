// The PC catalog loader's door (src/portal/routes/catalog-loader.ts): a key, not a staff session.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "../../src/portal/index";
import { sha256Hex } from "../../src/shared/crypto";
import { person } from "./helpers";

const KEY = "k".repeat(40);
const GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

async function call(path: string, init: { method?: string; body?: BodyInit; key?: string; type?: string } = {}, hash?: string) {
  const headers: Record<string, string> = { "cf-connecting-ip": "10.9.9.9" };
  if (init.key) headers.authorization = `Bearer ${init.key}`;
  if (init.type) headers["content-type"] = init.type;
  return app.request(`${env.ORIGIN}/api/catalog-loader${path}`, { method: init.method ?? "GET", headers, body: init.body }, { ...env, CATALOG_LOADER_KEY_HASH: hash ?? (await sha256Hex(KEY)) });
}

async function machineWithSheet() {
  const admin = await person("admin");
  const serial = `${5100 + Math.floor(Math.random() * 800)}MB`;
  const m = await admin.json("/api/machines", { body: { serial, model: "ROTOCAP" } });
  const imp = await admin.json(`/api/catalog/machines/${m.data.id}/import`, { body: { fileName: "x.pdf", pages: 2, sheets: [{ key: "p1", page: 1, title: "Capping head", code: "MB000100", rows: [] }] } });
  return { serial, sheet: imp.data.sheets[0].id as string, admin, machineId: m.data.id as string };
}

describe("PC catalog loader", () => {
  it("is switched off without the secret, and refuses a wrong key", async () => {
    expect((await call("/machines", { key: KEY }, "")).status).toBe(404);
    expect((await call("/machines", { key: "x".repeat(40) })).status).toBe(404);
    expect((await call("/machines")).status).toBe(404);
  });

  it("lists machines with their parts-list numbers and puts a 3D model on a parts list", async () => {
    const { serial, sheet, admin, machineId } = await machineWithSheet();
    const list = await call("/machines", { key: KEY });
    expect(list.status).toBe(200);
    const m = ((await list.json()) as any).machines.find((x: any) => x.serial === serial);
    expect(m.sheets).toEqual([{ id: sheet, code: "MB000100", title: "Capping head", source: "manual", has_model: false, has_drawing: false }]);

    const put = await call(`/sheets/${sheet}/model`, { method: "PUT", key: KEY, type: "model/gltf-binary", body: GLB });
    expect(put.status).toBe(200);
    const tree = await admin.json(`/api/catalog/machines/${machineId}`);
    expect(tree.data.sheets.find((s: any) => s.id === sheet).has_model).toBeTruthy();
  });

  it("takes a wrong 3D model off again, by key or by staff", async () => {
    const { sheet, admin, machineId } = await machineWithSheet();
    const hasModel = async () => (await admin.json(`/api/catalog/machines/${machineId}`)).data.sheets.find((s: any) => s.id === sheet).has_model;
    await call(`/sheets/${sheet}/model`, { method: "PUT", key: KEY, type: "model/gltf-binary", body: GLB });
    expect((await call(`/sheets/${sheet}/model`, { method: "DELETE", key: KEY })).status).toBe(200);
    expect(await hasModel()).toBeFalsy();
    expect((await call(`/sheets/${sheet}/model`, { method: "DELETE", key: KEY })).status).toBe(404);
    expect((await call(`/sheets/${sheet}/model`, { method: "DELETE" })).status).toBe(404);

    await call(`/sheets/${sheet}/model`, { method: "PUT", key: KEY, type: "model/gltf-binary", body: GLB });
    expect((await admin.fetch(`/api/catalog/sheets/${sheet}/model`, { method: "DELETE" })).status).toBe(200);
    expect(await hasModel()).toBeFalsy();
    const viewer = await person("tech");
    expect((await viewer.fetch(`/api/catalog/sheets/${sheet}/model`, { method: "DELETE" })).status).toBe(403);
  });

  it("keeps one copy of a model that sits on many parts lists", async () => {
    const one = await machineWithSheet();
    const two = await machineWithSheet();
    // A model nobody has sent yet can't be pointed at.
    const glb = new Uint8Array([...GLB, 7, 7, 7, Math.floor(Math.random() * 250), Math.floor(Math.random() * 250)]);
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", glb))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const link = (sheet: string) => call(`/sheets/${sheet}/model-ref`, { method: "PUT", key: KEY, type: "application/json", body: JSON.stringify({ sha256 }) });
    expect((await link(two.sheet)).status).toBe(404);
    expect((await call(`/sheets/${two.sheet}/model-ref`, { method: "PUT", key: KEY, type: "application/json", body: JSON.stringify({ sha256: "nope" }) })).status).toBe(400);
    // Sent once for the first list, then the second list only points at it.
    expect((await call(`/sheets/${one.sheet}/model`, { method: "PUT", key: KEY, type: "model/gltf-binary", body: glb })).status).toBe(200);
    expect((await link(two.sheet)).status).toBe(200);
    const stored = await env.FILES.list({ prefix: `catalog/shared/${sha256}` });
    expect(stored.objects.length).toBe(1);
    const read = async (p: typeof one) => new Uint8Array(await (await p.admin.fetch(`/api/catalog/sheets/${p.sheet}/model`)).arrayBuffer());
    expect(await read(one)).toEqual(glb);
    expect(await read(two)).toEqual(glb);
    // Taking it off one list leaves the other working; the file goes with the last list.
    expect((await call(`/sheets/${one.sheet}/model`, { method: "DELETE", key: KEY })).status).toBe(200);
    expect(await read(two)).toEqual(glb);
    expect((await one.admin.fetch(`/api/catalog/sheets/${one.sheet}/model`)).status).toBe(404);
    expect((await call(`/sheets/${two.sheet}/model`, { method: "DELETE", key: KEY })).status).toBe(200);
    expect((await env.FILES.list({ prefix: `catalog/shared/${sha256}` })).objects.length).toBe(0);
  });

  it("only takes real GLB files", async () => {
    const { sheet } = await machineWithSheet();
    expect((await call(`/sheets/${sheet}/model`, { method: "PUT", key: KEY, type: "model/gltf-binary", body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) })).status).toBe(400);
    expect((await call(`/sheets/${sheet}/model`, { method: "PUT", key: KEY, type: "image/png", body: GLB })).status).toBe(400);
  });

  it("can't do anything else in the portal with the key", async () => {
    const res = await app.request(`${env.ORIGIN}/api/machines`, { headers: { authorization: `Bearer ${KEY}`, "cf-connecting-ip": "10.9.9.8" } }, { ...env, CATALOG_LOADER_KEY_HASH: await sha256Hex(KEY) });
    expect(res.status).toBe(401);
  });

  it("saves parts lists and drawings read from a manual on the PC, and only for a machine the portal has", async () => {
    const admin = await person("admin");
    const serial = `${6100 + Math.floor(Math.random() * 800)}MB`;
    const m = await admin.json("/api/machines", { body: { serial, model: "EXACTA" } });
    const sheets = [
      { key: "5", page: 5, code: "MB000200", title: "Filling group", rows: [{ pos: "1", code: "GF092618", qty: 2, nameEn: "Support", hotspots: [{ x: 0.2, y: 0.3, w: 0.02, h: 0.02 }] }] },
      { key: "6", parentKey: "5", page: 6, code: "GF092618", title: "Support", rows: [] },
    ];
    const post = (to: string, key?: string) => call(`/machines/${to}/import`, { method: "POST", key, type: "application/json", body: JSON.stringify({ fileName: "chapter 11.pdf", pages: 9, sheets }) });
    expect((await post(serial)).status).toBe(404);
    expect((await post("0000ZZ", KEY)).status).toBe(404);
    const res = await post(serial.toLowerCase(), KEY);
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as any).sheets as { key: string; id: string }[];
    expect(ids.map((x) => x.key)).toEqual(["5", "6"]);

    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    expect((await call(`/sheets/${ids[0]!.id}/drawing?w=800&h=600`, { method: "PUT", key: KEY, type: "image/png", body: PNG })).status).toBe(200);
    expect((await call(`/sheets/${ids[0]!.id}/drawing`, { method: "PUT", key: KEY, type: "image/png", body: PNG })).status).toBe(400);
    expect((await call(`/sheets/${ids[0]!.id}/drawing?w=800&h=600`, { method: "PUT", type: "image/png", body: PNG })).status).toBe(404);

    const tree = await admin.json(`/api/catalog/machines/${m.data.id}`);
    expect(tree.data.sheets.map((s: any) => [s.code, !!s.has_drawing, s.rows])).toEqual([["MB000200", true, 1], ["GF092618", false, 0]]);
    expect(tree.data.sheets[1].parent_id).toBe(ids[0]!.id);
    // The import shows in the machine's history with nobody's name on it.
    expect(tree.data.imports[0]).toMatchObject({ file_name: "chapter 11.pdf", sheets: 2, rows: 1, by_name: null });
    const sheet = await admin.json(`/api/catalog/sheets/${ids[0]!.id}`);
    expect(sheet.data.rows[0].hotspots).toEqual([{ x: 0.2, y: 0.3, w: 0.02, h: 0.02 }]);
  });
});
