// Sending a stored file back to the browser, the same safe way everywhere (chat files and job files).
// The type comes from src/shared/files.ts by the file's extension, never from what the uploader's
// browser claimed. Photos may show inside the page; everything else is always a download.
import { fileInfo } from "../../shared/files";
import { fail } from "./http";

export async function serveFile(bucket: R2Bucket, key: string, name: string, opts: { download: boolean }): Promise<Response> {
  const info = fileInfo(name);
  const obj = await bucket.get(key);
  if (!obj || !info) fail(404, "Not found.");
  const inline = info.kind === "image" && !opts.download;
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return new Response(obj.body, {
    headers: {
      "Content-Type": info.type,
      "Content-Length": String(obj.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      // Files never change once sent, so the browser may keep its own copy (never shared caches).
      "Cache-Control": "private, max-age=86400",
      // Even if a file were opened directly, it can't run anything.
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
