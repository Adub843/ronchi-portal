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
    expect(m.sheets).toEqual([{ id: sheet, code: "MB000100", title: "Capping head", has_model: false }]);

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

  it("only takes real GLB files", async () => {
    const { sheet } = await machineWithSheet();
    expect((await call(`/sheets/${sheet}/model`, { method: "PUT", key: KEY, type: "model/gltf-binary", body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) })).status).toBe(400);
    expect((await call(`/sheets/${sheet}/model`, { method: "PUT", key: KEY, type: "image/png", body: GLB })).status).toBe(400);
  });

  it("can't do anything else in the portal with the key", async () => {
    const res = await app.request(`${env.ORIGIN}/api/machines`, { headers: { authorization: `Bearer ${KEY}`, "cf-connecting-ip": "10.9.9.8" } }, { ...env, CATALOG_LOADER_KEY_HASH: await sha256Hex(KEY) });
    expect(res.status).toBe(401);
  });
});
