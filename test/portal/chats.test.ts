import { describe, expect, it } from "vitest";
import { person } from "./helpers";

const file = (name: string, bytes: number | string, type = "application/octet-stream") =>
  new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name, { type });

describe("private chats", () => {
  it("only the people in a chat can see it, admins included", async () => {
    const a = await person("tech");
    const b = await person("service");
    const admin = await person("admin");
    const { data } = await a.json("/api/boards/chats", { body: { userIds: [b.id] } });
    await a.json(`/api/boards/${data.id}/posts`, { body: { body: "Private note" } });
    expect((await b.json(`/api/boards/${data.id}`)).data.posts[0].body).toBe("Private note");
    expect((await admin.fetch(`/api/boards/${data.id}`)).status).toBe(404);
    expect((await admin.json("/api/boards?kind=chat")).data.boards.some((x: any) => x.id === data.id)).toBe(false);
    // Chats never show up in the boards list.
    expect((await a.json("/api/boards")).data.boards.some((x: any) => x.id === data.id)).toBe(false);
    const mine = (await b.json("/api/boards?kind=chat")).data.boards.find((x: any) => x.id === data.id);
    expect(mine.unread).toBe(1);
    expect(mine.members.map((m: any) => m.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("reopens an existing one-to-one chat instead of making a second", async () => {
    const a = await person("tech");
    const b = await person("sales");
    const first = await a.json("/api/boards/chats", { body: { userIds: [b.id] } });
    const again = await b.json("/api/boards/chats", { body: { userIds: [a.id] } });
    expect(again.data.id).toBe(first.data.id);
  });

  it("someone removed from a group chat loses access", async () => {
    const a = await person("tech");
    const b = await person("tech");
    const c = await person("tech");
    const { data } = await a.json("/api/boards/chats", { body: { userIds: [b.id, c.id], name: "Line 3 crew" } });
    expect((await c.fetch(`/api/boards/${data.id}`)).status).toBe(200);
    expect((await b.fetch(`/api/boards/${data.id}`, { method: "PATCH", body: { removeUserIds: [c.id] } })).status).toBe(403);
    expect((await a.fetch(`/api/boards/${data.id}`, { method: "PATCH", body: { removeUserIds: [c.id] } })).status).toBe(200);
    expect((await c.fetch(`/api/boards/${data.id}`)).status).toBe(404);
    await b.json(`/api/boards/${data.id}/leave`, { body: {} });
    expect((await b.fetch(`/api/boards/${data.id}`)).status).toBe(404);
  });
});

describe("adding and removing people", () => {
  it("anyone in a group chat can add people; they see the history and an 'added' line", async () => {
    const a = await person("tech");
    const b = await person("tech");
    const c = await person("engineering");
    const { data } = await a.json("/api/boards/chats", { body: { userIds: [b.id], name: "Atlanta install" } });
    await a.json(`/api/boards/${data.id}/posts`, { body: { body: "Bring the torque wrench" } });
    expect((await c.fetch(`/api/boards/${data.id}`)).status).toBe(404);
    const added = await b.json(`/api/boards/${data.id}/people`, { body: { userIds: [c.id] } });
    expect(added.data).toEqual({ id: data.id, newChat: false });
    const seen = (await c.json(`/api/boards/${data.id}`)).data;
    expect(seen.members.map((m: any) => m.id).sort()).toEqual([a.id, b.id, c.id].sort());
    const event = seen.posts.find((p: any) => p.kind === "event");
    expect(event.user_id).toBe(b.id);
    expect(JSON.parse(event.body)).toEqual({ type: "added", names: [c.name] });
    // The line isn't a message: it doesn't count as unread, can't be edited, removed or replied to.
    expect((await a.json("/api/boards?kind=chat")).data.boards.find((x: any) => x.id === data.id).unread).toBe(0);
    expect((await b.fetch(`/api/boards/${data.id}/posts/${event.id}`, { method: "PATCH", body: { body: "x" } })).status).toBe(404);
    expect((await a.fetch(`/api/boards/${data.id}/posts/${event.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await a.fetch(`/api/boards/${data.id}/posts`, { body: { body: "hi", parentId: event.id } })).status).toBe(400);
    // Adding someone who is already there is refused.
    expect((await a.fetch(`/api/boards/${data.id}/people`, { body: { userIds: [c.id] } })).status).toBe(400);
  });

  it("only the person who started the chat can remove people, and the removed person loses access", async () => {
    const a = await person("tech");
    const b = await person("tech");
    const c = await person("tech");
    const { data } = await a.json("/api/boards/chats", { body: { userIds: [b.id, c.id], name: "Line 4" } });
    expect((await b.fetch(`/api/boards/${data.id}/people/${c.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await a.fetch(`/api/boards/${data.id}/people/${a.id}`, { method: "DELETE" })).status).toBe(400);
    expect((await a.fetch(`/api/boards/${data.id}/people/${c.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await c.fetch(`/api/boards/${data.id}`)).status).toBe(404);
    expect((await c.fetch(`/api/boards/${data.id}/posts`, { body: { body: "still here?" } })).status).toBe(404);
    expect((await a.fetch(`/api/boards/${data.id}/people/${c.id}`, { method: "DELETE" })).status).toBe(404);
    const posts = (await b.json(`/api/boards/${data.id}`)).data.posts;
    expect(JSON.parse(posts.find((p: any) => p.kind === "event").body)).toEqual({ type: "removed", names: [c.name] });
  });

  it("adding someone to a one-to-one chat starts a new group, so the old messages stay private", async () => {
    const a = await person("tech");
    const b = await person("service");
    const c = await person("sales");
    const { data } = await a.json("/api/boards/chats", { body: { userIds: [b.id] } });
    await a.json(`/api/boards/${data.id}/posts`, { body: { body: "Just between us" } });
    const r = (await b.json(`/api/boards/${data.id}/people`, { body: { userIds: [c.id] } })).data;
    expect(r.newChat).toBe(true);
    expect(r.id).not.toBe(data.id);
    expect((await c.fetch(`/api/boards/${data.id}`)).status).toBe(404);
    const group = (await c.json(`/api/boards/${r.id}`)).data;
    expect(group.members.length).toBe(3);
    expect(group.posts.some((p: any) => p.body === "Just between us")).toBe(false);
    expect(group.canModerate).toBe(false);
    expect((await b.json(`/api/boards/${r.id}`)).data.canModerate).toBe(true);
  });

  it("when the person who started a chat leaves, the next person can manage it", async () => {
    const a = await person("tech");
    const b = await person("tech");
    const c = await person("tech");
    const { data } = await a.json("/api/boards/chats", { body: { userIds: [b.id, c.id], name: "Night shift" } });
    await a.json(`/api/boards/${data.id}/leave`, { body: {} });
    const seen = (await b.json(`/api/boards/${data.id}`)).data;
    expect(seen.canModerate).toBe(true);
    expect(JSON.parse(seen.posts.find((p: any) => p.kind === "event").body).type).toBe("left");
    const text = await (await b.fetch(`/api/boards/${data.id}/export`)).text();
    expect(text).toContain(`${a.name} left the chat`);
    // Lines about people never pop up as alerts.
    const since = new Date(Date.now() - 60000).toISOString();
    expect((await c.json(`/api/boards/updates?since=${since}`)).data.posts).toEqual([]);
  });
});

describe("files in chats", () => {
  it("sends a photo and a PDF, and only people who can see the chat can open them", async () => {
    const a = await person("tech");
    const b = await person("service");
    const outsider = await person("sales");
    const { data } = await a.json("/api/boards/chats", { body: { userIds: [b.id] } });
    const form = new FormData();
    form.set("body", "Photo of the O-rings");
    form.append("files", file("o-rings.jpg", 2048, "image/jpeg"));
    form.append("files", file("report.pdf", "%PDF-1.4 example", "text/html"));
    expect((await a.form(`/api/boards/${data.id}/posts`, form)).status).toBe(200);
    const post = (await b.json(`/api/boards/${data.id}`)).data.posts[0];
    expect(post.files.map((f: any) => [f.name, f.kind])).toEqual([["o-rings.jpg", "image"], ["report.pdf", "pdf"]]);
    const photo = await b.fetch(`/api/files/${post.files[0].id}`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");
    expect(photo.headers.get("content-disposition")).toMatch(/^inline/);
    expect((await photo.arrayBuffer()).byteLength).toBe(2048);
    // The PDF is served as a PDF download, whatever type the browser claimed.
    const pdf = await b.fetch(`/api/files/${post.files[1].id}`);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(pdf.headers.get("content-security-policy")).toMatch(/sandbox/);
    expect((await outsider.fetch(`/api/files/${post.files[0].id}`)).status).toBe(404);
    expect((await (await person("admin")).fetch(`/api/files/${post.files[0].id}`)).status).toBe(404);
  });

  it("refuses web pages, scripts and files over 25 MB", async () => {
    const a = await person("tech");
    const { data } = await a.json("/api/boards", { body: { name: "Uploads" } });
    for (const bad of [file("page.html", "<script>alert(1)</script>"), file("logo.svg", "<svg/>"), file("tool.exe", 10), file("big.zip", 25 * 1024 * 1024 + 1)]) {
      const form = new FormData();
      form.append("files", bad);
      expect((await a.form(`/api/boards/${data.id}/posts`, form)).status).toBe(400);
    }
    expect((await a.json(`/api/boards/${data.id}`)).data.posts).toHaveLength(0);
  });

  it("removing a message hides its files", async () => {
    const a = await person("tech");
    const { data } = await a.json("/api/boards", { body: { name: "Remove test" } });
    const form = new FormData();
    form.append("files", file("drawing.pdf", 100));
    const { id } = (await (await a.form(`/api/boards/${data.id}/posts`, form)).json()) as { id: string };
    const fid = (await a.json(`/api/boards/${data.id}/files`)).data.files[0].id;
    await a.fetch(`/api/boards/${data.id}/posts/${id}`, { method: "DELETE" });
    expect((await a.fetch(`/api/files/${fid}`)).status).toBe(404);
  });
});

describe("chat controls", () => {
  it("pop-up updates skip your own messages, muted chats and chats you're not in", async () => {
    const a = await person("tech");
    const b = await person("service");
    const since = (await b.json("/api/boards/updates")).data.now;
    const board = (await a.json("/api/boards", { body: { name: "Updates test" } })).data.id;
    const muted = (await a.json("/api/boards", { body: { name: "Muted test" } })).data.id;
    const other = (await a.json("/api/boards/chats", { body: { userIds: [(await person("sales")).id] } })).data.id;
    await b.json(`/api/boards/${muted}/mute`, { body: { muted: true } });
    await a.json(`/api/boards/${board}/posts`, { body: { body: "New one" } });
    await a.json(`/api/boards/${muted}/posts`, { body: { body: "Quiet one" } });
    await a.json(`/api/boards/${other}/posts`, { body: { body: "Not for b" } });
    await b.json(`/api/boards/${board}/posts`, { body: { body: "My own" } });
    const up = (await b.json(`/api/boards/updates?since=${since}`)).data;
    expect(up.posts.map((p: any) => p.body)).toEqual(["New one"]);
    expect(up.unread.boards).toBeGreaterThanOrEqual(2);
  });

  it("announcement-only boards: only the creator and moderators post", async () => {
    const owner = await person("tech");
    const tech = await person("tech");
    const { data } = await owner.json("/api/boards", { body: { name: "Announcements" } });
    expect((await tech.fetch(`/api/boards/${data.id}`, { method: "PATCH", body: { locked: true } })).status).toBe(403);
    await owner.json(`/api/boards/${data.id}`, { method: "PATCH", body: { locked: true, name: "Company news" } });
    expect((await tech.fetch(`/api/boards/${data.id}/posts`, { body: { body: "hi" } })).status).toBe(403);
    expect((await owner.fetch(`/api/boards/${data.id}/posts`, { body: { body: "Office closed Friday" } })).status).toBe(200);
    expect((await (await person("service")).fetch(`/api/boards/${data.id}/posts`, { body: { body: "Noted" } })).status).toBe(200);
    expect((await tech.json(`/api/boards/${data.id}`)).data).toMatchObject({ canPost: false, board: { name: "Company news" } });
  });

  it("admins can export, archive and restore a board; others can't export it", async () => {
    const tech = await person("tech");
    const admin = await person("admin");
    const { data } = await tech.json("/api/boards", { body: { name: "Export me" } });
    await tech.json(`/api/boards/${data.id}/posts`, { body: { body: "Line one" } });
    expect((await (await person("sales")).fetch(`/api/boards/${data.id}/export`)).status).toBe(403);
    const ex = await admin.fetch(`/api/boards/${data.id}/export`);
    expect(await ex.text()).toMatch(/: Line one/);
    await admin.json(`/api/boards/${data.id}/archive`, { body: {} });
    expect((await admin.json("/api/boards/archived")).data.boards.some((b: any) => b.id === data.id)).toBe(true);
    expect((await tech.fetch(`/api/boards/${data.id}/unarchive`, { body: {} })).status).toBe(403);
    await admin.json(`/api/boards/${data.id}/unarchive`, { body: {} });
    expect((await tech.json("/api/boards")).data.boards.some((b: any) => b.id === data.id)).toBe(true);
  });

  it("mark all read clears every unread count", async () => {
    const a = await person("tech");
    const b = await person("tech");
    const { data } = await a.json("/api/boards/chats", { body: { userIds: [b.id] } });
    await a.json(`/api/boards/${data.id}/posts`, { body: { body: "ping" } });
    expect((await b.json("/api/boards/updates")).data.unread.chats).toBe(1);
    await b.json("/api/boards/read-all", { body: {} });
    expect((await b.json("/api/boards/updates")).data.unread.chats).toBe(0);
  });

  it("saves language and pop-up choice to the login", async () => {
    const p = await person("tech");
    expect((await p.json("/api/prefs")).data).toMatchObject({ lang: "en", popups: true });
    await p.json("/api/prefs", { method: "PUT", body: { theme: "ronchi", lang: "it", popups: false } });
    expect((await p.json("/api/prefs")).data).toMatchObject({ lang: "it", popups: false });
    expect((await p.fetch("/api/prefs", { method: "PUT", body: { theme: "ronchi", lang: "fr" } })).status).toBe(400);
  });
});
