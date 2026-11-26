// Send one 3D model to a parts list. The portal keeps each model once by its SHA-256, so the
// file itself goes up only the first time; every other parts list with the same model is a tiny
// request that points at it.
import { createHash } from "node:crypto";

/** fetch that waits and tries again when the portal says "too many requests" (300 a minute) or the line drops. */
export async function send(url: string, init: RequestInit): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, init);
      if (r.status !== 429 || i >= 6) return r;
    } catch (e) {
      if (i >= 6) throw e;
    }
    await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** i)));
  }
}

export async function sendModel(portal: string, auth: Record<string, string>, sheetId: string, model: Uint8Array | ArrayBuffer): Promise<{ ok: boolean; shared: boolean; error?: string }> {
  // three.js's GLB writer gives an ArrayBuffer; Node's hash wants a typed array.
  const glb = model instanceof Uint8Array ? model : new Uint8Array(model);
  const sha256 = createHash("sha256").update(glb).digest("hex");
  const base = `${portal}/api/catalog-loader/sheets/${sheetId}`;
  const link = await send(`${base}/model-ref`, { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ sha256 }) });
  if (link.ok) return { ok: true, shared: true };
  // 404 = the portal doesn't have this model yet (or it is an older portal without sharing): send the file.
  const r = await send(`${base}/model`, { method: "PUT", headers: { ...auth, "content-type": "model/gltf-binary" }, body: glb });
  return r.ok ? { ok: true, shared: false } : { ok: false, shared: false, error: `${r.status} ${await r.text()}` };
}
