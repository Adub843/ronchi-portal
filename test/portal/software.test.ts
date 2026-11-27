// Software downloads (Aaron, 2026-11-25): admins upload installers and whole program folders into
// packages such as "New laptop setup"; staff open a package, tick the folders they want and
// download them all at once. Licensed vendor software stays with signed-in staff.
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("software kept on SharePoint (Aaron, 2026-11-25: \"we dont have to store the software ... tunnel that file from share point for now\")", () => {
  const SP = "https://ronchiam.sharepoint.com/sites/HelpReferenceDocuments/Shared%20Documents/0%20-%20Help%20%26%20Technical%20Reference%20Documents/AB%20Studio%205000%20Software";

  it("a package can hold SharePoint links; Download sends people straight to SharePoint", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    const id = (await admin.json("/api/software", { body: { name: "AB links" } })).data.id;
    const add = await admin.json(`/api/software/${id}/links`, { body: { folder: "Studio 5000 v32", links: [`${SP}/v32/Studio%205000%20v32.iso`, `${SP}/RSLinx%20Classic%204.21.exe`] } });
    expect(add.status, JSON.stringify(add.data)).toBe(200);
    expect(add.data.added).toBe(2);
    const files = (await tech.json(`/api/software/${id}`)).data.files;
    expect(files.map((f: any) => [f.folder, f.name, f.link])).toEqual([
      ["Studio 5000 v32", "RSLinx Classic 4.21.exe", true],
      ["Studio 5000 v32", "Studio 5000 v32.iso", true],
    ]);
    const res = await tech.fetch(`/api/software/files/${files[1].id}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://ronchiam.sharepoint.com/sites/HelpReferenceDocuments/_layouts/15/download.aspx?SourceUrl=" +
        encodeURIComponent("/sites/HelpReferenceDocuments/Shared Documents/0 - Help & Technical Reference Documents/AB Studio 5000 Software/v32/Studio 5000 v32.iso"),
    );
    // Removing a link only removes the link.
    expect((await admin.fetch(`/api/software/files/${files[0].id}`, { method: "DELETE" })).status).toBe(200);
    expect((await tech.json(`/api/software/${id}`)).data.files).toHaveLength(1);
  });

  it("takes the SharePoint page link (AllItems.aspx?id=...) and sharing links too", async () => {
    const admin = await person("admin");
    const id = (await admin.json("/api/software", { body: { name: "AB page links" } })).data.id;
    const page = "https://ronchiam.sharepoint.com/sites/HelpReferenceDocuments/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2FHelpReferenceDocuments%2FShared%20Documents%2FAB%2FFTView%2014.zip&parent=%2Fsites";
    const share = "https://ronchiam.sharepoint.com/:u:/s/HelpReferenceDocuments/EaBcDeF123?e=xyz";
    const add = await admin.json(`/api/software/${id}/links`, { body: { links: [page, { url: share, name: "KEPServerEX 6.exe" }] } });
    expect(add.status, JSON.stringify(add.data)).toBe(200);
    const files = (await admin.json(`/api/software/${id}`)).data.files;
    const byName = Object.fromEntries(files.map((f: any) => [f.name, f.id]));
    expect((await admin.fetch(`/api/software/files/${byName["FTView 14.zip"]}`)).headers.get("location")).toContain("download.aspx?SourceUrl=" + encodeURIComponent("/sites/HelpReferenceDocuments/Shared Documents/AB/FTView 14.zip"));
    expect((await admin.fetch(`/api/software/files/${byName["KEPServerEX 6.exe"]}`)).headers.get("location")).toBe(`${share}&download=1`);
  });

  it("a whole folder can be kept as one line that opens in SharePoint, and links can carry their size and folder", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    const id = (await admin.json("/api/software", { body: { name: "Studio 5000 from SharePoint" } })).data.id;
    const add = await admin.json(`/api/software/${id}/links`, { body: { folder: "AB", links: [
      { url: `${SP}/v32`, open: true, size: 5000000000 },
      { url: `${SP}/v33/Studio%205000%20v33.iso`, size: 7000000000, folder: "v33" },
    ] } });
    expect(add.status, JSON.stringify(add.data)).toBe(200);
    const files = (await tech.json(`/api/software/${id}`)).data.files;
    expect(files.map((f: any) => [f.folder, f.name, f.size, f.opens])).toEqual([["AB", "v32", 5000000000, true], ["AB/v33", "Studio 5000 v33.iso", 7000000000, false]]);
    const res = await tech.fetch(`/api/software/files/${files[0].id}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${SP}/v32`);
    // Without open: true a folder is still refused, and a folder can't climb out of the package.
    expect((await admin.json(`/api/software/${id}/links`, { body: { links: [{ url: `${SP}/v32` }] } })).status).toBe(400);
    expect((await admin.json(`/api/software/${id}/links`, { body: { links: [{ url: `${SP}/a.exe`, folder: "../x" }] } })).status).toBe(400);
  });

  it("a link the package already lists is skipped, so sending a list twice adds nothing", async () => {
    const admin = await person("admin");
    const id = (await admin.json("/api/software", { body: { name: "Sent twice" } })).data.id;
    const links = [{ url: `${SP}/vm/disk.vmdk`, folder: "vm" }, { url: `${SP}/vm/disk.vmdk`, folder: "vm" }, { url: `${SP}/vm/version`, open: true, folder: "vm" }];
    expect((await admin.json(`/api/software/${id}/links`, { body: { links } })).data).toEqual({ added: 2, skipped: 1 });
    expect((await admin.json(`/api/software/${id}/links`, { body: { links: [...links, { url: `${SP}/vm/new.iso`, folder: "vm" }] } })).data).toEqual({ added: 1, skipped: 3 });
    expect((await admin.json(`/api/software/${id}/links`, { body: { links } })).data).toEqual({ added: 0, skipped: 3 });
    expect((await admin.json(`/api/software/${id}`)).data.files.map((f: any) => f.name)).toEqual(["disk.vmdk", "new.iso", "version"]);
  });

  it("only Ronchi SharePoint file links, only for people who manage software", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    const id = (await admin.json("/api/software", { body: { name: "Guarded" } })).data.id;
    expect((await tech.json(`/api/software/${id}/links`, { body: { links: [`${SP}/a.exe`] } })).status).toBe(403);
    for (const bad of ["https://evil.example.com/a.exe", "http://ronchiam.sharepoint.com/sites/x/a.exe", "https://ronchiam.sharepoint.com.evil.com/sites/x/a.exe", "javascript:alert(1)", SP]) {
      expect((await admin.json(`/api/software/${id}/links`, { body: { links: [bad] } })).status, bad).toBe(400);
    }
  });
});

describe("SharePoint through the portal (Aaron, 2026-11-25: \"just built it and ill do that when i get that log in\")", () => {
  const SP = "https://ronchiam.sharepoint.com/sites/HelpReferenceDocuments/Shared%20Documents/AB%20Studio%205000%20Software";
  const MS = { MS_TENANT_ID: "tenant-1", MS_CLIENT_ID: "client-1", MS_CLIENT_SECRET: "secret-1" };
  const shareId = (url: string) => "u!" + btoa(url).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  afterEach(() => vi.unstubAllGlobals());

  /** A pretend Microsoft: a token, the Graph shares API, and SharePoint's pre-signed download host. */
  function fakeMicrosoft(opts: { tokenFails?: boolean; folders?: Record<string, { name: string; size?: number; folder?: boolean }[]> } = {}) {
    const calls: { url: string; headers: Headers }[] = [];
    const items: Record<string, string> = {}; // item id -> webUrl
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;
      calls.push({ url, headers: req.headers });
      if (url.startsWith("https://login.microsoftonline.com/")) {
        if (!url.includes("/tenant-1/")) return Response.json({ error: "invalid_tenant" }, { status: 400 });
        if (opts.tokenFails) return Response.json({ error: "invalid_client" }, { status: 401 });
        const form = new URLSearchParams(await req.text());
        expect(form.get("client_id")).toBe("client-1");
        expect(form.get("scope")).toBe("https://graph.microsoft.com/.default");
        return Response.json({ access_token: "tok-1", expires_in: 3600 });
      }
      expect(req.headers.get("authorization") ?? "", url).toBe(url.startsWith("https://graph.microsoft.com/") ? "Bearer tok-1" : "");
      const content = /\/shares\/([^/]+)\/driveItem\/content$/.exec(url);
      if (content) return new Response(null, { status: 302, headers: { location: `https://ronchiam-my.sharepoint.com/download.aspx?tempauth=xyz&f=${content[1]}` } });
      if (url.startsWith("https://ronchiam-my.sharepoint.com/download.aspx")) {
        const range = req.headers.get("range");
        if (range === "bytes=2-5") return new Response("2345", { status: 206, headers: { "content-range": "bytes 2-5/10", "content-length": "4" } });
        return new Response("0123456789", { headers: { "content-length": "10", "content-type": "text/html" } });
      }
      const share = /\/shares\/([^/?]+)\/driveItem\?/.exec(url);
      if (share) {
        const web = Object.keys(opts.folders ?? {}).find((w) => shareId(w) === share[1]);
        if (!web) return Response.json({ error: { code: "itemNotFound" } }, { status: 404 });
        items.root = web;
        return Response.json({ id: "root", name: decodeURIComponent(web.split("/").pop()!), webUrl: web, folder: { childCount: 1 }, parentReference: { driveId: "d1" } });
      }
      const kids = /\/drives\/d1\/items\/([^/]+)\/children/.exec(url);
      if (kids) {
        const web = items[kids[1]!]!;
        const value = (opts.folders?.[web] ?? []).map((k, i) => {
          const id = `${kids[1]}-${i}`;
          const childWeb = `${web}/${encodeURIComponent(k.name)}`;
          items[id] = childWeb;
          return k.folder ? { id, name: k.name, webUrl: childWeb, folder: { childCount: 1 } } : { id, name: k.name, webUrl: childWeb, size: k.size ?? 1, file: {} };
        });
        return Response.json({ value });
      }
      return new Response("unexpected " + url, { status: 500 });
    });
    return calls;
  }

  async function connected(role: string) {
    const p = await person(role);
    p.env = { ...p.env, ...MS };
    return p;
  }

  it("once the Microsoft connection is set, Download comes through the portal itself, resumable", async () => {
    const admin = await connected("admin");
    const tech = await connected("tech");
    const id = (await admin.json("/api/software", { body: { name: "AB tunnel" } })).data.id;
    await admin.json(`/api/software/${id}/links`, { body: { links: [`${SP}/RSLinx%20Classic%204.21.exe`] } });
    const list = await tech.json(`/api/software/${id}`);
    expect(list.data.sharepoint).toBe(true);
    const fid = list.data.files[0].id;
    const calls = fakeMicrosoft();
    const res = await tech.fetch(`/api/software/files/${fid}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toContain("RSLinx%20Classic%204.21.exe");
    expect(res.headers.get("content-length")).toBe("10");
    expect(await res.text()).toBe("0123456789");
    expect(calls.some((c) => c.url === `https://graph.microsoft.com/v1.0/shares/${shareId(`${SP}/RSLinx%20Classic%204.21.exe`)}/driveItem/content`)).toBe(true);

    const part = await tech.fetch(`/api/software/files/${fid}`, { headers: { range: "bytes=2-5" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await part.text()).toBe("2345");
  });

  it("without the connection, or if Microsoft refuses it, Download still goes straight to SharePoint", async () => {
    const admin = await person("admin");
    const id = (await admin.json("/api/software", { body: { name: "AB fallback" } })).data.id;
    await admin.json(`/api/software/${id}/links`, { body: { links: [`${SP}/a.exe`] } });
    const list = await admin.json(`/api/software/${id}`);
    expect(list.data.sharepoint).toBe(false);
    expect((await admin.json("/api/software")).data.sharepoint).toBe(false);
    const fid = list.data.files[0].id;
    expect((await admin.fetch(`/api/software/files/${fid}`)).status).toBe(302);

    admin.env = { ...admin.env, ...MS, MS_TENANT_ID: "tenant-2" };
    fakeMicrosoft({ tokenFails: true });
    const res = await admin.fetch(`/api/software/files/${fid}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("download.aspx?SourceUrl=");
  });

  it("with the connection, a SharePoint folder link adds every file inside it, keeping subfolders", async () => {
    const admin = await connected("admin");
    const id = (await admin.json("/api/software", { body: { name: "AB folder" } })).data.id;
    fakeMicrosoft({
      folders: {
        [SP]: [{ name: "v33", folder: true }, { name: "RSLinx Classic 4.21.exe", size: 900 }],
        [`${SP}/v33`]: [{ name: "Disk1", folder: true }, { name: "readme.txt", size: 12 }],
        [`${SP}/v33/Disk1`]: [{ name: "setup.exe", size: 4000 }],
      },
    });
    const add = await admin.json(`/api/software/${id}/links`, { body: { folder: "Studio 5000", links: [SP] } });
    expect(add.status, JSON.stringify(add.data)).toBe(200);
    expect(add.data.added).toBe(3);
    const files = (await admin.json(`/api/software/${id}`)).data.files;
    expect(files.map((f: any) => [f.folder, f.name, f.size])).toEqual([
      ["Studio 5000/AB Studio 5000 Software", "RSLinx Classic 4.21.exe", 900],
      ["Studio 5000/AB Studio 5000 Software/v33", "readme.txt", 12],
      ["Studio 5000/AB Studio 5000 Software/v33/Disk1", "setup.exe", 4000],
    ]);
  });

  it("without the connection, a folder link is turned away with a plain reason", async () => {
    const admin = await person("admin");
    const id = (await admin.json("/api/software", { body: { name: "AB no folder" } })).data.id;
    const add = await admin.json(`/api/software/${id}/links`, { body: { links: [SP] } });
    expect(add.status).toBe(400);
    expect(add.data.error).toContain("Microsoft connection");
  });
});
