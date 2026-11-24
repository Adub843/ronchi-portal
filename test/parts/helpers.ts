import { env } from "cloudflare:workers";
import app from "../../src/parts/index";
import { SoftAuthenticator } from "../portal/soft-authenticator";

let ipCounter = 0;

/** One customer's browser on the parts site: its own cookie, address and passkey. */
export class Browser {
  cookie = "";
  ip = `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
  passkey = new SoftAuthenticator(env.RP_ID, env.ORIGIN);

  async fetch(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const method = init.method ?? (init.body === undefined ? "GET" : "POST");
    const headers: Record<string, string> = { "cf-connecting-ip": this.ip, ...(init.headers ?? {}) };
    if (this.cookie) headers.cookie = this.cookie;
    if (method !== "GET") {
      headers.origin ??= env.ORIGIN;
      headers["x-ronchi"] ??= "1";
      headers["content-type"] = "application/json";
    }
    const res = await app.request(`${env.ORIGIN}${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }, env);
    const set = res.headers.get("set-cookie");
    if (set) {
      const pair = set.split(";")[0]!;
      this.cookie = /=$/.test(pair) || /Max-Age=0/i.test(set) ? "" : pair;
    }
    return res;
  }

  async json<T = any>(path: string, init: Parameters<Browser["fetch"]>[1] = {}): Promise<{ status: number; data: T }> {
    const res = await this.fetch(path, init);
    return { status: res.status, data: (await res.json()) as T };
  }

  async acceptInvite(link: string) {
    const token = link.split("#")[1]!;
    const opt = await this.json("/api/auth/register/options", { body: { token } });
    if (opt.status !== 200) throw new Error(`register/options ${opt.status} ${JSON.stringify(opt.data)}`);
    const response = await this.passkey.register(opt.data.options);
    const ver = await this.json("/api/auth/register/verify", { body: { token, challengeId: opt.data.challengeId, userId: opt.data.userId, response } });
    if (ver.status !== 200) throw new Error(`register/verify ${ver.status} ${JSON.stringify(ver.data)}`);
  }

  async signIn() {
    const opt = await this.json("/api/auth/login/options", { body: {} });
    const response = await this.passkey.login(opt.data.options);
    return this.json("/api/auth/login/verify", { body: { challengeId: opt.data.challengeId, response } });
  }
}

/** Call the staff-only publish door the way the portal does. */
export async function adminCall(path: string, init: { method?: string; body?: unknown; key?: string | null; raw?: BodyInit; type?: string } = {}) {
  const method = init.method ?? (init.body === undefined && init.raw === undefined ? "GET" : "POST");
  const headers: Record<string, string> = { "cf-connecting-ip": "10.255.0.1" };
  const key = init.key === undefined ? env.TEST_ADMIN_KEY : init.key;
  if (key) headers.authorization = `Bearer ${key}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.type) headers["content-type"] = init.type;
  const res = await app.request(`${env.ORIGIN}/admin${path}`, { method, headers, body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)) }, env);
  return { status: res.status, data: (await res.json().catch(() => null)) as any };
}

let n = 0;
/** A customer company owning the given machines. */
export async function company(serials: string[]) {
  n++;
  const co = await adminCall("/companies", { body: { name: `Bottler ${n}` } });
  await adminCall(`/companies/${co.data.id}/machines`, { method: "PUT", body: { machines: serials.map((serial) => ({ serial })) } });
  return co.data.id as string;
}

/** A signed-in customer at a company. */
export async function customer(companyId: string, role: "standard" | "buyer" = "standard") {
  n++;
  const b = new Browser();
  const email = `c${n}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const inv = await adminCall(`/companies/${companyId}/invites`, { body: { email, name: `Customer ${n}`, role } });
  if (inv.status !== 200) throw new Error(`invite ${inv.status} ${JSON.stringify(inv.data)}`);
  await b.acceptInvite(inv.data.link);
  return Object.assign(b, { email });
}

/** Publish a small catalog for a machine: one assembly with two parts and one sub-assembly. */
export async function publish(serial: string, suffix = "") {
  const top = `sheet-${serial}-top${suffix}`.slice(0, 40);
  const sub = `sheet-${serial}-sub${suffix}`.slice(0, 40);
  const res = await adminCall("/publish", {
    body: {
      machine: { serial, model: "ROTOCAP" },
      sheets: [
        { id: top, section: "machine", title: "Capping head", code: "MB000100", rows: [
          { pos: "1", code: "MB000200", qty: 1, hotspots: [{ x: 0.1, y: 0.1, w: 0.05, h: 0.05 }] },
          { pos: "2", code: `MB${serial.slice(0, 4)}01`, qty: 4 },
        ] },
        { id: sub, parentId: top, section: "machine", title: "Clutch", code: "MB000200", rows: [
          { pos: "1", code: "MB000300", qty: 2 },
        ] },
      ],
      parts: [
        { code: "MB000100", nameEn: "Capping head", nameIt: "Testata" },
        { code: "MB000200", nameEn: "Clutch", nameIt: "Frizione" },
        { code: "MB000300", nameEn: "O-ring", nameIt: "Anello OR", wear: true },
        { code: `MB${serial.slice(0, 4)}01`, nameEn: `Bolt for ${serial}`, nameIt: "Vite" },
      ],
    },
  });
  if (res.status !== 200) throw new Error(`publish ${res.status} ${JSON.stringify(res.data)}`);
  return { top, sub };
}
