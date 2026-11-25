// Software downloads (Aaron, 2026-11-25): admins upload installers and whole program folders into
// packages such as "New laptop setup"; staff open a package, tick the folders they want and
// download them all at once. Licensed vendor software stays with signed-in staff.
import { describe, expect, it } from "vitest";
import { person, sendBytes } from "./helpers";

type P = Awaited<ReturnType<typeof person>>;
const bytes = (s: string) => new TextEncoder().encode(s);

/** Upload one file the way the app does: start, send each part, finish. */
async function upload(admin: P, pkg: string, name: string, folder: string, content: string) {
  const data = bytes(content);
  const start = await admin.json(`/api/software/${pkg}/files`, { body: { name, folder, size: data.length } });
  expect(start.status, JSON.stringify(start.data)).toBe(200);
  const part = await sendBytes(admin, `/api/software/files/${start.data.id}/parts/1`, data);
  expect(part.status).toBe(200);
  const { etag } = (await part.json()) as { etag: string };
  const done = await admin.json(`/api/software/files/${start.data.id}/complete`, { body: { parts: [{ n: 1, etag }] } });
  expect(done.status, JSON.stringify(done.data)).toBe(200);
  return start.data.id as string;
}

describe("software downloads", () => {
  it("an admin makes a package, uploads a program folder, and staff see it grouped by folder", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    const tag = crypto.randomUUID().slice(0, 4);
    const pkg = await admin.json("/api/software", { body: { name: `New laptop setup ${tag}`, description: "Everything a new field laptop needs" } });
    expect(pkg.status).toBe(200);
    const id = pkg.data.id as string;
    await upload(admin, id, "setup.exe", "Studio 5000 v33/Disk1", "MZ fake installer");
    await upload(admin, id, "readme.txt", "Studio 5000 v33", "read me");
    await upload(admin, id, "LinkManager.msi", "", "msi bytes");

    const list = (await tech.json("/api/software")).data.packages as any[];
    const mine = list.find((p) => p.id === id);
    expect(mine).toMatchObject({ name: `New laptop setup ${tag}`, files: 3, size: 17 + 7 + 9 });

    const one = await tech.json(`/api/software/${id}`);
    expect(one.status).toBe(200);
    const files = one.data.files.map((f: any) => [f.folder, f.name]);
    expect(files).toEqual([["", "LinkManager.msi"], ["Studio 5000 v33", "readme.txt"], ["Studio 5000 v33/Disk1", "setup.exe"]]);
  });

  it("downloads a file as an attachment with its own name, and a part of it on request", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    const id = (await admin.json("/api/software", { body: { name: "Allen-Bradley legacy" } })).data.id;
    const fid = await upload(admin, id, "RSLinx Classic 4.21.exe", "RSLinx", "0123456789");
    const res = await tech.fetch(`/api/software/files/${fid}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain("RSLinx%20Classic%204.21.exe");
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(await res.text()).toBe("0123456789");
    const part = await tech.fetch(`/api/software/files/${fid}`, { headers: { range: "bytes=2-5" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await part.text()).toBe("2345");
  });

  it("a file that never finished uploading is not listed or downloadable", async () => {
    const admin = await person("admin");
    const id = (await admin.json("/api/software", { body: { name: "Half done" } })).data.id;
    const start = await admin.json(`/api/software/${id}/files`, { body: { name: "big.iso", folder: "", size: 10 } });
    expect((await admin.json(`/api/software/${id}`)).data.files).toEqual([]);
    expect((await admin.fetch(`/api/software/files/${start.data.id}`)).status).toBe(404);
  });

  it("only people allowed to manage software can upload or remove; signed-out people get nothing", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    expect((await tech.json("/api/software", { body: { name: "Mine" } })).status).toBe(403);
    const id = (await admin.json("/api/software", { body: { name: "Locked" } })).data.id;
    expect((await tech.json(`/api/software/${id}/files`, { body: { name: "x.exe", folder: "", size: 1 } })).status).toBe(403);
    const fid = await upload(admin, id, "x.exe", "", "x");
    expect((await tech.fetch(`/api/software/files/${fid}`, { method: "DELETE" })).status).toBe(403);
    const { Browser } = await import("./helpers");
    expect((await new Browser().fetch("/api/software")).status).toBe(401);
    expect((await new Browser().fetch(`/api/software/files/${fid}`)).status).toBe(401);
  });

  it("folder names can't climb out of the package, and removing a file or package takes it away", async () => {
    const admin = await person("admin");
    const id = (await admin.json("/api/software", { body: { name: "Tidy" } })).data.id;
    for (const folder of ["../etc", "a/../../b", "C:\\Windows"]) {
      expect((await admin.json(`/api/software/${id}/files`, { body: { name: "x.exe", folder, size: 1 } })).status, folder).toBe(400);
    }
    expect((await admin.json(`/api/software/${id}/files`, { body: { name: "x.exe", folder: "", size: 0 } })).status).toBe(400);
    const fid = await upload(admin, id, "x.exe", "Tools\\Old", "x");
    expect((await admin.json(`/api/software/${id}`)).data.files[0].folder).toBe("Tools/Old");
    expect((await admin.fetch(`/api/software/files/${fid}`, { method: "DELETE" })).status).toBe(200);
    expect((await admin.fetch(`/api/software/files/${fid}`)).status).toBe(404);
    expect((await admin.fetch(`/api/software/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(((await admin.json("/api/software")).data.packages as any[]).some((p) => p.id === id)).toBe(false);
  });

  it("renames a package and marks it legacy", async () => {
    const admin = await person("admin");
    const id = (await admin.json("/api/software", { body: { name: "AB" } })).data.id;
    expect((await admin.json(`/api/software/${id}`, { method: "PATCH", body: { name: "Allen-Bradley (legacy)", legacy: true } })).status).toBe(200);
    expect((await admin.json(`/api/software/${id}`)).data.package).toMatchObject({ name: "Allen-Bradley (legacy)", legacy: true });
  });
});
