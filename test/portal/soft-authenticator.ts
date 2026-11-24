// A software passkey for tests: it creates and signs WebAuthn responses exactly
// the way a phone or laptop would, so the real sign-in code is tested end to end.
import { sha256Hex, toBase64Url, fromBase64Url } from "../../src/shared/crypto";

// --- tiny CBOR encoder (only what WebAuthn needs) ---
function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 256) return [(major << 5) | 24, n];
  if (n < 65536) return [(major << 5) | 25, n >> 8, n & 255];
  return [(major << 5) | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
}
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;
function cbor(v: Cbor): number[] {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") { const b = new TextEncoder().encode(v); return [...head(3, b.length), ...b]; }
  if (v instanceof Uint8Array) return [...head(2, v.length), ...v];
  const out = head(5, v.size);
  for (const [k, val] of v) out.push(...cbor(k), ...cbor(val));
  return out;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  // copy into a plain ArrayBuffer-backed array for Web Crypto
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}
function u32(n: number): Uint8Array { return new Uint8Array([(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]); }

/** ECDSA raw r||s -> DER, which WebAuthn signatures use. */
function derSig(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v: Uint8Array = b.slice(i);
    if (v[0]! & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

export class SoftAuthenticator {
  private keys!: CryptoKeyPair;
  credentialId = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  private counter = 0;
  userHandle = "";
  constructor(private rpId: string, private origin: string) {}

  async register(options: { challenge: string; user: { id: string } }) {
    this.keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    this.userHandle = options.user.id;
    const jwk = (await crypto.subtle.exportKey("jwk", this.keys.publicKey)) as JsonWebKey;
    const cose = new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, fromBase64Url(jwk.x!)], [-3, fromBase64Url(jwk.y!)]]);
    const credId = fromBase64Url(this.credentialId);
    const authData = concat(
      await sha256(new TextEncoder().encode(this.rpId)),
      new Uint8Array([0x45]), // user present + user verified + attested credential data
      u32(this.counter),
      new Uint8Array(16),     // AAGUID
      new Uint8Array([credId.length >> 8, credId.length & 255]),
      credId,
      new Uint8Array(cbor(cose)),
    );
    const clientData = new TextEncoder().encode(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: this.origin, crossOrigin: false }));
    const attObj = new Uint8Array(cbor(new Map<Cbor, Cbor>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]])));
    return {
      id: this.credentialId, rawId: this.credentialId, type: "public-key",
      response: { clientDataJSON: toBase64Url(clientData), attestationObject: toBase64Url(attObj), transports: ["internal"] },
      clientExtensionResults: {},
    };
  }

  async login(options: { challenge: string }, opts: { origin?: string; userVerified?: boolean } = {}) {
    this.counter++;
    const authData = concat(await sha256(new TextEncoder().encode(this.rpId)), new Uint8Array([opts.userVerified === false ? 0x01 : 0x05]), u32(this.counter));
    const clientData = new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin: opts.origin ?? this.origin, crossOrigin: false }));
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keys.privateKey, concat(authData, await sha256(clientData))));
    return {
      id: this.credentialId, rawId: this.credentialId, type: "public-key",
      response: { clientDataJSON: toBase64Url(clientData), authenticatorData: toBase64Url(authData), signature: toBase64Url(derSig(sig)), userHandle: this.userHandle },
      clientExtensionResults: {},
    };
  }
}

export { sha256Hex };
