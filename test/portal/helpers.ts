import { env } from "cloudflare:workers";
import app from "../../src/portal/index";
import { createInvite } from "../../src/portal/lib/invites";
import { SoftAuthenticator } from "./soft-authenticator";

let ipCounter = 0;

/** One browser: keeps its own cookie and a fake address (so rate limits are per test person). */
export class Browser {
  cookie = "";
  ip = `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
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

  /** Send a form with files, the way the chat sends photos and documents. */
  async form(path: string, form: FormData, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { "cf-connecting-ip": this.ip, origin: env.ORIGIN, "x-ronchi": "1", ...headers };
    if (this.cookie) h.cookie = this.cookie;
    return app.request(`${env.ORIGIN}${path}`, { method: "POST", headers: h, body: form }, env);
  }

  async json<T = any>(path: string, init: Parameters<Browser["fetch"]>[1] = {}): Promise<{ status: number; data: T }> {
    const res = await this.fetch(path, init);
    return { status: res.status, data: (await res.json()) as T };
  }

  /** Accept an invite link and create a passkey, like a new staff member would. */
  async acceptInvite(link: string) {
    const token = link.split("#")[1]!;
    const opt = await this.json("/api/auth/register/options", { body: { token } });
    if (opt.status !== 200) throw new Error(`register/options ${opt.status} ${JSON.stringify(opt.data)}`);
    const response = await this.passkey.register(opt.data.options);
    const ver = await this.json("/api/auth/register/verify", { body: { token, challengeId: opt.data.challengeId, userId: opt.data.userId, response } });
    if (ver.status !== 200) throw new Error(`register/verify ${ver.status} ${JSON.stringify(ver.data)}`);
  }

  async signIn(opts: { origin?: string; userVerified?: boolean } = {}) {
    const opt = await this.json("/api/auth/login/options", { body: {} });
    const response = await this.passkey.login(opt.data.options, opts);
    return this.json("/api/auth/login/verify", { body: { challengeId: opt.data.challengeId, response } });
  }
}

let n = 0;
/** Make a signed-in person with the given role. */
export async function person(role: string, opts: { name?: string } = {}) {
  n++;
  const b = new Browser();
  const email = `${role}${n}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const link = await createInvite(env, { email, name: opts.name ?? `${role} ${n}`, role, createdBy: null });
  await b.acceptInvite(link);
  const me = await b.json("/api/auth/me");
  return Object.assign(b, { id: me.data.user.id as string, email });
}
