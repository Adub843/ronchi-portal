// Send one 3D model to a parts list. The portal keeps each model once by its SHA-256, so the
// file itself goes up only the first time; every other parts list with the same model is a tiny
// request that points at it.
import { createHash } from "node:crypto";

export async function sendModel(portal: string, auth: Record<string, string>, sheetId: string, glb: Uint8Array): Promise<{ ok: boolean; shared: boolean; error?: string }> {
  const sha256 = createHash("sha256").update(glb).digest("hex");
  const base = `${portal}/api/catalog-loader/sheets/${sheetId}`;
  const link = await fetch(`${base}/model-ref`, { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ sha256 }) });
  if (link.ok) return { ok: true, shared: true };
  // 404 = the portal doesn't have this model yet (or it is an older portal without sharing): send the file.
  const r = await fetch(`${base}/model`, { method: "PUT", headers: { ...auth, "content-type": "model/gltf-binary" }, body: glb });
  return r.ok ? { ok: true, shared: false } : { ok: false, shared: false, error: `${r.status} ${await r.text()}` };
}
